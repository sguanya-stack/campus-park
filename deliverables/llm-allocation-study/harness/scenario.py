"""
Episode generator: turns the real spot inventory (data_loader.load_spots)
into a fully reproducible request stream for one simulated 3-hour peak
window, given a load factor rho = demand/supply and a PRNG seed.

Reproducibility contract: same (spots, rho, seed) -> byte-identical request
list, always. Every source of randomness goes through `rng`
(numpy.random.default_rng(seed)); nothing reads wall-clock time or
un-seeded globals.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from .data_loader import ANCHOR_LAT, ANCHOR_LNG, Spot

WINDOW_MINUTES = 180  # one 3-hour peak window per episode
DECISION_STEP_MINUTES = 10  # matches the proposal's 10-min decision windows

DURATION_CHOICES_H = [1.0, 1.5, 2.0, 3.0]
DURATION_WEIGHTS = [0.25, 0.25, 0.35, 0.15]

EV_REQUEST_FRACTION = 0.15
ORIGIN_JITTER_RADIUS_M = 1500.0

# Price sensitivity is a *设定* parameter, not measured from data -- the
# proposal flags this as a high-severity threat to validity (§7) because the
# whole "surge pricing pushes marginal users out" mechanism scales with it.
# Exposed as a range so it can be swept; see results/pricing_sensitivity.md.
DEFAULT_PRICE_WEIGHT_RANGE = (0.8, 1.2)


@dataclass(frozen=True)
class Request:
    id: str
    arrival_minute: float
    duration_minutes: float
    trip_value: float  # $ - how much reaching a spot is worth to this user
    price_weight: float  # multiplier on $ cost of the chosen spot's price
    walk_weight: float  # $ penalty per meter walked beyond tolerance
    walk_tolerance_m: float
    needs_ev: bool
    reservation_frac: float  # u_min = reservation_frac * trip_value
    origin_lat: float
    origin_lng: float

    @property
    def start_minute(self) -> int:
        return int(round(self.arrival_minute))

    @property
    def end_minute(self) -> int:
        return int(round(self.arrival_minute + self.duration_minutes))

    @property
    def u_min(self) -> float:
        return self.reservation_frac * self.trip_value

    def distance_to(self, spot: Spot) -> float:
        m_per_deg_lat = 111_320.0
        m_per_deg_lng = 111_320.0 * math.cos(math.radians(ANCHOR_LAT))
        dy = (spot.lat - self.origin_lat) * m_per_deg_lat
        dx = (spot.lng - self.origin_lng) * m_per_deg_lng
        return math.hypot(dx, dy)

    def is_eligible(self, spot: Spot) -> bool:
        """Hard eligibility filter (not a utility penalty): EV need must be met."""
        return (not self.needs_ev) or spot.is_ev

    def utility(self, spot: Spot) -> float:
        """Net dollar utility of parking at `spot`. Call only if is_eligible()."""
        duration_h = self.duration_minutes / 60.0
        price_cost = self.price_weight * spot.price_per_hour * duration_h
        dist = self.distance_to(spot)
        walk_cost = self.walk_weight * max(0.0, dist - self.walk_tolerance_m)
        return self.trip_value - price_cost - walk_cost


def total_capacity(spots: list[Spot]) -> int:
    return sum(s.capacity for s in spots)


def generate_requests(
    spots: list[Spot],
    rho: float,
    seed: int,
    window_minutes: int = WINDOW_MINUTES,
    n_requests_override: int | None = None,
    price_weight_range: tuple[float, float] = DEFAULT_PRICE_WEIGHT_RANGE,
) -> list[Request]:
    """Generate a Poisson-like arrival stream sized to rho * total capacity.

    `n_requests_override`: use this many requests instead of rho * total
    capacity. Needed for the LLM arms (T1/T2), which run at a much smaller
    N than the classic baselines for cost reasons (proposal §6.2/§11) --
    when comparing LLM vs. classic, run classic baselines with the SAME
    override so the comparison stays paired-and-equal-N (see
    harness/run_experiment.py --compact-base).
    """
    rng = np.random.default_rng(seed)
    if n_requests_override is not None:
        n_requests = max(1, int(n_requests_override))
    else:
        cap = total_capacity(spots)
        n_requests = max(1, int(round(rho * cap)))

    arrivals = np.sort(rng.uniform(0, window_minutes, size=n_requests))

    requests: list[Request] = []
    for i, arrival in enumerate(arrivals):
        duration_h = rng.choice(DURATION_CHOICES_H, p=DURATION_WEIGHTS)
        trip_value = float(rng.lognormal(mean=math.log(25.0), sigma=0.35))
        # Same number of rng draws regardless of the range, so widening or
        # shifting price sensitivity leaves every OTHER attribute of every
        # request byte-identical for a given seed. That makes the sweep a
        # clean single-factor manipulation rather than a new scenario.
        price_weight = float(rng.uniform(price_weight_range[0], price_weight_range[1]))
        walk_weight = float(rng.uniform(0.01, 0.05))
        walk_tolerance_m = float(rng.uniform(100.0, 800.0))
        needs_ev = bool(rng.random() < EV_REQUEST_FRACTION)
        reservation_frac = float(rng.uniform(0.1, 0.3))

        angle = float(rng.uniform(0, 2 * math.pi))
        radius = float(rng.uniform(0, 1) ** 0.5 * ORIGIN_JITTER_RADIUS_M)
        m_per_deg_lat = 111_320.0
        m_per_deg_lng = 111_320.0 * math.cos(math.radians(ANCHOR_LAT))
        origin_lat = ANCHOR_LAT + (radius * math.cos(angle)) / m_per_deg_lat
        origin_lng = ANCHOR_LNG + (radius * math.sin(angle)) / m_per_deg_lng

        requests.append(
            Request(
                id=f"req-{seed}-{i:04d}",
                arrival_minute=float(arrival),
                duration_minutes=duration_h * 60.0,
                trip_value=trip_value,
                price_weight=price_weight,
                walk_weight=walk_weight,
                walk_tolerance_m=walk_tolerance_m,
                needs_ev=needs_ev,
                reservation_frac=reservation_frac,
                origin_lat=origin_lat,
                origin_lng=origin_lng,
            )
        )

    return requests


if __name__ == "__main__":
    from .data_loader import load_spots

    spots = load_spots()
    for rho in (0.8, 1.2, 2.0):
        reqs = generate_requests(spots, rho=rho, seed=1)
        print(f"rho={rho}: {len(reqs)} requests over {WINDOW_MINUTES}min "
              f"(capacity={total_capacity(spots)}), "
              f"ev_requests={sum(r.needs_ev for r in reqs)}")
