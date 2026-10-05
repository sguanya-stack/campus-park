# Progress Report — LLM Multi-Agent Negotiation vs. Classical Schedulers for Parking Allocation

**Student:** Guanya Song (song.guany@northeastern.edu)
**Date:** 2026-09-23
**System under study:** CampusPark, a parking reservation platform I built (Node.js + Prisma + PostgreSQL)

---

## 1. Research question

> In a contended parking-allocation setting calibrated on real parking-market data, does
> LLM-driven multi-agent negotiation differ from greedy / first-come-first-served scheduling
> in **allocation success rate** and **fairness** — and what does it cost, including failure
> modes classical schedulers cannot exhibit?

A secondary experiment (B) asks whether the dynamic pricing rule already running in
CampusPark actually improves spot utilization.

---

## 2. Status at a glance

| Component | Status |
|---|---|
| Simulator (real-data loader, seeded scenario generation, interval-scheduling engine) | **Complete** |
| Classical baselines: Random, FIFO, Greedy | **Complete** — 1,080 episodes across three fleet scales |
| Scale validation (does a smaller fleet reproduce the phenomenon?) | **Complete** |
| Power analysis from measured variance | **Complete** |
| **Experiment B — dynamic pricing benchmark** | **Complete, with results** (§4) |
| **Experiment B sensitivity analysis** | **Complete — it overturned one of my own findings** (§4.3) |
| LLM policies T1 (single-shot allocator) and T2 (3-round negotiation) | Implemented and tested offline; **no real API call has been made yet** |
| **Experiment A — the main LLM comparison** | **Design frozen and pre-registered; not yet run** |
| Production serving layer (breaker, fallback, observability, HTTP service) | **Complete** (§6) |
| Test suite (75 tests) and CI | **Complete** — zero-cost, network-blocked |
| Low-cost pilot plan | **Complete** — ~$6 in four steps, each with a stop condition |

**Honest bottom line:** Experiment B is finished and has publishable results. Experiment A is
fully built, pre-registered, and blocked on one thing only — API budget/credentials
(~$748 estimated, ~$374 using the Batch API). No LLM result exists yet, and nothing in this
report claims one.

---

## 3. Data and simulator

**Real data.** 1,104 parking quotes scraped from Parkopedia covering **24 garages** in
Bellevue, WA across **53 time snapshots** (2026-03-20 to 03-21). Prices range \$4.49–\$37.10
(median \$8.74).

I also extracted a signal that is not an explicit column: a garage that returns no quote in a
given snapshot was most likely *full*, so each garage's appearance rate (17/53 to 53/53)
serves as a real-data proxy for how frequently it is contended.

**Synthetic fields, documented rather than hidden.** The feed carries no capacity,
coordinates, or EV flag. These are derived deterministically from the garage ID and are
listed field-by-field in `data_provenance.md`. This is a genuine limitation, recorded in the
threats-to-validity table rather than glossed over.

**Simulator.** Each episode is a 3-hour peak window with Poisson arrivals; requests carry
heterogeneous duration, trip value, price sensitivity, walk tolerance, and EV need. Spots are
modeled as capacity-many lanes under interval scheduling — the real hard constraint (you
cannot double-book a physical space). Scenario generation is fully seeded and byte-identical
across arms, giving a **paired design**.

---

## 4. Experiment B — dynamic pricing (complete)

**Design.** The allocator is held fixed at Greedy; only price varies. 270 episodes
(3 arms × 3 load levels × 30 seeds).

| Arm | Definition |
|---|---|
| P0 static | Real CSV prices, unchanged |
| P1 rule surge | ×1.5 on contested spots — CampusPark's production rule (`server.js:574`), rewritten scale-free |
| P2 permuted | The **same number** of ×1.5 surcharges P1 applied that window, relocated to randomly chosen spots |

**Why P2 rather than "a random multiplier with the same mean."** My original proposal
specified U[1.0, 1.5] as the control, on the grounds that it matches P1's mean. It does not:
U[1.0, 1.5] has mean 1.25, which equals P1's mean only if the surge fires exactly 50% of the
time, and the trigger rate is unknown. Re-using P1's realized surge *count* and permuting only
its placement makes the marginal price distribution identical **by construction** at any
trigger rate (verified: mean multipliers 1.144 vs 1.143), leaving targeting as the sole
difference.

### 4.1 Result: the production rule reduces utilization

