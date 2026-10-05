# CampusPark LLM Allocation Study — project write-up (pre-drafted)

> **Read this first.** This document is written in the voice of a finished project.
> **Results that actually exist are stated plainly; results not yet obtained are marked
> `⟨PENDING: ...⟩`.** Do not strip a PENDING marker and paste the sentence onto a resume
> before the data exists — that would be fabricating an experimental result. Section 5
> below is a line-by-line table of what can and cannot be claimed today.

---

## 1. One-sentence version

Built a discrete-event simulation platform on real parking-market data to benchmark
LLM multi-agent negotiation against greedy/FIFO allocation under contention, using a
pre-registered experimental design with paired statistical testing to quantify both
fairness gains and LLM-specific failure modes.

---

## 2. Resume bullets (pick 3–4)

**For ML / AI roles:**

- Designed and implemented a multi-agent LLM allocation system (per-user negotiating agents +
  a central broker over a 3-round protocol) using strict JSON-schema tool calling, with an
  independent constraint validator that **rejects rather than repairs** illegal allocations —
  making model failure modes measurable instead of silently masked.
- Benchmarked LLM-driven allocation against greedy and FIFO baselines across 3 contention
  levels × 30 seeds under a paired design; reported Cohen's d / Cliff's delta with bootstrap
  CIs and Holm–Bonferroni correction over a pre-registered metric family.
- Addressed reproducibility on current-generation models that **no longer accept
  `temperature`**: replaced deterministic decoding with a repeated-measures design and
  variance decomposition (ICC), isolating model stochasticity from scenario variance via a
  linear mixed-effects model.
- Profiled inference cost end-to-end and found spend was dominated by broker reasoning tokens
  (**11.7× swing, $26→$303, across thinking-budget settings**), not by the per-agent model
  choice (**1.4–2.4% of total**) — redirecting optimization to the parameter that actually
  mattered.

**For platform / infrastructure roles (the engineering layer):**

- Shipped the research finding as a **fault-tolerant serving layer**: cost-ceiling guard →
  circuit breaker → deadline + bounded retry → LLM policy → validator gate → deterministic
  fallback → structured telemetry. Illegal model output is **dropped and re-decided by the
  classical scheduler, never repaired**, so a hallucinated spot ID can never reach a user.
- Kept the production retry/fallback behavior in a **separate layer that wraps the research
  code without modifying it**, because the study's pre-registration explicitly forbids
  retries and repair — the two requirements are contradictory and could not share a codebase.
- Built a **75-test suite whose harness makes it impossible to spend money**: every test runs
  against a stub client and `conftest.py` blocks outbound sockets, so a test that began
  calling the real API would fail rather than bill every CI run.
- Wrote CI that enforces **scientific** invariants alongside the usual ones: two independent
  runs must be byte-identical, classical policies must produce zero illegal allocations, and
  **prompt/tool-schema SHA-256 fingerprints must still match the pre-registration** — making
  post-hoc prompt tuning a build failure rather than an honor-system rule.
- Caught a defect where a timeout was decorative: `ThreadPoolExecutor` used as a context
  manager calls `shutdown(wait=True)`, so the deadline fired but the caller still blocked for
  the full hung call (asserted <3s, measured 5.02s).

**For SWE / data roles:**

- Built a reproducible discrete-event simulator (interval-scheduling engine, seeded scenario
  generation, pluggable policy interface) over **1,104 real parking quotes across 24 garages**;
  documented every real vs. synthetic field to keep data provenance auditable.
- Validated a cost-driven 28× scale reduction of the simulation before relying on it: ran
  classic baselines at both scales (270 episodes each) and showed strategy ordering held in
  **6/6 (metric, load) cells with max mean deviation 0.121**.
- Caught two correctness bugs through zero-cost dry-run harness testing that would have
  invalidated the primary comparison — an unenforced acceptance threshold making success rates
  incomparable across arms, and a tool-name mismatch silently disabling the negotiation
  revision round.

**Results bullets — Experiment B is complete, so these are real and usable as-is:**

- Produced a **negative result on the pre-registered primary metric**: the production surge
  pricing rule significantly *reduced* spot utilization at every load level (**−3.79% at
  ρ=2.0, d=−3.58, p=2.9e−18**), reframing it as a utilization-for-revenue trade rather than
  an efficiency gain — a conclusion that held across **all 5** demand-elasticity settings in
  a sensitivity sweep, with effect size scaling monotonically in price sensitivity.
- Isolated the source of the rule's revenue gain with a **permutation control** (identical
  number of surcharges, randomly relocated): targeting contested spots earned **+5.94% over
  the matched-price control** (d=+3.98, p=1.6e−19), showing the gain comes from the demand
  signal rather than the price increase — robust in **4 of 5** elasticity settings, failing
  only for a uniformly highly-price-sensitive population.
