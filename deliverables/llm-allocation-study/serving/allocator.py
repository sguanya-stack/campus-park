"""
The production allocator: an LLM policy wrapped in everything needed to
run it against real users.

Composition (each layer is separately testable):

    request
      -> cost budget guard      (refuse to spend past a ceiling)
      -> circuit breaker        (skip the model entirely when it's failing)
      -> deadline + retry       (bounded, jittered; NOT used in the research path)
      -> LLM policy             (harness/, unmodified and pre-registered)
      -> validator gate         (drop illegal allocations, never repair)
      -> Greedy fallback        (re-decide everything the model lost)
      -> telemetry              (latency, cost, illegal rate, fallback rate)

The retry/fallback behavior here is deliberately ABSENT from the research
path: PRE_REGISTRATION.md §5 forbids retrying failed episodes and repairing
illegal allocations, because both would erase the failure modes the study
measures. Production has the opposite obligation. Keeping the two in
separate layers is what lets both be true at once.
"""

from __future__ import annotations

import random
import time
from concurrent.futures import ThreadPoolExecutor, TimeoutError as FutureTimeout
from dataclasses import dataclass

from harness.data_loader import load_spots
from harness.policies.greedy_policy import GreedyPolicy

from .safety import BreakerConfig, CircuitBreaker, gate_allocations
from .telemetry import Event, Telemetry, now_ms


@dataclass
class AllocatorConfig:
    deadline_s: float = 25.0
    max_attempts: int = 2          # 1 retry; more just burns money on a sick model
    backoff_base_s: float = 0.5
    cost_ceiling_usd: float = 25.0  # process-lifetime budget; refuses past this
    illegal_rate_alarm: float = 0.05


