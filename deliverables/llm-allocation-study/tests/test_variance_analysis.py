"""
Validates the variance decomposition against synthetic data with a KNOWN
ICC. This is the only way to test a statistical estimator before the real
data exists: construct data whose between/within split you chose, and
check the estimator recovers it.
"""

import numpy as np
import pandas as pd
import pytest

from harness.analyze import add_arm_column
from harness.variance_analysis import direct_decomposition, mixed_effects_icc


def make_replicated(between_sd, within_sd, n_seeds=40, n_reps=3, seed=0,
                     arm="llm_negotiate@high", loads=(0.8, 1.2, 2.0)):
    """Build a dataset whose true ICC is between^2 / (between^2 + within^2)."""
    rng = np.random.default_rng(seed)
    rows = []
    for rho in loads:
        base = 0.60 - 0.04 * (rho - 0.8)
        for s in range(1, n_seeds + 1):
            scenario_effect = rng.normal(0, between_sd)   # per (rho, seed)
            for rep in range(1, n_reps + 1):
                rows.append({
                    "strategy": arm.split("@")[0],
                    "effort": arm.split("@")[1] if "@" in arm else "n/a",
                    "rho": rho, "seed": s, "replicate": rep,
                    "success_rate": base + scenario_effect + rng.normal(0, within_sd),
                    "jains_index": 0.5 + scenario_effect + rng.normal(0, within_sd),
                    "illegal_allocation_rate": 0.0,
                    "cost_usd": 1.0,
                })
    return add_arm_column(pd.DataFrame(rows))


def true_icc(between_sd, within_sd):
    return between_sd**2 / (between_sd**2 + within_sd**2)


@pytest.mark.parametrize("between_sd,within_sd,between_recoverable", [
    (0.050, 0.010, True),    # stable model: ICC ~0.96
    (0.030, 0.030, True),    # jitter equals scenario variance: ICC ~0.50
    (0.010, 0.050, False),   # jitter dominates: ICC ~0.04
])
def test_direct_decomposition_recovers_known_icc(between_sd, within_sd, between_recoverable):
    df = make_replicated(between_sd, within_sd, n_seeds=60, n_reps=3, seed=7)
    out = direct_decomposition(df, "success_rate")
    assert out is not None
    expected = true_icc(between_sd, within_sd)
    assert out["icc"] == pytest.approx(expected, abs=0.08), \
        f"recovered ICC {out['icc']:.3f} vs true {expected:.3f}"
    assert out["within_sd"] == pytest.approx(within_sd, rel=0.25), \
        "within-cell jitter is directly observed and must always be recovered well"

    if between_recoverable:
        assert out["between_sd"] == pytest.approx(between_sd, rel=0.30)
    else:
        # A real limitation, not a defect: the correction subtracts
        # within/n (here ~8x the true between_var), so with only 3
        # replicates the between term has almost no relative precision once
        # jitter dominates. The ICC verdict ("essentially no scenario
        # variance") still holds, but the magnitude must not be quoted.
        assert out["between_sd"] < 0.02, out



def test_between_variance_is_not_inflated_by_jitter():
    """With zero true scenario variance, `between` must collapse to ~0
    rather than absorbing the model's jitter."""
    df = make_replicated(between_sd=0.0, within_sd=0.04, n_seeds=60, n_reps=3, seed=3)
    out = direct_decomposition(df, "success_rate")
    assert out["between_var"] < 0.0002, out
    assert out["icc"] < 0.15, f"ICC should be near zero, got {out['icc']:.3f}"


def test_deterministic_arm_has_zero_jitter():
    """Replicates of a deterministic policy are identical, so within-cell
    variance is exactly zero and ICC is 1."""
    df = make_replicated(between_sd=0.04, within_sd=0.0, n_seeds=30, n_reps=3, seed=1)
    out = direct_decomposition(df, "success_rate")
    assert out["within_var"] == pytest.approx(0.0, abs=1e-12)
    assert out["icc"] == pytest.approx(1.0, abs=1e-6)


