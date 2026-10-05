"""
Variance decomposition for the LLM arms (PRE_REGISTRATION §4, proposal §5.3).

This is the analysis that replaces `temperature=0`. Current Claude models
reject the `temperature` parameter outright, so the usual "set temperature
to zero and the run is reproducible" protocol is unavailable. Instead the
design measures stochasticity: each (arm, rho, seed) cell is run several
times, and total variance is split into

  * between-scenario variance  -- different seeds are genuinely different
                                  demand/supply configurations
  * within-cell variance       -- the SAME scenario re-run, i.e. the
                                  model's own jitter

ICC = between / (between + within) is the share of variance attributable
to the scenario. High ICC means the model is stable relative to how much
scenarios differ, and the paired design's power estimates hold. Low ICC
means model jitter dominates and the pre-registered n is optimistic --
which, per PRE_REGISTRATION §5, must be handled by revising and
re-freezing the sample size, NOT by quietly adding seeds.

Two estimators are reported side by side on purpose:

  1. A direct empirical decomposition (mean within-cell variance vs
     variance of cell means). No model assumptions, easy to defend,
     and computable from three replicates.
  2. A linear mixed-effects fit, `metric ~ C(arm) * C(rho)` with a random
     intercept for seed, which is what the pre-registration names.

If the two disagree substantially, trust the direct one and say so: the
mixed model can fail to converge or mis-attribute variance on small,
unbalanced data, and this dataset is small by construction.

Usage:
  python -m harness.variance_analysis --csv results/expA_combined.csv \
      --out results/expA_variance.md
"""

from __future__ import annotations

import argparse
import warnings
from pathlib import Path

import numpy as np
import pandas as pd

METRICS = ["success_rate", "jains_index", "illegal_allocation_rate", "cost_usd"]


def direct_decomposition(df: pd.DataFrame, metric: str) -> dict | None:
    """Empirical between-scenario / within-cell split from replicated cells.

    A "scenario" is a (rho, seed) pair, not a seed: `generate_requests(spots,
    rho, seed)` produces a different request stream for each rho, so the same
    seed at two load levels is two different scenarios.

    Load (rho) is a FIXED experimental factor, and its effect is large (real
    success rates move ~8pp across the rho range). Pooling across rho would
    charge that shift to scenario variance and inflate the ICC, so the split
    is computed within each rho level and then pooled.

      within  = mean within-cell variance (the model re-run on one scenario)
      between = variance of cell means within a load level, corrected for the
                jitter each cell mean itself carries
    """
    cells = df.groupby(["rho", "seed"])[metric]
    sizes = cells.size()
    replicated = sizes[sizes >= 2].index
    if len(replicated) < 2:
        return None

    sub = df.set_index(["rho", "seed"]).loc[replicated].reset_index()

    within_num, within_den = 0.0, 0
    between_parts, weights = [], []
    n_per_cell_vals = []

    for rho, chunk in sub.groupby("rho"):
        g = chunk.groupby("seed")[metric]
        wv = g.var(ddof=1).dropna()
        if wv.empty:
            continue
        within_num += float(wv.sum())
        within_den += len(wv)
        n_per_cell_vals.extend(g.size().tolist())

        means = g.mean()
        if len(means) >= 2:
            between_parts.append(float(means.var(ddof=1)))
            weights.append(len(means) - 1)

    if within_den == 0 or not between_parts:
        return None

    within = within_num / within_den
    n_per_cell = float(np.mean(n_per_cell_vals))
    observed_between = float(np.average(between_parts, weights=weights))
    # A cell mean of n replicates carries within/n of the model's own jitter;
    # subtract it so `between` is not inflated by the thing it is compared to.
    between = max(0.0, observed_between - within / n_per_cell)

    total = between + within
    return {
        "metric": metric,
        "n_cells": len(replicated),
        "replicates_per_cell": n_per_cell,
        "between_var": between,
        "within_var": within,
        "between_sd": between ** 0.5,
        "within_sd": within ** 0.5,
        "icc": (between / total) if total > 0 else float("nan"),
    }


