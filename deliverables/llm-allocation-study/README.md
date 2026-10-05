# LLM Multi-Agent Negotiation vs. Classical Schedulers — Experiment Harness

Proposal: [research_proposal_llm_allocation.md](../research_proposal_llm_allocation.md)
Frozen design: [PRE_REGISTRATION.md](PRE_REGISTRATION.md)
Field-by-field data provenance: [data_provenance.md](data_provenance.md)

## Status

| Component | Status |
|---|---|
| Simulator (real-data loader, seeded scenarios, interval scheduling) | Complete |
| Classical baselines: Random / FIFO / Greedy, large-N fleet (833 spaces) | 270 episodes |
| Same, compact fleet (30 spaces, for pairing with the LLM arms) | 270 episodes |
| Same, frozen Experiment A config (240 spaces, n=60) | 540 episodes |
| **Scale validation** — does a smaller fleet reproduce the phenomenon? | Ordering held 6/6 cells |
| Power analysis from measured variance | Complete |
| **Offline cost estimator** (no key, no spend) | Complete; it overturned the proposal's cost reasoning |
| **Experiment B — dynamic pricing benchmark** | **Complete, 270 episodes + 5-setting sensitivity sweep** |
| Reasoning effort as an experimental factor | Wired into the runner and the analysis |
| Production serving layer + live console | Complete |
| Test suite (93) and CI | Complete; zero-cost, network-blocked |
| T1 (single-shot LLM allocator) and T2 (3-round negotiation) | Implemented and tested offline; **never called the real API** |
| **Experiment A — the main LLM comparison** | **Pre-registered; not yet run** |

**The only thing blocking the main experiment is an `ANTHROPIC_API_KEY`.** With one, follow
[PILOT_PLAN.md](PILOT_PLAN.md): four staged steps, ~$6 total, each with an explicit stop
condition, before committing to the full grid (~$748, ~$374 with the Batch API).

### Experiment B results (complete — see [results/pricing_findings.md](results/pricing_findings.md))

The surge-pricing rule running in CampusPark (`server.js:574`) trades utilization for revenue:

- Utilization **drops 3.79%** at rho=2.0 (d=−3.58, p=2.9e−18) — a negative result on the
  pre-registered primary metric, consistent across all 5 elasticity settings
- Revenue rises, but a same-mean **permutation control** attributes the gain to *demand
  targeting*, not to raising prices: targeting beats the control by **+5.94%** (p=1.6e−19)
- Without that control the natural conclusion would be "dynamic pricing raises revenue 6%",
  crediting the price lever

## Data

Real prices from Parkopedia: **1,104 quotes, 24 garages, 53 snapshots** (Bellevue, WA,
2026-03-20 → 03-21), $4.49–$37.10, median $8.74. Real coordinates for the same 1 km disc
from **OpenStreetMap** (156 features, ODbL, frozen into `data/`).

Capacity and EV availability remain **synthesized** — neither source carries them (only 6 of
156 OSM features have a `capacity` tag). Every synthetic field is listed in
[data_provenance.md](data_provenance.md), and the switch from synthetic to real coordinates
is logged as Amendment A-2 in the pre-registration, including the parts of it that
contradicted my own prediction.

## The engineering layer: turning the finding into something shippable

Hypothesis H3 says the LLM produces allocations a classical scheduler structurally cannot —
hallucinated spot IDs, double bookings, EV mismatches. **So production never trusts it.**

```
request
  -> cost ceiling guard      refuse to call the model past a budget
  -> circuit breaker         skip the model entirely once it is failing
  -> deadline + bounded retry
  -> LLM policy              harness/, untouched
  -> validator gate          the SAME validator the experiment scores with;
                             illegal allocations are dropped, never repaired
  -> Greedy fallback         re-decide everything the model lost
  -> telemetry               p50/p95 latency, cost, illegal rate, degradation rate
```

