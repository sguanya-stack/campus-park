"""
Statistical analysis per the proposal's §5 (research_proposal_llm_allocation.md).

Pre-registered primary metrics: success_rate, jains_index. Everything else
is a secondary family and gets Holm-Bonferroni correction alongside the
primary tests within its own metric -- we never let a secondary result
change which comparisons get corrected together.

Works on whatever strategies are present in the input CSV: run it on the
classic-only baseline_summary.csv today, and again once llm_central /
llm_negotiate episodes exist (T1/T2 vs B1/B2, per §3.1) -- it will
automatically include every pairwise strategy comparison found in the data.

Usage:
  python -m harness.analyze --csv results/baseline_summary.csv \
      --out results/baseline_report.md
"""

from __future__ import annotations

import argparse
import itertools
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats
from statsmodels.formula.api import ols
from statsmodels.stats.anova import anova_lm
from statsmodels.stats.multitest import multipletests

PRIMARY_METRICS = ["success_rate", "jains_index"]
SECONDARY_METRICS = [
    "gini", "worst_decile_utility", "social_welfare", "utilization",
    "illegal_allocation_rate", "parse_failure_rate", "decision_latency_s", "cost_usd",
]


def cliffs_delta(a: np.ndarray, b: np.ndarray) -> float:
    """Non-parametric effect size in [-1, 1]. |d|<0.147 negligible,
    <0.33 small, <0.474 medium, else large (Romano et al. 2006 thresholds)."""
    n_a, n_b = len(a), len(b)
    more = sum(1 for x in a for y in b if x > y)
    less = sum(1 for x in a for y in b if x < y)
    return (more - less) / (n_a * n_b)


def bootstrap_ci_mean_diff(a: np.ndarray, b: np.ndarray, n_boot: int = 10_000, seed: int = 0):
    """95% bootstrap CI for mean(a) - mean(b), paired resampling."""
    rng = np.random.default_rng(seed)
    n = len(a)
    diffs = a - b
    boot_means = np.empty(n_boot)
    for i in range(n_boot):
        idx = rng.integers(0, n, size=n)
        boot_means[i] = diffs[idx].mean()
    lo, hi = np.percentile(boot_means, [2.5, 97.5])
    return float(lo), float(hi)


def add_arm_column(df: pd.DataFrame) -> pd.DataFrame:
    """An 'arm' is a strategy at one reasoning-effort level. Classic
    strategies have no effort knob (effort == 'n/a') and keep their bare
    name; LLM strategies become e.g. 'llm_negotiate@medium', so a sweep
    over effort produces genuinely distinct arms rather than silently
    pooling runs that were configured differently."""
    df = df.copy()
    if "effort" not in df.columns:
        df["effort"] = "n/a"
    df["effort"] = df["effort"].fillna("n/a")
    df["arm"] = [
        s if e in ("n/a", "", None) else f"{s}@{e}"
        for s, e in zip(df["strategy"], df["effort"])
    ]
    return df


def _per_seed(sub: pd.DataFrame, arm: str, metric: str) -> pd.Series:
    """One value per seed: the mean over replicates.

    The unit of analysis for the paired tests is a (arm, rho, seed) cell, not
    an episode. Replicates exist to reduce measurement error inside that cell
    (the model's own jitter, which `variance_analysis` reads separately) — they
    are not extra independent observations, and treating them as such would
    inflate n and understate the p-values.
    """
    return sub[sub["arm"] == arm].groupby("seed")[metric].mean()


def paired_comparison(df: pd.DataFrame, metric: str, strat_a: str, strat_b: str, rho: float) -> dict | None:
    sub = df[df["rho"] == rho]
    sa, sb = _per_seed(sub, strat_a, metric), _per_seed(sub, strat_b, metric)
    common_seeds = sorted(set(sa.index) & set(sb.index))
    if len(common_seeds) < 2:
        return None
    a = sa.loc[common_seeds].to_numpy(dtype=float)
    b = sb.loc[common_seeds].to_numpy(dtype=float)

    diff = a - b
    t_stat, t_p = stats.ttest_rel(a, b) if np.std(diff) > 0 else (np.nan, 1.0)
    try:
        w_stat, w_p = stats.wilcoxon(a, b)
    except ValueError:
        w_stat, w_p = np.nan, 1.0

    cohend = diff.mean() / diff.std(ddof=1) if diff.std(ddof=1) > 0 else 0.0
    delta = cliffs_delta(a, b)
    ci_lo, ci_hi = bootstrap_ci_mean_diff(a, b)

    return {
        "metric": metric, "rho": rho, "arm_a": strat_a, "arm_b": strat_b,
        "n_pairs": len(common_seeds),
        "mean_a": a.mean(), "mean_b": b.mean(), "mean_diff": diff.mean(),
        "ci95_lo": ci_lo, "ci95_hi": ci_hi,
        "t_stat": t_stat, "t_p": t_p,
        "wilcoxon_stat": w_stat, "wilcoxon_p": w_p,
        "cohens_d": cohend, "cliffs_delta": delta,
    }


