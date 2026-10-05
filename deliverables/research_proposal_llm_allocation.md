# Research Proposal — LLM Agent Negotiation vs. Greedy/FIFO Scheduling for Parking Allocation

**Author:** Guanya Song (song.guany@northeastern.edu)
**System under study:** CampusPark (Node.js + Prisma + PostgreSQL, with existing concurrent
reservation and dynamic pricing modules)
**Date:** 2026-09-21 (revised as findings required)
**Status:** Draft, self-reviewed before submission

---

## 0. One-page summary

**Research question (one sentence)**
In a parking-allocation setting calibrated on real price and occupancy data under high
contention, does LLM-driven multi-agent negotiation differ significantly from greedy and
first-come-first-served (FIFO) scheduling in **allocation success rate** and **fairness**?

**Hypotheses**
- **H1 (success rate):** LLM negotiation's request-satisfaction rate is no better than Greedy's,
  or is lower — the cost being latency and token spend.
- **H2 (fairness):** LLM negotiation is significantly fairer (Jain's index / Gini) than Greedy
  and FIFO, because it can trade preferences across users ("you want the EV charger, I only
  want cheap").
- **H3 (reliability cost):** LLM allocation produces a non-zero **illegal allocation rate**
  (double bookings, references to nonexistent spots, time-window violations) — a failure mode a
  classical algorithm structurally cannot exhibit.

**Baselines (all implemented in the same simulation harness)**

| Code | Policy | Role |
|---|---|---|
| B0 | Random allocation | Sanity floor |
| B1 | FIFO (= CampusPark's current behaviour: atomic transactional inventory decrement) | Production baseline |
| B2 | Greedy (utility-maximising over distance/price, single round, no negotiation) | Strong algorithmic baseline |
| T1 | LLM **single-shot** central allocator (one call sees the whole batch) | Ablation: separates "LLM" from "negotiation" |
| T2 | LLM **multi-round negotiation** (one agent per user plus a broker, R=3 rounds) | Treatment |

**Data sources**
1. Already-collected real data, `parking_data.csv`: Parkopedia (Bellevue WA, 1 km radius) —
   **1,104 quotes, 24 garages, 53 time snapshots**, covering 2026-03-20 13:20 → 2026-03-21
   13:52, prices $4.49–$37.10 (median $8.74).
2. Real coordinates for the same 1 km disc from OpenStreetMap (156 features, ODbL), frozen into
   the repository.
3. CampusPark's existing hourly demand curve and occupancy model (`server.js:1759-1870`:
   morning-rush 0.90 / evening-rush 0.93 / midday 0.72 / off-peak 0.58) to generate the arrival
   process.
4. The simulator uses only **static snapshots** — the scraper is not re-run (see §8).

**Generative-AI depth:** the multi-agent negotiation protocol, structured-output constraints
(`strict` tool schemas), prompt-caching cost engineering, and — given that **`temperature`
cannot be set on current models** — a variance-decomposition methodology. These constitute the
substance of the work, not a single API call.

**Possible negative results:** it is entirely possible to conclude that LLM allocation has a
significantly *worse* success rate, 2–3 orders of magnitude more latency, 10^4x the unit cost,
and no significant fairness advantage. That conclusion is itself publishable, and the design
deliberately preserves room for it.

**Budget:** see §6.2. The figure depends almost entirely on one parameter the original draft
never mentioned.

---

## 1. Direction and rationale

Two directions were suggested. **Direction 2 (a dynamic-pricing benchmark) has a hard flaw as a
standalone project: it contains no generative AI at all.** "Rule-based pricing vs. random
baseline vs. static pricing" is a discrete-event simulation and hypothesis-testing exercise;
its technical depth is not in GenAI.

So this proposal takes:

- **Primary experiment (Experiment A) = Direction 1**: LLM multi-agent negotiation vs.
  Greedy/FIFO. The GenAI depth lives here.
- **Secondary experiment (Experiment B) = Direction 2**: the effect of pricing policy on
  utilization, **reusing the same simulation harness**, so its marginal cost is near zero while
  providing a "classical algorithms can also be benchmarked rigorously" counterpoint.

Sharing the harness is the point — these are not two bolted-together topics but the same
simulator with a different policy slot.

---

## 2. Background and the gap

CampusPark already has three measurable mechanisms in production, which is what makes this
study tractable:

1. **Atomic concurrent reservation** (`test-concurrency.js`, `scripts/load-test-reserve.js`): a
   Prisma transaction checks inventory then `decrement`s; 10 concurrent requests for 1 spot
   yield exactly 1 success. This is the real implementation of **B1 (FIFO)** — not a straw man.
2. **Rule-based dynamic surcharge** (`server.js:574`): `demandSearchCount > 20` sets
   `surgeMultiplier = 1.5`, otherwise 1.0. This is the policy under test in Experiment B.
3. **Occupancy simulation** (`server.js:1759`): hourly demand curve x site bias + sinusoidal
   perturbation + jitter, clamped to [0.02, 0.98].

**The gap:** existing work on LLMs for resource allocation largely stops at feasibility
demonstrations. What is missing is a controlled comparison against a *strong* algorithmic
baseline (not merely random) in the same simulated environment, with the same random seeds and
the same metric family — and above all, quantification of the failure modes unique to LLMs
(illegal allocations). This study fills that gap.

---

## 3. Experimental design

### 3.1 Factorial design (Experiment A)

**Two factors, repeated measures**

- **Factor 1 — policy** (5 levels): B0, B1, B2, T1, T2
- **Factor 2 — load** (3 levels): demand/supply ratio rho in {0.8 (oversupply), 1.2 (tight),
  2.0 (heavy contention)}
- **Episodes per cell:** n = 30 (seeds 1..30, **the same seed set shared across policies**, so
  the design is paired and variance drops sharply)
- Total 5 x 3 x 30 = 450 episodes, of which 180 are LLM episodes

(The frozen configuration in `PRE_REGISTRATION.md` revises these numbers upward after measured
power analysis: 240-space fleet, n=60 main grid.)

**Definition of an episode:** a 3-hour peak window across 24 garages (capacities and prices
derived from the real CSV), with N requests generated by a Poisson arrival process; each request
carries `(arrival time, duration, walk tolerance, price sensitivity, EV requirement, reservation
utility u_min)`. Each policy allocates the pending queue within each 10-minute decision window.

### 3.2 Agent protocol (the core of T2)

```
Round 1: each user-agent submits a structured bid
         { spot_preferences: [...], max_price, flexibility: {time_shift_min, walk_extra_m} }
Round 2: the broker publishes a tentative allocation plus the conflict set; losing agents may
         (a) concede further or (b) withdraw
Round 3: the broker publishes the final allocation
Hard constraints are enforced in code, never trusted to the model: capacity, non-overlapping
time windows, EV requirement matching
```

- Each agent's output is constrained by **structured outputs** (`output_config.format`) or a
  `strict: true` tool schema, guaranteeing parseability; parse failures count toward
  `parse_failure_rate` rather than being silently retried.
- The broker's allocation **must pass a code validator**. Allocations violating hard constraints
  are rejected and recorded as `invalid_allocation` (the dependent variable for H3), then rolled
  back to that round's last legal state — **no patching, no retrying**, since either would wash
  the LLM's failure mode out of the data.

### 3.3 Ablation

T1 vs T2 isolates the contribution of *negotiation*. In addition, two single-factor sweeps over
T2:
- negotiation rounds R in {1, 2, 3, 5}
- reasoning budget `output_config.effort` in {low, medium, high}

---

## 4. Dependent variables (the metric family)

| Metric | Definition | Hypothesis |
|---|---|---|
| **Success rate** | satisfied requests / total requests (primary) | H1 |
| **Fairness — Jain's index** | (sum u_i)^2 / (n * sum u_i^2), u_i = realized utility of user i | H2 (primary) |
| **Fairness — Gini** | Gini coefficient of the utility distribution | H2 (robustness) |
| **Worst-decile utility** | mean utility of the bottom 10% of users | H2 (who gets sacrificed) |
| **Social welfare** | sum of realized utility | Secondary |
| **Spot utilization** | occupied space-hours / total capacity space-hours | Secondary / Exp B primary |
| **Illegal allocation rate** | allocations violating a hard constraint / total allocations | **H3 (LLM-specific)** |
| **Decision latency** | p50 / p95 wall-clock per decision window | Deployability |
| **Unit allocation cost** | USD per successful allocation, computed from measured `response.usage` | Deployability |

**Primary metrics declared in advance:** success rate plus Jain's index. Everything else forms a
secondary family with Holm–Bonferroni correction applied separately. This declaration must be
part of the proposal — otherwise there is no defence against p-hacking.

---

## 5. Statistical methods

### 5.1 Testing strategy

- **Primary tests:** given the paired design, **Welch t-test** for success rate and **Wilcoxon
  signed-rank** for Jain's index (bounded, non-normal), for T2 vs B2 at each load level.
  Report **Cohen's d / Cliff's delta with 95% bootstrap CIs** (10,000 resamples), not p-values
  alone.
- **Interaction:** two-way ANOVA (policy x load), testing whether "the LLM's advantage appears
  only under heavy contention" — the most interesting hypothesis here.
- **Multiple comparisons:** Holm–Bonferroni within the primary metric family (family-wise
  alpha = 0.05).
- **Illegal allocation rate:** one-sided exact binomial test against H0 = 0, the structural zero
  of classical algorithms.

### 5.2 Power analysis

Two-sample t-test, alpha = 0.05, power = 0.80:
- n = 30/cell detects **d >= 0.74** (a medium-to-large effect)
- n = 64/cell detects d >= 0.50

The paired / shared-seed design reduces effective variance considerably further. **Approach:**
run an n = 5 pilot to estimate between-episode variance, then back out the required n; if the
pilot suggests an effect smaller than d = 0.74, expand the LLM arms to n = 60 (about $30 more,
per §6). The non-LLM arms (B0/B1/B2) are essentially free to compute, so they are run at n = 200
to obtain precise baseline distributions.

> Measured outcome: this was carried out, and the result was that the *two-sample* formula above
> understates the paired design's sensitivity. See `results/design_recommendation.md` — the
> frozen configuration uses a larger fleet (240 spaces) at n=60, where the measured MDE is
> 0.52–0.95 pp.

### 5.3 LLM stochasticity — the methodological problem this study must confront directly

**Current Claude models have removed the sampling parameters:** `temperature` / `top_p` /
`top_k` return a **400 error** on `claude-opus-5` and `claude-sonnet-5` (only older-generation
models such as `claude-haiku-4-5` still accept them). That means **"set temperature=0 for
reproducibility" is unavailable to this study**.

This is a design constraint rather than an obstacle, handled as follows:

1. **Treat model stochasticity as a random effect** instead of pretending it does not exist:
   repeat each (policy, load, seed) combination **3 times** (same scenario, same prompt) and
   perform a **variance decomposition**, reporting the **ICC** — the share of total variance
   attributable to the model's own jitter on an identical scenario.
2. Use a **linear mixed-effects model**: `metric ~ strategy * load + (1 | seed)`, treating the
   scenario as a random intercept.
   > Amendment A-1 in `PRE_REGISTRATION.md` corrects this: the correct grouping for this design
   > is `(1 | rho:seed)`, because `generate_requests` redraws per load level. Both are reported.
3. The scenario side is **fully reproducible** (fixed PRNG seeds), isolating irreproducibility
   strictly to the model-call layer.
4. Fix and record: the exact model ID (`claude-opus-5`, with no date suffix),
   `output_config.effort`, a hash of the full prompt, and the SDK version.

**This is itself a contribution worth writing up:** how to run credible repeated experiments on
a new generation of models where sampling temperature cannot be controlled.

---

## 6. Implementation and budget

### 6.1 Architecture

```
harness/
  scenario.py      # seed -> episode (capacities/prices sampled from parking_data.csv, Poisson arrivals)
  policies/
    random.py  fifo.py  greedy.py          # B0 B1 B2 (pure Python, no API calls)
    llm_central.py                          # T1
    llm_negotiate.py                        # T2: broker + user-agents
  validator.py     # hard-constraint validator (does not trust model output)
  metrics.py       # the full metric family from §4
  analyze.py       # the statistics from §5
  runs/            # full JSONL log per episode (prompt / response / usage / decisions)
```

Python plus the `anthropic` SDK. The negotiation loop is hand-written (control flow is fixed at
3 rounds, so an agentic tool runner is unnecessary).

### 6.2 Model choice and cost

Recomputed offline with the implemented harness — see
[llm-allocation-study/results/cost_analysis.md](llm-allocation-study/results/cost_analysis.md).
Scope: compact scenario, 24/36/60 requests x 3 loads x n=30 seeds, both LLM arms (T1+T2).

**The main axis is not model choice; it is the broker's reasoning depth.** Opus 5 bills adaptive
thinking as output tokens, and `output_config.effort` controls it directly:

| Broker thinking tokens per call | T1 subtotal | T2 subtotal | **Grid total** |
|---|---|---|---|
| 0 (thinking off) | $9.65 | $16.32 | **$25.96** |
| 500 | $25.02 | $47.07 | **$72.09** |
| 1500 | $55.77 | $108.57 | **$164.34** |
| 3000 | $101.90 | $200.82 | **$302.71** |

The same experiment can cost $26 or $303 — a factor of 11.7 — and the Batch API's 50% discount
halves whichever figure applies. **The effort level must therefore be fixed as part of the
pre-registration** (the §3.3 effort ablation covers exactly this, and the pilot should first
confirm whether low effort degrades allocation quality).

Cost-engineering levers (themselves part of the GenAI engineering depth):
- **Broker `effort` level:** the only order-of-magnitude lever, per the table above.
- **Batch API:** the simulation is not latency-sensitive, so batch processing gives a **50%
  discount**. Note that batch results return in **arbitrary order** — index by `custom_id`.
- **Prompt caching:** the negotiation protocol and rule text are a stable prefix, so cache hits
  cost about 0.1x. The current implementation caches only the system prompt; the static part of
  the spot menu (id/price/capacity/EV) is still re-sent in every user message and should be
  moved into the cached prefix, leaving only the dynamic free-lane counts at the tail. Verify
  hits with `usage.cache_read_input_tokens` — a zero means a silent invalidator such as a
  timestamp is in the prefix.

**The original argument for "use Haiku 4.5 for user agents to save money" has been refuted by
measurement:** the user-agent side is only **1.4%–2.4%** of T2's cost ($0.01–0.04 per episode,
versus $0.94–1.48 for the broker). At compact scale the broker is called twice per 10-minute
window (tentative, then final), so one episode involves roughly 34 high-effort, long-context
Opus 5 calls — that is where the money goes. So "should the agents also use Opus 5" is **no
longer a budget question worth an instructor's time**: even switching all of them would raise
the total by far less than dropping broker effort from high to medium would lower it.

### 6.3 Experiment B (pricing benchmark, reusing the harness)

Policies plugged into the same harness's pricing slot (the allocator is held fixed at Greedy, so
only price varies):
- P0 static pricing (original CSV prices)
- P1 the production rule surcharge (`server.js:574`'s x1.5, rewritten in the simulation as a
  scale-free "demand > free lanes" trigger)
