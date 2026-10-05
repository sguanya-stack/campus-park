"""
The safety layer that makes an LLM allocator shippable.

This exists because of a research finding, not a hunch: hypothesis H3 is
that LLM allocators produce allocations that are *structurally impossible*
for a classical scheduler -- hallucinated spot IDs, double bookings, EV
mismatches. A system that trusts the model's output will happily
double-book a physical parking space.

So production never trusts it. Every LLM allocation passes through the
SAME validator the experiment uses, and anything that fails is dropped and
re-decided by Greedy. On top of that, a circuit breaker watches the
failure rate and stops paying for the model entirely when it misbehaves.

Nothing here modifies `harness/` -- the research policies stay exactly as
pre-registered (no retries, no repair), and this wraps them.
"""

from __future__ import annotations

import threading
import time
from dataclasses import dataclass
from enum import Enum


class BreakerState(str, Enum):
    CLOSED = "closed"        # LLM in use
    OPEN = "open"            # LLM bypassed, serving fallback only
    HALF_OPEN = "half_open"  # trial request allowed through


@dataclass
class BreakerConfig:
    failure_threshold: float = 0.25   # fraction of recent decisions that failed
    min_samples: int = 5              # don't trip on a tiny sample
    cooldown_s: float = 60.0          # how long OPEN lasts before a trial
    window: int = 20                  # rolling decisions considered


class CircuitBreaker:
    """Trips when the LLM path fails too often, so a degraded model costs
    money once rather than on every request."""

    def __init__(self, config: BreakerConfig | None = None):
        self.config = config or BreakerConfig()
        self._lock = threading.Lock()
        self._results: list[bool] = []   # True = failure
        self._state = BreakerState.CLOSED
        self._opened_at = 0.0

    @property
    def state(self) -> BreakerState:
        with self._lock:
            return self._observe_state()

    def _observe_state(self) -> BreakerState:
        if self._state is BreakerState.OPEN:
            if time.monotonic() - self._opened_at >= self.config.cooldown_s:
                self._state = BreakerState.HALF_OPEN
        return self._state

    def allows_llm(self) -> bool:
        with self._lock:
            return self._observe_state() is not BreakerState.OPEN

    def record(self, failed: bool) -> None:
        with self._lock:
            state = self._observe_state()
            self._results.append(failed)
            del self._results[: max(0, len(self._results) - self.config.window)]

            if state is BreakerState.HALF_OPEN:
                # One trial decides it: recovered, or straight back to open.
                if failed:
                    self._state = BreakerState.OPEN
                    self._opened_at = time.monotonic()
                else:
                    self._state = BreakerState.CLOSED
                    self._results.clear()
                return

            if len(self._results) >= self.config.min_samples:
                rate = sum(self._results) / len(self._results)
                if rate >= self.config.failure_threshold:
                    self._state = BreakerState.OPEN
                    self._opened_at = time.monotonic()

    def reset(self) -> None:
        with self._lock:
            self._state = BreakerState.CLOSED
            self._results.clear()


@dataclass
class GateResult:
    kept: list           # assignments that passed validation
    rejected_request_ids: list[str]
    illegal_count: int


def gate_allocations(spots, requests, assignments) -> GateResult:
    """Drop every allocation that violates a hard constraint.

    Uses `harness.validator` -- the same code the experiment scores with --
    so production and the study agree on what "legal" means. Rejected
    requests are returned for the fallback to re-decide; they are never
    patched into validity, because a patched allocation would hide exactly
    the failure mode H3 measures.
    """
    from harness.validator import validate

    report = validate(spots, requests, assignments)
    bad_ids = {v.request_id for v in report.violations}

    kept = []
    for a in assignments:
        if a.request_id in bad_ids:
            continue
        if a.spot_id is not None and a.utility is None:
            # committed by the policy but not actually satisfied
            continue
        kept.append(a)

    return GateResult(
        kept=kept,
        rejected_request_ids=sorted(bad_ids),
        illegal_count=report.n_illegal,
    )