**The layering is load-bearing, not stylistic.** PRE_REGISTRATION §5 *forbids* retrying
failed episodes and repairing illegal allocations, because both would erase the failure mode
the study measures. Production has the opposite obligation. `serving/` therefore wraps
`harness/policies/` **without modifying it**, so the research path stays word-for-word as
pre-registered while production gets its safety net.

### Console

`GET /` serves a live dashboard: circuit-breaker state, throughput/quality/reliability/cost
tiles, a decision log, and a button that injects synthetic traffic. Standard library only, no
CDN, light and dark themes.

**Demo mode** (`ALLOCATOR_POLICY=demo`) drives the whole chain with a **fake model** that
hallucinates spot IDs and fails on purpose, so the validator gate, the breaker tripping, and
Greedy taking over are all visible without an API key. A prominent banner states **"these
numbers are not research data"**, and `/healthz` reports `mode: simulated`.

```bash
python3 -m serving.app                         # real arms (degrades to Greedy with no key)
ALLOCATOR_POLICY=demo python3 -m serving.app   # demo mode: the whole safety layer, visible
# then open http://localhost:8080
```

## Tests and CI

```bash
python3 -m pytest tests/ -q     # 93 passed in ~24s
```

Every test runs against a stub client, and `conftest.py` **hard-blocks outbound sockets** — a
test that started calling the real API would bill every push, so that is made mechanically
impossible rather than merely discouraged.

The `allocation-study` job in `.github/workflows/ci.yml` checks, with no API key: the test
suite, that **two independent runs are byte-identical**, that classical policies produce zero
illegal allocations, that **prompt fingerprints still match the pre-registration** (making
post-hoc prompt tuning a build failure), and that the service degrades instead of crashing.

## Layout

```
data/
  osm_parking_bellevue.json   real OSM coordinates, frozen (not fetched at runtime)
harness/
  data_loader.py       real CSV + OSM -> Spot list (prices and coordinates real; capacity/EV synthetic)
  scenario.py           spots + rho + seed -> request stream (fully deterministic)
  interval_lanes.py     interval-scheduling engine, shared by every policy and the validator
  validator.py          independent hard-constraint check; LLM output is not trusted
  metrics.py            the metric family declared in proposal section 4
  policies/
    random_policy.py    B0
    fifo_policy.py       B1 (mirrors the production atomic reservation transaction)
    greedy_policy.py      B2
    llm_common.py         shared by T1/T2: pricing table, windowing, strict tool schema, commit-and-validate
    llm_central.py         T1 — single-shot central allocator
    llm_negotiate.py       T2 — bid -> tentative allocation -> revision -> final
  run_experiment.py     CLI: strategy x load x seed x effort x replicate grid
  run_pricing_experiment.py  CLI: Experiment B grid
  pricing.py             P0 static / P1 rule surge / P2 permutation control
  analyze.py             paired tests, Holm-Bonferroni, two-way ANOVA, effort ablation
  power_analysis.py      MDE and required n from measured variance (paired design)
  variance_analysis.py   scenario variance vs model jitter + ICC (stands in for temperature=0)
  combine_results.py     merges Experiment A files; refuses unpaired or duplicated rows
  compare_scales.py      compact vs full-fleet scale validation
  sensitivity_report.py  utility-parameter sweep summary
  estimate_cost.py       offline cost projection (records real prompts, sends no requests)
  make_figures.py        the four report figures as dependency-free SVG
serving/                 production layer (wraps harness/, never modifies it)
  safety.py              circuit breaker + validator gate (drop, never repair)
  allocator.py           budget guard / breaker / deadline / retry / fallback / telemetry
  telemetry.py           structured JSONL events + rolling metrics
  app.py                 HTTP service, console route, and the demo fake model
  static/dashboard.html  live console (single file, no dependencies, light + dark)
tests/                   93 tests, all stub-client, outbound network blocked
results/
  baseline_summary.csv          large-N (833 spaces), 270 episodes
  compact_baseline_summary.csv  compact (30 spaces), 270 episodes
  expA_classic.csv              frozen Experiment A config (240 spaces), 540 episodes
  pricing_summary.csv           Experiment B, 270 episodes
  pricing_pw_*.csv              the five elasticity settings
  pricing_findings.md           Experiment B conclusions and limits
  pricing_sensitivity.md        the sweep, and which conclusions survive it
  scale_validation.md           compact vs full fleet
  power_analysis*.md            measured MDE by scale
  design_recommendation.md      scale and sample size for Experiment A
  cost_analysis.md              inference cost structure
  figures/*.svg                 the four report figures
  _pre_osm/                     pre-Amendment-A-2 snapshot, kept as the audit trail
```

