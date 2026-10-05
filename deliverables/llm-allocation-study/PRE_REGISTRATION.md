# Experiment A pre-registration (design frozen)

**Frozen:** 2026-09-23
**Status: written before any Experiment A result was seen. At the time of freezing, T1 and T2
had never made a single real API call.**

This is the W4 milestone from the proposal's timeline (§9). The entire point of a
pre-registration is that the primary metrics, the sample size, the statistical plan, and
**what counts as support versus refutation** are fixed before the data exists — otherwise
post-hoc selection cannot be ruled out.

---

## 1. The frozen configuration

| Item | Value | Rationale |
|---|---|---|
| Fleet size | `--target-capacity 240` (24 real garages scaled to 240 spaces) | At 30 spaces the MDE is 3.00 pp, which would report a real 2 pp difference as "not significant" |
| Load rho | 0.8 / 1.2 / 2.0 | 192 / 288 / 480 requests |
| Seeds, main grid | n = 60 (seeds 1–60) | See measured power below |
| Seeds, ablation grid | n = 20 (seeds 1–20) | The effort ablation is a secondary question; it only needs to detect large effects |
| Arms | B0 random, B1 fifo, B2 greedy, T1 llm_central, T2 llm_negotiate | |
| Broker model | `claude-opus-5` | |
| User-agent model | `claude-haiku-4-5` | Only 1.4–2.4% of T2 cost; not a budget decision |
| Main-grid effort | `high` | |
| Ablation effort | `low`, `medium` | |
| Decision window | 10 minutes | |
| Negotiation rounds (T2) | 3 (bid → tentative + revision → final) | |
| Replicates (LLM arms) | 3 per (arm, rho, seed) | Required by the variance decomposition in §4 |

**Paired design:** every arm sees the same seeds, and therefore byte-identical scenarios.

### Measured power (classical arms already run at this configuration, 540 episodes)

Paired-difference SD taken from fifo vs greedy — the closest pair, and the most relevant
reference for an LLM comparison. alpha=0.05, power=0.80, two-sided paired t-test:

| Metric | rho=0.8 | rho=1.2 | rho=2.0 |
|---|---|---|---|
| success_rate MDE | 0.95 pp | 0.80 pp | **0.63 pp** |
| jains_index MDE | 0.80 pp | 0.58 pp | **0.52 pp** |

Pairing reduces variance by roughly 74% relative to the unpaired pooled SD.

**These figures come from deterministic policies and capture scenario variance only.** The LLM
arms add model stochasticity on top, so their real MDE will be larger. Power must be
recomputed from pilot data (§6, item 3). This section establishes that precision on the
classical side is sufficient; it is **not** a commitment about power for the LLM arms.

### Prompt and schema fingerprints (to make post-hoc prompt tuning detectable)

Recorded before any real episode ran. If these hashes change after results are collected, the
prompts were edited and the results must be discarded and re-run.

| Object | sha256[:16] |
|---|---|
| T1 system prompt | `e3cfd6c8d2ae8db0` |
| T2 agent system prompt | `f3b9fa5605da3716` |
| T2 broker system prompt | `c3f7f5a542080738` |
| `submit_allocation` schema | `cb7fed34d83e9002` |
| `submit_bid` schema | `11ac97ec4cb16451` |
| `submit_tentative_allocation` schema | `2064efed20f1d535` |

Recomputation command at the end of this file. CI also checks them on every push.

---

## 2. Pre-declared metrics

**Primary metrics (only these two):** `success_rate`, `jains_index`.

**Secondary family** (Holm–Bonferroni corrected *separately*, so it cannot borrow significance
budget from the primary family): `gini`, `worst_decile_utility`, `social_welfare`,
`utilization`, `illegal_allocation_rate`, `parse_failure_rate`, `decision_latency_s`,
`cost_usd`.

`worst_decile_utility` saturates at 0 whenever the failure rate exceeds 10% (a known floor
effect). It is expected to do so again here, and will be reported as uninformative rather than
interpreted.

---

## 3. Hypotheses and **refutation criteria**

Writing down in advance what would count as refutation is the most important part of this
document.

### H1 (success rate)
T2's success rate is **not better than** B2 greedy.

