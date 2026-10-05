"""
Sensitivity analysis for Experiment B's unmeasured utility parameter
(proposal §7: "用户效用函数是我设定的 -- 效用参数做敏感性扫描，报告结论是否翻转").

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
    ("0.4_0.6", "low level, narrow"),
    ("0.8_1.2", "BASELINE"),
    ("1.6_2.4", "high level, narrow"),
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
        return "不显著" if expected_sign != 0 else "不显著 (一致)"
    if expected_sign == 0:
        return "显著 (翻转!)" if pct != 0 else "—"
    same = (pct > 0) == (expected_sign > 0)
    return "一致" if same else "**翻转!**"


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
            "结论": verdict(c1["pct"], c1["p"], -1),
        })

        c2 = contrast(df, rho, "p1_rule_surge", "p2_permuted_surge", "revenue_usd")
        rows2.append({
            "setting": label, "pw_mean": mean_pw, "pw_sd": sd_pw,
            "revenue_pct": c2["pct"], "cohens_d": c2["d"], "p": c2["p"],
            "结论": verdict(c2["pct"], c2["p"], +1),
        })

        mm = df[(df.rho == rho) & (df.strategy == "p2_permuted_surge")].mean_multiplier.mean()
        c3 = contrast(df, rho, "p2_permuted_surge", "p0_static", "revenue_usd")
        rows3.append({
            "setting": label, "pw_mean": mean_pw, "pw_sd": sd_pw,
            "extra_price_pct": 100 * (mm - 1),
            "revenue_pct": c3["pct"], "p": c3["p"],
            "结论": verdict(c3["pct"], c3["p"], -1),
        })

    t1, t2, t3 = pd.DataFrame(rows1), pd.DataFrame(rows2), pd.DataFrame(rows3)

    def n_consistent(t):
        return int((t["结论"] == "一致").sum()), len(t)

    lines = [
        "# Experiment B 敏感性分析：三条结论各自站不站得住\n",
        f"对比在 ρ={rho}（最高争抢）下计算，每档 n=30 配对 episode。`price_weight` 的取值"
        f"范围是**设定的、非实测的**，整个加价机制都通过它起作用，所以这是 Proposal §7 要求"
        f"的那项敏感性扫描。\n",
        "扫描同时变动**水平**与**离散度**：加价的作用机制是"
        "\"把价格敏感的人挤走、留下不敏感的人\"，所以异质性本身就是机制的一部分——"
        "均值相同但离散度不同的两个人群，行为可以相反。\n",
        "---\n",
        f"## 结论① 生产规则降低利用率 —— {'/'.join(map(str, n_consistent(t1)))} 档一致\n",
        t1.round(4).to_markdown(index=False),
        "\n",
        f"## 结论② 瞄准比随机加价更赚钱（同均值乘数） —— {'/'.join(map(str, n_consistent(t2)))} 档一致\n",
        t2.round(4).to_markdown(index=False),
        "\n",
        f"## 结论③ 不瞄准的涨价赚不到钱 —— {'/'.join(map(str, n_consistent(t3)))} 档一致\n",
        t3.round(4).to_markdown(index=False),
        "\n",
    ]

    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("\n".join(lines))
    print(f"Wrote {out}")
    for name, t in (("①利用率下降", t1), ("②瞄准有价值", t2), ("③随机涨价无收益", t3)):
        c, n = n_consistent(t)
        print(f"  {name}: {c}/{n} 档与基线一致")


if __name__ == "__main__":
    main()
