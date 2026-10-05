"""
Independent re-validation of a policy's output against the domain's hard
constraints. Every policy -- classic or LLM -- is checked with this SAME
code, so no policy gets a looser standard.

Classic policies (random/fifo/greedy) are correct by construction (they
book through interval_lanes.SpotLedger themselves), so this should always
report zero violations for them; running it on their output anyway is a
regression test, and it becomes essential once T1/T2 (LLM policies) are
wired in, since their output is not trusted.

Per the proposal: an illegal allocation is REJECTED, not repaired -- this
module only reports; the caller (run_experiment.py) decides whether to
roll back to the last legal state. We never silently patch an LLM's
invalid output back into validity, since that would erase the very
failure mode (H3) this study measures.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .interval_lanes import build_ledgers
from .policies.base import Assignment


@dataclass
class Violation:
    request_id: str
    spot_id: str | None
    reason: str  # "unknown_spot" | "ev_mismatch" | "double_booked"


@dataclass
class ValidationReport:
    violations: list[Violation] = field(default_factory=list)
    n_allocated: int = 0  # number of assignments with spot_id is not None

    @property
    def n_illegal(self) -> int:
        return len(self.violations)

    @property
    def illegal_allocation_rate(self) -> float:
        return self.n_illegal / self.n_allocated if self.n_allocated else 0.0


def validate(spots, requests, assignments: list[Assignment]) -> ValidationReport:
    spot_by_id = {s.id: s for s in spots}
    req_by_id = {r.id: r for r in requests}
    ledgers = build_ledgers(spots)

    report = ValidationReport()

    for a in assignments:
        if a.spot_id is None:
            continue
        report.n_allocated += 1

        req = req_by_id.get(a.request_id)
        spot = spot_by_id.get(a.spot_id)

        if req is None:
            report.violations.append(Violation(a.request_id, a.spot_id, "unknown_request"))
            continue
        if spot is None:
            report.violations.append(Violation(a.request_id, a.spot_id, "unknown_spot"))
            continue
        if not req.is_eligible(spot):
            report.violations.append(Violation(a.request_id, a.spot_id, "ev_mismatch"))
            continue

        ledger = ledgers[spot.id]
        if not ledger.has_capacity(req.start_minute, req.end_minute):
            report.violations.append(Violation(a.request_id, a.spot_id, "double_booked"))
            continue

        ledger.book(req.start_minute, req.end_minute)

    return report
