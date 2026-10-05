"""Experiment B invariants -- above all, that the permutation control is
actually a permutation control."""

import numpy as np
import pytest

from harness.interval_lanes import build_ledgers
from harness.pricing import (
    SURGE_MULTIPLIER,
    PermutedSurgePricing,
    RuleSurgePricing,
    StaticPricing,
    allocate_with_pricing,
)
from harness.scenario import generate_requests
from harness.validator import validate


def test_static_pricing_never_adjusts(small_spots, requests_small):
    ledgers = build_ledgers(small_spots)
    rng = np.random.default_rng(0)
    mults = StaticPricing().multipliers(small_spots, ledgers, requests_small, 0, 10, rng)
    assert set(mults.values()) == {1.0}


def test_permuted_control_applies_the_same_number_of_surges(small_spots):
    """The whole design rests on this: P2 must charge the same marginal
    price distribution as P1 and differ ONLY in where the surcharge lands.
    Matching means (the proposal's original plan) would not guarantee it."""
    requests = generate_requests(small_spots, rho=2.0, seed=4)
    rule, permuted = RuleSurgePricing(), PermutedSurgePricing()

    checked_nonzero = False
    for w_start in range(0, 180, 10):
        ledgers = build_ledgers(small_spots)
        prev = [r for r in requests
                if w_start - 10 <= r.arrival_minute < w_start]
        r_out = rule.multipliers(small_spots, ledgers, prev, w_start, w_start + 10,
                                  np.random.default_rng(1))
        p_out = permuted.multipliers(small_spots, ledgers, prev, w_start, w_start + 10,
                                      np.random.default_rng(1))
        n_rule = sum(1 for v in r_out.values() if v > 1.0)
        n_perm = sum(1 for v in p_out.values() if v > 1.0)
        assert n_rule == n_perm, f"window {w_start}: {n_rule} vs {n_perm} surges"
        if n_rule:
            checked_nonzero = True
    assert checked_nonzero, "scenario never triggered a surge -- test would be vacuous"


def test_permuted_control_actually_relocates_the_surge(small_spots):
    """Same count is necessary but not sufficient -- it must also land
    somewhere different at least sometimes, or it isn't a control."""
    requests = generate_requests(small_spots, rho=2.0, seed=4)
    rule, permuted = RuleSurgePricing(), PermutedSurgePricing()
    relocated = False
    for w_start in range(0, 180, 10):
        ledgers = build_ledgers(small_spots)
        prev = [r for r in requests if w_start - 10 <= r.arrival_minute < w_start]
        r_out = rule.multipliers(small_spots, ledgers, prev, w_start, w_start + 10,
                                  np.random.default_rng(2))
        p_out = permuted.multipliers(small_spots, ledgers, prev, w_start, w_start + 10,
                                      np.random.default_rng(2))
        if {k for k, v in r_out.items() if v > 1} != {k for k, v in p_out.items() if v > 1}:
            relocated = True
            break
    assert relocated


def test_surge_multiplier_matches_production_rule():
    assert SURGE_MULTIPLIER == 1.5, "must stay in sync with server.js:574"


@pytest.mark.parametrize("pricing_cls", [StaticPricing, RuleSurgePricing, PermutedSurgePricing])
def test_pricing_arms_produce_legal_allocations(pricing_cls, small_spots):
    requests = generate_requests(small_spots, rho=1.2, seed=2)
    out, revenue, mean_mult = allocate_with_pricing(small_spots, requests, pricing_cls(), seed=2)
    assert len(out) == len(requests)
    assert validate(small_spots, requests, out).n_illegal == 0
    assert revenue >= 0
    assert mean_mult >= 1.0


def test_surge_raises_mean_multiplier_above_static(small_spots):
    requests = generate_requests(small_spots, rho=2.0, seed=2)
    _, _, static_mult = allocate_with_pricing(small_spots, requests, StaticPricing(), seed=2)
    _, _, rule_mult = allocate_with_pricing(small_spots, requests, RuleSurgePricing(), seed=2)
    assert static_mult == pytest.approx(1.0)
    assert rule_mult > 1.0


def test_revenue_is_charged_at_the_adjusted_price(spots):
    """Revenue must reflect what the user actually paid, not the list price.

    Deliberately run on the FULL fleet, not the compact one. A fired surge
    does not guarantee a revenue change: the rule targets contested spots,
    and a spot contested enough to surge may be saturated enough that nobody
    new books it, so the surcharge lands on zero transactions. Measured at
    rho=2.0 over 10 seeds: revenue moved 10/10 on the full fleet and at
    cap=240, but only 6/10 at cap=30, where each spot has 1-2 lanes.

    That is a property of the domain, not a defect -- so the test asserts it
    where the effect is actually guaranteed, and this docstring records why
    the compact scale cannot carry the assertion.
    """
    moved = 0
    for seed in range(1, 6):
        requests = generate_requests(spots, rho=2.0, seed=seed)
        _, rev_static, _ = allocate_with_pricing(spots, requests, StaticPricing(), seed=seed)
        _, rev_surge, mult = allocate_with_pricing(spots, requests, RuleSurgePricing(), seed=seed)
        assert mult > 1.0, f"seed {seed}: surge never fired, test would be vacuous"
        if abs(rev_surge - rev_static) > 1e-9:
            moved += 1
    assert moved == 5, f"surcharge failed to reach revenue in {5 - moved}/5 full-fleet seeds"


def test_pricing_is_reproducible(small_spots):
    requests = generate_requests(small_spots, rho=1.2, seed=9)
    a = allocate_with_pricing(small_spots, requests, PermutedSurgePricing(), seed=9)
    b = allocate_with_pricing(small_spots, requests, PermutedSurgePricing(), seed=9)
    assert [x.spot_id for x in a[0]] == [x.spot_id for x in b[0]]
    assert a[1] == pytest.approx(b[1])
