# Experiment B results: dynamic pricing benchmark (complete)

Data: `pricing_summary.csv`, 270 episodes (3 pricing policies x 3 load levels x 30 seeds), full
fleet (24 real garages, 833 spaces). The allocator is held fixed at Greedy, so **only price
varies** and any difference is attributable to pricing alone. Paired design: all three arms see
the same seeded scenarios.

All numbers below are post-Amendment A-2 (real OSM coordinates).

| Arm | Definition |
|---|---|
| P0 static | Real CSV prices, never adjusted |
| P1 rule surge | x1.5 on contested spots — the production rule (`server.js:574`), rewritten scale-free |
| P2 permuted | The **same number** of x1.5 surcharges P1 applied in that window, relocated to randomly chosen spots |

**Why P2 is a permutation control rather than "a random multiplier with the same mean."** The
original plan specified U[1.0, 1.5]. That does not actually match: U[1.0, 1.5] has a mean of
1.25, which equals P1's mean only if the surge fires exactly 50% of the time, and the trigger
rate is unknown. Re-using P1's realized surcharge **count** and permuting only its placement
makes the marginal price distribution identical **by construction** at any trigger rate
(measured: mean multipliers 1.144 vs 1.143), leaving targeting as the sole difference.

---

## Result 1: the production rule reduces utilization

Utilization was this experiment's pre-registered primary metric. The result runs opposite to
the hypothesis.

| rho | Utilization change (P1 vs P0) | Cohen's d | p |
|---|---|---|---|
| 0.8 | −1.31% | −1.24 | 1.8e−07 |
| 1.2 | −1.02% | −1.02 | 4.7e−06 |
| 2.0 | **−3.79%** | −3.58 | 2.9e−18 |

Losses grow with contention. The rule is more accurately described as **trading utilization for
revenue** than as an efficiency mechanism.

## Result 2: the revenue gain comes from targeting, not from raising prices

At matched average multipliers, aiming surcharges at contested spots earned **+5.94% more than
the permutation control** (rho=2.0, d=+3.98, p=1.6e−19). Without P2, the natural reading would
have been "dynamic pricing raises revenue 6%", crediting the price increase.

## Result 3: untargeted increases capture no revenue — with one boundary condition

P2 charged **13.8% higher average prices** than P0 and revenue **fell 0.78%** (p=0.008).

Because price sensitivity is an **assumed, unmeasured** parameter, the sweep required by the
proposal's threats-to-validity table was run: 5 settings varying both the **level** and the
**spread** of price sensitivity, with every other request attribute held byte-identical.

| Population | elasticity mean/sd | P2 charged | P2 revenue vs P0 | Supports result 3? |
|---|---|---|---|---|
| low level, homogeneous | 0.50 / 0.06 | +16.0% | **+2.91%** (p<0.001) | **no — genuinely profitable** |
| BASELINE | 1.00 / 0.12 | +13.8% | −0.78% (p=0.008) | yes — loses money |
| high level, homogeneous | 2.00 / 0.23 | +7.8% | **−2.14%** (p<0.001) | yes — loses money |
| mid level, wide | 1.10 / 0.52 | +13.0% | +0.14% (n.s., p=0.57) | yes — captures nothing |
| high level, very wide | 2.00 / 1.10 | +9.1% | +0.07% (n.s., p=0.76) | yes — captures nothing |

**Decision rule, stated so the tally cannot be gamed:** the claim is that untargeted increases
*capture no revenue*. It is therefore **supported** whenever the revenue change is not
significantly positive, and **contradicted** only by a significant gain. On that rule it holds
in **4 of 5** settings and fails in one — the genuinely price-insensitive population, where
blanket pricing does pay.

(The `consistent` column in `pricing_sensitivity.md` applies a stricter rule, counting only
settings with a *significant loss*, which is why the generator prints 2/5. Both are defensible;
quoting them interchangeably is not.)

The mechanism is interpretable: **level** decides how much volume an increase destroys, while
**spread** decides whether surplus can still be extracted from an insensitive tail. At the
**same mean elasticity of 2.0**, the homogeneous population loses 2.14% while the highly
heterogeneous one captures nothing at all (+0.07%, n.s.) rather than losing.

Settling which regime real CampusPark users occupy requires **measured price elasticity** —
conversion at different price points — not more simulation.

### The permutation control was necessary either way

Even with result 3 carrying a boundary condition, P2 earned its place: running only P0 vs P1
would have yielded "dynamic pricing raises revenue 6.15%" attributed to the price increase.
P2 is what separates "raising prices" from "aiming them" — and the resulting **result 2 is
considerably more robust than result 3**.

---

## Overall conclusion

The production surge rule makes a **utilization-for-revenue trade**: revenue up, at the cost of
3.79% utilization at high contention (rho=2.0). It is not the utilization-improving mechanism
the proposal assumed. Whether the trade is worthwhile depends on the operating objective — if
the KPI is turnover, the rule is harmful; if it is revenue, it works, and **it works mainly
because of the targeting algorithm rather than the price lever**, so the thing to optimise is
the demand signal, not the multiplier.

Ranked by robustness, here is how far each result can be stated:

| Result | Sensitivity sweep | How to report it |
|---|---|---|
| 1. The rule lowers utilization | **5/5 consistent**, magnitude monotone in elasticity | Report unconditionally |
| 2. Targeting beats same-mean random surcharges | 4/5 | Report **with a boundary condition** (fails for a uniformly highly price-sensitive population) |
| 3. Untargeted increases capture no revenue | 4/5 under the stated rule | Report **with the qualifier** that it fails for genuinely price-insensitive demand |

## Threats to validity, to be reported alongside the results

1. ~~The demand model is mine and needs a price-sensitivity sweep~~ → **done**, 5 settings (see
   [pricing_sensitivity.md](pricing_sensitivity.md)). The remaining limitation is that
   identifying which setting real users occupy requires actual elasticity data from CampusPark.
2. **The trigger rule was rewritten.** Production uses `demandSearchCount > 20` (an absolute
   threshold); the simulation uses "demand aimed at this spot in the previous window exceeds
   its currently free lanes" (scale-free). The direction matches, but it is not the same rule,
   so this does not claim to reproduce production behaviour exactly.
3. **Only the x1.5 multiplier was tested.** The multiplier itself was not swept, so this
   experiment cannot say whether it should be raised or lowered.
4. **Utilization is defined** as occupied space-minutes / total capacity space-minutes, which
   does not distinguish "empty" from "priced away".
5. **Capacity and EV availability remain synthetic** (see
   [data_provenance.md](../data_provenance.md)). Coordinates are now real; capacity is derived
   from the availability-fraction proxy.

## Reproducing

```bash
python3 -m harness.run_pricing_experiment --n-seeds 30 --out-name pricing_summary
python3 -m harness.analyze --csv results/pricing_summary.csv --out results/pricing_report.md
```
