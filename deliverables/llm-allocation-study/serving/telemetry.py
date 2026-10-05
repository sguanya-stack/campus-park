"""
Structured telemetry for the production allocator.

Emits one JSON object per line (JSONL) so it can be tailed, grepped, or
shipped to any log backend without a parser. Also keeps rolling in-process
counters so `/metrics` can answer "how is the allocator doing right now"
without re-reading the log.

What is deliberately recorded, because the research says these are the
things that bite: per-decision latency, dollar cost, token usage, illegal
allocation rate, fallback rate, and circuit-breaker state.
"""

from __future__ import annotations

import json
import os
import sys
import threading
import time
from collections import deque
from dataclasses import asdict, dataclass, field
from pathlib import Path


@dataclass
class Event:
    ts: float
    event: str
    request_count: int = 0
    policy: str = ""
    outcome: str = ""          # ok | fallback | rejected | error
    latency_ms: float = 0.0
    cost_usd: float = 0.0
    illegal_count: int = 0
    satisfied: int = 0
    detail: dict = field(default_factory=dict)


class Telemetry:
    def __init__(self, path: str | Path | None = None, keep: int = 500):
        env_path = os.environ.get("ALLOCATOR_LOG")
        self.path = Path(path or env_path) if (path or env_path) else None
        self._lock = threading.Lock()
        self._recent: deque[Event] = deque(maxlen=keep)
        self.counters: dict[str, float] = {
            "decisions": 0, "requests": 0, "satisfied": 0,
            "fallbacks": 0, "errors": 0, "illegal_allocations": 0,
            "cost_usd": 0.0, "latency_ms_total": 0.0,
        }

    def emit(self, ev: Event) -> None:
        with self._lock:
            self._recent.append(ev)
            c = self.counters
            if ev.event == "decision":
                c["decisions"] += 1
                c["requests"] += ev.request_count
                c["satisfied"] += ev.satisfied
                c["illegal_allocations"] += ev.illegal_count
                c["cost_usd"] += ev.cost_usd
                c["latency_ms_total"] += ev.latency_ms
                if ev.outcome == "fallback":
                    c["fallbacks"] += 1
                elif ev.outcome == "error":
                    c["errors"] += 1

            line = json.dumps(asdict(ev), separators=(",", ":"))
            if self.path:
                self.path.parent.mkdir(parents=True, exist_ok=True)
                with open(self.path, "a", encoding="utf-8") as f:
                    f.write(line + "\n")
            else:
                print(line, file=sys.stderr)

    def snapshot(self) -> dict:
        with self._lock:
            c = dict(self.counters)
        decisions = c["decisions"] or 1
        requests = c["requests"] or 1
        allocated = c["satisfied"] + c["illegal_allocations"] or 1
        latencies = sorted(e.latency_ms for e in self._recent if e.event == "decision")
        return {
            **c,
            "success_rate": c["satisfied"] / requests,
            "fallback_rate": c["fallbacks"] / decisions,
            "error_rate": c["errors"] / decisions,
            "illegal_allocation_rate": c["illegal_allocations"] / allocated,
            "cost_per_satisfied_usd": c["cost_usd"] / (c["satisfied"] or 1),
            "latency_ms_mean": c["latency_ms_total"] / decisions,
            "latency_ms_p50": _pct(latencies, 50),
            "latency_ms_p95": _pct(latencies, 95),
            "window_size": len(latencies),
        }


def _pct(sorted_vals: list[float], p: int) -> float:
    if not sorted_vals:
        return 0.0
    k = max(0, min(len(sorted_vals) - 1, int(round((p / 100) * (len(sorted_vals) - 1)))))
    return sorted_vals[k]


def now_ms() -> float:
    return time.perf_counter() * 1000.0