- **Supports H1:** the upper bound of the 95% CI on T2 − B2 is below +1.1 pp (the measured MDE
  at that load), or the difference is significantly negative.
- **Refutes H1:** T2 is significantly higher than B2 (Holm-corrected p<0.05) and the effect
  exceeds the MDE at that load.
- Note: **"not significant" does not mean "equivalent."** If the CI spans ±MDE, the outcome is
  recorded as "underpowered to decide", not as support for H1. **This distinction must be
  stated explicitly per load level, not glossed as "no significant difference."**

### H2 (fairness)
T2's Jain's index is **significantly better** than both B1 fifo and B2 greedy, and the
advantage grows with rho.

- **Supports H2:** the T2 − B2 difference in jains_index is significantly positive at rho=2.0,
  and the rho x arm interaction term is significant.
- **Refutes H2:** the difference is not significant, or is negative.
- This is the hypothesis most likely to fail, and also the most valuable negative result.

### H3 (failure modes unique to the LLM)
T1/T2's `illegal_allocation_rate` is **significantly greater than 0**; classical policies are
structurally zero.

- **Supports H3:** one-sided exact binomial test, p<0.05.
- **Refutes H3:** the rate is 0, which would mean strict schemas plus a code validator fully
  close this risk — a result of equal practical value.

### H4 (marginal value of reasoning depth; ablation)
Higher effort does **not** produce better allocations.

- **Supports H4:** high vs low is non-significant on both primary metrics.
- **Refutes H4:** high is significantly better than low.
- Either direction is reportable. If H4 holds, the direct implication is to deploy at the cheap
  effort level.

---

## 4. Statistical plan (fixed in advance)

- **Primary tests:** paired t-test (success_rate) and Wilcoxon signed-rank (jains_index, which
  is bounded and non-normal).
- **Effect sizes:** Cohen's d on paired differences and Cliff's delta, both with 10,000-sample
  bootstrap 95% CIs.
- **Multiple comparisons:** Holm–Bonferroni within the primary metric family, family-wise
  alpha = 0.05. The secondary family is corrected separately.
- **Interaction:** two-way ANOVA (arm x rho).
- **Model stochasticity:** 3 replicates per (arm, rho, seed), analysed with a linear
  mixed-effects model `metric ~ arm * rho + (1|seed)` to separate scenario variance from model
  jitter, reporting the ICC. (`claude-opus-5` rejects the `temperature` parameter, so
  determinism via temperature=0 is unavailable; this is the substitute.)
  **See Amendment A-1 below: that random-effect structure is wrong, but the original text is
  preserved.**
- **Handling replicates in the paired tests:** the unit of analysis is an (arm, rho, seed)
  cell, and replicates are averaged within the cell before pairing. Replicates reduce that
  cell's measurement error; they are not additional independent observations, and treating them
  as such would inflate n and understate p-values. The raw replicates are used only by the
  variance decomposition.

---

## 4b. Amendment log

After freezing, any change must be recorded here. The original text is never rewritten.

### Amendment A-1 (2026-09-30, **before any real API call**)

**Problem.** The random-effect structure in §4, `(1|seed)`, does not match how scenarios are
generated. `generate_requests(spots, rho, seed)` redraws for each rho (both the request count
and the random stream differ), so **one seed at three load levels is three unrelated
scenarios**, not three observations of one scenario. Grouping by seed cannot represent the
scenario effect and pushes it into the residual, **understating the ICC**.

**Evidence.** Three estimators tested against synthetic data with a known ICC
(`tests/test_variance_analysis.py`, reproducible):

| True ICC | Direct decomposition | `(1\|rho:seed)` | **`(1\|seed)` (as written)** |
|---|---|---|---|
| 0.962 | 0.965 | 0.965 | **0.223** |
| 0.800 | 0.811 | 0.811 | **0.178** |
| 0.500 | 0.510 | 0.510 | **0.100** |

**Resolution.** The original text stands. `harness/variance_analysis.py` **computes and
reports both groupings**, treating `(1|rho:seed)` and the direct empirical decomposition as
authoritative while listing `(1|seed)` for fidelity to the pre-registration, with the direction
of its bias stated. Separately, rho is removed as a fixed factor before estimating scenario
variance (otherwise the roughly 8 pp success-rate shift across load levels would be charged to
it).