def test_returns_none_without_replicates():
    df = make_replicated(0.03, 0.02, n_seeds=30, n_reps=1, seed=2)
    assert direct_decomposition(df, "success_rate") is None, \
        "must refuse to decompose unreplicated data rather than return a bogus number"


def test_corrected_mixed_effects_agrees_with_direct():
    between_sd, within_sd = 0.04, 0.02
    df = make_replicated(between_sd, within_sd, n_seeds=60, n_reps=3, seed=11)
    d = direct_decomposition(df, "success_rate")
    m = mixed_effects_icc(df, "success_rate", grouping="scenario")
    assert m is not None and "error" not in m
    assert m["icc"] == pytest.approx(d["icc"], abs=0.05), (m["icc"], d["icc"])
    assert m["icc"] == pytest.approx(true_icc(between_sd, within_sd), abs=0.08)


def test_preregistered_seed_grouping_understates_icc():
    """Documents a known defect in the pre-registered formula rather than
    hiding it: `(1|seed)` assumes a seed's effect is shared across load
    levels, but generate_requests() redraws per rho, so one seed at three
    loads is three unrelated scenarios. The seed grouping cannot represent
    that and pushes scenario variance into the residual.

    Both forms are still reported (PRE_REGISTRATION is frozen); this test
    pins down the direction and size of the bias so the report can state it.
    """
    between_sd, within_sd = 0.05, 0.01   # true ICC ~0.96
    df = make_replicated(between_sd, within_sd, n_seeds=60, n_reps=3, seed=7)
    truth = true_icc(between_sd, within_sd)

    corrected = mixed_effects_icc(df, "success_rate", grouping="scenario")["icc"]
    preregistered = mixed_effects_icc(df, "success_rate", grouping="seed")["icc"]

    assert corrected == pytest.approx(truth, abs=0.08)
    assert preregistered < truth - 0.4, (
        f"expected the pre-registered grouping to badly understate a high ICC; "
        f"got {preregistered:.3f} vs truth {truth:.3f}"
    )


def test_unknown_grouping_is_rejected():
    df = make_replicated(0.03, 0.02, n_seeds=20, n_reps=3, seed=1)
    with pytest.raises(ValueError, match="unknown grouping"):
        mixed_effects_icc(df, "success_rate", grouping="nonsense")


def test_load_effect_is_not_charged_to_scenario_variance():
    """rho is a fixed factor with a large real effect (~8pp across the range).
    Pooling across rho would charge that shift to scenario variance."""
    df = make_replicated(between_sd=0.0, within_sd=0.02, n_seeds=60, n_reps=3, seed=4)
    # make_replicated already varies the base by rho; with zero true scenario
    # variance the estimator must still report ~0, not the rho spread.
    out = direct_decomposition(df, "success_rate")
    assert out["between_sd"] < 0.01, (
        f"between_sd={out['between_sd']:.4f} — the load effect is leaking into "
        "scenario variance"
    )


def test_mixed_effects_reports_error_instead_of_raising():
    tiny = make_replicated(0.03, 0.02, n_seeds=2, n_reps=2, seed=5)
    out = mixed_effects_icc(tiny, "success_rate")
    assert out is None or "error" in out or np.isfinite(out.get("icc", np.nan))


def test_report_refuses_csv_without_replicate_column(tmp_path, monkeypatch):
    """The CLI must fail loudly, not silently produce an empty report."""
    import subprocess, sys
    csv = tmp_path / "no_reps.csv"
    make_replicated(0.03, 0.02, n_seeds=5, n_reps=1).drop(columns=["replicate"]).to_csv(csv, index=False)
    r = subprocess.run(
        [sys.executable, "-m", "harness.variance_analysis", "--csv", str(csv),
         "--out", str(tmp_path / "out.md")],
        capture_output=True, text=True, cwd=str(__import__("pathlib").Path(__file__).resolve().parents[1]),
    )
    assert r.returncode != 0
    assert "no `replicate` column" in (r.stdout + r.stderr)