Utilization was the pre-registered primary metric for this experiment. The result runs
opposite to my hypothesis.

| ρ | Δ utilization (P1 vs P0) | Cohen's d | p |
|---|---|---|---|
| 0.8 | −1.31% | −1.24 | 1.8e−07 |
| 1.2 | −1.02% | −1.02 | 4.7e−06 |
| 2.0 | **−3.79%** | −4.09 | 2.9e−18 |

Losses grow with contention. The rule is better described as trading utilization for revenue
than as an efficiency mechanism.

![Figure 1: Experiment B utilization and revenue](llm-allocation-study/results/figures/fig1_pricing.svg)

**Figure 1.** The surge rule lowers utilization at every load and buys revenue instead. Two measures, two panels — never one dual axis.


### 4.2 Result: the revenue gain comes from targeting, not from the price increase

At matched average multipliers, aiming surcharges at contested spots earned **+5.94% over the
permutation control** (ρ=2.0, d=+3.98, p=1.6e−19). Without P2, the natural reading would have
been "dynamic pricing raises revenue 6%," crediting the price lever.

### 4.3 A finding I reported and then overturned myself

I initially treated a third result as the sharpest: untargeted price increases captured no
revenue (P2 charged 13.8% more on average yet revenue *fell* 0.78%, p=0.008).

Because price sensitivity is a **set, not measured** parameter, I ran the sensitivity sweep my
proposal's threats-to-validity table called for — five settings, varying both the *level* and
the *spread* of price sensitivity, holding every other request attribute byte-identical.

| Conclusion | Holds in | Disposition |
|---|---|---|
| Surge reduces utilization | **5/5**, magnitude monotone in elasticity | Report unconditionally |
| Targeting beats matched-price random | 4/5 | Report **with a boundary condition** (fails for a uniformly highly price-sensitive population) |
| Untargeted increases capture no revenue | **4/5** (1 significant counter-example) | Holds **with a boundary condition**: fails only for a genuinely price-insensitive population |

The mechanism is interpretable: *level* determines how much volume a price increase loses,
while *spread* determines whether surplus can still be extracted from an insensitive tail. At
the **same mean elasticity of 2.0**, a homogeneous population lost 2.14% while a highly
heterogeneous one gained 0.77%. The baseline setting happens to sit near the sign-flip point.

Settling this requires real price-elasticity data from CampusPark (conversion at different
price points), not more simulation. I have corrected the claim everywhere it appeared.

![Figure 2: the sign flip in the sensitivity sweep](llm-allocation-study/results/figures/fig2_sensitivity.svg)

**Figure 2.** The conclusion I revised myself. Across five elasticity settings the contrast is significantly contradicted once — the genuinely price-insensitive population, where blanket pricing really does pay. Note the last two rows: at the **same mean elasticity (2.0)** the homogeneous population loses 2.14% while the highly heterogeneous one captures nothing at all (+0.07%, n.s.). Spread decides whether any surplus is left to take; level decides how much volume a hike destroys.


---

## 5. Experiment A — design frozen, awaiting execution

The full pre-registration is in `PRE_REGISTRATION.md`, written before any LLM API call.

**Arms.** B0 Random (floor) · B1 FIFO (mirrors the production atomic-reservation transaction)
· B2 Greedy (strong online baseline) · T1 LLM single-shot central allocator (**ablation** —
isolates reasoning from negotiation) · T2 LLM 3-round multi-agent negotiation (treatment).

**Configuration.** Fleet scaled to 240 spaces; ρ ∈ {0.8, 1.2, 2.0} (192/288/480 requests);
n=60 seeds main grid, n=20 for the effort ablation; broker = Claude Opus 5, per-user agents =
Claude Haiku 4.5; strict JSON-schema tool calling throughout.

**Pre-registered commitments.**
- Primary metrics fixed in advance: success rate, Jain's fairness index. Secondary family
  corrected separately (Holm–Bonferroni).
- **Explicit falsification criteria for each hypothesis**, including the rule that a
  non-significant result is *not* evidence of equivalence — if the CI spans ±MDE the outcome
  is recorded as "underpowered to decide," per load level.
- Stopping rules: no interim peeking, no adding seeds after seeing results, no retrying
  failed episodes, no repairing illegal allocations.
- **SHA-256 fingerprints of every prompt and tool schema are recorded**, so post-hoc prompt
  tuning would be detectable.

**Measured power at the frozen configuration** (classical arms already run, 540 episodes):

