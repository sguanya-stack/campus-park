"""
T2 -- LLM multi-round negotiation (research_proposal_llm_allocation.md §0, §3.2).

Per 10-minute decision window, three rounds:
  Round 1: every request gets its own "user-agent" call (Claude Haiku 4.5)
           that ranks eligible spots by its own preference and states how
           much it's willing to concede (widen walk tolerance) if it
           doesn't get an early choice.
  Round 2: the broker (Claude Opus 5) sees every bid + spot state and
           proposes a TENTATIVE allocation, flagging a subset of
           request_ids to send back for one revision round (e.g. requests
           that got nothing, or a low-ranked spot, in a contested spot).
  Round 2.5: only the flagged agents get a second call with their
           concession applied (or they can withdraw).
  Round 3: the broker makes the FINAL allocation using the SAME
           submit_allocation tool/schema as T1 (llm_central), so the two
           are commit-compatible and directly comparable.

Hard constraints are enforced the same way as T1 -- via
llm_common.commit_llm_choice, which never repairs an illegal choice, only
records it (H3, illegal_allocation_rate).

Requires ANTHROPIC_API_KEY. Cost scales with (n_requests_in_window x 1-2
agent calls) + 2 broker calls, per window -- see the proposal §6.2 and
README before running more than a couple of episodes. For cost/latency
reasons this negotiates over the SAME (optionally --compact-base-sized)
request stream as llm_central -- do not run T2 against the large-N
(rho * total_capacity) classic-baseline scenario size; see
harness/run_experiment.py --compact-base.
"""

from __future__ import annotations

import time

from ..scenario import DECISION_STEP_MINUTES, Request
from .base import Assignment, Policy
from .llm_common import (
    ALLOCATION_TOOL,
    UTILITY_FORMULA_TEXT,
    commit_llm_choice,
    group_into_windows,
    parse_tool_input,
    spot_menu_text,
    usage_cost_usd,
)

AGENT_BID_TOOL = {
    "name": "submit_bid",
    "description": "Rank the spots you'd accept, best first, for your one request.",
    "input_schema": {
        "type": "object",
        "properties": {
            "spot_preferences": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Eligible spot_ids ordered best-to-worst for this request. "
                                "Omit spots you would never accept (utility below reservation_u_min).",
            },
            "willing_to_widen_walk_m": {
                "type": "number",
                "description": "Extra meters of walking you'd accept if this is the only "
                                "way to get a legal spot in a revision round.",
            },
            "withdraw": {
                "type": "boolean",
                "description": "True if you'd rather get nothing than any available spot.",
            },
        },
        "required": ["spot_preferences", "willing_to_widen_walk_m", "withdraw"],
        "additionalProperties": False,
    },
    "strict": True,
}

BROKER_TENTATIVE_TOOL = {
    "name": "submit_tentative_allocation",
    "description": "Propose a tentative allocation for this window and flag which "
                    "request_ids should get one revision round before the allocation is final.",
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
            },
            "revise_request_ids": {
                "type": "array",
                "items": {"type": "string"},
                "description": "Subset of request_ids that should get a chance to revise "
                                "their bid before this becomes final (e.g. got nothing, or "
                                "lost a contested spot to a lower-value match).",
            },
        },
        "required": ["assignments", "revise_request_ids"],
        "additionalProperties": False,
    },
    "strict": True,
}

AGENT_SYSTEM_PROMPT = f"""You are a user's personal parking-negotiation agent. You \
represent exactly one reservation request and want the best deal for your \
user, but you only get a spot if the broker's allocation across ALL users \
this window gives it to you.

{UTILITY_FORMULA_TEXT}

Rank spot_preferences best-to-worst among the eligible spots you were \
given (only ones clearing your reservation_u_min). If you're asked to \
revise, you may widen your walk tolerance to make a previously-rejected \
spot newly acceptable -- state how many extra meters you'd tolerate. \
Respond ONLY by calling submit_bid."""