class ProductionAllocator:
    def __init__(
        self,
        policy_factory=None,
        config: AllocatorConfig | None = None,
        telemetry: Telemetry | None = None,
        breaker: CircuitBreaker | None = None,
        spots=None,
    ):
        self.config = config or AllocatorConfig()
        self.telemetry = telemetry or Telemetry()
        self.breaker = breaker or CircuitBreaker(BreakerConfig())
        self.spots = spots if spots is not None else load_spots(target_total_capacity=240)
        self.policy_factory = policy_factory or _default_policy_factory
        self._spent_usd = 0.0

    # ── public API ──────────────────────────────────────────────────────

    def allocate(self, requests) -> dict:
        started = now_ms()
        reason = None
        cost = 0.0
        illegal = 0
        assignments = None
        policy_name = "greedy"

        if self._spent_usd >= self.config.cost_ceiling_usd:
            reason = "cost_ceiling"
        elif not self.breaker.allows_llm():
            reason = "circuit_open"

        if reason is None:
            try:
                assignments, cost, policy_name = self._try_llm(requests)
                gate = gate_allocations(self.spots, requests, assignments)
                illegal = gate.illegal_count
                if gate.rejected_request_ids:
                    assignments = self._patch_with_fallback(
                        requests, gate.kept, set(gate.rejected_request_ids)
                    )
                    reason = "illegal_allocations"
                self.breaker.record(failed=illegal > 0)
            except Exception as exc:  # noqa: BLE001 -- degrade, never 500 the caller
                self.breaker.record(failed=True)
                reason = f"llm_error:{type(exc).__name__}"
                assignments = None

        if assignments is None:
            assignments = GreedyPolicy().allocate(self.spots, requests)
            policy_name = "greedy"

        self._spent_usd += cost
        satisfied = sum(1 for a in assignments if a.spot_id is not None and a.utility is not None)
        outcome = "ok" if reason is None else ("error" if "error" in (reason or "") else "fallback")

        self.telemetry.emit(Event(
            ts=time.time(), event="decision", request_count=len(requests),
            policy=policy_name, outcome=outcome,
            latency_ms=now_ms() - started, cost_usd=cost,
            illegal_count=illegal, satisfied=satisfied,
            detail={
                "reason": reason,
                "breaker": self.breaker.state.value,
                "spent_usd": round(self._spent_usd, 4),
            },
        ))

        return {
            "assignments": [
                {"request_id": a.request_id, "spot_id": a.spot_id, "utility": a.utility}
                for a in assignments
            ],
            "policy": policy_name,
            "degraded": reason is not None,
            "reason": reason,
            "satisfied": satisfied,
            "illegal_rejected": illegal,
            "cost_usd": round(cost, 6),
        }

    # ── internals ───────────────────────────────────────────────────────

    def _try_llm(self, requests):
        """Bounded retries under a wall-clock deadline.

        Note on the deadline: a timed-out call is abandoned by the caller
        but the underlying HTTP request may keep running in its thread --
        Python cannot cancel it. The deadline bounds what the *user* waits
        for, not what we pay for; the cost ceiling is what bounds spend.
        """
        deadline = time.monotonic() + self.config.deadline_s
        last_exc = None

        for attempt in range(self.config.max_attempts):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise TimeoutError("deadline exhausted before attempt")

            policy = self.policy_factory()
            # NOT a context manager: `with ThreadPoolExecutor(...)` calls
            # shutdown(wait=True) on exit, which blocks until the hung worker
            # returns -- making the timeout above decorative. Shut down
            # without waiting instead and abandon the thread.
            pool = ThreadPoolExecutor(max_workers=1)
            try:
                fut = pool.submit(policy.allocate, self.spots, requests)
                assignments = fut.result(timeout=remaining)
                return assignments, getattr(policy, "last_cost_usd", 0.0), policy.name
            except FutureTimeout:
                last_exc = TimeoutError(f"LLM allocation exceeded {self.config.deadline_s}s")
                break  # retrying a timeout just burns the rest of the deadline
            except Exception as exc:  # noqa: BLE001
                last_exc = exc
                if attempt + 1 < self.config.max_attempts:
                    time.sleep(min(
                        self.config.backoff_base_s * (2 ** attempt) + random.uniform(0, 0.25),
                        max(0.0, deadline - time.monotonic()),
                    ))
            finally:
                # cancel_futures only cancels queued work; a call already in
                # flight keeps running to completion in its own thread. The
                # caller stops waiting, but we may still be billed for it --
                # which is why cost_ceiling_usd, not the deadline, is what
                # actually bounds spend.
                pool.shutdown(wait=False, cancel_futures=True)

        raise last_exc or RuntimeError("LLM allocation failed")

    def _patch_with_fallback(self, requests, kept, rejected_ids):
        """Re-decide the rejected requests with Greedy, against a fleet
        already holding the model's legal allocations."""
        kept_by_id = {a.request_id: a for a in kept}
        redo = [r for r in requests if r.id in rejected_ids or r.id not in kept_by_id]
        if not redo:
            return [kept_by_id[r.id] for r in requests]

        from harness.interval_lanes import build_ledgers
        from harness.policies.base import Assignment

        ledgers = build_ledgers(self.spots)
        by_id = {s.id: s for s in self.spots}
        for a in kept:
            if a.spot_id is not None and a.utility is not None:
                req = next(r for r in requests if r.id == a.request_id)
                ledgers[a.spot_id].book(req.start_minute, req.end_minute)

        for req in redo:
            best, best_u = None, None
            for s in self.spots:
                if not req.is_eligible(s):
                    continue
                if not ledgers[s.id].has_capacity(req.start_minute, req.end_minute):
                    continue
                u = req.utility(s)
                if best_u is None or u > best_u:
                    best, best_u = s, u
            if best is None or best_u < req.u_min:
                kept_by_id[req.id] = Assignment(req.id, None, None)
            else:
                lane = ledgers[best.id].book(req.start_minute, req.end_minute)
                kept_by_id[req.id] = Assignment(req.id, best.id, best_u, lane)

        return [kept_by_id.get(r.id, Assignment(r.id, None, None)) for r in requests]

    def health(self) -> dict:
        m = self.telemetry.snapshot()
        healthy = (
            self.breaker.state.value != "open"
            and m["illegal_allocation_rate"] <= self.config.illegal_rate_alarm
            and self._spent_usd < self.config.cost_ceiling_usd
        )
        return {
            "status": "ok" if healthy else "degraded",
            # "simulated" means a fake model is driving this, for demonstrating
            # the safety layer without an API key. Never research data.
            "mode": getattr(self, "mode", "live"),
            "policy": getattr(self, "policy_name", "unknown"),
            "breaker": self.breaker.state.value,
            "spent_usd": round(self._spent_usd, 4),
            "cost_ceiling_usd": self.config.cost_ceiling_usd,
            "illegal_allocation_rate": m["illegal_allocation_rate"],
        }


def _default_policy_factory():
    from harness.policies.llm_negotiate import LLMNegotiatePolicy

    return LLMNegotiatePolicy()
