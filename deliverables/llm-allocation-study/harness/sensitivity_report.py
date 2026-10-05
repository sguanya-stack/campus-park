"""
Sensitivity analysis for Experiment B's unmeasured utility parameter
(proposal §7: "the utility function is assumed, not measured -- sweep the utility
parameters and report whether any conclusion flips").

Price sensitivity (`price_weight`) is set by assumption, not measured, and
the entire surge-pricing mechanism runs through it. This script re-tests
each of Experiment B's three conclusions across a sweep of that parameter
and reports, per conclusion, whether it holds, weakens, or flips.

The sweep varies LEVEL and SPREAD separately on purpose. Surge pricing
works by pushing price-sensitive users out while insensitive ones stay, so
heterogeneity is part of the mechanism, not a nuisance -- two populations
with the same mean sensitivity but different spread can behave oppositely.

Generate the inputs first:
  for pw in 0.4,0.6  0.8,1.2  1.6,2.4  0.2,2.0  0.1,3.9; do
    python -m harness.run_pricing_experiment --n-seeds 30 \
      --price-weight-range "$pw" --out-name "pricing_pw_$(echo $pw | tr ',' '_')"
  done
  python -m harness.sensitivity_report
"""

from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

SETTINGS = [
    ("0.4_0.6", "low level, homogeneous"),
    ("0.8_1.2", "BASELINE"),
    ("1.6_2.4", "high level, homogeneous"),
    ("0.2_2.0", "mid level, wide"),
    ("0.1_3.9", "high level, very wide"),
]


def contrast(df: pd.DataFrame, rho: float, a: str, b: str, metric: str):
    s = df[df["rho"] == rho]
    x = s[s.strategy == a].sort_values("seed")[metric].to_numpy(float)
    y = s[s.strategy == b].sort_values("seed")[metric].to_numpy(float)
    if len(x) == 0 or len(x) != len(y):
        return None
    d = x - y
    _, p = stats.ttest_rel(x, y)
    return {
        "pct": 100 * d.mean() / y.mean() if y.mean() else np.nan,
        "abs": d.mean(),
        "d": d.mean() / d.std(ddof=1) if d.std(ddof=1) else 0.0,
        "p": p,
    }


def verdict(pct: float, p: float, expected_sign: int) -> str:
    """expected_sign: +1 if the baseline conclusion was 'positive', -1 if
    'negative', 0 if the baseline conclusion was 'no significant effect'."""
    if p >= 0.05:
        return "not significant"
    if expected_sign == 0:
        return "significant (FLIPPED)" if pct != 0 else "--"
    same = (pct > 0) == (expected_sign > 0)
    return "consistent" if same else "**FLIPPED**"


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results-dir", default="results")
    ap.add_argument("--rho", type=float, default=2.0)
    ap.add_argument("--out", default="results/pricing_sensitivity.md")
    args = ap.parse_args()

    rdir = Path(args.results_dir)
    loaded = []
    for tag, label in SETTINGS:
        f = rdir / f"pricing_pw_{tag}.csv"
        if not f.exists():
            print(f"missing {f} -- skipping {label}")
            continue
        df = pd.read_csv(f)
        lo, hi = float(df.pw_lo.iloc[0]), float(df.pw_hi.iloc[0])
        loaded.append((label, lo, hi, df))

    if not loaded:
        raise SystemExit("No pricing_pw_*.csv files found -- run the sweep first.")

    rho = args.rho
    rows1, rows2, rows3 = [], [], []
    for label, lo, hi, df in loaded:
        mean_pw, sd_pw = (lo + hi) / 2, (hi - lo) / (12 ** 0.5)

        c1 = contrast(df, rho, "p1_rule_surge", "p0_static", "utilization")
        rows1.append({
            "setting": label, "pw_mean": mean_pw, "pw_sd": sd_pw,
            "util_pct": c1["pct"], "cohens_d": c1["d"], "p": c1["p"],
            "verdict": verdict(c1["pct"], c1["p"], -1),
        })

        c2 = contrast(df, rho, "p1_rule_surge", "p2_permuted_surge", "revenue_usd")
        rows2.append({
            "setting": label, "pw_mean": mean_pw, "pw_sd": sd_pw,
            "revenue_pct": c2["pct"], "cohens_d": c2["d"], "p": c2["p"],
            "verdict": verdict(c2["pct"], c2["p"], +1),
        })

        mm = df[(df.rho == rho) & (df.strategy == "p2_permuted_surge")].mean_multiplier.mean()
        c3 = contrast(df, rho, "p2_permuted_surge", "p0_static", "revenue_usd")
        rows3.append({
            "setting": label, "pw_mean": mean_pw, "pw_sd": sd_pw,
            "extra_price_pct": 100 * (mm - 1),
            "revenue_pct": c3["pct"], "p": c3["p"],
            "verdict": verdict(c3["pct"], c3["p"], -1),
        })

    t1, t2, t3 = pd.DataFrame(rows1), pd.DataFrame(rows2), pd.DataFrame(rows3)

    def n_consistent(t):
        return int((t["verdict"] == "consistent").sum()), len(t)

    lines = [
        "# Experiment B sensitivity analysis: which conclusions actually hold\n",
        f"Contrasts computed at rho={rho} (highest contention), n=30 paired episodes per "
        f"setting. The `price_weight` range is **assumed, not measured**, and the entire "
        f"surge mechanism runs through it -- so this is the sweep the proposal's threats-to-"
        f"validity table (§7) requires.\n",
        "The sweep varies **level** and **spread** independently. Surge pricing works by "
        "pushing price-sensitive users out while insensitive ones stay, so heterogeneity is "
        "part of the mechanism, not a nuisance: two populations with the same mean "
        "sensitivity but different spread can behave in opposite directions.\n",
        "---\n",
        f"## Conclusion 1: the production rule lowers utilization -- consistent in {'/'.join(map(str, n_consistent(t1)))} settings\n",
        t1.round(4).to_markdown(index=False),
        "\n",
        f"## Conclusion 2: targeting beats same-mean random surcharges -- consistent in {'/'.join(map(str, n_consistent(t2)))} settings\n",
        t2.round(4).to_markdown(index=False),
        "\n",
        f"## Conclusion 3: untargeted increases capture no revenue -- strictly consistent in {'/'.join(map(str, n_consistent(t3)))} settings\n",
        t3.round(4).to_markdown(index=False),
        "\n",
    ]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines))
    print(f"Wrote {out}")
    for name, t in (("1 utilization drops", t1), ("2 targeting pays", t2),
                     ("3 untargeted captures nothing", t3)):
        c, n = n_consistent(t)
        print(f"  {name}: consistent with baseline in {c}/{n} settings")


if __name__ == "__main__":
    main()
