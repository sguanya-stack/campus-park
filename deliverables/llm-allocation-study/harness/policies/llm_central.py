"""
T1 -- LLM single-shot central allocator (research_proposal_llm_allocation.md §0, §3.1).

One Claude Opus 5 call per 10-minute decision window: the model sees every
request that arrived in that window plus the current spot state, and must
return a complete assignment via the strict `submit_allocation` tool. No
negotiation rounds (that's T2, llm_negotiate.py) -- this is the ablation
that isolates "does batching + reasoning help" from "does multi-round
negotiation help on top of that".

Requires ANTHROPIC_API_KEY. Each call costs real money -- see the
proposal §6.2 cost table before running more than a couple of episodes.
"""

from __future__ import annotations

import time

from ..scenario import DECISION_STEP_MINUTES
from .base import Assignment, Policy
from .llm_common import (
    ALLOCATION_TOOL,
    UTILITY_FORMULA_TEXT,
    commit_llm_choice,
    group_into_windows,
    parse_tool_input,
    request_menu_text,
    spot_menu_text,
    usage_cost_usd,
)

SYSTEM_PROMPT = f"""You are the central parking-allocation engine for a campus parking \
system. Each call, you are given every reservation request that arrived in \
one 10-minute decision window, plus the current state of every parking \
spot, and you must decide who gets which spot right now.

Ground-truth objective (matches exactly what the system will use to score \
this allocation -- there is no hidden information):
{UTILITY_FORMULA_TEXT}

Hard constraints (violating these gets your allocation for that request \
rejected -- it will not be repaired or retried):
- A spot cannot host more overlapping reservations than its stated capacity.
- A request needing EV charging can only go to an EV-flagged spot.
- Every request_id given to you must appear exactly once in your output; \
use spot_id=null for requests you intentionally leave unassigned.

Your goal: maximize total realized utility across all requests in this \
window (sum of utility for every request you successfully match), while \
respecting the hard constraints and never assigning a spot with utility \
below that request's reservation_u_min. You may leave some requests \
unassigned if no legal, worthwhile spot exists for them, especially when \
that frees capacity for a higher-value match elsewhere in the window.

Respond ONLY by calling the submit_allocation tool."""


class LLMCentralPolicy(Policy):
    name = "llm_central"

    def __init__(self, model: str = "claude-opus-5", effort: str = "high", **_ignored):
        self.model = model
        self.effort = effort
        self.last_cost_usd = 0.0
        self.last_parse_failure_rate = 0.0
        self.last_transcript: list[dict] = []

    def allocate(self, spots, requests) -> list[Assignment]:
        import anthropic

        from ..interval_lanes import build_ledgers

        client = anthropic.Anthropic()

        req_by_id = {r.id: r for r in requests}
        spot_by_id = {s.id: s for s in spots}
        ledgers = build_ledgers(spots)

        windows = group_into_windows(requests)
        assignments: dict[str, Assignment] = {}
        n_windows = 0
        n_parse_failures = 0
        total_cost = 0.0
        transcript: list[dict] = []

        for window in windows:
            n_windows += 1
            w_start = int(window[0].arrival_minute // DECISION_STEP_MINUTES) * DECISION_STEP_MINUTES
            w_end = w_start + DECISION_STEP_MINUTES

            user_msg = (
                f"Decision window [{w_start}, {w_end}) minutes.\n\n"
                f"Spots:\n{spot_menu_text(spots, ledgers, w_start, w_end)}\n\n"
                f"Requests in this window:\n{request_menu_text(window, spots)}\n\n"
                f"Return an assignment for all {len(window)} request_id(s) above."
            )

            t0 = time.perf_counter()
            try:
                response = client.messages.create(
                    model=self.model,
                    max_tokens=8000,
                    system=[{
                        "type": "text",
                        "text": SYSTEM_PROMPT,
                        "cache_control": {"type": "ephemeral"},
                    }],
                    tools=[ALLOCATION_TOOL],
                    tool_choice={"type": "tool", "name": "submit_allocation"},
                    output_config={"effort": self.effort},
                    messages=[{"role": "user", "content": user_msg}],
                )
            except Exception as e:  # noqa: BLE001 -- record and move on, never retry
                n_parse_failures += 1
                for r in window:
                    assignments[r.id] = Assignment(r.id, None, None)
                transcript.append({"window": [w_start, w_end], "error": repr(e)})
                continue

            total_cost += usage_cost_usd(self.model, response.usage)
            parsed = parse_tool_input(response)
            transcript.append({
                "window": [w_start, w_end],
                "n_requests": len(window),
                "latency_s": time.perf_counter() - t0,
                "usage": getattr(response, "usage", None) and response.usage.model_dump(),
                "parsed_ok": parsed is not None,
            })

            if parsed is None or "assignments" not in parsed:
                n_parse_failures += 1
                for r in window:
                    assignments[r.id] = Assignment(r.id, None, None)
                continue

            chosen_by_req = {
                item.get("request_id"): item.get("spot_id")
                for item in parsed["assignments"]
                if isinstance(item, dict)
            }
            for r in window:
                spot_id = chosen_by_req.get(r.id)  # missing -> treated as null (unassigned)
                result = commit_llm_choice(req_by_id, spot_by_id, ledgers, r.id, spot_id)
                assignments[r.id] = result.assignment

        self.last_cost_usd = total_cost
        self.last_parse_failure_rate = n_parse_failures / n_windows if n_windows else 0.0
        self.last_transcript = transcript

        return [assignments.get(r.id, Assignment(r.id, None, None)) for r in requests]
