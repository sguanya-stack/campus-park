"""B2 -- Greedy (strong algorithmic baseline).

For each request, in arrival order, search ALL eligible spots that
currently have a free lane and pick the one maximizing utility (a local,
online optimum at decision time -- still no knowledge of future arrivals,
so it stays a fair comparison against the LLM policies, which are equally
online). This is what differentiates Greedy from FIFO: Greedy substitutes
to the best *currently available* option instead of committing to one
fixed preference.
"""

from __future__ import annotations

from ..interval_lanes import build_ledgers
from .base import Assignment, Policy


class GreedyPolicy(Policy):
    name = "greedy"

    def allocate(self, spots, requests) -> list[Assignment]:
        ledgers = build_ledgers(spots)
        assignments: list[Assignment] = []

        for req in requests:
            best_spot = None
            best_u = None
            for s in spots:
                if not req.is_eligible(s):
                    continue
                if not ledgers[s.id].has_capacity(req.start_minute, req.end_minute):
                    continue
                u = req.utility(s)
                if best_u is None or u > best_u:
                    best_u, best_spot = u, s

            if best_spot is None or best_u < req.u_min:
                assignments.append(Assignment(req.id, None, None))
                continue

            lane_idx = ledgers[best_spot.id].book(req.start_minute, req.end_minute)
            assignments.append(Assignment(req.id, best_spot.id, best_u, lane_idx))

        return assignments
