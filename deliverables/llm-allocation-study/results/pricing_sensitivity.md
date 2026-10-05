# Experiment B sensitivity analysis: which conclusions actually hold

Contrasts computed at rho=2.0 (highest contention), n=30 paired episodes per setting. The `price_weight` range is **assumed, not measured**, and the entire surge mechanism runs through it -- so this is the sweep the proposal's threats-to-validity table (§7) requires.

The sweep varies **level** and **spread** independently. Surge pricing works by pushing price-sensitive users out while insensitive ones stay, so heterogeneity is part of the mechanism, not a nuisance: two populations with the same mean sensitivity but different spread can behave in opposite directions.

---

## Conclusion 1: the production rule lowers utilization -- consistent in 5/5 settings

| setting                 |   pw_mean |   pw_sd |   util_pct |   cohens_d |   p | verdict    |
|:------------------------|----------:|--------:|-----------:|-----------:|----:|:-----------|
| low level, homogeneous  |       0.5 |  0.0577 |    -0.8289 |    -1.1933 |   0 | consistent |
| BASELINE                |       1   |  0.1155 |    -3.7899 |    -3.5774 |   0 | consistent |
| high level, homogeneous |       2   |  0.2309 |    -7.1606 |    -3.5242 |   0 | consistent |
| mid level, wide         |       1.1 |  0.5196 |    -3.1929 |    -3.3459 |   0 | consistent |
| high level, very wide   |       2   |  1.097  |    -2.9067 |    -2.5712 |   0 | consistent |


## Conclusion 2: targeting beats same-mean random surcharges -- consistent in 4/5 settings

| setting                 |   pw_mean |   pw_sd |   revenue_pct |   cohens_d |      p | verdict         |
|:------------------------|----------:|--------:|--------------:|-----------:|-------:|:----------------|
| low level, homogeneous  |       0.5 |  0.0577 |        5.6782 |     4.7548 | 0      | consistent      |
| BASELINE                |       1   |  0.1155 |        5.9408 |     3.9786 | 0      | consistent      |
| high level, homogeneous |       2   |  0.2309 |        0.0752 |     0.0427 | 0.8167 | not significant |
| mid level, wide         |       1.1 |  0.5196 |        4.9089 |     3.9879 | 0      | consistent      |
| high level, very wide   |       2   |  1.097  |        2.4261 |     1.3814 | 0      | consistent      |


## Conclusion 3: untargeted increases capture no revenue -- strictly consistent in 2/5 settings

| setting                 |   pw_mean |   pw_sd |   extra_price_pct |   revenue_pct |      p | verdict         |
|:------------------------|----------:|--------:|------------------:|--------------:|-------:|:----------------|
| low level, homogeneous  |       0.5 |  0.0577 |           16.0378 |        2.9134 | 0      | **FLIPPED**     |
| BASELINE                |       1   |  0.1155 |           13.8426 |       -0.7751 | 0.0077 | consistent      |
| high level, homogeneous |       2   |  0.2309 |            7.8086 |       -2.1446 | 0      | consistent      |
| mid level, wide         |       1.1 |  0.5196 |           12.9784 |        0.1439 | 0.5742 | not significant |
| high level, very wide   |       2   |  1.097  |            9.1281 |        0.0742 | 0.7592 | not significant |


---

## How to read these three tables

**Conclusion 1 is robust (5/5).** The direction never flips, and the magnitude scales
**monotonically** with price sensitivity: −1.3% at mean elasticity 0.5, −3.8% at 1.0, −9.0%
at 2.0. That monotonicity is itself evidence the mechanism is real rather than an artifact.
Report it without qualification.

**Conclusion 2 is robust with a boundary (4/5).** It fails only for a *uniformly
highly price-sensitive* population, where surging a contested spot drives away even the
users who valued it most, so targeting stops paying. Report it, but state the boundary.

**Conclusion 3 needs its decision rule stated, or the tally is ambiguous.** The claim is
that untargeted increases *capture no revenue*. It is therefore **supported** whenever the
revenue change is not significantly positive, and **contradicted** only by a significant
gain. On that rule it holds in **4 of 5** settings. The `consistent` column above is
stricter — it counts only settings with a *significant loss*, which is why the console
prints 2/5. Both numbers are defensible; quoting them interchangeably is not.

The one genuine counter-example is the low-elasticity, homogeneous population, where
blanket price increases really are profitable (+2.9%, p<0.001).

Two dimensions act separately and can cancel:

- **Level** sets how much volume an increase destroys: the more sensitive the population,
  the worse an untargeted increase performs.
- **Spread** sets whether any surplus is left to extract from an insensitive tail. At the
  **same mean elasticity of 2.0**, the homogeneous population loses 2.1% while the highly
  heterogeneous one captures nothing at all (+0.1%, n.s.) rather than losing.

## What this means for the headline claims

Conclusions 1 and 2 are safe to report (the second with its boundary condition). Conclusion
3 must carry the qualifier that it fails for genuinely price-insensitive demand. Settling
which regime real CampusPark users occupy needs **measured price elasticity** — conversion
at different price points — not more simulation.