- P2 **permutation control**: the **same number** of x1.5 surcharges as P1, relocated to
  randomly chosen spots
- P3 (optional GenAI extension) an LLM pricer — not implemented

Primary metric: spot utilization. Design and statistics as in §5.

**Correction to P2's implementation.** The original plan specified "a random multiplier
U[1.0,1.5], matched on mean to P1". But U[1.0,1.5] has a mean of 1.25, which equals P1's mean
only if the surge fires exactly 50% of the time — and the trigger rate is unknown. The
implementation instead **re-uses P1's actual surcharge count in the same window and permutes its
placement**, making the marginal price distribution identical by construction and leaving
"whether contested spots were targeted" as the only variable, at any trigger rate.

### Experiment B is complete (270 episodes, n=30/cell)

Full results:
[pricing_findings.md](llm-allocation-study/results/pricing_findings.md). Three conclusions:

1. **The production rule does not raise utilization — it significantly lowers it** (−3.79% at
   rho=2.0, d=−3.58, p=2.9e−18), with losses growing in contention. This is a **negative result
   on the pre-registered primary metric**.
2. **The revenue gain comes mainly from targeting, not from raising prices:** at matched average
   multipliers, P1 earns **+5.94%** more than P2 (rho=2.0, d=+3.98, p=1.6e−19).
