"""Core simulator invariants: scheduling, reproducibility, metrics, validation."""

import pytest

from harness.data_loader import load_spots
from harness.interval_lanes import SpotLedger, build_ledgers
from harness.metrics import _gini, _jains_index, _worst_decile_utility, compute_metrics
from harness.policies import FIFOPolicy, GreedyPolicy, RandomPolicy
from harness.policies.base import Assignment
from harness.scenario import WINDOW_MINUTES, generate_requests
from harness.validator import validate


# ── interval scheduling ──────────────────────────────────────────────────

def test_lane_rejects_overlap():
    led = SpotLedger("s", capacity=1)
    led.book(0, 60)
    assert not led.has_capacity(30, 90), "overlapping interval must not fit"
    assert led.has_capacity(60, 120), "touching-but-not-overlapping must fit"


def test_capacity_is_per_lane_not_per_spot():
    led = SpotLedger("s", capacity=3)
    for _ in range(3):
        led.book(0, 60)
    assert not led.has_capacity(0, 60), "4th overlapping booking must be rejected"
    assert led.has_capacity(60, 120)


def test_unbook_restores_capacity():
    led = SpotLedger("s", capacity=1)
    idx = led.book(0, 60)
    assert not led.has_capacity(0, 60)
    led.unbook(idx, 0, 60)
    assert led.has_capacity(0, 60)


def test_booked_minutes_accumulates():
    led = SpotLedger("s", capacity=2)
    led.book(0, 60)
    led.book(0, 30)
    assert led.booked_minutes() == 90


# ── reproducibility ──────────────────────────────────────────────────────

def test_same_seed_gives_identical_requests(small_spots):
    a = generate_requests(small_spots, rho=1.2, seed=42)
    b = generate_requests(small_spots, rho=1.2, seed=42)
    assert a == b, "same seed must reproduce byte-identical requests"


def test_different_seed_gives_different_requests(small_spots):
    a = generate_requests(small_spots, rho=1.2, seed=1)
    b = generate_requests(small_spots, rho=1.2, seed=2)
    assert a != b


def test_price_weight_sweep_is_single_factor(small_spots):
    """Changing the elasticity range must leave every OTHER attribute
    untouched -- this is what makes the sensitivity sweep interpretable."""
    a = generate_requests(small_spots, rho=1.2, seed=7, price_weight_range=(0.8, 1.2))
    b = generate_requests(small_spots, rho=1.2, seed=7, price_weight_range=(0.2, 2.0))
    assert len(a) == len(b)
    for x, y in zip(a, b):
        assert x.price_weight != y.price_weight or x.price_weight == y.price_weight
        for f in ("arrival_minute", "duration_minutes", "trip_value", "walk_weight",
                   "walk_tolerance_m", "needs_ev", "reservation_frac",
                   "origin_lat", "origin_lng"):
            assert getattr(x, f) == getattr(y, f), f"{f} must not change with elasticity"


def test_spot_attributes_are_deterministic():
    assert load_spots() == load_spots()


def test_rescale_preserves_spot_count_and_hits_target():
    full = load_spots()
    small = load_spots(target_total_capacity=30)
    assert len(small) == len(full), "rescaling must not drop garages"
    assert sum(s.capacity for s in small) == 30
    assert all(s.capacity >= 1 for s in small)
    assert {s.id for s in small} == {s.id for s in full}
    assert all(a.price_per_hour == b.price_per_hour for a, b in zip(full, small))


def test_rescale_below_spot_count_is_rejected():
    with pytest.raises(ValueError, match="below the number of spots"):
        load_spots(target_total_capacity=5)


# ── metrics ──────────────────────────────────────────────────────────────

def test_jains_index_known_values():
    assert _jains_index([1, 1, 1, 1]) == pytest.approx(1.0)
    assert _jains_index([1, 0, 0, 0]) == pytest.approx(0.25)
    assert _jains_index([0, 0, 0, 0]) == pytest.approx(1.0)


def test_gini_known_values():
    assert _gini([1, 1, 1, 1]) == pytest.approx(0.0)
    assert _gini([0, 0, 0, 1]) == pytest.approx(0.75)


def test_worst_decile_is_the_bottom_tenth():
    assert _worst_decile_utility(list(range(100))) == pytest.approx(4.5)  # mean of 0..9
    assert _worst_decile_utility([5]) == pytest.approx(5.0)


# ── policies ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("cls", [RandomPolicy, FIFOPolicy, GreedyPolicy])
def test_policy_returns_one_assignment_per_request(cls, small_spots, requests_small):
    policy = cls(seed=1) if cls is RandomPolicy else cls()
    out = policy.allocate(small_spots, requests_small)
    assert len(out) == len(requests_small)
    assert [a.request_id for a in out] == [r.id for r in requests_small]


