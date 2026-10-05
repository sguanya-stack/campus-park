"""
Computes the metric family declared in the proposal (research_proposal_llm_allocation.md §4).

Primary (pre-registered) metrics: success_rate, jains_index.
Everything else is secondary and gets Holm-Bonferroni correction at
analysis time (harness/analyze.py), never used to cherry-pick a result.
"""

from __future__ import annotations

from dataclasses import dataclass

from .policies.base import Assignment
from .scenario import Request
from .validator import ValidationReport


@dataclass
class EpisodeMetrics:
    n_requests: int
    n_satisfied: int
    success_rate: float
    jains_index: float
    gini: float
    worst_decile_utility: float
    social_welfare: float
    utilization: float
    illegal_allocation_rate: float
    parse_failure_rate: float
    decision_latency_s: float | None
    cost_usd: float

    def as_dict(self) -> dict:
        return {
            "n_requests": self.n_requests,
            "n_satisfied": self.n_satisfied,
            "success_rate": self.success_rate,
            "jains_index": self.jains_index,
            "gini": self.gini,
            "worst_decile_utility": self.worst_decile_utility,
            "social_welfare": self.social_welfare,
            "utilization": self.utilization,
            "illegal_allocation_rate": self.illegal_allocation_rate,
            "parse_failure_rate": self.parse_failure_rate,
            "decision_latency_s": self.decision_latency_s,
            "cost_usd": self.cost_usd,
        }


def _jains_index(utilities: list[float]) -> float:
    n = len(utilities)
    if n == 0:
        return 1.0
    s = sum(utilities)
    ssq = sum(u * u for u in utilities)
    if ssq == 0:
        return 1.0  # everyone equally got zero -> perfectly (trivially) fair
    return (s * s) / (n * ssq)


def _gini(utilities: list[float]) -> float:
    n = len(utilities)
    if n == 0:
        return 0.0
    total = sum(utilities)
    if total == 0:
        return 0.0
    xs = sorted(utilities)
    cum = sum((i + 1) * x for i, x in enumerate(xs))
    return (2 * cum) / (n * total) - (n + 1) / n


def _worst_decile_utility(utilities: list[float]) -> float:
    if not utilities:
        return 0.0
    xs = sorted(utilities)
    k = max(1, len(xs) // 10)
    return sum(xs[:k]) / k


def compute_metrics(
    spots,
    requests: list[Request],
    assignments: list[Assignment],
    window_minutes: int,
    violation_report: ValidationReport | None = None,
    decision_latency_s: float | None = None,
    cost_usd: float = 0.0,
    parse_failure_rate: float = 0.0,
) -> EpisodeMetrics:
    req_by_id = {r.id: r for r in requests}
    utilities: list[float] = []
    n_satisfied = 0

    for a in assignments:
        if a.spot_id is not None and a.utility is not None:
            utilities.append(max(0.0, a.utility))
            n_satisfied += 1
        else:
            utilities.append(0.0)

    n_requests = len(requests)
    success_rate = n_satisfied / n_requests if n_requests else 0.0

    total_capacity_minutes = sum(s.capacity for s in spots) * window_minutes
    booked_minutes = 0
    for a in assignments:
        if a.spot_id is None:
            continue
        req = req_by_id.get(a.request_id)
        if req is None:
            continue
        booked_minutes += max(0, req.end_minute - req.start_minute)
    utilization = booked_minutes / total_capacity_minutes if total_capacity_minutes else 0.0

    illegal_rate = violation_report.illegal_allocation_rate if violation_report else 0.0

    return EpisodeMetrics(
        n_requests=n_requests,
        n_satisfied=n_satisfied,
        success_rate=success_rate,
        jains_index=_jains_index(utilities),
        gini=_gini(utilities),
        worst_decile_utility=_worst_decile_utility(utilities),
        social_welfare=sum(utilities),
        utilization=utilization,
        illegal_allocation_rate=illegal_rate,
        parse_failure_rate=parse_failure_rate,
        decision_latency_s=decision_latency_s,
        cost_usd=cost_usd,
    )
