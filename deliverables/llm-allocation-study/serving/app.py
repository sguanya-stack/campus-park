"""
HTTP service exposing the production allocator.

Standard library only -- no framework -- matching CampusPark's own
`server.js`, which is plain `http.createServer`. One fewer dependency to
pin, and the whole service is readable in one sitting.

Endpoints
  POST /allocate   decide a batch of reservation requests
  GET  /healthz    liveness + degradation state (breaker, budget, illegal rate)
  GET  /metrics    rolling counters: latency p50/p95, cost, fallback rate

Run:
  python -m serving.app                      # port 8080, LLM arm if key present
  ALLOCATOR_POLICY=greedy python -m serving.app   # force the classical path
  ALLOCATOR_LOG=/tmp/alloc.jsonl python -m serving.app

Without ANTHROPIC_API_KEY the service still runs: it starts with the
circuit open and serves Greedy, which is the intended degraded mode rather
than a crash.
"""

from __future__ import annotations

import json
import os
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from harness.data_loader import load_spots  # noqa: E402
from harness.scenario import Request  # noqa: E402

from .allocator import AllocatorConfig, ProductionAllocator  # noqa: E402
from .safety import BreakerConfig, CircuitBreaker  # noqa: E402
from .telemetry import Telemetry  # noqa: E402

MAX_BODY_BYTES = 1 << 20  # 1 MiB
MAX_REQUESTS_PER_CALL = 500