**Why this does not weaken the pre-registration.** It was made before any real LLM call, so it
cannot have been influenced by results; and it changes no hypothesis, primary metric, sample
size, or stopping rule — it corrects an implementation error in one estimator.

### Amendment A-2 (2026-10-05, **before any real API call**)

**Problem.** The simulator placed the 24 garages by hashing `location_id` and sampling
uniformly by area inside a 1 km disc around the anchor. Compared against real OpenStreetMap
parking features, that model is **measurably wrong**: real parking sits at a median of 554 m
from the destination anchor, while uniform-by-area placement gives 744 m (KS test D=0.301,
p=1.2e−06). Because the utility function penalises walking beyond a tolerance, the bias
systematically inflated walk costs.

**Resolution.** Switched to real OSM coordinates (`data/osm_parking_bellevue.json`, 156
features, the same 1 km disc the scraper queried, frozen into the repository for
reproducibility). The 24 garages are assigned coordinates by shuffling with a fixed seed and
dealing out in `location_id` order — **the spatial distribution is real, the id-to-coordinate
correspondence is arbitrary**, because Parkopedia ids cannot be matched to OSM features (only 8
of 156 are even named). Capacity and EV flags **remain synthetic** (only 6 of 156 features
carry a `capacity` tag).

**Consequences (everything was re-run and is reported as found):**

- All three Experiment B conclusions **kept their direction**: utilization −3.54% →
  **−3.79%**; P1 vs P2 revenue +6.92% → **+5.94%**; P2 vs P0 revenue −0.72% → **−0.78%**.
- Strategy ordering held at all three scales and all load levels.
- **But the effect was differential, not a shared shift — my own prediction was wrong.**
  Greedy fell 2–6 pp across the board while FIFO mostly rose; the greedy-minus-fifo gap
  narrowed by **19–37%**. The mechanism is sensible: real parking clusters, which makes the
  best *available* alternative resemble the first choice — and that resemblance is exactly what
  erodes Greedy's advantage.
- **The implication for Experiment A must be faced:** if real geography compresses the
  differences between allocation strategies, the LLM-vs-Greedy effect is likely smaller than
  the synthetic geography implied, so the frozen n=60 is less adequate than §1 suggests. Power
  must be recomputed honestly after the pilot.
- Scale validation **weakened**: max mean deviation between the compact and full fleets went
  0.052 → **0.121** (ordering still 6/6).

**Why this does not weaken the pre-registration.** It was made before any real LLM call, so it
cannot have been influenced by LLM results; it changes no hypothesis, primary metric, test, or
stopping rule; and it makes the simulator more faithful rather than more favourable to any arm
— in fact it *weakened* the strongest baseline, Greedy, which is no favour to the treatment.
The complete pre-change snapshot is retained in `results/_pre_osm/` for audit.

---

## 5. Stopping rules and prohibitions

- **No interim looks.** No statistical test is run until the full grid is complete.
- **No adding seeds because the result is unsatisfying.** n is frozen here. If a larger sample
  later proves genuinely necessary, it must be reported as a separate, clearly labelled
  secondary analysis and never merged with the pre-registered result.
