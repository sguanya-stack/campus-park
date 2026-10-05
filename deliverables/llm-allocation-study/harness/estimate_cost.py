"""
Offline cost estimator for the LLM arms -- run this BEFORE spending money.

Drives T1/T2 with a recording stub client that captures every prompt they
would actually send (no network, no API key, no cost), then prices the
captured traffic against the table in llm_common.PRICING_USD_PER_MTOK.

Accuracy caveat, stated plainly: token counts here are a chars/4 heuristic,
not the real tokenizer, and the output-token figure includes an ASSUMED
thinking-token budget (adaptive thinking on Opus 5 is billed as output and
is the single biggest swing factor in this estimate). Treat the result as
an order-of-magnitude planning number. The exact figure comes from running
ONE real pilot episode and reading `cost_usd` out of the results CSV --
that path is in the study README.

Usage:
  python -m harness.estimate_cost --target-capacity 30 --loads 0.8,1.2,2.0 --n-seeds 30
"""

from __future__ import annotations

import argparse
import re
import sys
import types

from .data_loader import load_spots
from .policies.llm_common import PRICING_USD_PER_MTOK
from .scenario import generate_requests

CHARS_PER_TOKEN = 4.0

# Adaptive thinking on Opus 5 is billed as output tokens. This is a guess,
# and it dominates the broker-side estimate -- surface it as a knob rather
# than burying it in a constant.
DEFAULT_BROKER_THINKING_TOKENS = 1500
DEFAULT_AGENT_THINKING_TOKENS = 0  # Haiku 4.5 runs with no thinking here


class _Recorder:
    def __init__(self):
        self.calls: list[dict] = []