3. **Untargeted increases capture no revenue** — P2 charged 13.8% more on average and revenue
   **fell 0.78%** (p=0.008) — **but this one carries a boundary condition**, see below.

**The utility-parameter sensitivity sweep required by §7 is complete** (5 price-sensitivity
settings varying level and spread independently,
[pricing_sensitivity.md](llm-allocation-study/results/pricing_sensitivity.md)):

| Conclusion | Settings consistent | Disposition |
|---|---|---|
| 1. Utilization drops | **5/5**, magnitude monotone in elasticity | Report unconditionally |
| 2. Targeting beats random surcharges | 4/5 | Report with a boundary condition (fails for a uniformly highly price-sensitive population) |
| 3. Untargeted increases capture nothing | 4/5 under the stated decision rule | Report with the qualifier that it fails for genuinely price-insensitive demand |

The mechanism behind conclusion 3's boundary is clear: **level** decides how much volume an
increase destroys, **spread** decides whether surplus can still be taken from an insensitive
tail. At the **same mean elasticity of 2.0**, the homogeneous population loses 2.14% while the
highly heterogeneous one captures nothing at all.

Either way the permutation control earned its place: without it, running only P0 vs P1 would
have produced "dynamic pricing raises revenue 6.15%" attributed to price — and once separated,
**conclusion 2 proves considerably more robust than conclusion 3**.