def run_pairwise_family(df: pd.DataFrame, metrics: list[str]) -> pd.DataFrame:
    strategies = sorted(df["arm"].unique())
    loads = sorted(df["rho"].unique())
    rows = []
    for metric in metrics:
        for rho in loads:
            for strat_a, strat_b in itertools.combinations(strategies, 2):
                r = paired_comparison(df, metric, strat_a, strat_b, rho)
                if r is not None:
                    rows.append(r)
    result = pd.DataFrame(rows)
    if result.empty:
        return result
    # Holm-Bonferroni within each metric family (primary metrics corrected
    # separately from secondary, per §5.1's pre-registration).
    for metric in metrics:
        mask = result["metric"] == metric
        if mask.sum() == 0:
            continue
        reject, p_adj, _, _ = multipletests(result.loc[mask, "t_p"], method="holm")
        result.loc[mask, "t_p_holm"] = p_adj
        result.loc[mask, "reject_holm_0.05"] = reject
    return result


def two_way_anova(df: pd.DataFrame, metric: str) -> pd.DataFrame | None:
    if df["arm"].nunique() < 2 or df["rho"].nunique() < 2:
        return None
    model = ols(f"{metric} ~ C(arm) * C(rho)", data=df).fit()
    return anova_lm(model, typ=2)


def effort_ablation(df: pd.DataFrame, metrics: list[str]) -> pd.DataFrame:
    """Within each LLM strategy, compare reasoning-effort levels head to head.

    This is the question "does more reasoning actually buy better
    allocations?" -- a research result either way. A null here is worth
    reporting: it would say this allocation task doesn't reward deeper
    reasoning, which is directly actionable for anyone deploying one.
    """
    rows = []
    for strategy in sorted(df["strategy"].unique()):
        sub = df[df["strategy"] == strategy]
        levels = [e for e in sorted(sub["effort"].unique()) if e != "n/a"]
        if len(levels) < 2:
            continue
        for metric in metrics:
            for rho in sorted(sub["rho"].unique()):
                for ea, eb in itertools.combinations(levels, 2):
                    r = paired_comparison(sub, metric, f"{strategy}@{ea}", f"{strategy}@{eb}", rho)
                    if r is not None:
                        r["strategy"] = strategy
                        rows.append(r)
    result = pd.DataFrame(rows)
    if result.empty:
        return result
    for metric in metrics:
        mask = result["metric"] == metric
        if mask.sum() == 0:
            continue
        reject, p_adj, _, _ = multipletests(result.loc[mask, "t_p"], method="holm")
        result.loc[mask, "t_p_holm"] = p_adj
        result.loc[mask, "reject_holm_0.05"] = reject
    return result