| Metric | ρ=0.8 | ρ=1.2 | ρ=2.0 |
|---|---|---|---|
| success_rate MDE | 0.95 pp | 0.80 pp | 0.63 pp |
| jains_index MDE | 0.80 pp | 0.58 pp | 0.52 pp |

Pairing reduces variance ~74%. These come from deterministic policies and therefore capture
scenario variance only; the LLM arms add model stochasticity, so power will be recomputed from
pilot data before the main grid is trusted.

---

## 6. From study to deployable system

Stopping at "which policy scores better" would miss the practical question: **hypothesis H3
says the LLM produces allocations a classical scheduler structurally cannot** — hallucinated
spot IDs, double bookings, EV mismatches. A system that trusts model output will genuinely
sell the same physical parking space twice. So the finding was turned into a deployable
engineering layer.

### 6.1 A contradiction that had to be handled

Pre-registration §5 **forbids** retrying failed episodes and **forbids** repairing illegal
allocations, because both would erase the failure mode this study measures. Production has
the opposite obligation: it must retry, must fall back, must always return an answer.

These cannot both hold in one codebase. So `serving/` **wraps without modifying**
`harness/policies/`: the research path stays word-for-word as pre-registered, and the safety
net sits outside it.

### 6.2 Layering

```
request
  -> cost ceiling guard     refuse to call the model past a budget
  -> circuit breaker        skip the model entirely once it is failing
  -> deadline + bounded retry
  -> LLM policy             harness/, untouched
  -> validator gate         the SAME validator the experiment scores with;
                            illegal allocations are dropped, never repaired
  -> Greedy fallback        re-decide everything the model lost
  -> telemetry              p50/p95 latency, cost, illegal rate, degradation rate
```

The service is standard library only (no framework), matching CampusPark's own `server.js`.
Measured behavior with **no API key present**: `/healthz` returns 503 and states
`status=degraded, breaker=open`; `/allocate` still returns a usable answer via Greedy, marked
`degraded=true`. **It degrades rather than crashing, and reports its own degradation
honestly.**

### 6.3 Tests and CI

All 75 tests run against a stub client, and `conftest.py` **hard-blocks outbound sockets** —
a test that started calling the real API would bill every push, so that is made mechanically
impossible rather than merely discouraged.

CI, with no API key, checks five things: tests pass, **two independent runs are byte-identical**,
classical policies produce zero illegal allocations, **prompt fingerprints still match the
pre-registration** (making post-hoc prompt tuning detectable), and the service degrades
gracefully without a key.

### 6.4 The engineering layer caught two bugs of its own

**(a) The timeout was decorative.** `with ThreadPoolExecutor(...)` calls `shutdown(wait=True)`
on exit, blocking until the hung worker returns — the deadline fired correctly but the caller
still waited the full 5 seconds. A test asserting "the caller must not wait for a hung model"
caught it (asserted <3s, measured 5.02s). That class of defect is an incident in production.

**(b) My own CI reproducibility check was wrong.** Diffing two result CSVs directly always
fails, because `decision_latency_s` is wall-clock. Running the CI steps locally first surfaced
it; otherwise every push would have gone red.

### 6.5 Low-cost pilot

Before committing to the ~$748 full grid, ~**$6** across four steps, each with an explicit
stop condition: does the API path work at all ($0.02), how accurate is the cost estimate and
what is the illegal-allocation rate ($1), **does the negotiation revision round actually
fire** ($1.8), and does model variance invalidate the n=60 power claim ($3). The last matters
most: if model jitter is comparable to the classical arms' paired-difference SD, the frozen
MDE is optimistic — and the response is **not** to quietly add seeds (pre-registration forbids
it) but to revise the sample size, record the reason, and re-freeze.

---

## 7. Methodological points I would highlight

**Reproducibility without `temperature`.** Current Claude models reject the `temperature`
parameter outright (HTTP 400), so the standard "set temperature=0 for determinism" protocol is
unavailable. Rather than ignore the problem, the design isolates and *measures* stochasticity:
scenario generation is fully seeded, each cell is replicated three times, and variance is
decomposed via a linear mixed-effects model reporting the intraclass correlation — i.e. how
much of total variance is the model's own jitter.

