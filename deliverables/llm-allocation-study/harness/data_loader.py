"""
Loads real CampusPark/Parkopedia price data and derives per-spot attributes.

See ../data_provenance.md for exactly which fields are real vs. synthetic.
All synthetic derivation here is a deterministic function of `location_id`
alone (never of an episode seed), so spot attributes are stable across the
whole study -- the "physical parking lots" don't change between episodes.
"""

from __future__ import annotations

import csv
import hashlib
import math
import statistics as st
from dataclasses import dataclass
from pathlib import Path

DEFAULT_CSV_PATH = Path(__file__).resolve().parents[3] / "parking_data.csv"
OSM_PATH = Path(__file__).resolve().parents[1] / "data" / "osm_parking_bellevue.json"

# Anchor point + radius used by the real scraper (parking.py) -- kept
# identical here so the synthetic geography stays consistent with the
# system it was pulled from.
ANCHOR_LAT = 47.61385
ANCHOR_LNG = -122.20017
RADIUS_M = 1000.0

BASE_CAPACITY = 40
MIN_CAPACITY = 3
EV_FRACTION_DENOM = 5  # ~20% of spots flagged EV


def _det_rng_float(key: str, salt: str) -> float:
    """Deterministic pseudo-random float in [0, 1) from (key, salt)."""
    h = hashlib.sha256(f"{key}:{salt}".encode()).hexdigest()
    return int(h[:12], 16) / float(16**12)


def _load_osm_coords() -> list[tuple[float, float]]:
    """Real parking coordinates for the scraper's own 1 km disc.

    Replaces the earlier hash-generated uniform-in-area placement, which was
    measurably wrong: real parking sits closer to the destination anchor
    (median 554 m) than uniform-in-area puts it (median 744 m), a difference
    significant at KS D=0.301, p=1.2e-06. Because the utility function
    penalises walking beyond a tolerance, that bias inflated walk costs and
    depressed success rates in every arm.

    Returns [] when the file is absent, and the caller falls back to the old
    synthetic placement rather than failing -- the file is an improvement, not
    a hard dependency.
    """
    if not OSM_PATH.exists():
        return []
    import json

    data = json.loads(OSM_PATH.read_text(encoding="utf-8"))
    return [(f["lat"], f["lng"]) for f in data.get("features", [])]


@dataclass(frozen=True)
class Spot:
    id: str
    price_per_hour: float
    capacity: int
    lat: float
    lng: float
    is_ev: bool
    availability_fraction: float  # real signal, kept for reporting/debugging

    def distance_m(self, lat: float, lng: float) -> float:
        # Flat-earth approximation is fine at this scale (<=1km).
        m_per_deg_lat = 111_320.0
        m_per_deg_lng = 111_320.0 * math.cos(math.radians(ANCHOR_LAT))
        dy = (self.lat - lat) * m_per_deg_lat
        dx = (self.lng - lng) * m_per_deg_lng
        return math.hypot(dx, dy)


