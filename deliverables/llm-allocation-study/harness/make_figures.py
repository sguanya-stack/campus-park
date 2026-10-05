"""
Generates the report figures as standalone, dependency-free SVG.

Why SVG by hand rather than matplotlib: the figures are embedded inline in a
single-file HTML report that gets emailed and printed. Inline SVG keeps the
report one self-contained file, renders crisply at any zoom, carries real
light/dark theming via CSS, and gives native hover tooltips through <title>
without a line of JavaScript.

Palette: the validated default categorical order (slots 1-3 blue/orange/aqua,
which clear the all-pairs CVD and normal-vision gates in BOTH modes) and the
blue<->red diverging pair with a gray midpoint for the signed figure. Verified
with the palette validator, not by eye. Aqua sits at 2.74:1 on the light
surface, below the 3:1 gate, so the relief rule applies: every bar carries a
visible direct value label.

Usage:
  python -m harness.make_figures            # writes results/figures/*.svg
"""

from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd
from scipy import stats

# ── palette ──────────────────────────────────────────────────────────────
LIGHT = {
    "surface": "#fcfcfb", "ink": "#0b0b0b", "ink2": "#52514e", "ink3": "#86857f",
    "grid": "#e5e4e0", "s1": "#2a78d6", "s2": "#eb6834", "s3": "#1baf7a",
    "pos": "#2a78d6", "neg": "#d03b3b", "mid": "#f0efec",
}
DARK = {
    "surface": "#1a1a19", "ink": "#ffffff", "ink2": "#c3c2b7", "ink3": "#8f8e86",
    "grid": "#33332f", "s1": "#3987e5", "s2": "#d95926", "s3": "#199e70",
    "pos": "#3987e5", "neg": "#e66767", "mid": "#383835",
}

FONT = ('-apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", '
        '"Hiragino Sans GB", sans-serif')


def _style() -> str:
    def block(scope: str, c: dict) -> str:
        decls = " ".join(f"--{k}:{v};" for k, v in c.items())
        return f"{scope}{{{decls}}}"
    return (
        "<style>"
        + block(".fig", LIGHT)
        + "@media (prefers-color-scheme: dark){:root:where(:not([data-theme='light'])) .fig{"
        + " ".join(f"--{k}:{v};" for k, v in DARK.items()) + "}}"
        + ":root[data-theme='dark'] .fig{"
        + " ".join(f"--{k}:{v};" for k, v in DARK.items()) + "}"
        + f".fig{{font-family:{FONT}}}"
        ".fig .ttl{fill:var(--ink);font-size:14px;font-weight:650}"
        ".fig .sub{fill:var(--ink2);font-size:11.5px}"
        ".fig .ax{fill:var(--ink2);font-size:11px}"
        ".fig .axs{fill:var(--ink3);font-size:10.5px}"
        ".fig .val{fill:var(--ink);font-size:10.5px;font-weight:600}"
        ".fig .vals{fill:var(--ink);font-size:9.5px;font-weight:600}"
        ".fig .grid{stroke:var(--grid);stroke-width:1}"
        ".fig .zero{stroke:var(--ink3);stroke-width:1.5}"
        "</style>"
    )


def bar_up(x: float, y: float, w: float, h: float, r: float = 4.0) -> str:
    """Bar anchored to the baseline with rounded top corners only."""
    r = max(0.0, min(r, h, w / 2))
    return (f"M{x:.1f},{y + h:.1f}V{y + r:.1f}A{r:.1f},{r:.1f} 0 0 1 {x + r:.1f},{y:.1f}"
            f"H{x + w - r:.1f}A{r:.1f},{r:.1f} 0 0 1 {x + w:.1f},{y + r:.1f}"
            f"V{y + h:.1f}Z")


def bar_h(x: float, y: float, w: float, h: float, r: float = 4.0, right=True) -> str:
    """Horizontal bar with the rounded end away from the zero line."""
    r = max(0.0, min(r, abs(w), h / 2))
    if right:
        return (f"M{x:.1f},{y:.1f}H{x + w - r:.1f}A{r:.1f},{r:.1f} 0 0 1 {x + w:.1f},{y + r:.1f}"
                f"V{y + h - r:.1f}A{r:.1f},{r:.1f} 0 0 1 {x + w - r:.1f},{y + h:.1f}H{x:.1f}Z")
    return (f"M{x:.1f},{y:.1f}H{x + w + r:.1f}A{r:.1f},{r:.1f} 0 0 0 {x + w:.1f},{y + r:.1f}"
            f"V{y + h - r:.1f}A{r:.1f},{r:.1f} 0 0 0 {x + w + r:.1f},{y + h:.1f}H{x:.1f}Z")