---

## 7. Threats to validity

**These must be stated proactively in the proposal, not waited for from a reviewer.**

| Threat | Severity | Mitigation |
|---|---|---|
| **Thin data:** 24 garages, ~24.5 hours, 53 snapshots | High | Claim no external validity beyond Bellevue; bootstrap-resample to extend scenarios; sensitivity analysis over demand-curve shape |
| **I wrote the simulator**, so it could unintentionally favour a policy | High | Policies and simulator are strictly decoupled (slot-based); the simulator and seeds were frozen before policies were implemented; all code and logs are published |
| **I set the user utility function** | High | ✅ **Done** (Exp B, 5 price-sensitivity settings varying level and spread). One conclusion acquired a boundary condition as a result, see §6.3. The same treatment is required for Exp A's utility parameters once it runs |
| **LLM irreproducibility** (no temperature control) | Medium | §5.3's repeated measures + variance decomposition + ICC |
| **Prompt sensitivity:** conclusions could be an artifact of prompt engineering | Medium | Fix and freeze prompts via a pilot before the main run; additionally run 2 paraphrased prompts as a robustness check |
| **Model version drift** | Medium | Pin the model ID; record `response.model` and `_request_id` for every call |
| **The success-rate/fairness tradeoff is unavoidable** | Low | Declare both primary metrics in advance; no post-hoc selection |

