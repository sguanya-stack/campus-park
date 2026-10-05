"""
LLM policy tests. Every one runs against a stub client -- no API key, no
network, no cost. These are regression tests for the two bugs that were
caught before the paid experiment ran.
"""

import pytest

from harness.metrics import compute_metrics
from harness.policies.llm_common import commit_llm_choice, group_into_windows, usage_cost_usd
from harness.scenario import WINDOW_MINUTES, generate_requests
from harness.validator import validate

from . import stub_anthropic as stub


@pytest.fixture
def tiny(small_spots):
    return small_spots, generate_requests(small_spots, rho=1.2, seed=1, n_requests_override=8)


def _run(policy_cls, spots, requests, chooser, **kwargs):
    calls = stub.install(stub.allocation_handler(chooser))
    policy = policy_cls(**kwargs)
    out = policy.allocate(spots, requests)
    return policy, out, calls


# ── contract ─────────────────────────────────────────────────────────────

@pytest.mark.parametrize("policy_name", ["llm_central", "llm_negotiate"])
def test_returns_one_assignment_per_request_in_order(policy_name, tiny):
    spots, requests = tiny
    cls = _policy(policy_name)
    _, out, _ = _run(cls, spots, requests, lambda r, i: None)
    assert [a.request_id for a in out] == [r.id for r in requests]


def _policy(name):
    if name == "llm_central":
        from harness.policies.llm_central import LLMCentralPolicy
        return LLMCentralPolicy
    from harness.policies.llm_negotiate import LLMNegotiatePolicy
    return LLMNegotiatePolicy


# ── H3: illegal output is recorded, never repaired ───────────────────────

@pytest.mark.parametrize("policy_name", ["llm_central", "llm_negotiate"])
def test_hallucinated_spot_is_flagged_not_silently_dropped(policy_name, tiny):
    spots, requests = tiny
    _, out, _ = _run(_policy(policy_name), spots, requests, lambda r, i: "NO_SUCH_SPOT")
    report = validate(spots, requests, out)
    assert report.n_illegal > 0, "a hallucinated spot_id must surface as a violation"
    assert all(v.reason == "unknown_spot" for v in report.violations)
    # and it must NOT be counted as a satisfied request
    assert all(a.utility is None for a in out if a.spot_id == "NO_SUCH_SPOT")


def test_illegal_rate_denominator_is_attempted_allocations(tiny):
    spots, requests = tiny
    _, out, _ = _run(_policy("llm_central"), spots, requests, lambda r, i: "NO_SUCH_SPOT")
    report = validate(spots, requests, out)
    assert report.illegal_allocation_rate == pytest.approx(1.0)


# ── regression: u_min must be enforced on the LLM path too ───────────────

def test_below_threshold_choice_is_not_counted_as_success(small_spots):
    """Regression for a real bug: the LLM commit path did not apply the
    acceptance threshold the classic policies use, so a negative-utility
    match counted as a 'success' for LLM arms only -- making success rates
    incomparable across conditions."""
    requests = generate_requests(small_spots, rho=1.2, seed=1, n_requests_override=30)
    spot_by_id = {s.id: s for s in small_spots}
    req_by_id = {r.id: r for r in requests}
    from harness.interval_lanes import build_ledgers
    ledgers = build_ledgers(small_spots)

    # find a (request, spot) pair that is legal but below the threshold
    pair = None
    for r in requests:
        for s in small_spots:
            if r.is_eligible(s) and r.utility(s) < r.u_min:
                pair = (r, s)
                break
        if pair:
            break
    assert pair, "expected at least one legal-but-unattractive pairing in this scenario"

    r, s = pair
    result = commit_llm_choice(req_by_id, spot_by_id, ledgers, r.id, s.id)
    assert result.assignment.spot_id is None, "below-threshold match must not count as satisfied"
    assert result.is_illegal is False, "below-threshold is a quality miss, not a hard violation"
    assert ledgers[s.id].has_capacity(r.start_minute, r.end_minute), \
        "rejected match must not consume capacity"


