"""
Orchestrates the strategy x load x seed grid described in the proposal
(research_proposal_llm_allocation.md §3.1) and writes:

  - results/<out_name>.csv       one row per episode, all metrics
  - runs/<strategy>_<rho>_<seed>.json   per-episode audit log (light by
    default; pass --full-logs to also dump every assignment)

Usage (classic baselines, no API key needed):
  python -m harness.run_experiment \
      --strategies random,fifo,greedy \
      --loads 0.8,1.2,2.0 \
      --n-seeds 30 \
      --out-name baseline_summary

LLM strategies (llm_central / llm_negotiate) are wired in but NOT included
in --strategies unless you explicitly ask for them AND have set
ANTHROPIC_API_KEY -- each episode costs real money (see the proposal §6.2
cost table). This script will refuse to run an llm_* strategy without a
key rather than silently skip it.
"""

from __future__ import annotations

import argparse
import csv
import json
import os
import time
from pathlib import Path

from .data_loader import load_spots
from .metrics import compute_metrics
from .policies import REGISTRY
from .scenario import WINDOW_MINUTES, generate_requests
from .validator import validate

HERE = Path(__file__).resolve().parent
STUDY_ROOT = HERE.parent

LLM_STRATEGIES = {"llm_central", "llm_negotiate"}


def _build_policy(strategy: str, seed: int, effort: str | None = None):
    if strategy in REGISTRY:
        cls = REGISTRY[strategy]
        try:
            return cls(seed=seed)
        except TypeError:
            return cls()
    if strategy == "llm_central":
        from .policies.llm_central import LLMCentralPolicy

        return LLMCentralPolicy(effort=effort or "high")
    if strategy == "llm_negotiate":
        from .policies.llm_negotiate import LLMNegotiatePolicy

        # Only the broker's effort is swept. The per-user agents run on
        # Haiku 4.5, which doesn't take `effort` at all, and cost profiling
        # showed they're 1.4-2.4% of spend -- so there is nothing to learn
        # from varying them (see results/cost_analysis.md).
        return LLMNegotiatePolicy(broker_effort=effort or "high")
    raise ValueError(f"Unknown strategy: {strategy}")


