"""
Production-layer tests: circuit breaker, validator gate, fallback,
budget guard, telemetry, and the HTTP contract.

The behavior under test is specifically what the research path is
FORBIDDEN from doing (retry, fall back, repair) -- keeping these tests
here documents the split.
"""

import json
import threading
import time
import urllib.error
import urllib.request

import pytest

from harness.policies.base import Assignment
from harness.scenario import generate_requests
from serving.allocator import AllocatorConfig, ProductionAllocator
from serving.safety import BreakerConfig, BreakerState, CircuitBreaker, gate_allocations
from serving.telemetry import Event, Telemetry


# ── circuit breaker ──────────────────────────────────────────────────────

def test_breaker_closed_until_threshold():
    b = CircuitBreaker(BreakerConfig(failure_threshold=0.5, min_samples=4))
    for _ in range(3):
        b.record(failed=True)
    assert b.state is BreakerState.CLOSED, "must not trip below min_samples"
    b.record(failed=True)
    assert b.state is BreakerState.OPEN


def test_breaker_half_opens_after_cooldown_then_recovers():
    b = CircuitBreaker(BreakerConfig(failure_threshold=0.5, min_samples=2, cooldown_s=0.05))
    b.record(True); b.record(True)
    assert not b.allows_llm()
    time.sleep(0.08)
    assert b.state is BreakerState.HALF_OPEN
    assert b.allows_llm(), "half-open must let one trial through"
    b.record(failed=False)
    assert b.state is BreakerState.CLOSED


def test_failed_trial_reopens_immediately():
    b = CircuitBreaker(BreakerConfig(failure_threshold=0.5, min_samples=2, cooldown_s=0.05))
    b.record(True); b.record(True)
    time.sleep(0.08)
    assert b.state is BreakerState.HALF_OPEN
    b.record(failed=True)
    assert b.state is BreakerState.OPEN, "a failed trial must not need min_samples again"


def test_breaker_is_threadsafe():
    b = CircuitBreaker(BreakerConfig(failure_threshold=0.9, min_samples=50, window=500))
    def hammer():
        for _ in range(200):
            b.record(failed=False)
            b.allows_llm()
    threads = [threading.Thread(target=hammer) for _ in range(4)]
    [t.start() for t in threads]
    [t.join() for t in threads]
    assert b.state is BreakerState.CLOSED


# ── validator gate ───────────────────────────────────────────────────────

def test_gate_drops_illegal_and_reports_ids(small_spots):
    requests = generate_requests(small_spots, rho=1.2, seed=1, n_requests_override=5)
    assignments = [Assignment(requests[0].id, "HALLUCINATED", None)] + \
                  [Assignment(r.id, None, None) for r in requests[1:]]
    gate = gate_allocations(small_spots, requests, assignments)
    assert gate.illegal_count == 1
    assert gate.rejected_request_ids == [requests[0].id]
    assert all(a.request_id != requests[0].id for a in gate.kept)


def test_gate_keeps_legal_allocations(small_spots):
    from harness.policies.greedy_policy import GreedyPolicy
    requests = generate_requests(small_spots, rho=1.2, seed=1, n_requests_override=20)
    good = GreedyPolicy().allocate(small_spots, requests)
    gate = gate_allocations(small_spots, requests, good)
    assert gate.illegal_count == 0
    assert len(gate.kept) == len(good)


# ── allocator composition ────────────────────────────────────────────────

class _StubPolicy:
    name = "stub"
    last_cost_usd = 0.01

    def __init__(self, behavior):
        self.behavior = behavior

    def allocate(self, spots, requests):
        if self.behavior == "raise":
            raise RuntimeError("model exploded")
        if self.behavior == "hang":
            time.sleep(5)
            return []
        if self.behavior == "hallucinate":
            return [Assignment(r.id, "NO_SUCH_SPOT", None) for r in requests]
        return [Assignment(r.id, None, None) for r in requests]


def _alloc(behavior, spots, **cfg):
    return ProductionAllocator(
        policy_factory=lambda: _StubPolicy(behavior),
        config=AllocatorConfig(**cfg),
        telemetry=Telemetry(),
        breaker=CircuitBreaker(BreakerConfig(min_samples=1, failure_threshold=1.0)),
        spots=spots,
    )


def test_llm_exception_falls_back_to_greedy(small_spots):
    requests = generate_requests(small_spots, rho=1.2, seed=1, n_requests_override=10)
    a = _alloc("raise", small_spots, max_attempts=1)
    out = a.allocate(requests)
    assert out["policy"] == "greedy"
    assert out["degraded"] is True
    assert "llm_error" in out["reason"]
    assert len(out["assignments"]) == len(requests)