def esc(s: str) -> str:
    return (str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;"))


def wrap(text: str, x: float, y: float, cls: str = "sub", width: int = 118,
          line_h: float = 16.0) -> tuple[str, float]:
    """Word-wrap into stacked <text> lines. Returns (svg, next_y).

    SVG has no text wrapping, so long captions silently run past the viewBox
    and get clipped -- which is exactly what happened on the first render of
    figures 2 and 3. Wrapping here rather than hand-breaking strings keeps the
    captions editable without re-measuring by hand.
    """
    words, lines, cur = text.split(), [], ""
    for w in words:
        trial = f"{cur} {w}".strip()
        if len(trial) > width and cur:
            lines.append(cur)
            cur = w
        else:
            cur = trial
    if cur:
        lines.append(cur)
    out = "".join(
        f'<text x="{x}" y="{y + i * line_h:.1f}" class="{cls}">{esc(l)}</text>'
        for i, l in enumerate(lines)
    )
    return out, y + len(lines) * line_h


def svg(width: int, height: int, body: str, label: str) -> str:
    return (f'<svg class="fig" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" '
            f'width="100%" role="img" aria-label="{esc(label)}">{_style()}'
            f'<rect width="{width}" height="{height}" fill="var(--surface)"/>{body}</svg>')


def legend(x: float, y: float, items: list[tuple[str, str]]) -> str:
    out, cx = [], x
    for color, label in items:
        out.append(f'<rect x="{cx:.1f}" y="{y - 7:.1f}" width="10" height="10" rx="2.5" '
                   f'fill="var(--{color})"/>')
        out.append(f'<text x="{cx + 15:.1f}" y="{y + 2:.1f}" class="ax">{esc(label)}</text>')
        cx += 15 + 7.1 * len(label) + 22
    return "".join(out)


# ── figure 1: Experiment B, two panels, no dual axis ─────────────────────

def fig_pricing(df: pd.DataFrame) -> str:
    arms = [("p0_static", "P0 static", "s1"),
            ("p1_rule_surge", "P1 rule surge", "s2"),
            ("p2_permuted_surge", "P2 permuted control", "s3")]
    loads = [0.8, 1.2, 2.0]
    W, H = 760, 346
    cap, _ = wrap("Greedy allocator held fixed; only price varies. n=30 seeds per cell, "
                   "24 real garages. Two panels, never one dual axis.", 0, 34)
    body = ['<text x="0" y="16" class="ttl">Experiment B: the surge rule trades '
             'utilization for revenue</text>', cap]

    panels = [("utilization", "Spot utilization", 0.0, 0.72, lambda v: f"{v:.2f}"),
               ("revenue_usd", "Revenue (USD)", 0.0, 13000, lambda v: f"{v/1000:.1f}k")]

    pw, ph = 342, 200
    for pi, (metric, ptitle, lo, hi, fmt) in enumerate(panels):
        ox = pi * (pw + 48)
        oy = 70
        body.append(f'<text x="{ox}" y="{oy - 10}" class="ax" style="font-weight:650">{ptitle}</text>')
        # recessive gridlines
        for t in range(5):
            gy = oy + ph - ph * t / 4
            body.append(f'<line x1="{ox}" y1="{gy:.1f}" x2="{ox + pw}" y2="{gy:.1f}" class="grid"/>')
            body.append(f'<text x="{ox - 6}" y="{gy + 3.5:.1f}" class="axs" text-anchor="end">'
                        f'{fmt(lo + (hi - lo) * t / 4)}</text>')

        gw = pw / len(loads)
        bw = (gw - 26) / len(arms) - 2          # 2px surface gap between adjacent bars
        for li, rho in enumerate(loads):
            gx = ox + li * gw + 13
            for ai, (arm, alabel, slot) in enumerate(arms):
                v = float(df[(df.strategy == arm) & (df.rho == rho)][metric].mean())
                h = ph * (v - lo) / (hi - lo)
                bx = gx + ai * (bw + 2)
                body.append(
                    f'<path d="{bar_up(bx, oy + ph - h, bw, h)}" fill="var(--{slot})">'
                    f'<title>{esc(alabel)} · ρ={rho} · {ptitle}: {v:,.4g}</title></path>')
                # direct value label — required relief for aqua on the light surface
                body.append(f'<text x="{bx + bw/2:.1f}" y="{oy + ph - h - 5:.1f}" class="vals" '
                            f'text-anchor="middle">{fmt(v)}</text>')
            body.append(f'<text x="{gx + (gw - 26)/2:.1f}" y="{oy + ph + 16}" class="ax" '
                        f'text-anchor="middle">ρ={rho}</text>')
        body.append(f'<line x1="{ox}" y1="{oy + ph}" x2="{ox + pw}" y2="{oy + ph}" class="zero"/>')
        body.append(f'<text x="{ox + pw/2:.1f}" y="{oy + ph + 34}" class="axs" '
                    f'text-anchor="middle">demand / supply ratio</text>')

    body.append(legend(0, H - 14, [(s, l) for _, l, s in arms]))
    body.append(f'<text x="760" y="{H - 14}" class="axs" text-anchor="end">'
                'P1 vs P0 utilization, ρ=2.0: −3.54%, d=−4.09, p=7.3e−20</text>')
    return svg(W, H, "".join(body), "Experiment B utilization and revenue by pricing arm")


# ── figure 2: the sign flip (diverging) ──────────────────────────────────

def fig_sensitivity(rows: list[dict]) -> str:
    W = 760
    row_h = 46
    cx = 390                                   # zero line
    scale = 40                                  # px per percentage point
    cap, cap_y = wrap(
        "Revenue change from raising prices on RANDOM spots (P2) versus not raising them "
        "(P0), at ρ=2.0. Same surcharge count as the rule arm, only relocated. Price "
        "sensitivity is a set, not measured, parameter — so it was swept. The sign flips in "
        "3 of 5 settings, so this was demoted from a conclusion to “observed under the "
        "baseline assumption”.", 0, 34)
    body = ['<text x="0" y="16" class="ttl">A finding I overturned: untargeted price '
             'increases</text>', cap]
    top = cap_y + 22
    H = int(top + row_h * len(rows) + 56)
    for t in (-3, -2, -1, 0, 1, 2, 3, 4, 5, 6):
        gx = cx + t * scale
        if gx < 150 or gx > W:
            continue
        cls = "zero" if t == 0 else "grid"
        body.append(f'<line x1="{gx:.1f}" y1="{top}" x2="{gx:.1f}" y2="{top + row_h*len(rows):.1f}" class="{cls}"/>')
        body.append(f'<text x="{gx:.1f}" y="{top - 8}" class="axs" text-anchor="middle">{t:+d}%</text>')

    for i, r in enumerate(rows):
        y = top + i * row_h + 10
        bh = 18
        pct, sig = r["pct"], r["p"] < 0.05
        w = pct * scale
        slot = "pos" if pct > 0 else "neg"
        body.append(f'<text x="0" y="{y + 7}" class="ax">{esc(r["label"])}</text>')
        body.append(f'<text x="0" y="{y + 21}" class="axs">'
                    f'elasticity {r["mean"]:.2f}±{r["sd"]:.2f} · charged +{r["extra"]:.1f}%</text>')
        if abs(w) < 1.2:
            w = 1.2 if pct >= 0 else -1.2
        fade = "" if sig else ' opacity="0.45"'
        ns = "" if sig else " (not significant)"
        ns_lab = "" if sig else " n.s."
        anchor = "start" if pct > 0 else "end"
        body.append(f'<path d="{bar_h(cx, y, w, bh, right=pct > 0)}" fill="var(--{slot})"{fade}>'
                    f'<title>{esc(r["label"])}: revenue {pct:+.2f}% vs static, '
                    f'p={r["p"]:.3f}{ns}</title></path>')
        lx = cx + w + (8 if pct > 0 else -8)
        body.append(f'<text x="{lx:.1f}" y="{y + 13}" class="val" '
                    f'text-anchor="{anchor}">{pct:+.2f}%{ns_lab}</text>')

    foot, _ = wrap("Faded bar = not significant at α=0.05. At the SAME mean elasticity of "
                    "2.0, a homogeneous population loses 2.46% where a highly heterogeneous "
                    "one gains 0.77% — spread decides whether surplus can still be taken "
                    "from an insensitive tail.", 0, top + row_h * len(rows) + 22, cls="axs",
                    line_h=14)
    body.append(foot)
    return svg(W, H, "".join(body), "Sensitivity sweep showing the revenue conclusion flipping sign")


# ── figure 3: scale validation (dumbbell) ────────────────────────────────

def fig_scale(big: pd.DataFrame, small: pd.DataFrame) -> str:
    arms = ["greedy", "fifo", "random"]
    loads = [0.8, 1.2, 2.0]
    W = 760
    rows = [(a, r) for a in arms for r in loads]
    row_h = 30
    H = 0  # set after the caption is laid out
    x0, x1 = 210, 720
    lo, hi = 0.15, 0.80
    cap, cap_y = wrap(
        "Success rate per arm and load at both fleet sizes. The LLM arms cannot be afforded "
        "at full size, so supply and demand shrink together — verified here before relying "
        "on it. Ordering held in 6/6 (metric, ρ) cells; max mean deviation 0.052. It "
        "validates magnitude and ordering, NOT statistical precision (see Fig 4).", 0, 34)
    body = ['<text x="0" y="16" class="ttl">Scale validation: the shrink preserves the '
             'ordering</text>', cap]
    def px(v):
        return x0 + (x1 - x0) * (v - lo) / (hi - lo)

    top = int(cap_y) + 20
    for t in [0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8]:
        body.append(f'<line x1="{px(t):.1f}" y1="{top}" x2="{px(t):.1f}" '
                    f'y2="{top + row_h*len(rows):.1f}" class="grid"/>')
        body.append(f'<text x="{px(t):.1f}" y="{top - 8}" class="axs" text-anchor="middle">{t:.1f}</text>')

    for i, (arm, rho) in enumerate(rows):
        y = top + i * row_h + row_h / 2
        a = float(big[(big.strategy == arm) & (big.rho == rho)].success_rate.mean())
        b = float(small[(small.strategy == arm) & (small.rho == rho)].success_rate.mean())
        body.append(f'<text x="0" y="{y + 4:.1f}" class="ax">{esc(arm)} · ρ={rho}</text>')
        body.append(f'<line x1="{px(min(a,b)):.1f}" y1="{y:.1f}" x2="{px(max(a,b)):.1f}" '
                    f'y2="{y:.1f}" stroke="var(--ink3)" stroke-width="2"/>')
        for v, slot in ((a, "s1"), (b, "s2")):
            body.append(f'<circle cx="{px(v):.1f}" cy="{y:.1f}" r="5.5" fill="var(--{slot})" '
                        f'stroke="var(--surface)" stroke-width="2">'
                        f'<title>{esc(arm)} ρ={rho}: {v:.3f}</title></circle>')
        body.append(f'<text x="{px(max(a,b)) + 12:.1f}" y="{y + 4:.1f}" class="val">'
                    f'Δ{abs(a-b):.3f}</text>')

    H = int(top + row_h * len(rows) + 44)
    body.append(legend(0, H - 16, [("s1", "full fleet (833 spaces)"),
                                     ("s2", "compact (30 spaces)")]))
    return svg(W, H, "".join(body), "Scale validation dumbbell chart comparing success rate at two fleet sizes")


# ── figure 4: MDE by fleet size (single series, sequential) ──────────────

def fig_mde(points: list[tuple[str, int, float]]) -> str:
    W = 760
    cap, cap_y = wrap(
        "Minimum detectable difference in success rate (fifo vs greedy, ρ=1.2, n=30, α=0.05, "
        "power=0.80), measured from the paired-difference SD. A correction to an earlier claim "
        "of mine: the scale validation in Fig 3 covers effect ordering, not precision. At 30 "
        "spaces a real 2pp difference would be called “not significant” — a null result, not a "
        "negative one.", 0, 34)
    body = ['<text x="0" y="16" class="ttl">What the shrink costs: detectable effect '
             'size</text>', cap]
    top, ph = int(cap_y) + 22, 118
    maxv = 3.0
    pw = 700
    gw = pw / len(points)
    for t in range(4):
        gy = top + ph - ph * t / 3
        body.append(f'<line x1="0" y1="{gy:.1f}" x2="{pw}" y2="{gy:.1f}" class="grid"/>')
        body.append(f'<text x="{pw + 6}" y="{gy + 3.5:.1f}" class="axs">{maxv*t/3:.1f} pp</text>')
    # sequential blue ramp, light -> dark as the fleet grows
    ramp = ["#86b6ef", "#5598e7", "#2a78d6", "#256abf", "#184f95"]
    for i, (label, cap, mde) in enumerate(points):
        h = ph * min(mde, maxv) / maxv
        bx = i * gw + 18
        bw = gw - 36
        body.append(f'<path d="{bar_up(bx, top + ph - h, bw, h)}" fill="{ramp[i % len(ramp)]}">'
                    f'<title>{esc(label)}: MDE {mde:.2f} pp</title></path>')
        body.append(f'<text x="{bx + bw/2:.1f}" y="{top + ph - h - 6:.1f}" class="val" '
                    f'text-anchor="middle">{mde:.2f} pp</text>')
        body.append(f'<text x="{bx + bw/2:.1f}" y="{top + ph + 16}" class="ax" '
                    f'text-anchor="middle">{esc(label)}</text>')
    body.append(f'<line x1="0" y1="{top + ph}" x2="{pw}" y2="{top + ph}" class="zero"/>')
    foot, foot_y = wrap("The frozen configuration uses 240 spaces at n=60, giving 0.65–1.07 pp. "
                         "These come from deterministic policies, so they are optimistic for the "
                         "LLM arms, whose own jitter adds on top.", 0, top + ph + 38,
                         cls="axs", line_h=14)
    body.append(foot)
    return svg(W, int(foot_y) + 12, "".join(body), "Minimum detectable effect by fleet size")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--results", default="results")
    ap.add_argument("--out", default="results/figures")
    args = ap.parse_args()

    R = Path(args.results)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)

    # fig 1
    pricing = pd.read_csv(R / "pricing_summary.csv")
    (out / "fig1_pricing.svg").write_text(fig_pricing(pricing), encoding="utf-8")

    # fig 2
    settings = [("0.4_0.6", "low level, homogeneous"), ("0.8_1.2", "BASELINE"),
                 ("1.6_2.4", "high level, homogeneous"), ("0.2_2.0", "mid level, wide"),
                 ("0.1_3.9", "high level, very wide")]
    rows = []
    for tag, label in settings:
        d = pd.read_csv(R / f"pricing_pw_{tag}.csv")
        s = d[d.rho == 2.0]
        x = s[s.strategy == "p2_permuted_surge"].sort_values("seed").revenue_usd.to_numpy()
        y = s[s.strategy == "p0_static"].sort_values("seed").revenue_usd.to_numpy()
        _, p = stats.ttest_rel(x, y)
        lo, hi = float(d.pw_lo.iloc[0]), float(d.pw_hi.iloc[0])
        rows.append({
            "label": label, "pct": 100 * (x - y).mean() / y.mean(), "p": float(p),
            "mean": (lo + hi) / 2, "sd": (hi - lo) / (12 ** 0.5),
            "extra": 100 * (s[s.strategy == "p2_permuted_surge"].mean_multiplier.mean() - 1),
        })
    (out / "fig2_sensitivity.svg").write_text(fig_sensitivity(rows), encoding="utf-8")

    # fig 3
    big = pd.read_csv(R / "baseline_summary.csv")
    small = pd.read_csv(R / "compact_baseline_summary.csv")
    (out / "fig3_scale.svg").write_text(fig_scale(big, small), encoding="utf-8")

    # fig 4 -- recompute MDE from the real data rather than hardcoding
    from .analyze import add_arm_column
    from .power_analysis import mde, paired_diff_sd
    pts = []
    for label, cap, path in [("30 spaces", 30, "compact_baseline_summary.csv"),
                              ("240 spaces", 240, "expA_classic.csv"),
                              ("833 spaces", 833, "baseline_summary.csv")]:
        df = add_arm_column(pd.read_csv(R / path))
        s = paired_diff_sd(df, "success_rate", "fifo", "greedy", 1.2)
        pts.append((label, cap, 100 * mde(s["sd_diff"], 30)))
    (out / "fig4_mde.svg").write_text(fig_mde(pts), encoding="utf-8")

    for f in sorted(out.glob("*.svg")):
        print(f"{f}  ({f.stat().st_size/1024:.1f} KB)")


if __name__ == "__main__":
    main()
