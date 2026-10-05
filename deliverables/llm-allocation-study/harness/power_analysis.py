"""
Power analysis from MEASURED variance (proposal §5.2, §10).

The proposal planned to estimate variance from an n=5 pilot and back out
the required n. The classic arms have since been run at n=30 across two
scales, so the variance is no longer a guess -- this script reads it off
the real data.

Two corrections this makes to the proposal's stated power:

1. The proposal quoted "n=30 detects d >= 0.74" from a TWO-SAMPLE formula.
   The design is PAIRED (every arm sees the same seeded scenarios), so the
   relevant dispersion is the SD of paired differences, which is far
   smaller than the SD of raw values whenever arms are correlated across
   seeds -- as they are here, since they share the scenario. Using the
   two-sample number understates the design's real sensitivity.

2. Cohen's d is reported in SD units, which is unreadable when the SD is
   tiny. This reports the minimum detectable effect in NATURAL units too
   (percentage points of success rate, Jain's index points, dollars),
   which is what a reader actually needs to judge whether the design can
   detect an effect worth caring about.

Caveat for the LLM arms: these SDs come from deterministic policies, so
they capture scenario variance only. LLM arms add model stochasticity on
top (the thing §5.3's ICC is designed to quantify), so their paired-
difference SD will be LARGER and the MDEs below are optimistic for them.
Treat the classic numbers as a floor, and re-run this script on the LLM
data once it exists.

Usage:
  python -m harness.power_analysis --csv results/compact_baseline_summary.csv \
      --out results/power_analysis.md
"""

from __future__ import annotations

import argparse
import itertools
from pathlib import Path

import numpy as np
import pandas as pd
from statsmodels.stats.power import TTestPower

METRICS = ["success_rate", "jains_index", "utilization", "social_welfare"]
ALPHA = 0.05
TARGET_POWER = 0.80


def paired_diff_sd(df: pd.DataFrame, metric: str, arm_a: str, arm_b: str, rho: float):
    sub = df[df["rho"] == rho]
    # Average replicates first: the unit of analysis is a (arm, rho, seed)
    # cell, and replicates reduce that cell's measurement error rather than
    # adding independent observations. See analyze._per_seed.
    sa = sub[sub["arm"] == arm_a].groupby("seed")[metric].mean()
    sb = sub[sub["arm"] == arm_b].groupby("seed")[metric].mean()
    common = sorted(set(sa.index) & set(sb.index))
    if len(common) < 3:
        return None
    av = sa.loc[common].to_numpy(dtype=float)
    bv = sb.loc[common].to_numpy(dtype=float)
    diff = av - bv
    raw_sd = float(np.std(np.concatenate([av, bv]), ddof=1))
    return {
        "n": len(common),
        "sd_diff": float(diff.std(ddof=1)),
        "sd_raw_pooled": raw_sd,
        "observed_diff": float(diff.mean()),
    }


def mde(sd_diff: float, n: int) -> float:
    """Minimum detectable effect in natural units at alpha=.05, power=.80."""
    if sd_diff == 0:
        return 0.0
    d = TTestPower().solve_power(
        effect_size=None, nobs=n, alpha=ALPHA, power=TARGET_POWER, alternative="two-sided"
    )
    return float(d) * sd_diff


