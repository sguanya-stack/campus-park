"""B0 -- Random baseline (sanity floor).

For each request, in arrival order, pick uniformly at random among the
spots that currently have a free lane for that request's interval and
that meet the EV eligibility constraint. Accept only if the resulting
utility clears the request's own reservation threshold (u_min) -- this
still uses the *same* acceptance rule as every other policy, so the floor
is "random choice among legal options", not "accept literally anything".
"""

from __future__ import annotations

import numpy as np

from ..interval_lanes import build_ledgers
from .base import Assignment, Policy


class RandomPolicy(Policy):
    name = "random"

    def __init__(self, seed: int = 0):
        self._seed = seed

    def allocate(self, spots, requests) -> list[Assignment]:
        rng = np.random.default_rng(self._seed)
        ledgers = build_ledgers(spots)
        assignments: list[Assignment] = []

        for req in requests:
            eligible = [s for s in spots if req.is_eligible(s)]
            free = [s for s in eligible if ledgers[s.id].has_capacity(req.start_minute, req.end_minute)]

            if not free:
                assignments.append(Assignment(req.id, None, None))
                continue

            chosen = free[int(rng.integers(0, len(free)))]
            u = req.utility(chosen)
            if u < req.u_min:
                assignments.append(Assignment(req.id, None, None))
                continue

            lane_idx = ledgers[chosen.id].book(req.start_minute, req.end_minute)
            assignments.append(Assignment(req.id, chosen.id, u, lane_idx))

        return assignments