---

## 8. Compliance and reproducibility

- **Data:** `parking_data.csv` is already-collected public quote data containing **no personal
  information**. The research phase uses only static snapshots; the `parking.py` scraper is not
  re-run — it hits Parkopedia's internal API, and the ToS risk of continued scraping is not
  worth carrying for a course project. This is stated in the proposal's limitations.
  OpenStreetMap data is ODbL-licensed and frozen into the repository.
- **Reproducibility package:** seeds, full prompts, model IDs, all per-episode JSONL logs, and
  the analysis scripts are submitted together.
- **Cost transparency:** per-episode token and dollar cost are measured from `response.usage`
  and reported as part of the results.

---

## 9. Timeline (8 weeks from 2026-09-21)

| Week | Dates | Milestone | Deliverable |
|---|---|---|---|
| W1 | 09/22–09/28 | Proposal finalised and submitted; harness interfaces frozen | This document, v2 |
| W2 | 09/29–10/05 | Simulator + B0/B1/B2 implemented and validated | Baseline distributions (n=200) |
| W3 | 10/06–10/12 | T1/T2 protocol + validator; **pilot n=5** | Measured variance and cost |
| W4 | 10/13–10/19 | Recompute power, **freeze the design (pre-registration)** | Pre-registration document |
| W5–W6 | 10/20–11/02 | Full run (Batch API) | 450+ episode logs |
| W7 | 11/03–11/09 | Statistical analysis + Experiment B | Figures and test results |
| W8 | 11/10–11/16 | Write-up | Final report |