def mixed_effects_icc(df: pd.DataFrame, metric: str, grouping: str = "scenario") -> dict | None:
    """Mixed-effects ICC with a random intercept.

    `grouping`:
      "seed"     -- the form named in PRE_REGISTRATION §4, `(1|seed)`.
      "scenario" -- `(1|rho:seed)`, the corrected form (default).

    Why both are reported: the pre-registered formula assumes a seed's effect
    is SHARED across load levels. It is not. `generate_requests(spots, rho,
    seed)` draws a different request count and a different random stream for
    each rho, so one seed at three load levels is three unrelated scenarios.
    Grouping by seed alone therefore cannot represent the scenario effect and
    pushes it into the residual, understating the ICC.

    The pre-registration is frozen, so the form it names is still computed and
    reported -- but alongside the corrected grouping, with this discrepancy
    stated rather than silently resolved.
    """
    import statsmodels.formula.api as smf

    if df["seed"].nunique() < 3 or len(df) < 10:
        return None

    if grouping == "seed":
        groups = df["seed"]
    elif grouping == "scenario":
        groups = df["rho"].astype(str) + ":" + df["seed"].astype(str)
    else:
        raise ValueError(f"unknown grouping {grouping!r}")

    formula = f"{metric} ~ C(rho)"
    if df["arm"].nunique() > 1:
        formula = f"{metric} ~ C(arm) * C(rho)"

    try:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            fit = smf.mixedlm(formula, df, groups=groups).fit()
        group_var = float(np.asarray(fit.cov_re).ravel()[0])
        resid_var = float(fit.scale)
    except Exception as e:  # noqa: BLE001 -- report, don't crash the report
        return {"metric": metric, "grouping": grouping, "error": f"{type(e).__name__}: {e}"}

    total = group_var + resid_var
    return {
        "metric": metric,
        "grouping": f"(1|{'seed' if grouping == 'seed' else 'rho:seed'})",
        "group_var": group_var,
        "residual_var": resid_var,
        "icc": (group_var / total) if total > 0 else float("nan"),
        "converged": bool(getattr(fit, "converged", True)),
    }


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--csv", default="results/expA_combined.csv")
    ap.add_argument("--out", default="results/expA_variance.md")
    args = ap.parse_args()

    from .analyze import add_arm_column

    df = add_arm_column(pd.read_csv(args.csv))
    if "replicate" not in df.columns:
        raise SystemExit(
            f"{args.csv} has no `replicate` column, so there are no repeated measures to "
            "decompose. Re-run the LLM arms with --replicates 3 (PRE_REGISTRATION §4)."
        )

    lines = [
        "# Variance decomposition: scenario variance vs model jitter\n",
        f"Source: `{args.csv}`.\n",
        "This is the analysis that stands in for `temperature=0`, which current Claude "
        "models reject outright. Instead of suppressing stochasticity, each cell is re-run "
        "and the variance is split.\n",
    ]

    any_replicated = False
    for arm in sorted(df["arm"].unique()):
        sub = df[df["arm"] == arm]
        reps = sub.groupby(["rho", "seed"]).size()
        max_reps = int(reps.max()) if len(reps) else 1

        lines.append(f"## {arm}\n")
        if max_reps < 2:
            lines.append(
                f"Only {max_reps} observation per cell — no replicates, so nothing to "
                "decompose. Expected for the classical arms: they are deterministic given a "
                "seed, so their model-jitter variance is exactly zero and ICC is 1 by "
                "construction.\n"
            )
            continue

        any_replicated = True
        direct_rows, mixed_rows = [], []
        for metric in METRICS:
            if metric not in sub.columns:
                continue
            d = direct_decomposition(sub, metric)
            if d:
                direct_rows.append(d)
            for grouping in ("scenario", "seed"):
                m = mixed_effects_icc(sub, metric, grouping=grouping)
                if m:
                    mixed_rows.append(m)

        if direct_rows:
            lines.append("### Direct empirical decomposition\n")
            lines.append(pd.DataFrame(direct_rows).round(6).to_markdown(index=False))
            lines.append("")
        if mixed_rows:
            lines.append("### Mixed-effects estimates\n")
            lines.append(pd.DataFrame(mixed_rows).round(6).to_markdown(index=False))
            lines.append(
                "\n`(1|seed)` is the form PRE_REGISTRATION §4 names; `(1|rho:seed)` is the "
                "corrected grouping. A seed at two load levels is two different scenarios "
                "(`generate_requests` redraws for each rho), so `(1|seed)` cannot represent "
                "the scenario effect and pushes it into the residual — expect it to report a "
                "**lower** ICC. Where they disagree, `(1|rho:seed)` and the direct estimate "
                "are the defensible ones; the pre-registered form is reported for fidelity, "
                "not because it is right.\n"
            )

        primary = next((r for r in direct_rows if r["metric"] == "success_rate"), None)
        if primary and np.isfinite(primary["icc"]):
            icc = primary["icc"]
            jitter_sd = primary["within_sd"]
            verdict = (
                "Model jitter is small relative to scenario differences; the paired design's "
                "power estimates hold."
                if icc >= 0.8 else
                "Model jitter is a **substantial** share of total variance. The MDEs in "
                "`design_recommendation.md` came from deterministic policies and are "
                "therefore optimistic for this arm. Per PRE_REGISTRATION §5 the response is "
                "to revise the sample size, record the reason, and RE-FREEZE — not to "
                "quietly add seeds."
            )
            lines.append(
                f"**success_rate:** ICC = {icc:.3f}; model jitter SD = {jitter_sd:.4f} "
                f"({jitter_sd * 100:.2f} pp) on the same scenario. {verdict}\n"
            )

    if not any_replicated:
        lines.append(
            "\n> No arm in this dataset has replicated cells. This report is empty by "
            "necessity, not by choice — run the LLM arms with `--replicates 3`.\n"
        )

    lines.append("\n## Interpreting the two estimators\n")
    lines.append(
        "- The **direct** decomposition makes no distributional assumptions and is "
        "computable from three replicates; prefer it when the two disagree.\n"
        "- The **mixed-effects** fit is the form named in the pre-registration. On small or "
        "unbalanced data it can fail to converge or mis-attribute variance; the `converged` "
        "column says which happened.\n"
        "- `between_var` is corrected for the sampling noise that within-cell jitter "
        "contributes to each cell mean, so it is not inflated by the very thing it is being "
        "compared against. Load (rho) is removed first as a fixed factor; pooling across "
        "load levels would charge the ~8pp success-rate shift between them to scenario "
        "variance.\n"
        "- **When jitter dominates, do not quote `between_sd` as a number.** The correction "
        "subtracts `within/n`, which in that regime is several times larger than the "
        "quantity being estimated, so three replicates leave it with almost no relative "
        "precision (verified against synthetic data with a known split: the ICC verdict "
        "survives, the magnitude does not). `within_sd` is directly observed and is always "
        "trustworthy.\n"
    )

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines))
    print(f"Wrote {out}")


if __name__ == "__main__":
    main()