def _make_stub(recorder: _Recorder, spots):
    class FakeUsage:
        input_tokens = 0
        output_tokens = 0
        cache_read_input_tokens = 0
        cache_creation_input_tokens = 0

        def model_dump(self):
            return {}

    class FakeBlock:
        type = "tool_use"

        def __init__(self, name, input_):
            self.name = name
            self.input = input_

    class FakeResponse:
        def __init__(self, content):
            self.content = content
            self.usage = FakeUsage()

    def handler(kwargs):
        model = kwargs.get("model")
        tool_name = kwargs.get("tool_choice", {}).get("name")
        system = kwargs.get("system")
        system_text = system if isinstance(system, str) else "".join(
            b.get("text", "") for b in (system or [])
        )
        user_text = kwargs["messages"][-1]["content"]
        req_ids = list(dict.fromkeys(re.findall(r"request_id=(\S+)", user_text)))

        recorder.calls.append({
            "model": model,
            "tool": tool_name,
            "input_chars": len(system_text) + len(user_text),
            "n_req_ids": len(req_ids),
        })

        if tool_name == "submit_bid":
            payload = {"spot_preferences": [spots[0].id], "willing_to_widen_walk_m": 100.0,
                        "withdraw": False}
        elif tool_name == "submit_tentative_allocation":
            # Realistic-ish: most get a spot, ~20% flagged for revision.
            assignments = [{"request_id": r, "spot_id": spots[i % len(spots)].id}
                            for i, r in enumerate(req_ids)]
            payload = {"assignments": assignments,
                        "revise_request_ids": req_ids[: max(0, len(req_ids) // 5)]}
        elif tool_name == "submit_allocation":
            payload = {"assignments": [{"request_id": r, "spot_id": spots[i % len(spots)].id}
                                        for i, r in enumerate(req_ids)]}
        else:
            payload = {}

        block = FakeBlock(tool_name, payload)
        recorder.calls[-1]["output_chars"] = len(str(payload))
        return FakeResponse([block])

    class FakeMessages:
        def create(self, **kwargs):
            return handler(kwargs)

    class FakeAnthropic:
        def __init__(self, *a, **kw):
            self.messages = FakeMessages()

    return types.SimpleNamespace(Anthropic=FakeAnthropic)


def price_calls(calls, broker_thinking: int, agent_thinking: int) -> dict:
    total = 0.0
    by_model: dict[str, dict] = {}
    for c in calls:
        model = c["model"]
        prices = PRICING_USD_PER_MTOK[model]
        in_tok = c["input_chars"] / CHARS_PER_TOKEN
        out_tok = c.get("output_chars", 0) / CHARS_PER_TOKEN
        out_tok += agent_thinking if c["tool"] == "submit_bid" else broker_thinking
        cost = (in_tok * prices["input"] + out_tok * prices["output"]) / 1e6
        total += cost
        entry = by_model.setdefault(model, {"calls": 0, "in_tok": 0.0, "out_tok": 0.0, "cost": 0.0})
        entry["calls"] += 1
        entry["in_tok"] += in_tok
        entry["out_tok"] += out_tok
        entry["cost"] += cost
    return {"total_usd": total, "by_model": by_model, "n_calls": len(calls)}


def estimate_for(policy_cls, spots, requests, broker_thinking, agent_thinking) -> dict:
    recorder = _Recorder()
    sys.modules["anthropic"] = _make_stub(recorder, spots)
    policy = policy_cls()
    policy.allocate(spots, requests)
    return price_calls(recorder.calls, broker_thinking, agent_thinking)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--target-capacity", type=int, default=30)
    ap.add_argument("--loads", default="0.8,1.2,2.0")
    ap.add_argument("--n-seeds", type=int, default=30)
    ap.add_argument("--seed", type=int, default=1, help="seed used for the sampled episode")
    ap.add_argument("--broker-thinking-tokens", type=int, default=DEFAULT_BROKER_THINKING_TOKENS)
    ap.add_argument("--agent-thinking-tokens", type=int, default=DEFAULT_AGENT_THINKING_TOKENS)
    args = ap.parse_args()

    from .policies.llm_central import LLMCentralPolicy
    from .policies.llm_negotiate import LLMNegotiatePolicy

    loads = [float(x) for x in args.loads.split(",")]
    spots = load_spots(target_total_capacity=args.target_capacity)

    print(f"Fleet: {len(spots)} spots, {sum(s.capacity for s in spots)} total spaces")
    print(f"Assumed thinking tokens: broker={args.broker_thinking_tokens}, "
          f"agent={args.agent_thinking_tokens} (billed as output -- biggest swing factor)")
    print(f"Token counts are a chars/{CHARS_PER_TOKEN:.0f} heuristic, NOT the real tokenizer.\n")

    grand_total = 0.0
    for label, cls in (("T1 llm_central", LLMCentralPolicy), ("T2 llm_negotiate", LLMNegotiatePolicy)):
        print(f"=== {label} ===")
        arm_total = 0.0
        for rho in loads:
            requests = generate_requests(spots, rho=rho, seed=args.seed)
            est = estimate_for(cls, spots, requests, args.broker_thinking_tokens,
                                args.agent_thinking_tokens)
            cell_total = est["total_usd"] * args.n_seeds
            arm_total += cell_total
            models = ", ".join(
                f"{m}: {d['calls']} calls ${d['cost']:.4f}" for m, d in est["by_model"].items()
            )
            print(f"  rho={rho}: {len(requests):3d} requests, {est['n_calls']:4d} API calls/episode, "
                  f"${est['total_usd']:.4f}/episode -> ${cell_total:7.2f} for n={args.n_seeds}")
            print(f"      {models}")
        print(f"  {label} subtotal (all loads, n={args.n_seeds}): ${arm_total:.2f}\n")
        grand_total += arm_total

    print(f"ESTIMATED GRAND TOTAL for the full LLM grid: ${grand_total:.2f}")
    print("\nCross-check against the proposal §6.2 budget ($40-150 mixed-model). If this "
          "number is far off, the proposal's cost table needs updating -- not this script "
          "quietly bent to match it.")
    print("Next step for a REAL number: run one pilot episode and read cost_usd "
          "(see README '跑真实 LLM episode 之前要过的三道门').")


if __name__ == "__main__":
    main()