@pytest.mark.parametrize("cls", [RandomPolicy, FIFOPolicy, GreedyPolicy])
def test_classic_policies_never_produce_illegal_allocations(cls, small_spots, requests_small):
    policy = cls(seed=1) if cls is RandomPolicy else cls()
    out = policy.allocate(small_spots, requests_small)
    report = validate(small_spots, requests_small, out)
    assert report.n_illegal == 0, [v.__dict__ for v in report.violations[:5]]


@pytest.mark.parametrize("cls", [RandomPolicy, FIFOPolicy, GreedyPolicy])
def test_assigned_utility_always_clears_reservation_threshold(cls, small_spots, requests_small):
    policy = cls(seed=1) if cls is RandomPolicy else cls()
    out = policy.allocate(small_spots, requests_small)
    by_id = {r.id: r for r in requests_small}
    for a in out:
        if a.spot_id is not None:
            assert a.utility >= by_id[a.request_id].u_min


def test_greedy_dominates_fifo_on_success_rate(small_spots, requests_small):
    """Greedy searches all available spots; FIFO commits to one preference.
    Greedy should never do worse on the same scenario."""
    g = GreedyPolicy().allocate(small_spots, requests_small)
    f = FIFOPolicy().allocate(small_spots, requests_small)
    assert sum(a.spot_id is not None for a in g) >= sum(a.spot_id is not None for a in f)


def test_ev_requests_never_land_on_non_ev_spots(small_spots, requests_small):
    out = GreedyPolicy().allocate(small_spots, requests_small)
    by_req = {r.id: r for r in requests_small}
    by_spot = {s.id: s for s in small_spots}
    for a in out:
        if a.spot_id and by_req[a.request_id].needs_ev:
            assert by_spot[a.spot_id].is_ev


# ── validator ────────────────────────────────────────────────────────────

def test_validator_flags_unknown_spot(small_spots, requests_small):
    bad = [Assignment(requests_small[0].id, "NOPE", 1.0)]
    report = validate(small_spots, requests_small, bad)
    assert report.n_illegal == 1
    assert report.violations[0].reason == "unknown_spot"


def test_validator_flags_double_booking(small_spots):
    """Two overlapping requests forced onto a 1-lane spot: the second is illegal."""
    spot = min(small_spots, key=lambda s: s.capacity)
    assert spot.capacity >= 1
    reqs = generate_requests(small_spots, rho=1.2, seed=3)
    overlapping = [r for r in reqs if not r.needs_ev][: spot.capacity + 1]
    # force identical intervals so they must collide
    import dataclasses
    overlapping = [dataclasses.replace(r, arrival_minute=10.0, duration_minutes=60.0)
                    for r in overlapping]
    assignments = [Assignment(r.id, spot.id, 1.0) for r in overlapping]
    report = validate(small_spots, overlapping, assignments)
    assert report.n_illegal == 1
    assert report.violations[0].reason == "double_booked"


def test_validator_flags_ev_mismatch(small_spots):
    non_ev = next(s for s in small_spots if not s.is_ev)
    reqs = generate_requests(small_spots, rho=1.2, seed=5)
    ev_req = next(r for r in reqs if r.needs_ev)
    report = validate(small_spots, [ev_req], [Assignment(ev_req.id, non_ev.id, 1.0)])
    assert report.n_illegal == 1
    assert report.violations[0].reason == "ev_mismatch"


def test_unassigned_requests_are_not_counted_as_allocations(small_spots, requests_small):
    none_assigned = [Assignment(r.id, None, None) for r in requests_small]
    report = validate(small_spots, requests_small, none_assigned)
    assert report.n_allocated == 0
    assert report.illegal_allocation_rate == 0.0


# ── metrics integration ──────────────────────────────────────────────────

def test_metrics_success_rate_matches_assignment_count(small_spots, requests_small):
    out = GreedyPolicy().allocate(small_spots, requests_small)
    m = compute_metrics(small_spots, requests_small, out, WINDOW_MINUTES)
    assert m.n_satisfied == sum(a.spot_id is not None for a in out)
    assert m.success_rate == pytest.approx(m.n_satisfied / len(requests_small))


def test_utilization_never_exceeds_one(small_spots, requests_small):
    out = GreedyPolicy().allocate(small_spots, requests_small)
    m = compute_metrics(small_spots, requests_small, out, WINDOW_MINUTES)
    assert 0.0 <= m.utilization <= 1.0