def load_spots(
    csv_path: Path | None = None,
    target_total_capacity: int | None = None,
) -> list[Spot]:
    """Parse parking_data.csv into a list of Spot objects.

    Deterministic: calling this twice with the same args yields
    byte-identical results.

    `target_total_capacity`: scale every spot's capacity proportionally so
    the fleet totals roughly this many spaces (each spot keeps >=1). This
    is how "compact" episodes for the LLM arms are built: the LLM arms
    cannot afford 600-1600 requests per episode, but simply generating
    fewer requests against the full 833-space inventory would destroy all
    contention (rho would stop meaning demand/supply). Shrinking supply
    instead keeps rho's meaning intact AND keeps all 24 real spots, so
    price/distance/EV diversity -- the thing the allocator actually
    reasons over -- is preserved.
    """
    path = csv_path or DEFAULT_CSV_PATH
    if not path.exists():
        raise FileNotFoundError(
            f"Real data file not found at {path}. This harness requires "
            "parking_data.csv (see data_provenance.md) rather than falling "
            "back to fabricated prices."
        )

    prices_by_loc: dict[str, list[float]] = {}
    snapshots: set[str] = set()
    with open(path, newline="", encoding="utf-8") as f:
        for row in csv.DictReader(f):
            loc = row["location_id"]
            snapshots.add(row["fetched_at"])
            try:
                price = float(row["price"])
            except (TypeError, ValueError):
                continue
            prices_by_loc.setdefault(loc, []).append(price)

    n_snapshots = len(snapshots)
    if n_snapshots == 0:
        raise ValueError(f"No rows parsed from {path}")

    # Real OSM coordinates, assigned to garages deterministically. The 156
    # candidates are shuffled with a fixed seed and dealt out in sorted
    # location_id order, so the fleet's spatial DISTRIBUTION is real while the
    # id -> coordinate assignment is arbitrary. Parkopedia ids cannot be
    # matched to OSM features (only 8 of 156 are even named), and claiming
    # otherwise would be a fabricated join -- see data_provenance.md.
    osm_coords = _load_osm_coords()
    if osm_coords:
        import random as _random

        pool = list(osm_coords)
        _random.Random(20260320).shuffle(pool)
    else:
        pool = []

    spots: list[Spot] = []
    for idx, (loc, prices) in enumerate(sorted(prices_by_loc.items())):
        availability_fraction = len(prices) / n_snapshots
        median_price = st.median(prices)

        capacity = max(MIN_CAPACITY, round(BASE_CAPACITY * availability_fraction))

        if pool:
            lat, lng = pool[idx % len(pool)]
        else:
            # Fallback: the original hash-generated uniform-in-area placement.
            angle = _det_rng_float(loc, "angle") * 2 * math.pi
            radius = _det_rng_float(loc, "radius") ** 0.5 * RADIUS_M
            m_per_deg_lat = 111_320.0
            m_per_deg_lng = 111_320.0 * math.cos(math.radians(ANCHOR_LAT))
            lat = ANCHOR_LAT + (radius * math.cos(angle)) / m_per_deg_lat
            lng = ANCHOR_LNG + (radius * math.sin(angle)) / m_per_deg_lng

        is_ev = int(hashlib.sha256(f"{loc}:ev".encode()).hexdigest(), 16) % EV_FRACTION_DENOM == 0

        spots.append(
            Spot(
                id=loc,
                price_per_hour=median_price,
                capacity=capacity,
                lat=lat,
                lng=lng,
                is_ev=is_ev,
                availability_fraction=availability_fraction,
            )
        )

    if target_total_capacity is not None:
        spots = _rescale_capacity(spots, target_total_capacity)

    return spots


def _rescale_capacity(spots: list[Spot], target_total: int) -> list[Spot]:
    """Scale capacities proportionally toward `target_total`, floor 1 each.

    Deterministic (largest-remainder rounding over a fixed spot order), so
    the compact inventory is identical for every strategy and every seed --
    which is what makes the classic-vs-LLM comparison a paired one.
    """
    if target_total < len(spots):
        raise ValueError(
            f"target_total_capacity={target_total} is below the number of spots "
            f"({len(spots)}); every spot needs at least 1 space. Raise the target "
            f"or drop spots explicitly rather than silently losing inventory."
        )

    current_total = sum(s.capacity for s in spots)
    scale = target_total / current_total

    exact = [s.capacity * scale for s in spots]
    floored = [max(1, int(x)) for x in exact]

    # Distribute the remaining spaces to the largest fractional parts.
    remainder = target_total - sum(floored)
    order = sorted(range(len(spots)), key=lambda i: (exact[i] - int(exact[i])), reverse=True)
    i = 0
    while remainder > 0 and order:
        floored[order[i % len(order)]] += 1
        remainder -= 1
        i += 1

    return [
        Spot(
            id=s.id,
            price_per_hour=s.price_per_hour,
            capacity=cap,
            lat=s.lat,
            lng=s.lng,
            is_ev=s.is_ev,
            availability_fraction=s.availability_fraction,
        )
        for s, cap in zip(spots, floored)
    ]


if __name__ == "__main__":
    spots = load_spots()
    print(f"Loaded {len(spots)} spots (real prices, synthetic capacity/geo/EV):")
    for s in spots:
        print(
            f"  {s.id:>10}  price=${s.price_per_hour:6.2f}/hr  cap={s.capacity:3d}  "
            f"avail_frac={s.availability_fraction:.2f}  ev={s.is_ev}  "
            f"dist_from_anchor={s.distance_m(ANCHOR_LAT, ANCHOR_LNG):.0f}m"
        )
    total_cap = sum(s.capacity for s in spots)
    print(f"\nTotal synthetic capacity across {len(spots)} spots: {total_cap}")
