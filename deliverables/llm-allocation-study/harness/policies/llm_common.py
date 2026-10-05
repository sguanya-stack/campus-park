"""
Shared plumbing for the LLM policies (T1 llm_central, T2 llm_negotiate):
pricing table, window grouping, prompt scaffolding, strict-schema tool
definitions, and the "commit but never repair" booking rule that makes
H3 (illegal allocation rate) measurable instead of laundered away.

Design decision that must stay visible to anyone reading results: T1/T2
decide in 10-minute batches (all requests that arrived in the same window
are decided together in one/few API calls), while the classic baselines
(random/fifo/greedy) decide one request at a time, immediately at arrival.
Batching is *what a central allocator means* and is unavoidable for cost
reasons (per-request LLM calls would be 100-1000x the cost), but it does
give T1/T2 a within-window information advantage that the classic
baselines don't have. This is reported, not hidden -- see
research_proposal_llm_allocation.md §3.2 and the study README.
"""

from __future__ import annotations

import json
from dataclasses import dataclass

from ..interval_lanes import SpotLedger
from ..scenario import DECISION_STEP_MINUTES, Request, WINDOW_MINUTES
from .base import Assignment

# Anthropic list pricing, $ per million tokens (research_proposal_llm_allocation.md §6.2).
# Keep in sync with the proposal if pricing changes; this is the ONLY place
# the numbers live so cost figures can't drift between T1 and T2.
PRICING_USD_PER_MTOK = {
    "claude-opus-5": {"input": 5.00, "output": 25.00},
    "claude-haiku-4-5": {"input": 1.00, "output": 5.00},
    "claude-sonnet-5": {"input": 2.00, "output": 10.00},
}


def usage_cost_usd(model: str, usage) -> float:
    """response.usage -> $ cost, using the table above. Cache read/write
    tokens are billed at the same effective rate as regular input tokens
    here for simplicity; refine with cache_read/creation fields once
    caching is actually measured empirically (see proposal §6.2)."""
    prices = PRICING_USD_PER_MTOK.get(model)
    if prices is None:
        raise ValueError(f"No pricing entry for model {model!r} -- add one before spending money on it.")
    input_tokens = getattr(usage, "input_tokens", 0) or 0
    output_tokens = getattr(usage, "output_tokens", 0) or 0
    cache_read = getattr(usage, "cache_read_input_tokens", 0) or 0
    cache_write = getattr(usage, "cache_creation_input_tokens", 0) or 0
    cost = (
        input_tokens * prices["input"]
        + cache_write * prices["input"] * 1.25
        + cache_read * prices["input"] * 0.1
        + output_tokens * prices["output"]
    ) / 1_000_000.0
    return cost


