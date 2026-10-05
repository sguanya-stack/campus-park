"""B1 -- FIFO / first-come-first-served (mirrors CampusPark's real production
behavior in server.js + test-concurrency.js: a user picks ONE preferred spot
up front -- their highest-utility eligible spot -- and the system grants it
if a lane is free at the moment they arrive, or rejects outright. There is
no fallback to a second-choice spot; this single-choice-only rule is what
makes FIFO meaningfully different from Greedy below, and is exactly the
"check inventory -> atomic decrement -> create reservation" transaction in
the real codebase.
"""

from __future__ import annotations

from ..interval_lanes import build_ledgers
from .base import Assignment, Policy


class FIFOPolicy(Policy):
    name = "fifo"

    def allocate(self, spots, requests) -> list[Assignment]:
        ledgers = build_ledgers(spots)
        assignments: list[Assignment] = []

        for req in requests:
            eligible = [s for s in spots if req.is_eligible(s)]
            if not eligible:
                assignments.append(Assignment(req.id, None, None))
                continue

            # Precompute the user's single preferred spot: highest utility
            # among eligible spots, ignoring current availability (the user
            # doesn't know who else is competing for it).
            preferred = max(eligible, key=lambda s: req.utility(s))
            u = req.utility(preferred)

            if u < req.u_min:
                assignments.append(Assignment(req.id, None, None))
                continue

            ledger = ledgers[preferred.id]
            if not ledger.has_capacity(req.start_minute, req.end_minute):
                # Preferred spot is full at arrival time -> no fallback.
                assignments.append(Assignment(req.id, None, None))
                continue

            lane_idx = ledger.book(req.start_minute, req.end_minute)
            assignments.append(Assignment(req.id, preferred.id, u, lane_idx))

        return assignments