- Ran a **sensitivity sweep over the model's one unmeasured parameter and reported that it
  materially revised one of my own headline findings**: "untargeted price increases capture no
  revenue" was significantly contradicted in 1 of 5 settings, holding only when demand is both price-sensitive
  *and* homogeneous — at equal mean elasticity, a heterogeneous population made blanket
  increases profitable (+0.07%) where a homogeneous one lost money (−2.14%).

**Results bullets for Experiment A (only usable once it has run):**

- ⟨PENDING: the headline LLM-vs-Greedy result, e.g. "Found LLM negotiation improved Jain's
  fairness index by X% (d=Y, p<Z) at high contention while reducing success rate by W%" ⟩
- ⟨PENDING: the H3 illegal-allocation rate, e.g. "Quantified an N% illegal-allocation rate
  that is structurally impossible for classical schedulers" ⟩

---

## 3. Portfolio / LinkedIn paragraph

This project grew out of CampusPark, a parking reservation system I built
(Node.js + Prisma + PostgreSQL). Once it was running I noticed a real problem: under
contention, first-come-first-served systematically shuts some users out permanently — even
when their needs could have been met by a cross-user trade ("you want the EV charger, I only
want cheap").

So I turned it into a testable research question: **does LLM-driven multi-agent negotiation
actually allocate more fairly than a greedy algorithm, and what does it cost?**

I calibrated a discrete-event simulator on scraped real parking quotes (24 garages, 53
snapshots) plus real OpenStreetMap coordinates, implemented three baselines (random, FIFO,
greedy) and two treatment arms (single-shot LLM allocator, multi-round LLM negotiation), and
ran the study to pre-registration standards: primary metrics declared in advance, paired
design, multiple-comparison correction, effect sizes and confidence intervals reported
together.

The completed pricing sub-experiment produced a result I had not expected. I assumed dynamic
surcharges would raise spot utilization; measured, they do the opposite — utilization
significantly **drops** (−3.79%, consistent across all five demand-elasticity settings) and
what you get instead is revenue. More importantly, I added a permutation control that applies
the same number of surcharges to randomly chosen spots, and it showed the revenue gain comes
mainly from **demand targeting** rather than from raising prices at all (+5.94%, d=3.98).
Without that control I would have credited the 6% revenue gain to the price increase.

The step I value most in this project is that **I ran a sensitivity sweep against my own
conclusions and it forced me to revise my headline claim.** I had treated "untargeted price
increases capture no revenue" as the sharpest finding; sweeping the one unmeasured parameter
across five settings showed it is significantly contradicted for a genuinely price-insensitive
population. At the **same mean elasticity**, a homogeneous population loses 2.14% while a
highly heterogeneous one captures nothing at all rather than losing. So the claim now ships
with an explicit boundary condition, and I wrote down that settling it requires real price-
elasticity data rather than more simulation.

⟨PENDING: one-sentence headline result for Experiment A (LLM vs greedy)⟩ The study also
instruments the failure modes unique to LLM allocation — hallucinated spot IDs, double
bookings — which are errors a classical scheduler structurally cannot make, and which I think
are the risk most in need of quantification before anything like this reaches production.

---

## 4. GitHub README opening (technical)

````markdown
# CampusPark Allocation Study

Do LLM negotiating agents allocate a scarce resource more fairly than a greedy scheduler —
and what does it cost you when they don't?

A pre-registered simulation study benchmarking **LLM multi-agent negotiation** against
**greedy / FIFO / random** baselines for parking-spot allocation under contention, built on
real market data from 24 Bellevue, WA garages.

## Why this exists

FIFO allocation — what most real booking systems actually do, including the CampusPark app
this study grew out of — is structurally unfair: a user whose first choice is contested gets
nothing, even when a mutually better swap exists with another user. Negotiation should fix
that. This study tests whether an LLM can actually find those swaps, at what cost, and with
what new failure modes.

## Design

| Arm | Policy | Role |
|---|---|---|
| B0 | Random | Sanity floor |
| B1 | FIFO | Production baseline (mirrors the real atomic-reservation transaction) |
| B2 | Greedy | Strong algorithmic baseline (online utility maximization) |
| T1 | LLM central allocator (single-shot) | Ablation: isolates *reasoning* from *negotiation* |
| T2 | LLM multi-agent negotiation (3 rounds) | Treatment |

- **Paired design**: all arms see identical seeded scenarios.
- **Pre-registered primary metrics**: allocation success rate, Jain's fairness index.
  Secondary family corrected separately (Holm–Bonferroni).
- **Never-repair validation**: an independent validator re-checks every allocation against
  hard constraints (capacity / EV / interval overlap). Illegal LLM output is *recorded and
  rejected*, never patched — otherwise the failure mode being measured disappears.

## Notable methodology

**Reproducibility without `temperature`.** Current Claude models reject the `temperature`
parameter outright, so the standard "set temperature=0 for determinism" approach is
unavailable. Instead: scenario generation is fully seeded, model stochasticity is treated as
a random effect, each cell is replicated, and variance is decomposed (ICC) under a
linear mixed-effects model.

**Validated scale reduction.** LLM arms can't be afforded at full scale, so supply and demand
are shrunk together (28× smaller fleet, all 24 real garages retained) to preserve the meaning
of the load factor ρ. Before relying on it, classic baselines were run at *both* scales:
strategy ordering held in 6/6 (metric, ρ) cells, max mean deviation 0.121.

## Results

### Experiment B — dynamic pricing (complete, n=30/cell, 270 episodes)

The production surge rule trades utilization for revenue, and its revenue gain is entirely
attributable to *targeting* rather than to the price increase itself.

| Arm | Mean multiplier | Utilization vs static | Revenue vs static |
|---|---|---|---|
| P0 static | 1.000 | — | — |
| P1 rule surge (contested spots) | 1.144 | **−3.79%** (d=−3.58, p=2.9e−18) | **+6.15%** |
| P2 permuted (same count, random spots) | 1.143 | −4.74% | −0.78% (p=0.008) |

*At ρ=2.0. P1 and P2 charge an identical average multiplier by construction — the only
difference is whether the surcharge is aimed at contested spots.*

Without P2, the natural conclusion would have been "surge pricing raises revenue 6%" with
the credit going to the price increase. P2 attributes it to targeting instead.

**Sensitivity sweep over the one unmeasured parameter** (price elasticity, 5 settings
varying level and spread independently):

| Conclusion | Holds in | Status |
|---|---|---|
| Surge reduces utilization | **5/5** | robust; effect scales monotonically in elasticity |
| Targeting beats matched-price random | 4/5 | robust with a boundary condition |
| Untargeted increases capture no revenue | **2/5** | **overturned** — holds only when demand is price-sensitive *and* homogeneous |

The third row is reported as a finding, not buried: at equal mean elasticity a heterogeneous
population made blanket increases profitable (+0.07%) where a homogeneous one lost money
(−2.14%). Settling it needs real price-elasticity data, not more simulation.

### Experiment A — LLM vs. classical allocation

⟨PENDING: headline results table and figures⟩

## Reproducing

```bash
pip install -r requirements.txt
python -m harness.run_experiment --strategies random,fifo,greedy --target-capacity 30 --n-seeds 30
python -m harness.analyze --csv results/compact_baseline_summary.csv
python -m harness.estimate_cost   # offline cost projection, no API key needed
```
````

---

## 5. What can and cannot be claimed today

| Claim | Usable today? | Backed by |
|---|---|---|
| 1,104 real quotes, 24 garages, 53 snapshots | yes | measured from `parking_data.csv` |
| Real OSM coordinates for the same 1 km disc | yes | `data/osm_parking_bellevue.json`, 156 features |
| Interval-scheduling simulator + pluggable policy interface | yes | code complete and running |
| Three classical baselines, 270 episodes, zero illegal allocations | yes | `results/baseline_summary.csv` |
| Scale validation: ordering held 6/6 cells, max deviation 0.121 | yes | `results/scale_validation.md` |
| Cost profile: 11.7x swing, agent side is 1.4–2.4% | yes | `results/cost_analysis.md` (state that it is an offline estimate) |
| Pre-registered design, paired tests, Holm-Bonferroni, effect sizes | yes (the design is implemented) | `harness/analyze.py` |
| LLM multi-agent negotiation system "is implemented" | yes | code complete + stub-client pipeline tests |
| Experiment B result 1: utilization drops | yes, unconditionally | consistent in 5/5 sensitivity settings |
| Experiment B result 2: targeting is what pays | yes, **state the boundary** | 4/5 settings; fails for a uniformly highly price-sensitive population |
| Experiment B result 3: untargeted increases capture nothing | yes, **state the boundary** | 4/5 settings; one significant counter-example |
| **The permutation-control methodology** | yes | `harness/pricing.py`, including the correction to the original plan |
| **Running a sensitivity sweep that revised my own finding** | yes | `results/pricing_sensitivity.md` |
| Production layer: breaker / validator gate / fallback / telemetry / HTTP service | yes | `serving/`; no-key degradation verified |
| 93 tests + CI (including prompt-fingerprint checks) | yes | `tests/`, `.github/workflows/ci.yml` |
| Four defects caught before they could contaminate a result | yes | documented in the README |
| Two pre-data pre-registration amendments, one contradicting my own prediction | yes | `PRE_REGISTRATION.md` §4b |
| LLM negotiation system "has been evaluated / run for real" | **no** | not one real API call yet |
| Any **numeric result** for LLM vs greedy | **no** | Experiment A has not run |
| A specific value for the illegal-allocation rate (H3) | **no** | same |
| Specific ICC / variance-decomposition values | **no** | needs repeated-measures data |

**What unlocks the rest:** an `ANTHROPIC_API_KEY` plus the main grid including the effort
factor. Estimated at roughly $748 for the full frozen configuration (T1+T2 x 3 loads x 3
effort levels, n=60 main / n=20 ablation), or about $374 using the Batch API. A $6 staged
pilot comes first — see `PILOT_PLAN.md`.

---

## 6. Five technical points worth going deep on in an interview

**1. "How do you know the LLM-vs-classical comparison is fair?"**
Three levels. (a) *Information symmetry* — the model is given every parameter of the utility
function and the distance to every spot, exactly what the greedy algorithm uses internally,
so what is measured is *how* the information is used, not whether it was available.
(b) *A single acceptance rule* — an early version of the LLM commit path omitted the "utility
must clear the user's reservation threshold" check, which would have counted a negative-utility
match as a success for the LLM arms only; I caught that in a dry-run test and fixed it.
(c) *One validator* — hard constraints are checked by the same code for every policy, so no
arm gets a looser standard.

**2. "Current models reject `temperature` — so how is the experiment reproducible?"**
This is the design decision I am happiest with. `claude-opus-5` and `claude-sonnet-5` return a
400 if you pass `temperature`, so the standard "set it to zero" protocol is unavailable.
Rather than pretend the stochasticity is gone, I **isolate and measure** it: scenario
generation is fully seeded and byte-for-byte reproducible, model randomness is treated as a
random effect by sampling the same scenario repeatedly, the ICC reports what share of total
variance is the model's own jitter, and a mixed-effects model separates that from the policy
effect. Validating the estimator against synthetic data with a known ICC also revealed that
the random-effect structure my own proposal specified was wrong — logged as Amendment A-1
rather than quietly corrected.

**3. "How do you know it was the *targeting* and not just the price increase?"** (Experiment B,
real data exists)
This is the control design I am most pleased with. The original plan specified "a random
multiplier U[1.0, 1.5], matched on mean to the rule arm" — but U[1.0, 1.5] has a mean of 1.25,
which only matches if the surge fires exactly 50% of the time, and the trigger rate is unknown.
I changed it to **re-use the rule arm's realized surcharge count in the same time window and
permute only the placement**, so the marginal price distribution is identical by construction
(measured mean multipliers 1.144 vs 1.143) and the sole remaining variable is whether the
surcharge was aimed at contested spots — valid at any trigger rate. The result is clean: the
randomly-placed arm charged 13.8% more on average and **lost money**, so the price lever by
itself contributes nothing. Without that control I would have attributed the 6% revenue gain
to raising prices.

**4. "How did you handle research code versus production code?"** (this one shows research
discipline and engineering judgment at the same time)
Their requirements are **directly in conflict**. The pre-registration forbids retrying failed
calls and forbids repairing illegal allocations, because both would erase the failure mode I am
measuring; production must retry, must fall back, and must always return an answer. My
resolution is layering: `serving/` only wraps `harness/policies/` and never modifies it, so the
research path stays word-for-word as pre-registered while the safety net sits outside it. The
production chain is cost-ceiling guard → circuit breaker → deadline + bounded retry → model →
validator gate → Greedy fallback → telemetry, and the validator gate uses **the exact same
validator the experiment scores with**: illegal allocations are dropped and re-decided, never
patched. The research already quantifies that the model hallucinates spot IDs, which is
precisely why production cannot trust a single line of its output.

**5. "Does shrinking the simulation invalidate the conclusions?"**
It can, and my first attempt got it wrong — I reduced the request count without reducing supply,
which drove the effective demand/supply ratio at rho=2.0 down to 0.07 and removed the contention
entirely. After switching to scaling supply proportionally I did not simply trust it: I ran the
classical baselines at both scales, 270 episodes each, and confirmed strategy ordering held in
6/6 cells with a maximum mean deviation of 0.121 before relying on the scaled scenario for the
LLM arms. I also later had to correct myself again here — that validation covers effect
magnitude and ordering, **not** statistical precision, which is why the frozen configuration
uses a larger fleet than I first planned.