def group_into_windows(requests: list[Request], step_minutes: int = DECISION_STEP_MINUTES):
    """Bucket requests by arrival time into fixed-width decision windows,
    in chronological order. Returns list[list[Request]]."""
    n_windows = int(WINDOW_MINUTES // step_minutes) + 1
    buckets: list[list[Request]] = [[] for _ in range(n_windows)]
    for r in requests:
        idx = min(n_windows - 1, int(r.arrival_minute // step_minutes))
        buckets[idx].append(r)
    return [b for b in buckets if b]


def spot_menu_text(spots, ledgers: dict[str, SpotLedger], window_start: int, window_end: int) -> str:
    """Human/model-readable snapshot of current spot state for a prompt.
    Deliberately includes only what a real allocator would know: price,
    EV flag, distance is NOT globally known (it's per-user), and current
    free-lane count for a representative interval within this window."""
    lines = []
    for s in spots:
        free_now = sum(
            1
            for lane in ledgers[s.id].lanes
            if all(not (window_start < e and st < window_end) for (st, e) in lane)
        )
        lines.append(
            f"- spot_id={s.id} price_per_hour=${s.price_per_hour:.2f} "
            f"capacity={s.capacity} free_lanes_this_window~={free_now} is_ev={s.is_ev}"
        )
    return "\n".join(lines)


def request_menu_text(requests: list[Request], spots) -> str:
    """Gives the model exactly the inputs the ground-truth utility formula
    needs -- the SAME information the classic (random/fifo/greedy)
    policies use internally -- so the comparison tests reasoning/
    negotiation quality, not information asymmetry."""
    lines = []
    for r in requests:
        eligible = [s for s in spots if r.is_eligible(s)]
        dist_parts = ", ".join(
            f"{s.id}:{r.distance_to(s):.0f}m" for s in eligible
        )
        lines.append(
            f"- request_id={r.id} arrival_min={r.arrival_minute:.1f} "
            f"start_min={r.start_minute} end_min={r.end_minute} "
            f"duration_min={r.duration_minutes:.0f} "
            f"trip_value=${r.trip_value:.2f} price_weight={r.price_weight:.2f} "
            f"walk_weight=${r.walk_weight:.3f}/m walk_tolerance_m={r.walk_tolerance_m:.0f} "
            f"needs_ev={r.needs_ev} reservation_u_min=${r.u_min:.2f} "
            f"distance_to_eligible_spots=[{dist_parts}]"
        )
    return "\n".join(lines)


UTILITY_FORMULA_TEXT = (
    "utility(request, spot) = trip_value "
    "- price_weight * spot.price_per_hour * (duration_min / 60) "
    "- walk_weight * max(0, distance_to_spot_m - walk_tolerance_m)\n"
    "A request may only be assigned a spot if utility(request, spot) >= "
    "reservation_u_min for that request, and the spot must appear in that "
    "request's distance_to_eligible_spots list (EV requirement already "
    "filtered)."
)


ALLOCATION_TOOL = {
    "name": "submit_allocation",
    "description": (
        "Submit the final spot assignment for every request_id in this "
        "decision window. Every request_id given in the prompt MUST appear "
        "exactly once in `assignments`. Use spot_id=null to leave a request "
        "unsatisfied (no legal spot available or not worth it for that user)."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "assignments": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "request_id": {"type": "string"},
                        "spot_id": {"type": ["string", "null"]},
                    },
                    "required": ["request_id", "spot_id"],
                    "additionalProperties": False,
                },
            }
        },
        "required": ["assignments"],
        "additionalProperties": False,
    },
    "strict": True,
}


@dataclass
class CommitResult:
    assignment: Assignment
    is_illegal: bool  # True if the model's choice was rejected by the ledger


def commit_llm_choice(
    req_by_id: dict[str, Request],
    spot_by_id: dict,
    ledgers: dict[str, SpotLedger],
    request_id: str,
    spot_id: str | None,
) -> CommitResult:
    """Attempt to actually book what the model chose. Mirrors CampusPark's
    real 'check inventory -> atomic decrement' transaction (test-concurrency.js):
    the attempt is either legally committed or rejected outright -- never
    silently repaired or retried, so illegal choices stay visible to the
    validator and to H3's illegal_allocation_rate.
    """
    req = req_by_id.get(request_id)
    if req is None or spot_id is None:
        return CommitResult(Assignment(request_id, None, None), is_illegal=False)

    spot = spot_by_id.get(spot_id)
    if spot is None:
        # Model hallucinated a spot_id that doesn't exist.
        return CommitResult(Assignment(request_id, spot_id, None), is_illegal=True)

    if not req.is_eligible(spot):
        return CommitResult(Assignment(request_id, spot_id, None), is_illegal=True)

    utility = req.utility(spot)
    if utility < req.u_min:
        # Not a hard-constraint violation -- the spot is real, eligible, and
        # (as far as we've checked) available, but the deal doesn't clear
        # this user's own reservation threshold. random/fifo/greedy never
        # even attempt a below-threshold match, so for a fair comparison an
        # LLM choice that fails this same bar must NOT count as "satisfied"
        # either. Report as unsatisfied (spot_id=None) and do NOT book --
        # capacity stays free for another request in this window.
        return CommitResult(Assignment(request_id, None, None), is_illegal=False)

    ledger = ledgers[spot_id]
    if not ledger.has_capacity(req.start_minute, req.end_minute):
        return CommitResult(Assignment(request_id, spot_id, None), is_illegal=True)

    lane_idx = ledger.book(req.start_minute, req.end_minute)
    return CommitResult(Assignment(request_id, spot_id, utility, lane_idx), is_illegal=False)


def parse_tool_input(response, tool_name: str = "submit_allocation") -> dict | None:
    """Extract the first `tool_name` tool_use block's input. Defaults to
    "submit_allocation" (T1's only tool, and T2's final-round tool) --
    pass tool_name="submit_tentative_allocation" for T2's round-2 call.
    Returns None on any structural failure (counts as a parse failure,
    per the proposal's rule that parse failures are recorded, not retried)."""
    for block in response.content:
        if getattr(block, "type", None) == "tool_use" and block.name == tool_name:
            return block.input if isinstance(block.input, dict) else None
    return None