**W4's pre-registration is the most important step in this design:** the primary metrics, n, and
the testing methods must be settled before any full results are seen.

---

## 10. Pre-submission self-review checklist

- [x] **One-sentence research question** — §0
- [x] **Explicit data source / simulation method** — §0 (1,104 rows of real data + a calibrated
      simulator + real OSM coordinates)
- [x] **Baselines explicit and not straw men** — B1 is the real production implementation, B2 is
      a strong algorithmic baseline, B0 is the floor, T1 is the ablation
- [x] **Genuine generative-AI depth** — the multi-agent negotiation protocol, structured-output
      constraints, a variance-decomposition methodology for a world without `temperature`, and
      cost engineering
- [x] **Capable of producing negative results** — H1's expected direction is "the LLM is not
      better"; H3 expects LLM-specific failure modes; Experiment B's same-mean random baseline
      exists specifically to refute P1 (and in the event, it revised one of my own conclusions)
- [ ] **For the instructor to confirm:** whether n=60/cell is acceptable; which broker `effort`
      levels to sweep (this directly sets the $26–$303 budget, §6.2); whether Experiment B
      stands as the secondary experiment

---

## 11. Open questions for you or the instructor

1. **Required rigour for this course.** If real user data is required, 24 garages over ~24.5
   hours may not suffice — I need to confirm whether "simulation calibrated on real price data"
   is accepted as a legitimate data source.
2. **Whether human subjects are needed.** If permitted, a small human-in-the-loop study (users'
   *perceived* fairness of LLM-negotiated allocations vs. the objective Jain's index) would
   strengthen the contribution considerably, but would introduce an IRB process.
3. **The broker's effort level.** This is now the only decision that materially affects the
   budget (§6.2). Recommendation: during the pilot, run a few episodes at each of
   effort in {low, medium, high}, confirm whether the low setting degrades allocation quality,
   then freeze.

### Resolved during implementation (recorded here to avoid re-litigating)

- ~~**The cap on T2's agent count:** 30 user-agents is a cost/realism compromise~~ →
  **Resolved.** Not by reducing the request count (which would strip rho of its demand/supply
  meaning and eliminate contention altogether) but by **scaling supply proportionally**
  (`load_spots(target_total_capacity=30)`, retaining all 24 real garages with their price,
  distance, and EV diversity), so rho keeps its meaning. A **scale validation** was then run,
  with classical baselines at 270 episodes per scale: strategy ordering held in 6/6 (metric,
  rho) cells, with a maximum mean deviation of 0.121
  ([scale_validation.md](llm-allocation-study/results/scale_validation.md)).
  **Caveat added later:** that validation covers effect magnitude and ordering, **not**
  statistical precision — measured MDE is 3.00 pp at 30 spaces versus 0.68 pp at full scale,
  which is why the frozen configuration uses a 240-space fleet
  ([design_recommendation.md](llm-allocation-study/results/design_recommendation.md)).
- ~~**Whether user agents may use Haiku 4.5**~~ → **No longer a budget question**; the agent side
  is 1.4%–2.4% of cost, see §6.2.
- ~~**Synthetic garage coordinates**~~ → **Replaced with real OpenStreetMap coordinates** after
  measurement showed the synthetic placement was wrong (median 554 m real vs. 744 m synthetic, KS
  D=0.301, p=1.2e−06). Logged as Amendment A-2 in `PRE_REGISTRATION.md`, including the
  consequence that contradicted my own prediction: the effect was differential rather than a
  shared shift, narrowing the greedy-minus-FIFO gap by 19–37%.