def run_episode(strategy: str, rho: float, seed: int, full_logs: bool, runs_dir: Path,
                 compact_base: float | None = None, target_capacity: int | None = None,
                 effort: str | None = None, replicate: int = 1):
    spots = load_spots(target_total_capacity=target_capacity)
    n_override = int(round(rho * compact_base)) if compact_base else None
    requests = generate_requests(spots, rho=rho, seed=seed, n_requests_override=n_override)

    policy = _build_policy(strategy, seed, effort=effort)

    t0 = time.perf_counter()
    assignments = policy.allocate(spots, requests)
    latency_s = time.perf_counter() - t0

    cost_usd = getattr(policy, "last_cost_usd", 0.0)
    parse_failure_rate = getattr(policy, "last_parse_failure_rate", 0.0)

    report = validate(spots, requests, assignments)
    metrics = compute_metrics(
        spots, requests, assignments, WINDOW_MINUTES,
        violation_report=report, decision_latency_s=latency_s, cost_usd=cost_usd,
        parse_failure_rate=parse_failure_rate,
    )

    log = {
        "strategy": strategy,
        "rho": rho,
        "seed": seed,
        "replicate": replicate,
        "effort": effort,
        "n_spots": len(spots),
        "n_requests": len(requests),
        "metrics": metrics.as_dict(),
        "violations": [v.__dict__ for v in report.violations][:20],
    }
    if full_logs:
        log["assignments"] = [a.__dict__ for a in assignments]
        log["llm_transcript"] = getattr(policy, "last_transcript", None)

    runs_dir.mkdir(parents=True, exist_ok=True)
    # Tag compact runs so their logs can never be mistaken for (or overwrite)
    # the large-N classic-baseline logs -- the two are different experiments
    # and must not be pooled.
    tag = f"_cap{target_capacity}" if target_capacity else ""
    if effort:
        tag += f"_{effort}"
    if replicate > 1:
        # Replicates of the same (arm, rho, seed) MUST NOT overwrite each other --
        # they are the repeated measures §5.3's variance decomposition reads.
        tag += f"_r{replicate}"
    out_path = runs_dir / f"{strategy}_{rho}_{seed}{tag}.json"
    log["target_capacity"] = target_capacity
    log["total_capacity"] = sum(s.capacity for s in spots)
    out_path.write_text(json.dumps(log, indent=2))

    return {
        "strategy": strategy,
        "rho": rho,
        "seed": seed,
        "replicate": replicate,
        "effort": effort or "n/a",  # classic policies have no reasoning-effort knob
        "n_requests": len(requests),
        **metrics.as_dict(),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--strategies", default="random,fifo,greedy",
                     help="comma-separated: random,fifo,greedy,llm_central,llm_negotiate")
    ap.add_argument("--loads", default="0.8,1.2,2.0", help="comma-separated rho values")
    ap.add_argument("--n-seeds", type=int, default=30)
    ap.add_argument("--seed-start", type=int, default=1)
    ap.add_argument("--out-name", default="baseline_summary")
    ap.add_argument("--replicates", type=int, default=1,
                     help="run each (arm, rho, seed) cell this many times. Required for the "
                          "pre-registered variance decomposition (PRE_REGISTRATION §4: 3 "
                          "replicates, mixed-effects model, ICC) -- current Claude models "
                          "reject `temperature`, so model stochasticity is MEASURED via "
                          "repeated measures instead of suppressed. Applies to LLM arms "
                          "only: the classical policies are deterministic given a seed, so "
                          "replicating them would just burn compute on identical rows.")
    ap.add_argument("--efforts", default="high",
                     help="comma-separated broker reasoning-effort levels to sweep "
                          "(low,medium,high,xhigh,max). Applies to LLM strategies ONLY -- "
                          "classic strategies run once and record effort='n/a', so mixing "
                          "arms in one command does not silently duplicate their episodes. "
                          "Effort is an experimental factor here, not just a cost dial: it "
                          "tests whether more reasoning buys better allocations.")
    ap.add_argument("--full-logs", action="store_true",
                     help="also dump every assignment (large; use for small runs only)")
    ap.add_argument("--target-capacity", type=int, default=None,
                     help="scale the fleet down to roughly this many total spaces "
                          "(all 24 real spots kept). This is the RIGHT way to build the "
                          "small 'compact' episodes the LLM arms need: it shrinks supply "
                          "and demand together, so rho keeps meaning demand/supply and "
                          "contention is preserved. Use --target-capacity 30 for the "
                          "LLM-comparable grid (24/36/60 requests at rho 0.8/1.2/2.0).")
    ap.add_argument("--compact-base", type=float, default=None,
                     help="(rarely needed) force n_requests = round(rho * compact_base) "
                          "while leaving supply untouched. Prefer --target-capacity: "
                          "shrinking demand alone drives rho's effective value toward 0 "
                          "and removes the contention the study is about.")
    ap.add_argument("--results-dir", default=str(STUDY_ROOT / "results"))
    ap.add_argument("--runs-dir", default=str(STUDY_ROOT / "runs"))
    args = ap.parse_args()

    strategies = [s.strip() for s in args.strategies.split(",") if s.strip()]
    loads = [float(x) for x in args.loads.split(",") if x.strip()]
    seeds = range(args.seed_start, args.seed_start + args.n_seeds)

    for s in strategies:
        if s in LLM_STRATEGIES and not os.environ.get("ANTHROPIC_API_KEY"):
            raise SystemExit(
                f"Strategy '{s}' calls the Anthropic API and costs real money per "
                f"episode. Set ANTHROPIC_API_KEY first, and confirm the run size "
                f"with the cost table in the proposal (§6.2) before running the "
                f"full grid. Refusing to proceed silently."
            )

    results_dir = Path(args.results_dir)
    runs_dir = Path(args.runs_dir)
    results_dir.mkdir(parents=True, exist_ok=True)

    efforts = [e.strip() for e in args.efforts.split(",") if e.strip()]

    # Effort only means anything for the LLM arms; classic arms run once
    # with effort=None so a mixed command doesn't multiply their episodes.
    plan = []
    for strategy in strategies:
        is_llm = strategy in LLM_STRATEGIES
        strategy_efforts = efforts if is_llm else [None]
        # Classical policies are deterministic given a seed, so replicating them
        # produces identical rows; only the stochastic LLM arms get replicates.
        n_reps = max(1, args.replicates) if is_llm else 1
        for effort in strategy_efforts:
            for rho in loads:
                for seed in seeds:
                    for rep in range(1, n_reps + 1):
                        plan.append((strategy, rho, seed, effort, rep))

    rows = []
    total = len(plan)
    for done, (strategy, rho, seed, effort, rep) in enumerate(plan, start=1):
        row = run_episode(strategy, rho, seed, args.full_logs, runs_dir,
                           compact_base=args.compact_base,
                           target_capacity=args.target_capacity,
                           effort=effort, replicate=rep)
        rows.append(row)
        if done % 20 == 0 or done == total:
            print(f"[{done}/{total}] {strategy} rho={rho} seed={seed} "
                  f"effort={effort or 'n/a'} rep={rep} "
                  f"success_rate={row['success_rate']:.3f} "
                  f"jains={row['jains_index']:.3f}")

    out_csv = results_dir / f"{args.out_name}.csv"
    fieldnames = list(rows[0].keys()) if rows else []
    with open(out_csv, "w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        writer.writerows(rows)

    print(f"\nWrote {len(rows)} episode rows to {out_csv}")


if __name__ == "__main__":
    main()