- **No re-running failed episodes.** API errors and parse failures are recorded per the
  pre-set rule (the window's requests count as unsatisfied, `parse_failure_rate` increments),
  with no retry and no discard.
- **No repairing illegal allocations.** An allocation violating a hard constraint is rejected
  and counted in `illegal_allocation_rate`.
- **No post-hoc prompt editing.** Fingerprints are in §1.

---

## 6. Planned sensitivity analyses (declared in advance, not retrofitted)

1. A five-setting sweep of the utility parameter (price sensitivity), on the same basis as the
   completed Experiment B sweep.
2. Prompt-robustness: after the main run, re-run T2 at rho=1.2, n=20 with two
   semantically-equivalent prompt rewrites, and check the direction of the conclusions.
3. Recompute power from the LLM arms' own data after the pilot. The MDEs in §1 come from
   deterministic policies and contain scenario variance only, so they are optimistic for the
   LLM arms.

---

## 7. Budget

| Stage | Configuration | Estimate |
|---|---|---|
| Main grid | effort=high, n=60 | $553 |
| Ablation | effort=medium, n=20 | $111 |
| Ablation | effort=low, n=20 | $83 |
| **Total** | | **$748** (about $374 with the Batch API) |

These come from `harness/estimate_cost.py` (a chars/4 heuristic plus an assumed thinking-token
budget) and are **not** a bill. The first step is a single pilot episode to calibrate the real
`cost_usd`; if it is off by more than a factor of 2, return to this file, revise the budget,
and re-freeze.

---

## 8. Execution order

```bash
export ANTHROPIC_API_KEY=sk-ant-...
cd deliverables/llm-allocation-study

# Step 1: single pilot episode, to calibrate real cost (about $1)
python3 -m harness.run_experiment --strategies llm_central --loads 1.2 --n-seeds 1 \
  --target-capacity 240 --efforts high --full-logs --out-name pilot_t1
# inspect cost_usd and illegal_allocation_rate in results/pilot_t1.csv

# Step 2: T2 pilot (longer chain; verify it once on its own first)
python3 -m harness.run_experiment --strategies llm_negotiate --loads 1.2 --n-seeds 1 \
  --target-capacity 240 --efforts high --full-logs --out-name pilot_t2

# Step 3: classical baselines at the same configuration (free, for pairing)
#   COMPLETE as of 2026-09-23 -- results/expA_classic.csv (540 episodes); power in §1
python3 -m harness.run_experiment --strategies random,fifo,greedy --loads 0.8,1.2,2.0 \
  --n-seeds 60 --target-capacity 240 --out-name expA_classic

# Step 4: main grid (--replicates 3 is required by the §4 variance decomposition)
python3 -m harness.run_experiment --strategies llm_central,llm_negotiate \
  --loads 0.8,1.2,2.0 --n-seeds 60 --target-capacity 240 --efforts high \
  --replicates 3 --out-name expA_llm_high

# Step 5: effort ablation
python3 -m harness.run_experiment --strategies llm_central,llm_negotiate \
  --loads 0.8,1.2,2.0 --n-seeds 20 --target-capacity 240 --efforts low,medium \
  --replicates 3 --out-name expA_llm_ablation

# Step 6: combine (rejects mixed scenario sizes and duplicated rows)
python3 -m harness.combine_results \
  results/expA_classic.csv results/expA_llm_high.csv results/expA_llm_ablation.csv \
  --out results/expA_combined.csv

# Step 7: analysis (run once, no interim looks)
python3 -m harness.analyze           --csv results/expA_combined.csv --out results/expA_report.md
python3 -m harness.variance_analysis --csv results/expA_combined.csv --out results/expA_variance.md
python3 -m harness.power_analysis    --csv results/expA_combined.csv --out results/expA_power.md
```

> The whole pipeline has been rehearsed end to end against a stub client (270 rows, 3
> replicates, classical plus both LLM arms across three effort levels), and all four analysis
> steps produced output. The rehearsal surfaced two defects that would have corrupted the real
> analysis: pandas parses `effort="n/a"` as NaN, silently dropping every classical-arm row from
> groupbys; and the paired tests crashed on unequal lengths once replicates existed (now
> averaged within the cell).

---

## 9. Recomputing the prompt fingerprints

```bash
python3 -c "
import hashlib, json
from harness.policies.llm_central import SYSTEM_PROMPT as T1
from harness.policies.llm_negotiate import AGENT_SYSTEM_PROMPT, BROKER_SYSTEM_PROMPT
from harness.policies.llm_common import ALLOCATION_TOOL
from harness.policies.llm_negotiate import AGENT_BID_TOOL, BROKER_TENTATIVE_TOOL
h=lambda s: hashlib.sha256(s.encode() if isinstance(s,str) else json.dumps(s,sort_keys=True).encode()).hexdigest()[:16]
for n,o in [('T1',T1),('agent',AGENT_SYSTEM_PROMPT),('broker',BROKER_SYSTEM_PROMPT),('alloc',ALLOCATION_TOOL),('bid',AGENT_BID_TOOL),('tent',BROKER_TENTATIVE_TOOL)]:
    print(n, h(o))
"
```