BROKER_SYSTEM_PROMPT = f"""You are the broker for a campus parking system, running a \
multi-round negotiation among per-user agents for one 10-minute decision \
window. Each agent has told you its ranked spot preferences.

{UTILITY_FORMULA_TEXT}

Hard constraints (a violated allocation is rejected outright, not repaired):
- No spot can host more overlapping reservations than its capacity.
- EV-only requests must go to EV-flagged spots (agents already filtered \
their own preference lists to eligible spots).

Your goal: maximize total realized utility this window. In the tentative \
round, propose your best current allocation and flag (in \
revise_request_ids) any request that got nothing or a low-ranked spot \
because of contention -- give those users one chance to widen their \
tolerance before you finalize. In the final round, commit to one \
allocation; every request_id must appear exactly once (spot_id=null if \
intentionally unassigned)."""


class LLMNegotiatePolicy(Policy):
    name = "llm_negotiate"

    def __init__(
        self,
        broker_model: str = "claude-opus-5",
        agent_model: str = "claude-haiku-4-5",
        broker_effort: str = "high",
        agent_effort: str = "low",
        **_ignored,
    ):
        self.broker_model = broker_model
        self.agent_model = agent_model
        self.broker_effort = broker_effort
        self.agent_effort = agent_effort
        self.last_cost_usd = 0.0
        self.last_parse_failure_rate = 0.0
        self.last_transcript: list[dict] = []

    # -- round 1 / 2.5: one Haiku call per request -------------------------
    def _get_bid(self, client, req: Request, spots, revise: bool = False,
                  prior_pref=None) -> tuple[dict | None, float]:
        eligible = [s for s in spots if req.is_eligible(s)]
        dist_txt = ", ".join(f"{s.id}:{req.distance_to(s):.0f}m" for s in eligible)
        price_txt = ", ".join(f"{s.id}:${s.price_per_hour:.2f}/hr" for s in eligible)

        context = (
            "This is a REVISION round -- your first bid didn't secure a spot. "
            "Consider widening your walk tolerance.\n" if revise else ""
        )
        user_msg = (
            f"{context}"
            f"Your request: duration_min={req.duration_minutes:.0f} "
            f"trip_value=${req.trip_value:.2f} price_weight={req.price_weight:.2f} "
            f"walk_weight=${req.walk_weight:.3f}/m walk_tolerance_m={req.walk_tolerance_m:.0f} "
            f"reservation_u_min=${req.u_min:.2f}\n"
            f"Eligible spot prices: {price_txt}\n"
            f"Eligible spot distances: {dist_txt}\n"
        )
        if prior_pref is not None:
            user_msg += f"Your prior preference order: {prior_pref}\n"

        try:
            # No `thinking` param: Haiku 4.5 defaults to no thinking, which
            # is the right call for a simple ranking task at low latency/cost.
            response = client.messages.create(
                model=self.agent_model,
                max_tokens=1024,
                system=AGENT_SYSTEM_PROMPT,
                tools=[AGENT_BID_TOOL],
                tool_choice={"type": "tool", "name": "submit_bid"},
                messages=[{"role": "user", "content": user_msg}],
            )
        except Exception as e:  # noqa: BLE001
            return None, 0.0

        cost = usage_cost_usd(self.agent_model, response.usage)
        for block in response.content:
            if getattr(block, "type", None) == "tool_use" and block.name == "submit_bid":
                return (block.input if isinstance(block.input, dict) else None), cost
        return None, cost

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
            window_log = {"window": [w_start, w_end], "n_requests": len(window)}

            # -- Round 1: independent bids -----------------------------------
            bids: dict[str, dict] = {}
            for r in window:
                bid, cost = self._get_bid(client, r, spots)
                total_cost += cost
                if bid is None:
                    n_parse_failures += 1
                    bid = {"spot_preferences": [], "willing_to_widen_walk_m": 0, "withdraw": True}
                bids[r.id] = bid

            # -- Round 2: broker tentative allocation ------------------------
            bids_text = "\n".join(
                f"- request_id={rid} preferences={b.get('spot_preferences')} "
                f"withdraw={b.get('withdraw')}"
                for rid, b in bids.items()
            )
            user_msg = (
                f"Decision window [{w_start}, {w_end}).\n"
                f"Spots:\n{spot_menu_text(spots, ledgers, w_start, w_end)}\n\n"
                f"Agent bids:\n{bids_text}\n\n"
                f"Propose a tentative allocation for all {len(window)} request_id(s)."
            )
            try:
                resp2 = client.messages.create(
                    model=self.broker_model,
                    max_tokens=8000,
                    system=[{"type": "text", "text": BROKER_SYSTEM_PROMPT,
                             "cache_control": {"type": "ephemeral"}}],
                    tools=[BROKER_TENTATIVE_TOOL],
                    tool_choice={"type": "tool", "name": "submit_tentative_allocation"},
                    output_config={"effort": self.broker_effort},
                    messages=[{"role": "user", "content": user_msg}],
                )
                total_cost += usage_cost_usd(self.broker_model, resp2.usage)
                tentative = parse_tool_input(resp2, tool_name="submit_tentative_allocation")
            except Exception as e:  # noqa: BLE001
                tentative = None
                window_log["round2_error"] = repr(e)

            revise_ids: list[str] = []
            if tentative and "revise_request_ids" in tentative:
                revise_ids = [rid for rid in tentative["revise_request_ids"] if rid in req_by_id]
            else:
                n_parse_failures += 1

            # -- Round 2.5: revision for flagged requests --------------------
            for rid in revise_ids:
                r = req_by_id[rid]
                prior_pref = bids.get(rid, {}).get("spot_preferences")
                bid, cost = self._get_bid(client, r, spots, revise=True, prior_pref=prior_pref)
                total_cost += cost
                if bid is not None:
                    bids[rid] = bid

            # -- Round 3: broker final allocation -----------------------------
            bids_text_final = "\n".join(
                f"- request_id={rid} preferences={b.get('spot_preferences')} "
                f"withdraw={b.get('withdraw')} widen_walk_m={b.get('willing_to_widen_walk_m', 0)}"
                for rid, b in bids.items()
            )
            user_msg_final = (
                f"Decision window [{w_start}, {w_end}) -- FINAL round.\n"
                f"Spots:\n{spot_menu_text(spots, ledgers, w_start, w_end)}\n\n"
                f"Agent bids (post-revision where applicable):\n{bids_text_final}\n\n"
                f"Commit the final assignment for all {len(window)} request_id(s)."
            )
            try:
                resp3 = client.messages.create(
                    model=self.broker_model,
                    max_tokens=8000,
                    system=[{"type": "text", "text": BROKER_SYSTEM_PROMPT,
                             "cache_control": {"type": "ephemeral"}}],
                    tools=[ALLOCATION_TOOL],
                    tool_choice={"type": "tool", "name": "submit_allocation"},
                    output_config={"effort": self.broker_effort},
                    messages=[{"role": "user", "content": user_msg_final}],
                )
                total_cost += usage_cost_usd(self.broker_model, resp3.usage)
                final = parse_tool_input(resp3)
            except Exception as e:  # noqa: BLE001
                final = None
                window_log["round3_error"] = repr(e)

            if final is None or "assignments" not in final:
                n_parse_failures += 1
                for r in window:
                    assignments[r.id] = Assignment(r.id, None, None)
                transcript.append(window_log)
                continue

            chosen_by_req = {
                item.get("request_id"): item.get("spot_id")
                for item in final["assignments"]
                if isinstance(item, dict)
            }
            for r in window:
                spot_id = chosen_by_req.get(r.id)
                result = commit_llm_choice(req_by_id, spot_by_id, ledgers, r.id, spot_id)
                assignments[r.id] = result.assignment

            window_log["n_revised"] = len(revise_ids)
            transcript.append(window_log)

        self.last_cost_usd = total_cost
        self.last_parse_failure_rate = n_parse_failures / n_windows if n_windows else 0.0
        self.last_transcript = transcript

        return [assignments.get(r.id, Assignment(r.id, None, None)) for r in requests]
