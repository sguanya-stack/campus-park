# Scale and sample size for Experiment A, from measured variance

Produced by `harness/power_analysis.py` and `harness/estimate_cost.py`, both free to run.
This document **corrects a claim I made earlier** and sets out the configuration to fix before
the main experiment runs.

All numbers below were recomputed after Amendment A-2 (real OSM coordinates).

---

## Correction: the scale validation proves the phenomenon survives, not the precision

`scale_validation.md` shows strategy ordering preserved in 6/6 cells between the compact fleet
(30 spaces) and the full fleet (833). **That result is about effect magnitude and ordering
only — it says nothing about statistical precision.** I previously described the compact fleet
as a "faithful proxy", which was too broad.

Measured paired-difference SD (fifo vs greedy, success_rate, rho=1.2, n=30):

| Fleet capacity | Requests/episode | Paired-diff SD | MDE @ n=30 | n needed for 1 pp |
|---|---|---|---|---|
| 30 | 36 | 0.0567 | **3.00 pp** | 255 |
| 60 | 72 | 0.0354 | 1.87 pp | 100 |
| 120 | 144 | 0.0305 | 1.62 pp | 75 |
| 240 | 288 | 0.0219 | 1.16 pp | 40 |
| 833 | 1000 | 0.0129 | **0.68 pp** | 15 |

The reason is direct: each episode's success rate is itself a small-sample proportion. With
24–60 requests the standard error is about 0.10; with 666–1666 it is about 0.019. **Shrinking
the fleet to save money costs more than a factor of four in precision.**

## Variance has two components, and a larger episode only removes one

Pure 1/sqrt(requests) scaling from the 30-space row would predict an SD of 0.0097 at 833
spaces; the measured value is 0.0129. The measured values sit consistently above the
prediction, which means part of the variance does **not** shrink as episodes grow — scenario
variance, since different seeds generate genuinely different demand and supply configurations.

So **bigger episodes suppress sampling noise but not scenario variance.** Driving the MDE
lower requires more seeds as well.

## But bigger episodes are far more token-efficient

Each decision window re-sends the spot menu (24 garages) and the system prompt. That fixed
cost is independent of how many requests the window holds, so cost per request falls sharply
as episodes grow:

| Fleet capacity | Requests/episode | $/episode | **$/request** |
|---|---|---|---|
| 30 | 36 | 0.587 | 0.0163 |
| 60 | 72 | 0.793 | 0.0110 |
| 120 | 144 | 0.908 | 0.0063 |
| 240 | 288 | 1.047 | **0.0036** |

From 30 to 240 spaces: requests per episode rise 8x, cost per episode rises only 1.8x, so
**cost per request drops 4.5x**.

## Recommended configuration

Given that cost is not the binding constraint, **do not use the 30-space fleet**:

| Configuration | MDE (rho=1.2, success_rate) | Estimated budget (3 efforts x 3 loads x T1+T2) | With Batch API |
|---|---|---|---|
| cap=30, n=30 (original plan) | 3.00 pp | $164 | $82 |
| cap=30, n=60 | 2.12 pp | $329 | $165 |
| **cap=240, n=60 (recommended)** | **~0.82 pp** | **$553** | **~$277** |

Why cap=240 / n=60:

1. An MDE near 0.8 pp is small enough to detect a subtle LLM-vs-Greedy difference. **At
   cap=30/n=30 (MDE 3.00 pp) a real 2 pp difference would be reported as "not significant" —
   which is a null result, not a negative one, and those are worth very different amounts in a
   paper.**
2. 288 requests per episode makes the negotiation scenario itself realistic. At the compact
   scale a decision window holds 1–4 requests, so "multi-agent negotiation" has almost nothing
   to negotiate over — which matters most for T2.
3. Cost per request is a quarter of the compact fleet's, so the money buys more.

## What still needs a decision

- **Which effort levels to sweep.** The table assumes three (low/medium/high). Running only
  medium and high cuts roughly a third of the budget.
- **cap=240 or cap=120.** The 120-space fleet gives an MDE near 1.15 pp at n=60, with a budget
  between the two rows above.
- **Every MDE here comes from deterministic policies, so it captures scenario variance only.**
  The LLM arms add model jitter on top — which is exactly what the §5.3 repeated-measures ICC
  exists to quantify — so the real MDE will be larger. **After the pilot, re-run
  `harness/variance_analysis.py` on actual LLM data before fixing n.**
- Amendment A-2 narrowed the greedy-vs-FIFO gap by 19–37%. If real geography compresses
  differences between allocation strategies in general, the effect Experiment A is trying to
  detect is smaller than originally assumed, which makes the point above more pressing rather
  than less.