def test_legal_attractive_choice_is_committed(small_spots):
    requests = generate_requests(small_spots, rho=1.2, seed=1, n_requests_override=30)
    spot_by_id = {s.id: s for s in small_spots}
    req_by_id = {r.id: r for r in requests}
    from harness.interval_lanes import build_ledgers
    ledgers = build_ledgers(small_spots)

    pair = next((r, s) for r in requests for s in small_spots
                 if r.is_eligible(s) and r.utility(s) >= r.u_min)
    r, s = pair
    result = commit_llm_choice(req_by_id, spot_by_id, ledgers, r.id, s.id)
    assert result.assignment.spot_id == s.id
    assert result.assignment.utility == pytest.approx(r.utility(s))
    assert not ledgers[s.id].has_capacity(r.start_minute, r.end_minute) or s.capacity > 1


# ── regression: T2's revision round must actually fire ───────────────────

def test_negotiate_runs_all_three_rounds(tiny):
    """Regression for a real bug: parse_tool_input was hardcoded to look for
    'submit_allocation', so T2's round-2 'submit_tentative_allocation'
    response never parsed and the revision round silently never ran."""
    spots, requests = tiny
    _, _, calls = _run(_policy("llm_negotiate"), spots, requests, lambda r, i: None)
    tools_used = [c.get("tool_choice", {}).get("name") for c in calls]
    assert "submit_bid" in tools_used
    assert "submit_tentative_allocation" in tools_used
    assert "submit_allocation" in tools_used
    n_windows = len(group_into_windows(requests))
    n_bids = tools_used.count("submit_bid")
    assert n_bids > len(requests) - n_windows, \
        "revision round should add bid calls beyond the one-per-request baseline"


def test_negotiate_reports_no_parse_failures_on_wellformed_output(tiny):
    spots, requests = tiny
    policy, _, _ = _run(_policy("llm_negotiate"), spots, requests, lambda r, i: None)
    assert policy.last_parse_failure_rate == 0.0


# ── failure accounting ───────────────────────────────────────────────────

def test_malformed_tool_output_counts_as_parse_failure_not_crash(tiny):
    spots, requests = tiny

    def broken(kwargs):
        return stub.StubResponse([])  # no tool_use block at all

    stub.install(broken)
    policy = _policy("llm_central")()
    out = policy.allocate(spots, requests)
    assert len(out) == len(requests)
    assert all(a.spot_id is None for a in out)
    assert policy.last_parse_failure_rate == 1.0


def test_api_exception_is_recorded_not_retried(tiny):
    spots, requests = tiny
    attempts = []

    def raising(kwargs):
        attempts.append(1)
        raise RuntimeError("simulated API failure")

    stub.install(raising)
    policy = _policy("llm_central")()
    out = policy.allocate(spots, requests)
    n_windows = len(group_into_windows(requests))
    assert len(attempts) == n_windows, \
        "pre-registration forbids retries in the research path: one attempt per window"
    assert all(a.spot_id is None for a in out)
    assert policy.last_parse_failure_rate == 1.0


# ── cost accounting ──────────────────────────────────────────────────────

def test_cost_is_accumulated_from_usage(tiny):
    spots, requests = tiny
    policy, _, calls = _run(_policy("llm_central"), spots, requests, lambda r, i: None)
    assert policy.last_cost_usd > 0
    expected = len(calls) * usage_cost_usd("claude-opus-5", stub.StubUsage())
    assert policy.last_cost_usd == pytest.approx(expected)


def test_unknown_model_pricing_raises_rather_than_guessing():
    with pytest.raises(ValueError, match="No pricing entry"):
        usage_cost_usd("some-unlisted-model", stub.StubUsage())


def test_negotiate_bills_agents_and_broker_separately(tiny):
    spots, requests = tiny
    policy, _, calls = _run(_policy("llm_negotiate"), spots, requests, lambda r, i: None)
    models = {c["model"] for c in calls}
    assert models == {"claude-opus-5", "claude-haiku-4-5"}
    assert policy.last_cost_usd > 0


# ── windowing ────────────────────────────────────────────────────────────

def test_every_request_lands_in_exactly_one_window(requests_small):
    windows = group_into_windows(requests_small)
    flat = [r.id for w in windows for r in w]
    assert sorted(flat) == sorted(r.id for r in requests_small)
    assert len(flat) == len(set(flat))


def test_effort_is_passed_through_to_the_api_call(tiny):
    spots, requests = tiny
    for effort in ("low", "medium", "high"):
        _, _, calls = _run(_policy("llm_central"), spots, requests,
                            lambda r, i: None, effort=effort)
        assert all(c["output_config"]["effort"] == effort for c in calls)
