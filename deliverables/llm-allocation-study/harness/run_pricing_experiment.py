"""
Runner for Experiment B (proposal §6.3): pricing policy x load x seed.

The allocator is held fixed at Greedy across all arms -- this experiment
varies price, not the scheduler.

Primary metric: utilization. Secondary: revenue, success_rate, fairness.
Same paired design as Experiment A (all arms see identical seeded
scenarios), same correction rules at analysis time.

Zero API cost -- all three arms are rule-based.

Usage:
  python -m harness.run_pricing_experiment --target-capacity 30 --n-seeds 30
  python -m harness.analyze --csv results/pricing_summary.csv \
      --out results/pricing_report.md
"""

from __future__ import annotations

import argparse
import csv
import json
import time
from pathlib import Path

from .data_loader import load_spots
from .metrics import compute_metrics
from .pricing import PRICING_REGISTRY, allocate_with_pricing
from .scenario import WINDOW_MINUTES, generate_requests
from .validator import validate

HERE = Path(__file__).resolve().parent
STUDY_ROOT = HERE.parent


def run_episode(pricing_name: str, rho: float, seed: int, target_capacity: int | None,
                 runs_dir: Path, full_logs: bool = False,
                 price_weight_range: tuple[float, float] = (0.8, 1.2)) -> dict:
    spots = load_spots(target_total_capacity=target_capacity)
    requests = generate_requests(spots, rho=rho, seed=seed,
                                  price_weight_range=price_weight_range)
    pricing = PRICING_REGISTRY[pricing_name]()

    t0 = time.perf_counter()
    assignments, revenue, mean_mult = allocate_with_pricing(spots, requests, pricing, seed)
    latency = time.perf_counter() - t0

    report = validate(spots, requests, assignments)
    metrics = compute_metrics(
        spots, requests, assignments, WINDOW_MINUTES,
        violation_report=report, decision_latency_s=latency, cost_usd=0.0,
    )

    log = {
        "pricing": pricing_name, "rho": rho, "seed": seed,
        "target_capacity": target_capacity,
        "price_weight_range": list(price_weight_range),
        "revenue_usd": revenue, "mean_multiplier": mean_mult,
        "metrics": metrics.as_dict(),
        "violations": [v.__dict__ for v in report.violations][:20],
    }
    if full_logs:
        log["assignments"] = [a.__dict__ for a in assignments]
    runs_dir.mkdir(parents=True, exist_ok=True)
    tag = f"_cap{target_capacity}" if target_capacity else ""
    if tuple(price_weight_range) != (0.8, 1.2):
        tag += f"_pw{price_weight_range[0]}-{price_weight_range[1]}"
    (runs_dir / f"pricing_{pricing_name}_{rho}_{seed}{tag}.json").write_text(json.dumps(log, indent=2))

    return {
        # `strategy` so harness.analyze can consume this file unchanged
        "strategy": pricing_name,
        "effort": "n/a",
        "rho": rho,
        "seed": seed,
        "n_requests": len(requests),
        "pw_lo": price_weight_range[0],
        "pw_hi": price_weight_range[1],
        "revenue_usd": revenue,
        "mean_multiplier": mean_mult,
        **metrics.as_dict(),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pricing", default="p0_static,p1_rule_surge,p2_permuted_surge")
    ap.add_argument("--loads", default="0.8,1.2,2.0")
    ap.add_argument("--n-seeds", type=int, default=30)
    ap.add_argument("--seed-start", type=int, default=1)
    ap.add_argument("--target-capacity", type=int, default=0,
                     help="0 (default) = use the full 833-space fleet. Experiment B has no "
                          "LLM component and costs nothing to run, so it defaults to full "
                          "scale: the demand signal the surge rule keys off only carries "
                          "information when windows hold enough requests to be informative. "
                          "Pass a positive value only to mirror the compact LLM grid.")
    ap.add_argument("--out-name", default="pricing_summary")
    ap.add_argument("--price-weight-range", default="0.8,1.2",
                     help="lo,hi for the uniform price-sensitivity draw. The surge mechanism "
                          "works by pushing price-sensitive users out while insensitive ones "
                          "stay, so BOTH the level and the spread of this range matter. "
                          "Sweeping it is the sensitivity analysis the proposal §7 requires "
                          "for the (unmeasured) utility parameters.")
    ap.add_argument("--full-logs", action="store_true")
    ap.add_argument("--results-dir", default=str(STUDY_ROOT / "results"))
    ap.add_argument("--runs-dir", default=str(STUDY_ROOT / "runs"))
    args = ap.parse_args()

    arms = [p.strip() for p in args.pricing.split(",") if p.strip()]
    for a in arms:
        if a not in PRICING_REGISTRY:
            raise SystemExit(f"Unknown pricing arm {a!r}. Known: {sorted(PRICING_REGISTRY)}")
    loads = [float(x) for x in args.loads.split(",")]
    seeds = range(args.seed_start, args.seed_start + args.n_seeds)

    target_capacity = args.target_capacity if args.target_capacity > 0 else None
    pw_parts = [float(x) for x in args.price_weight_range.split(",")]
    if len(pw_parts) != 2 or pw_parts[0] > pw_parts[1]:
        raise SystemExit(f"--price-weight-range must be 'lo,hi' with lo<=hi, got {args.price_weight_range!r}")
    price_weight_range = (pw_parts[0], pw_parts[1])

    results_dir = Path(args.results_dir)
    results_dir.mkdir(parents=True, exist_ok=True)
    runs_dir = Path(args.runs_dir)

    rows = []
    total = len(arms) * len(loads) * args.n_seeds
    done = 0
    for arm in arms:
        for rho in loads:
            for seed in seeds:
                rows.append(run_episode(arm, rho, seed, target_capacity, runs_dir,
                                         args.full_logs, price_weight_range))
                done += 1
                if done % 30 == 0 or done == total:
                    r = rows[-1]
                    print(f"[{done}/{total}] {arm} rho={rho} seed={seed} "
                          f"util={r['utilization']:.3f} rev=${r['revenue_usd']:.0f} "
                          f"mean_mult={r['mean_multiplier']:.3f}")

    out_csv = results_dir / f"{args.out_name}.csv"
    with open(out_csv, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        w.writeheader()
        w.writerows(rows)
    print(f"\nWrote {len(rows)} episode rows to {out_csv}")


if __name__ == "__main__":
    main()