## Two design decisions worth knowing before reading results

### 1. The LLM arms decide in 10-minute batches; the classical arms decide per request

T1/T2 settle every request that arrived in a decision window together; random/fifo/greedy
decide each request at its arrival instant, which is what CampusPark actually does. Batching
is what "central allocator" means and is unavoidable on cost (per-request LLM calls would be
100–1000x), but it does give T1/T2 a within-window information advantage the classical arms
do not have. **Reported, not hidden.**

### 2. The compact fleet shrinks *supply*, not request count

Shrinking demand alone would drive the effective demand/supply ratio toward 0 and remove the
contention the study is about. `--target-capacity 30` scales the 24 real garages down to 30
spaces total, keeping price/distance/EV diversity, so rho keeps its meaning.

**Scale validation** (`python -m harness.compare_scales`): classical baselines run at both
sizes; strategy ordering held in 6/6 (metric, rho) cells.

**But that validation covers effect magnitude and ordering, not statistical precision** — a
point I originally overstated. Measured MDE is 2.57 pp at 30 spaces versus 0.79 pp at full
scale. At 30 spaces a real 2 pp difference would be called "not significant", which is a null
result rather than a negative one. That is why the frozen configuration uses a larger fleet;
reasoning in [results/design_recommendation.md](results/design_recommendation.md).

## Reproducing

```bash
pip install -r requirements.txt

# classical baselines (free, no API key)
python3 -m harness.run_experiment --strategies random,fifo,greedy \
  --loads 0.8,1.2,2.0 --n-seeds 30 --target-capacity 240 --out-name baseline

# Experiment B (free)
python3 -m harness.run_pricing_experiment --n-seeds 30 --out-name pricing_summary

# analysis
python3 -m harness.analyze --csv results/pricing_summary.csv --out results/pricing_report.md
python3 -m harness.make_figures

# projected cost of the LLM arms, offline
python3 -m harness.estimate_cost --target-capacity 240 --n-seeds 60
```

Every result is reproducible from its seed. Per-episode logs under `runs/` are gitignored:
2,649 files and 10 MB, all regenerable, and CI verifies that two independent runs are
byte-identical.

## Correctness work worth noting

Four defects were caught before they could contaminate a result, all by zero-cost testing:

1. **The LLM commit path did not apply the acceptance threshold** the classical policies use,
   so a negative-utility match counted as a "success" for the LLM arms only — making success
   rates incomparable across conditions.
2. **A tool-name mismatch silently disabled T2's revision round** on every window.
3. **A timeout was decorative**: `ThreadPoolExecutor` used as a context manager calls
   `shutdown(wait=True)` on exit, so the deadline fired but the caller still blocked for the
   full hung call (asserted <3 s, measured 5.02 s).
4. **pandas parses the literal string `"n/a"` as NaN**, so every classical-arm row vanished
   from any groupby on `effort`.

Two pre-data corrections are logged as amendments in the pre-registration: the random-effect
structure the proposal named was wrong for this design (§4b, A-1), and the synthetic garage
coordinates were measurably wrong (§4b, A-2).