def test_illegal_output_is_repaired_by_fallback_not_served(small_spots):
    requests = generate_requests(small_spots, rho=1.2, seed=1, n_requests_override=10)
    a = _alloc("hallucinate", small_spots, max_attempts=1)
    out = a.allocate(requests)
    assert out["illegal_rejected"] > 0
    assert out["degraded"] is True
    assert all(x["spot_id"] != "NO_SUCH_SPOT" for x in out["assignments"]), \
        "a hallucinated spot must never reach the caller"


def test_deadline_is_enforced(small_spots):
    requests = generate_requests(small_spots, rho=1.2, seed=1, n_requests_override=5)
    a = _alloc("hang", small_spots, deadline_s=0.2, max_attempts=1)
    t0 = time.monotonic()
    out = a.allocate(requests)
    assert time.monotonic() - t0 < 3.0, "caller must not wait for a hung model"
    assert out["policy"] == "greedy"


def test_breaker_opens_and_skips_the_model(small_spots):
    requests = generate_requests(small_spots, rho=1.2, seed=1, n_requests_override=5)
    a = _alloc("raise", small_spots, max_attempts=1)
    a.allocate(requests)
    assert not a.breaker.allows_llm()
    out = a.allocate(requests)
    assert out["reason"] == "circuit_open", "second call must not pay the model again"


def test_cost_ceiling_stops_spending(small_spots):
    requests = generate_requests(small_spots, rho=1.2, seed=1, n_requests_override=5)
    a = _alloc("ok", small_spots, cost_ceiling_usd=0.005, max_attempts=1)
    a.allocate(requests)          # spends 0.01, crossing the ceiling
    out = a.allocate(requests)
    assert out["reason"] == "cost_ceiling"
    assert out["cost_usd"] == 0.0


def test_every_request_gets_an_answer_even_when_degraded(small_spots):
    requests = generate_requests(small_spots, rho=1.2, seed=1, n_requests_override=12)
    for behavior in ("raise", "hallucinate", "ok"):
        out = _alloc(behavior, small_spots, max_attempts=1, deadline_s=1).allocate(requests)
        assert [x["request_id"] for x in out["assignments"]] == [r.id for r in requests]


def test_health_reports_degraded_when_breaker_open(small_spots):
    requests = generate_requests(small_spots, rho=1.2, seed=1, n_requests_override=5)
    a = _alloc("raise", small_spots, max_attempts=1)
    assert a.health()["status"] == "ok"
    a.allocate(requests)
    assert a.health()["status"] == "degraded"


# ── telemetry ────────────────────────────────────────────────────────────

def test_telemetry_tracks_rates(tmp_path, small_spots):
    t = Telemetry(path=tmp_path / "events.jsonl")
    t.emit(Event(ts=0, event="decision", request_count=10, satisfied=8,
                  latency_ms=100, cost_usd=0.02, outcome="ok"))
    t.emit(Event(ts=0, event="decision", request_count=10, satisfied=5,
                  latency_ms=300, cost_usd=0.0, outcome="fallback", illegal_count=2))
    snap = t.snapshot()
    assert snap["decisions"] == 2
    assert snap["success_rate"] == pytest.approx(13 / 20)
    assert snap["fallback_rate"] == pytest.approx(0.5)
    assert snap["latency_ms_p50"] in (100, 300)
    assert snap["cost_usd"] == pytest.approx(0.02)
    lines = (tmp_path / "events.jsonl").read_text().strip().splitlines()
    assert len(lines) == 2
    assert json.loads(lines[0])["event"] == "decision"


# ── HTTP contract ────────────────────────────────────────────────────────

@pytest.fixture
def server(small_spots):
    from http.server import ThreadingHTTPServer
    from serving.app import Handler

    Handler.allocator = ProductionAllocator(
        policy_factory=lambda: _StubPolicy("raise"),
        config=AllocatorConfig(max_attempts=1),
        telemetry=Telemetry(),
        breaker=CircuitBreaker(BreakerConfig()),
        spots=small_spots,
    )
    srv = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
    thread = threading.Thread(target=srv.serve_forever, daemon=True)
    thread.start()
    yield f"http://127.0.0.1:{srv.server_port}"
    srv.shutdown()


