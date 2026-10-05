"""Shared types for all allocation policies (classic and LLM)."""

from __future__ import annotations

from dataclasses import dataclass


@dataclass
class Assignment:
    request_id: str
    spot_id: str | None  # None = request went unsatisfied
    utility: float | None  # None iff spot_id is None
    # Populated by the policy runner for bookkeeping / rollback, not by the
    # policy itself.
    lane_idx: int | None = None


class Policy:
    """Base interface. All policies process requests strictly in arrival
    order (online allocation -- no policy gets to see future arrivals),
    which mirrors how CampusPark actually grants reservations."""

    name: str = "base"

    def allocate(self, spots, requests) -> list[Assignment]:
        raise NotImplementedError
