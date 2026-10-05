"""
Scale-validation check: does the cost-driven shrink to a compact fleet
(--target-capacity 30, 24-60 requests) still reproduce the phenomenon the
full-size fleet (833 spaces, 666-1666 requests) shows?

This matters because the LLM arms (T1/T2) can only be afforded at the
compact scale. If compact episodes behaved qualitatively differently from
full-size ones, every LLM-vs-classic conclusion would be about the
shrink, not about the allocator. Running the classic baselines at BOTH
scales lets us say something concrete instead of hoping.

Note on what this can and cannot show: the two scales are different
scenario populations, so seeds don't pair across them -- this is an
unpaired comparison of distributions, reported with effect sizes rather
than as a significance test. All LLM-vs-classic comparisons still happen
strictly *within* the compact grid, where pairing by seed does hold.

Usage:
  python -m harness.compare_scales \
      --large results/baseline_summary.csv \
      --compact results/compact_baseline_summary.csv \
      --out results/scale_validation.md
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

METRICS = ["success_rate", "jains_index", "gini", "utilization"]


def cohens_d_unpaired(a: np.ndarray, b: np.ndarray) -> float:
    na, nb = len(a), len(b)
    if na < 2 or nb < 2:
        return float("nan")
    pooled_var = ((na - 1) * a.var(ddof=1) + (nb - 1) * b.var(ddof=1)) / (na + nb - 2)
    if pooled_var == 0:
        return 0.0
    return (a.mean() - b.mean()) / np.sqrt(pooled_var)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--large", default="results/baseline_summary.csv")
    ap.add_argument("--compact", default="results/compact_baseline_summary.csv")
    ap.add_argument("--out", default="results/scale_validation.md")
    args = ap.parse_args()

    large = pd.read_csv(args.large)
    compact = pd.read_csv(args.compact)

    rows = []
    for metric in METRICS:
        for strategy in sorted(set(large["strategy"]) & set(compact["strategy"])):
            for rho in sorted(set(large["rho"]) & set(compact["rho"])):
                a = large[(large.strategy == strategy) & (large.rho == rho)][metric].to_numpy()
                b = compact[(compact.strategy == strategy) & (compact.rho == rho)][metric].to_numpy()
                if len(a) == 0 or len(b) == 0:
                    continue
                rows.append({
                    "metric": metric, "strategy": strategy, "rho": rho,
                    "large_mean": a.mean(), "compact_mean": b.mean(),
                    "abs_diff": abs(a.mean() - b.mean()),
                    "cohens_d": cohens_d_unpaired(a, b),
                })
    table = pd.DataFrame(rows)

    # Does the strategy ordering survive the shrink? That's the property
    # the LLM comparison actually depends on.
    ordering_rows = []
    for rho in sorted(set(large["rho"]) & set(compact["rho"])):
        for metric in ["success_rate", "jains_index"]:
            lo = large[large.rho == rho].groupby("strategy")[metric].mean().sort_values(ascending=False)
            co = compact[compact.rho == rho].groupby("strategy")[metric].mean().sort_values(ascending=False)
            ordering_rows.append({
                "metric": metric, "rho": rho,
                "large_order": " > ".join(lo.index),
                "compact_order": " > ".join(co.index),
                "order_preserved": list(lo.index) == list(co.index),
            })
    ordering = pd.DataFrame(ordering_rows)

    n_large_req = large.groupby("rho")["n_requests"].first().to_dict()
    n_compact_req = compact.groupby("rho")["n_requests"].first().to_dict()

    lines = [
        "# Scale validation: compact (cap=30) vs full-size (cap=833) fleet\n",
        f"Requests per episode -- full-size: {n_large_req}; compact: {n_compact_req}\n",
        "## Does the strategy ordering survive the shrink?\n",
        ordering.to_markdown(index=False),
        "\n## Per-cell means and unpaired effect sizes\n",
        table.round(4).to_markdown(index=False),
        "\n## Reading this\n",
        "- The ordering table is the load-bearing one: if `order_preserved` is True "
        "everywhere, the compact fleet reproduces the phenomenon and is a defensible "
        "stand-in for the LLM arms, which cannot be afforded at full size.\n"
        "- `cohens_d` here is UNPAIRED (different scenario populations), so treat it as a "
        "magnitude-of-offset indicator, not a hypothesis test. A non-trivial d with a small "
        "`abs_diff` just means both distributions are tight, not that the shrink broke "
        "anything.\n"
        "- Any residual offset between scales does NOT bias the LLM-vs-classic comparison, "
        "because that comparison is run entirely within the compact grid against classic "
        "baselines measured at the same compact scale and the same seeds.\n",
    ]

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(lines))

    n_preserved = int(ordering["order_preserved"].sum())
    print(f"Wrote {out_path}")
    print(f"Strategy ordering preserved in {n_preserved}/{len(ordering)} (metric, rho) cells")
    print(f"Max |mean difference| across all cells: {table['abs_diff'].max():.4f}")


if __name__ == "__main__":
    main()
