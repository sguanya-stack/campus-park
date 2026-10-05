"""
Experiment B -- dynamic pricing benchmark (proposal §6.3).

Question: does CampusPark's production surge rule actually improve spot
utilization, or would raising prices by the same amount at random do just
as well?

Arms:
  P0 static      -- real CSV prices, never adjusted
  P1 rule surge  -- x1.5 on contested spots (the production rule in
                    server.js:574, rewritten to be scale-free, see below)
  P2 permuted    -- applies the SAME NUMBER of x1.5 surges P1 applied in
                    that same window, but to randomly chosen spots

Why P2 is a permutation control and not "uniform random multiplier in
[1.0, 1.5]" as originally sketched in the proposal: matching P1's *mean*
multiplier only isolates the targeting effect if you happen to know P1's
trigger rate (U[1.0,1.5] has mean 1.25, which equals P1's mean only when
the surge fires exactly 50% of the time). Re-using P1's realized surge
COUNT and permuting *where* those surges land gives an identical marginal
price distribution by construction, so the only thing that differs is
whether the surcharge was aimed at contested spots. That is exactly the
claim under test, and it holds at any trigger rate.

The mechanism being tested: surging a contested spot pushes price-sensitive
users toward cheaper, underused spots while price-insensitive users stay --
spreading demand and, in principle, raising overall utilization. Requests
have heterogeneous `price_weight`, so the simulator can express this.

Scale-free trigger rule: production uses `demandSearchCount > 20`, which
would never fire at the compact scale (a few requests per 10-min window).
Instead a spot surges when the demand aimed at it in the PREVIOUS window
exceeds its currently free lanes -- i.e. when it is genuinely contested.
Using the previous window keeps the policy online (no lookahead).
"""

from __future__ import annotations

import dataclasses

import numpy as np

from .data_loader import Spot
from .interval_lanes import build_ledgers
from .policies.base import Assignment
from .scenario import DECISION_STEP_MINUTES, Request

SURGE_MULTIPLIER = 1.5  # matches server.js:574


def _free_lanes(ledger, start: int, end: int) -> int:
    return sum(
        1 for lane in ledger.lanes
        if all(not (start < e and s < end) for (s, e) in lane)
    )


def _demand_counts(requests: list[Request], spots: list[Spot]) -> dict[str, int]:
    """How many of these requests would pick each spot as their top choice
    at current prices -- the simulator's analogue of production's
    'nearby search count' demand signal."""
    counts = {s.id: 0 for s in spots}
    for r in requests:
        eligible = [s for s in spots if r.is_eligible(s)]
        if not eligible:
            continue
        top = max(eligible, key=lambda s: r.utility(s))
        counts[top.id] += 1
    return counts


class PricingPolicy:
    name = "base"

    def multipliers(self, spots, ledgers, prev_requests, w_start, w_end, rng) -> dict[str, float]:
        raise NotImplementedError


class StaticPricing(PricingPolicy):
    name = "p0_static"

    def multipliers(self, spots, ledgers, prev_requests, w_start, w_end, rng):
        return {s.id: 1.0 for s in spots}


class RuleSurgePricing(PricingPolicy):
    name = "p1_rule_surge"

    def multipliers(self, spots, ledgers, prev_requests, w_start, w_end, rng):
        counts = _demand_counts(prev_requests, spots) if prev_requests else {s.id: 0 for s in spots}
        out = {}
        for s in spots:
            free = _free_lanes(ledgers[s.id], w_start, w_end)
            contested = counts.get(s.id, 0) > free
            out[s.id] = SURGE_MULTIPLIER if contested else 1.0
        return out


class PermutedSurgePricing(PricingPolicy):
    """Same number of surges as P1 would apply this window, randomly placed.

    Needs P1's decision for the same window, so it holds a reference to a
    RuleSurgePricing instance and re-derives the count rather than guessing
    a trigger rate.
    """

    name = "p2_permuted_surge"

    def __init__(self):
        self._rule = RuleSurgePricing()

    def multipliers(self, spots, ledgers, prev_requests, w_start, w_end, rng):
        rule_out = self._rule.multipliers(spots, ledgers, prev_requests, w_start, w_end, rng)
        n_surge = sum(1 for v in rule_out.values() if v > 1.0)
        out = {s.id: 1.0 for s in spots}
        if n_surge:
            idx = rng.choice(len(spots), size=min(n_surge, len(spots)), replace=False)
            for i in np.atleast_1d(idx):
                out[spots[int(i)].id] = SURGE_MULTIPLIER
        return out


PRICING_REGISTRY = {
    "p0_static": StaticPricing,
    "p1_rule_surge": RuleSurgePricing,
    "p2_permuted_surge": PermutedSurgePricing,
}


def allocate_with_pricing(spots, requests, pricing: PricingPolicy, seed: int):
    """Greedy allocation (B2, the strongest classic baseline) run under a
    pricing policy that re-prices spots at the start of each decision window.

    Returns (assignments, revenue_usd, mean_multiplier).

    Greedy is held fixed across all pricing arms on purpose: Experiment B
    varies price, not the allocator, so any difference is attributable to
    pricing alone.
    """
    rng = np.random.default_rng(seed)
    ledgers = build_ledgers(spots)
    assignments: list[Assignment] = []
    revenue = 0.0
    mult_samples: list[float] = []

    # Bucket requests by decision window, chronologically.
    n_windows = int(180 // DECISION_STEP_MINUTES) + 1
    buckets: list[list[Request]] = [[] for _ in range(n_windows)]
    for r in requests:
        buckets[min(n_windows - 1, int(r.arrival_minute // DECISION_STEP_MINUTES))].append(r)

    prev_requests: list[Request] = []
    for w_idx, window in enumerate(buckets):
        w_start = w_idx * DECISION_STEP_MINUTES
        w_end = w_start + DECISION_STEP_MINUTES
        if not window:
            prev_requests = []
            continue

        mults = pricing.multipliers(spots, ledgers, prev_requests, w_start, w_end, rng)
        mult_samples.extend(mults.values())
        priced = [
            dataclasses.replace(s, price_per_hour=s.price_per_hour * mults[s.id])
            for s in spots
        ]

        for req in window:
            best_spot = None
            best_u = None
            for s in priced:
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
            revenue += best_spot.price_per_hour * (req.duration_minutes / 60.0)

        prev_requests = window

    # Restore the caller's request order (windows are already chronological,
    # but requests within the episode were generated in arrival order).
    by_id = {a.request_id: a for a in assignments}
    ordered = [by_id.get(r.id, Assignment(r.id, None, None)) for r in requests]

    mean_mult = float(np.mean(mult_samples)) if mult_samples else 1.0
    return ordered, revenue, mean_mult