**Scale validation, and a limit on what it proves.** The LLM arms cannot be afforded at full
size, so supply and demand are shrunk together (preserving ρ's meaning). Before relying on
this, classical baselines were run at both scales: strategy ordering held in 6/6 (metric, ρ)
cells, max mean deviation 0.121. **However**, I initially over-claimed from this: it validates
effect *magnitude and ordering*, not statistical *precision*. Measured MDE is 2.57 pp at the
small scale versus 0.79 pp at full scale — which is why the frozen configuration uses a larger
fleet than originally planned.

![Figure 3: scale validation across two fleet sizes](llm-allocation-study/results/figures/fig3_scale.svg)

**Figure 3.** The shrink preserves the strategy ordering (6/6 cells), max mean deviation 0.121.

![Figure 4: minimum detectable effect by fleet size](llm-allocation-study/results/figures/fig4_mde.svg)

**Figure 4.** But it does not preserve precision. This corrects an earlier claim of mine:
Figure 3 validates magnitude and ordering, not statistical power.

**Failure modes are measured, not repaired.** An independent validator re-checks every
allocation against the hard constraints. Illegal LLM output is recorded and rejected, never
patched — patching it would erase the exact quantity hypothesis H3 is about.

**Two bugs caught before they could contaminate results.** (a) The LLM commit path did not
enforce the same acceptance threshold the classical policies apply, which would have let a
negative-utility match count as a "success" for LLM arms only, making success rates
incomparable across conditions. (b) A tool-name mismatch silently disabled T2's negotiation
revision round entirely. Both were found via a zero-cost dry-run harness using a stub API
client, before any money was spent.

**Cost reasoning corrected by measurement.** Offline profiling showed spend is dominated by
broker reasoning tokens (an 11.7× swing, \$26–\$303 for the same grid), while the per-agent
model choice my proposal had emphasized accounts for only 1.4–2.4%. Reasoning effort is
therefore treated as an experimental factor (does more reasoning buy better allocations?) and
not merely a cost dial.

---

## 8. Questions I would like your guidance on

1. **Data sufficiency.** Is "discrete-event simulation calibrated on real price data" an
   acceptable data source for this course, or is real user interaction data required? The
   honest limitation is 24 garages over ~24.5 hours, with capacity/geography/EV synthesized.
2. **Reporting the overturned finding (§4.3).** My inclination is to report it prominently as
   a sensitivity result rather than delete it, since the mechanism is interesting and the
   episode demonstrates the value of the control. Would you prefer it in the main results or
   an appendix?
3. **Sample size.** Is n=60 per cell (MDE ≈ 0.5–0.95 pp on the classical arms) acceptable,
   given that the LLM arms will be somewhat noisier?
4. **Scope of Experiment A.** Should the effort ablation (does deeper reasoning improve
   allocation quality?) stay in scope, or is the T1-vs-T2 negotiation ablation enough?
5. **Human-subjects extension.** A small study on whether users *perceive* LLM-negotiated
   allocations as fairer than Jain's index suggests would strengthen the contribution, but
   would require IRB. Is that feasible within the term?

---

## 9. Artifacts

| Path | Contents |
|---|---|
| `research_proposal_llm_allocation.md` | Full proposal, updated as findings corrected it |
| `llm-allocation-study/PRE_REGISTRATION.md` | Frozen Experiment A design, falsification criteria, prompt fingerprints |
| `llm-allocation-study/PILOT_PLAN.md` | Four-step, ~$6 pilot with explicit stop conditions |
| `llm-allocation-study/harness/` | Simulator, 5 allocation policies, validator, metrics, analysis tooling |
| `llm-allocation-study/serving/` | Production layer: breaker, validator gate, fallback, telemetry, HTTP service |
| `llm-allocation-study/tests/` | 75 tests, all stub-client, outbound network blocked |
| `.github/workflows/ci.yml` | CI: tests, reproducibility, zero illegal allocations, prompt fingerprints, degradation |
| `llm-allocation-study/results/pricing_findings.md` | Experiment B results and limitations |
| `llm-allocation-study/results/pricing_sensitivity.md` | The five-setting sweep and the overturned finding |
| `llm-allocation-study/results/scale_validation.md` | Small-fleet vs full-fleet comparison |
| `llm-allocation-study/results/design_recommendation.md` | Power/cost analysis behind the frozen configuration |
| `llm-allocation-study/results/cost_analysis.md` | Inference cost structure |
| `llm-allocation-study/data_provenance.md` | Field-by-field real vs synthetic accounting |

All experiments are reproducible from seeds; every result in this report can be regenerated
with the commands in each document.
