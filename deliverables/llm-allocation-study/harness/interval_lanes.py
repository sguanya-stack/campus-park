"""
Interval-scheduling engine shared by every policy and the validator.

A parking spot with `capacity` physical spaces is modeled as `capacity`
independent "lanes"; each lane can hold at most one non-overlapping
reservation at a time. This is the actual hard constraint of the domain
(you cannot double-book a physical parking space) -- every policy,
including the LLM ones, is checked against this same engine so no policy
gets a looser or stricter notion of "legal" than any other.

Time is represented in integer minutes from the start of the episode
window (matches the 10-minute decision windows used in the study design).
"""

from __future__ import annotations

from dataclasses import dataclass, field


@dataclass
class SpotLedger:
    """Tracks booked intervals per lane for one spot."""

    spot_id: str
    capacity: int
    # one sorted list of (start, end) tuples per lane
    lanes: list[list[tuple[int, int]]] = field(default_factory=list)

    def __post_init__(self):
        if not self.lanes:
            self.lanes = [[] for _ in range(self.capacity)]

    def _fits(self, lane: list[tuple[int, int]], start: int, end: int) -> bool:
        for (s, e) in lane:
            if start < e and s < end:  # overlap
                return False
        return True

    def find_free_lane(self, start: int, end: int) -> int | None:
        """Return the index of the first lane that can accept [start, end), or None."""
        for i, lane in enumerate(self.lanes):
            if self._fits(lane, start, end):
                return i
        return None

    def has_capacity(self, start: int, end: int) -> bool:
        return self.find_free_lane(start, end) is not None

    def book(self, start: int, end: int) -> int:
        """Book the interval on the first available lane. Raises if none free."""
        lane_idx = self.find_free_lane(start, end)
        if lane_idx is None:
            raise ValueError(
                f"No free lane on spot {self.spot_id} for interval [{start},{end})"
            )
        self.lanes[lane_idx].append((start, end))
        self.lanes[lane_idx].sort()
        return lane_idx

    def unbook(self, lane_idx: int, start: int, end: int) -> None:
        """Undo a booking (used when rolling back an illegal LLM allocation)."""
        self.lanes[lane_idx].remove((start, end))

    def booked_minutes(self) -> int:
        return sum(e - s for lane in self.lanes for (s, e) in lane)

    def capacity_minutes(self, window_start: int, window_end: int) -> int:
        return self.capacity * (window_end - window_start)


def build_ledgers(spots) -> dict[str, SpotLedger]:
    return {s.id: SpotLedger(spot_id=s.id, capacity=s.capacity) for s in spots}