def _fmt_table(df: pd.DataFrame, cols: list[str], float_cols: list[str]) -> str:
    d = df[cols].copy()
    for c in float_cols:
        if c in d.columns:
            d[c] = d[c].map(lambda x: f"{x:.4f}" if pd.notna(x) else "")
    return d.to_markdown(index=False)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default="results/baseline_summary.csv")
    ap.add_argument("--out", default="results/baseline_report.md")
    args = ap.parse_args()

    df = add_arm_column(pd.read_csv(args.csv))
    arms = sorted(df["arm"].unique())
    loads = sorted(df["rho"].unique())

    primary = run_pairwise_family(df, PRIMARY_METRICS)
    secondary = run_pairwise_family(df, SECONDARY_METRICS)
    ablation = effort_ablation(df, PRIMARY_METRICS)

    lines = []
    lines.append(f"# Statistical report\n")
    lines.append(f"Source: `{args.csv}`. Arms: {arms}. Loads (rho): {loads}. "
                 f"n_seeds per cell: {df.groupby(['arm','rho']).size().min()}-"
                 f"{df.groupby(['arm','rho']).size().max()}.\n")

    lines.append("## Descriptive summary (mean per arm x load)\n")
    desc = df.groupby(["arm", "rho"])[PRIMARY_METRICS + SECONDARY_METRICS].mean().reset_index()
    lines.append(_fmt_table(desc, ["arm", "rho"] + PRIMARY_METRICS + SECONDARY_METRICS,
                             PRIMARY_METRICS + SECONDARY_METRICS))
    lines.append("\n")

    lines.append("## Primary metrics: pairwise paired comparisons (Holm-Bonferroni corrected)\n")
    if not primary.empty:
        cols = ["metric", "rho", "arm_a", "arm_b", "n_pairs", "mean_a", "mean_b",
                "mean_diff", "ci95_lo", "ci95_hi", "cohens_d", "cliffs_delta", "t_p", "t_p_holm",
                "reject_holm_0.05"]
        lines.append(_fmt_table(primary, cols,
                                 ["mean_a", "mean_b", "mean_diff", "ci95_lo", "ci95_hi",
                                  "cohens_d", "cliffs_delta", "t_p", "t_p_holm"]))
    else:
        lines.append("(no comparisons -- need >=2 strategies)")
    lines.append("\n")

    lines.append("## Secondary metrics: pairwise paired comparisons (Holm-Bonferroni corrected within family)\n")
    if not secondary.empty:
        cols = ["metric", "rho", "arm_a", "arm_b", "n_pairs", "mean_diff",
                "ci95_lo", "ci95_hi", "cohens_d", "t_p_holm", "reject_holm_0.05"]
        lines.append(_fmt_table(secondary, cols,
                                 ["mean_diff", "ci95_lo", "ci95_hi", "cohens_d", "t_p_holm"]))
    else:
        lines.append("(no comparisons)")
    lines.append("\n")

    lines.append("## Effort ablation: does more reasoning buy better allocations?\n")
    if not ablation.empty:
        cols = ["strategy", "metric", "rho", "arm_a", "arm_b", "n_pairs", "mean_a", "mean_b",
                "mean_diff", "ci95_lo", "ci95_hi", "cohens_d", "t_p_holm", "reject_holm_0.05"]
        lines.append(_fmt_table(ablation, cols,
                                 ["mean_a", "mean_b", "mean_diff", "ci95_lo", "ci95_hi",
                                  "cohens_d", "t_p_holm"]))
        lines.append(
            "\nA null result here is a finding, not a failure: it would say this allocation "
            "task does not reward deeper reasoning, which directly tells a deployer to run "
            "the cheap effort level. Pair this table with `cost_usd` from the descriptive "
            "summary to state the quality-per-dollar tradeoff.\n"
        )
    else:
        lines.append("(no effort sweep present in this data -- run with --efforts low,medium,high)")
    lines.append("\n")

    lines.append("## Two-way ANOVA (strategy x load), primary metrics\n")
    for metric in PRIMARY_METRICS:
        anova = two_way_anova(df, metric)
        lines.append(f"### {metric}\n")
        if anova is not None:
            lines.append(anova.to_markdown())
        else:
            lines.append("(need >=2 strategies and >=2 load levels)")
        lines.append("\n")

    lines.append("## Notes\n")
    lines.append(
        "- Primary family (success_rate, jains_index) and secondary family are corrected "
        "*separately*, per the pre-registration rule in §5.1 of the proposal -- a secondary "
        "result is never allowed to steal significance budget from the primary family.\n"
        "- `cohens_d` is computed on paired differences (mean_diff / sd(diff)); `cliffs_delta` "
        "is the non-parametric alternative. Report both -- see the Romano et al. (2006) "
        "thresholds in `cliffs_delta()`'s docstring for interpreting magnitude.\n"
        "- An 'arm' is a strategy at one reasoning-effort level (e.g. `llm_negotiate@medium`); "
        "classic strategies have no effort knob and keep their bare name. Runs configured at "
        "different effort levels are never pooled.\n"
        "- `worst_decile_utility` saturates at 0 whenever a strategy's failure rate exceeds "
        "10% (the bottom decile is then entirely unsatisfied requests, which are pinned at "
        "utility 0) -- true for every cell in this run. It is not a coding error; it is a "
        "real floor effect worth flagging as a limitation of that particular metric rather "
        "than silently dropping it.\n"
    )

    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    out_path.write_text("\n".join(str(x) for x in lines))
    print(f"Wrote report to {out_path}")


if __name__ == "__main__":
    main()