def required_n(sd_diff: float, target_effect: float) -> float:
    """How many seeds to detect `target_effect` (natural units) at .80 power."""
    if sd_diff == 0 or target_effect == 0:
        return float("nan")
    d = abs(target_effect) / sd_diff
    return float(TTestPower().solve_power(
        effect_size=d, nobs=None, alpha=ALPHA, power=TARGET_POWER, alternative="two-sided"
    ))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default="results/compact_baseline_summary.csv")
    ap.add_argument("--out", default="results/power_analysis.md")
    ap.add_argument("--n-planned", type=int, default=30)
    args = ap.parse_args()

    from .analyze import add_arm_column

    df = add_arm_column(pd.read_csv(args.csv))
    arms = sorted(df["arm"].unique())
    loads = sorted(df["rho"].unique())

    rows = []
    for metric in METRICS:
        if metric not in df.columns:
            continue
        for rho in loads:
            for a, b in itertools.combinations(arms, 2):
                s = paired_diff_sd(df, metric, a, b, rho)
                if s is None:
                    continue
                m = mde(s["sd_diff"], args.n_planned)
                rows.append({
                    "metric": metric, "rho": rho, "pair": f"{a} vs {b}",
                    "n": s["n"],
                    "sd_diff": s["sd_diff"],
                    "sd_raw_pooled": s["sd_raw_pooled"],
                    "variance_reduction": (
                        1 - s["sd_diff"] / s["sd_raw_pooled"] if s["sd_raw_pooled"] else np.nan
                    ),
                    "mde_at_n": m,
                    "observed_diff": s["observed_diff"],
                    "observed_over_mde": (
                        abs(s["observed_diff"]) / m if m else np.inf
                    ),
                })
    table = pd.DataFrame(rows)

    # Planning table: required n for effects a reader would care about.
    targets = {
        "success_rate": [0.01, 0.02, 0.05],
        "jains_index": [0.01, 0.02, 0.05],
        "utilization": [0.005, 0.01, 0.02],
    }
    plan_rows = []
    for metric, ts in targets.items():
        sub = table[table["metric"] == metric]
        if sub.empty:
            continue
        # Use the WORST (largest) paired-diff SD seen for this metric, so the
        # planning number is conservative rather than flattering.
        worst_sd = sub["sd_diff"].max()
        for t in ts:
            plan_rows.append({
                "metric": metric,
                "worst_case_sd_diff": worst_sd,
                "target_effect": t,
                "required_n": required_n(worst_sd, t),
            })
    plan = pd.DataFrame(plan_rows)

    lines = [
        "# Power analysis from measured variance\n",
        f"Source: `{args.csv}`. Arms: {arms}. Planned n per cell: {args.n_planned}. "
        f"alpha={ALPHA}, target power={TARGET_POWER}, two-sided paired t-test.\n",
        "## Why these numbers differ from the proposal's\n",
        "The proposal quoted `n=30 detects d>=0.74` from a **two-sample** formula. This "
        "design is **paired** -- every arm sees the same seeded scenarios -- so the relevant "
        "dispersion is the SD of paired *differences*. The `variance_reduction` column below "
        "shows how much pairing buys: it is the fraction by which the paired-difference SD "
        "falls short of the pooled raw SD. Where that number is high, the two-sample figure "
        "badly understates what this design can detect.\n",
        "## Measured dispersion and minimum detectable effect\n",
        table.round(5).to_markdown(index=False),
        "\n`mde_at_n` is in the metric's own units (success_rate and utilization are "
        "fractions, so 0.01 = 1 percentage point). `observed_over_mde` > 1 means the effect "
        "actually measured in this data is larger than the smallest effect the design could "
        "reliably detect.\n",
        "## Planning table: seeds required for a given effect\n",
        plan.round(3).to_markdown(index=False) if not plan.empty else "(n/a)",
        "\nEach row uses the **largest** paired-difference SD observed for that metric, so "
        "these are conservative.\n",
        "## Limits of this analysis\n",
        "- These SDs come from **deterministic** policies, so they capture scenario variance "
        "only. The LLM arms add model stochasticity on top -- exactly what §5.3's repeated-"
        "measures ICC is meant to quantify -- so their paired-difference SD will be larger "
        "and every MDE here is **optimistic** for them. Re-run this script on the LLM data "
        "before claiming power for Experiment A.\n"
        "- Power computed post hoc on the same data that produced the observed effects is not "
        "evidence that those effects are real. The MDE column is a *design* property (it "
        "depends only on SD and n) and is the defensible thing to quote; "
        "`observed_over_mde` is descriptive context, not a test.\n",
    ]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines))

    print(f"Wrote {out}")
    if not table.empty:
        for metric in table["metric"].unique():
            sub = table[table["metric"] == metric]
            print(f"  {metric:16s} worst sd_diff={sub['sd_diff'].max():.5f}  "
                  f"MDE@n={args.n_planned}: {sub['mde_at_n'].max():.5f}  "
                  f"median pairing variance reduction: {sub['variance_reduction'].median():.1%}")


if __name__ == "__main__":
    main()