def _post(url, payload):
    req = urllib.request.Request(url, data=json.dumps(payload).encode(),
                                  headers={"Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=10) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())


def _sample_request(i=0):
    return {"id": f"r{i}", "arrival_minute": 10.0, "duration_minutes": 60.0,
            "trip_value": 30.0, "origin_lat": 47.61385, "origin_lng": -122.20017}


def test_allocate_returns_assignment_per_request(server):
    status, body = _post(f"{server}/allocate", [_sample_request(i) for i in range(3)])
    assert status == 200
    assert [a["request_id"] for a in body["assignments"]] == ["r0", "r1", "r2"]
    assert body["policy"] == "greedy"  # stub always raises -> degraded


def test_allocate_rejects_malformed_body(server):
    assert _post(f"{server}/allocate", {"not": "a list"})[0] == 400
    assert _post(f"{server}/allocate", [{"id": "x"}])[0] == 400
    bad_dupe = [_sample_request(0), _sample_request(0)]
    status, body = _post(f"{server}/allocate", bad_dupe)
    assert status == 400 and "duplicate" in body["error"]


def test_empty_batch_is_not_an_error(server):
    status, body = _post(f"{server}/allocate", [])
    assert status == 200 and body["assignments"] == []


def test_healthz_and_metrics(server):
    with urllib.request.urlopen(f"{server}/metrics", timeout=5) as r:
        assert r.status == 200 and "fallback_rate" in json.loads(r.read())
    try:
        with urllib.request.urlopen(f"{server}/healthz", timeout=5) as r:
            code = r.status
    except urllib.error.HTTPError as e:
        code = e.code
    assert code in (200, 503)


def test_unknown_route_is_404(server):
    try:
        urllib.request.urlopen(f"{server}/nope", timeout=5)
        code = 200
    except urllib.error.HTTPError as e:
        code = e.code
    assert code == 404


# ── console (dashboard) ──────────────────────────────────────────────────

def test_root_serves_the_console_html(server):
    with urllib.request.urlopen(f"{server}/", timeout=5) as r:
        assert r.status == 200
        assert r.headers["Content-Type"].startswith("text/html")
        html = r.read().decode()
    assert "Allocator Console" in html
    # Must not reference anything off-host: the console is served offline.
    assert "http://" not in html.replace("http://localhost", "")
    assert "cdn" not in html.lower()


def test_console_declares_both_color_schemes(server):
    with urllib.request.urlopen(f"{server}/", timeout=5) as r:
        html = r.read().decode()
    assert "prefers-color-scheme: dark" in html
    assert '[data-theme="dark"]' in html


def test_health_reports_mode_so_simulated_runs_are_labelled(server):
    try:
        with urllib.request.urlopen(f"{server}/healthz", timeout=5) as r:
            body = json.loads(r.read())
    except urllib.error.HTTPError as e:
        body = json.loads(e.read())
    assert body["mode"] in ("live", "simulated")


# ── simulated model (demo mode) ──────────────────────────────────────────

def test_simulated_model_exercises_every_failure_path(small_spots):
    """The demo policy must actually produce illegal picks, abstentions, legal
    picks, and hard failures -- otherwise the console cannot demonstrate the
    safety layer, which is the only reason it exists."""
    from serving.app import SimulatedModelPolicy

    requests = generate_requests(small_spots, rho=1.2, seed=1, n_requests_override=40)
    illegal = abstain = legal = errors = 0
    for seed in range(25):
        p = SimulatedModelPolicy(small_spots, seed=seed)
        p.P_ERROR = p.P_ERROR  # keep configured rates
        try:
            out = p.allocate(small_spots, requests)
        except RuntimeError:
            errors += 1
            continue
        for a in out:
            if a.spot_id == "SIMULATED_NONEXISTENT_SPOT":
                illegal += 1
            elif a.spot_id is None:
                abstain += 1
            else:
                legal += 1
    assert illegal > 0, "no hallucinated spots -- the validator gate would never fire"
    assert abstain > 0
    assert legal > 0
    assert errors > 0, "no hard failures -- the circuit breaker would never trip"


def test_simulated_model_is_seeded_and_reproducible(small_spots):
    from serving.app import SimulatedModelPolicy
    requests = generate_requests(small_spots, rho=1.2, seed=1, n_requests_override=15)
    a = SimulatedModelPolicy(small_spots, seed=99).allocate(small_spots, requests)
    b = SimulatedModelPolicy(small_spots, seed=99).allocate(small_spots, requests)
    assert [x.spot_id for x in a] == [x.spot_id for x in b]


def test_simulated_illegal_picks_are_caught_by_the_real_gate(small_spots):
    """End to end: the demo policy's garbage must be rejected by the SAME
    validator the study scores with, not by a special-case path."""
    from serving.app import SimulatedModelPolicy

    requests = generate_requests(small_spots, rho=1.2, seed=2, n_requests_override=40)
    alloc = ProductionAllocator(
        policy_factory=lambda: SimulatedModelPolicy(small_spots, seed=4),
        config=AllocatorConfig(max_attempts=1, deadline_s=5),
        telemetry=Telemetry(),
        breaker=CircuitBreaker(BreakerConfig(failure_threshold=0.9, min_samples=50)),
        spots=small_spots,
    )
    out = alloc.allocate(requests)
    assert out["illegal_rejected"] > 0
    assert all(a["spot_id"] != "SIMULATED_NONEXISTENT_SPOT" for a in out["assignments"]), \
        "a simulated hallucination reached the caller"