class SimulatedModelPolicy:
    """A fake model for demonstrating the safety layer with no API key.

    Exists because the interesting behaviour of this service -- the validator
    gate rejecting an impossible allocation, the breaker tripping, Greedy
    taking over -- is invisible when there is no model to misbehave. Without
    a key the real arms just report `circuit_open` forever.

    It is NOT a model and produces NO research data. Every number it drives
    is labelled as simulated in `/healthz`, and the console shows a banner.
    Switch it on only with ALLOCATOR_POLICY=demo.
    """

    name = "simulated_model"

    # Rates tuned to make each failure path visible within a handful of
    # batches, not to resemble any measured model behaviour.
    P_HALLUCINATE = 0.12
    P_ERROR = 0.06
    P_ABSTAIN = 0.20

    def __init__(self, spots, seed: int | None = None):
        import random as _random
        self.spots = spots
        self.rng = _random.Random(seed)
        self.last_cost_usd = 0.0
        self.last_parse_failure_rate = 0.0

    def allocate(self, spots, requests):
        import time as _time

        from harness.policies.base import Assignment

        _time.sleep(0.25 + self.rng.random() * 0.6)  # plausible model latency
        if self.rng.random() < self.P_ERROR:
            raise RuntimeError("simulated upstream failure")

        self.last_cost_usd = round(0.004 * len(requests) + 0.02, 6)

        out = []
        for r in requests:
            roll = self.rng.random()
            if roll < self.P_HALLUCINATE:
                out.append(Assignment(r.id, "SIMULATED_NONEXISTENT_SPOT", None))
                continue
            if roll < self.P_HALLUCINATE + self.P_ABSTAIN:
                out.append(Assignment(r.id, None, None))
                continue
            eligible = [s for s in spots if r.is_eligible(s) and r.utility(s) >= r.u_min]
            if not eligible:
                out.append(Assignment(r.id, None, None))
                continue
            pick = self.rng.choice(eligible[: max(1, len(eligible) // 2)])
            out.append(Assignment(r.id, pick.id, r.utility(pick)))
        return out


def build_allocator() -> ProductionAllocator:
    capacity = int(os.environ.get("ALLOCATOR_CAPACITY", "240"))
    spots = load_spots(target_total_capacity=capacity)

    policy_name = os.environ.get("ALLOCATOR_POLICY", "llm_negotiate")
    have_key = bool(os.environ.get("ANTHROPIC_API_KEY"))

    def factory():
        if policy_name == "demo":
            return SimulatedModelPolicy(spots)
        if policy_name == "llm_central":
            from harness.policies.llm_central import LLMCentralPolicy
            return LLMCentralPolicy(effort=os.environ.get("ALLOCATOR_EFFORT", "high"))
        if policy_name == "llm_negotiate":
            from harness.policies.llm_negotiate import LLMNegotiatePolicy
            return LLMNegotiatePolicy(broker_effort=os.environ.get("ALLOCATOR_EFFORT", "high"))
        from harness.policies.greedy_policy import GreedyPolicy
        return GreedyPolicy()

    breaker = CircuitBreaker(BreakerConfig())
    if policy_name.startswith("llm") and not have_key:
        # Start degraded on purpose rather than failing every request until
        # a human notices. /healthz reports it.
        breaker.record(failed=True)
        for _ in range(BreakerConfig().min_samples):
            breaker.record(failed=True)

    allocator = ProductionAllocator(
        policy_factory=factory,
        config=AllocatorConfig(
            deadline_s=float(os.environ.get("ALLOCATOR_DEADLINE_S", "25")),
            cost_ceiling_usd=float(os.environ.get("ALLOCATOR_COST_CEILING_USD", "25")),
        ),
        telemetry=Telemetry(),
        breaker=breaker,
        spots=spots,
    )
    allocator.mode = "simulated" if policy_name == "demo" else "live"
    allocator.policy_name = policy_name
    return allocator


def parse_requests(payload) -> list[Request]:
    """Validate and coerce the request batch. Rejects rather than guesses:
    a malformed batch is a client bug and should be visible as a 400."""
    if not isinstance(payload, list):
        raise ValueError("body must be a JSON array of requests")
    if len(payload) > MAX_REQUESTS_PER_CALL:
        raise ValueError(f"at most {MAX_REQUESTS_PER_CALL} requests per call")

    out = []
    for i, item in enumerate(payload):
        if not isinstance(item, dict):
            raise ValueError(f"request[{i}] must be an object")
        try:
            out.append(Request(
                id=str(item["id"]),
                arrival_minute=float(item["arrival_minute"]),
                duration_minutes=float(item["duration_minutes"]),
                trip_value=float(item["trip_value"]),
                price_weight=float(item.get("price_weight", 1.0)),
                walk_weight=float(item.get("walk_weight", 0.02)),
                walk_tolerance_m=float(item.get("walk_tolerance_m", 400.0)),
                needs_ev=bool(item.get("needs_ev", False)),
                reservation_frac=float(item.get("reservation_frac", 0.2)),
                origin_lat=float(item["origin_lat"]),
                origin_lng=float(item["origin_lng"]),
            ))
        except KeyError as e:
            raise ValueError(f"request[{i}] missing required field {e}") from e
        except (TypeError, ValueError) as e:
            raise ValueError(f"request[{i}] invalid: {e}") from e

    ids = [r.id for r in out]
    if len(set(ids)) != len(ids):
        raise ValueError("duplicate request ids in batch")
    return out


class Handler(BaseHTTPRequestHandler):
    allocator: ProductionAllocator = None  # injected in main()
    protocol_version = "HTTP/1.1"

    def _send(self, code: int, body: dict):
        data = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def _send_html(self, code: int, html: str):
        data = html.encode()
        self.send_response(code)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path in ("/", "/index.html"):
            page = Path(__file__).resolve().parent / "static" / "dashboard.html"
            if page.exists():
                self._send_html(200, page.read_text(encoding="utf-8"))
            else:
                self._send(404, {"error": "dashboard not installed"})
        elif self.path == "/healthz":
            h = self.allocator.health()
            self._send(200 if h["status"] == "ok" else 503, h)
        elif self.path == "/metrics":
            self._send(200, self.allocator.telemetry.snapshot())
        else:
            self._send(404, {"error": "not found"})

    def do_POST(self):
        if self.path != "/allocate":
            self._send(404, {"error": "not found"})
            return

        length = int(self.headers.get("Content-Length") or 0)
        if length > MAX_BODY_BYTES:
            self._send(413, {"error": "body too large"})
            return

        try:
            payload = json.loads(self.rfile.read(length) or b"[]")
            requests = parse_requests(payload)
        except json.JSONDecodeError as e:
            self._send(400, {"error": f"invalid JSON: {e}"})
            return
        except ValueError as e:
            self._send(400, {"error": str(e)})
            return

        if not requests:
            self._send(200, {"assignments": [], "policy": "none", "degraded": False})
            return

        # The allocator degrades internally; it should not raise. If it
        # somehow does, still answer the caller rather than hanging.
        try:
            self._send(200, self.allocator.allocate(requests))
        except Exception as e:  # noqa: BLE001
            self._send(500, {"error": f"allocation failed: {type(e).__name__}"})

    def log_message(self, fmt, *args):
        pass  # access logs would duplicate the structured telemetry stream


def main():
    port = int(os.environ.get("PORT", "8080"))
    Handler.allocator = build_allocator()
    server = ThreadingHTTPServer(("0.0.0.0", port), Handler)
    h = Handler.allocator.health()
    print(f"allocator listening on :{port}  status={h['status']}  breaker={h['breaker']}",
          file=sys.stderr)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()
