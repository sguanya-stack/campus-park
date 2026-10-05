# Low-cost pilot plan

Before committing the full grid (~$748), spend about **$6 across four steps** to answer four
questions. Every step has an explicit stop condition. The value of a pilot is not the money it
saves — it is **finding design defects while they are still cheap to fix**.

Prerequisite: `export ANTHROPIC_API_KEY=sk-ant-...`. All commands run from
`deliverables/llm-allocation-study/`.

---

## Step 0 — one minimal call (about $0.02)

**Question:** does the chain work at all — auth, model ID, strict schema, tool calling?

```bash
python3 - <<'PY'
import anthropic
from harness.policies.llm_common import ALLOCATION_TOOL
r = anthropic.Anthropic().messages.create(
    model="claude-opus-5", max_tokens=1024,
    tools=[ALLOCATION_TOOL],
    tool_choice={"type": "tool", "name": "submit_allocation"},
    output_config={"effort": "low"},
    messages=[{"role": "user", "content":
        "Decision window [0,10). Spots:\n- spot_id=A price_per_hour=$5.00 "
        "capacity=1 free_lanes_this_window~=1 is_ev=False\n\n"
        "Requests in this window:\n- request_id=req-1 ... "
        "distance_to_eligible_spots=[A:100m]\n\nReturn an assignment for all 1 request_id(s)."}],
)
print("stop_reason:", r.stop_reason)
print("usage:", r.usage)
print("tool input:", [b.input for b in r.content if getattr(b, "type", None) == "tool_use"])
PY
```

**Stop if:** a 400 comes back (wrong model ID or parameter), `stop_reason` is not `tool_use`,
or the returned JSON does not match the schema. These are code problems and should not be
discovered by burning real episodes.

---

## Step 1 — one T1 episode (about $1)

**Question:** how accurate is the cost estimate, and what is the illegal-allocation rate?

```bash
python3 -m harness.run_experiment --strategies llm_central --loads 1.2 --n-seeds 1 \
  --target-capacity 240 --efforts high --full-logs --out-name pilot_t1
```

Check `results/pilot_t1.csv`:

| Field | Expectation | What to do otherwise |
|---|---|---|
| `cost_usd` | ≈ $0.91 (the projection) | More than 2x off → revise the budget in `PRE_REGISTRATION.md` §7 and **re-freeze** |
| `illegal_allocation_rate` | any value is data (this is what H3 measures) | Above 0.5, read the transcript in `runs/*_full.json` first to confirm it is model capability and not a prompt defect |
| `parse_failure_rate` | should be 0 | Above 0 means the strict schema is not doing its job — a code problem, fix it first |
| `success_rate` | same order of magnitude as Greedy | Near 0 usually means the prompt omits information, not that the model is incapable |

---

## Step 2 — one T2 episode (about $1.80)

**Question:** does the three-round negotiation actually complete, and is the cost roughly
1.85x T1?

```bash
python3 -m harness.run_experiment --strategies llm_negotiate --loads 1.2 --n-seeds 1 \
  --target-capacity 240 --efforts high --full-logs --out-name pilot_t2
```

```bash
python3 - <<'PY'
import json, glob
log = json.load(open(sorted(glob.glob("runs/llm_negotiate_1.2_1_cap240_high.json"))[0]))
for w in log.get("llm_transcript") or []:
    print(w.get("window"), "n_req:", w.get("n_requests"), "n_revised:", w.get("n_revised"),
          "errors:", {k: v for k, v in w.items() if k.endswith("_error")})
PY
```

**The critical check: `n_revised` must be greater than 0 in at least some windows.** If it is
0 everywhere, the revision round is not actually running — which is exactly the symptom of the
tool-name mismatch bug fixed earlier, though this time the cause would be something else.
**All zeros means stop; do not continue.**

---

## Step 3 — variance and power probe (about $3)

**Question:** how large is the model's own jitter, and is the frozen n=60 still adequate?

Run the same scenario (same seed) three times to measure model jitter:

```bash
python3 -m harness.run_experiment --strategies llm_negotiate --loads 1.2 \
  --n-seeds 1 --seed-start 1 --target-capacity 240 --efforts high \
  --replicates 3 --out-name pilot_rep

python3 -m harness.variance_analysis --csv results/pilot_rep.csv \
  --out results/pilot_variance.md
```

**Decision criterion:** compare the within-cell jitter SD against the classical arms'
paired-difference SD in `results/expA_classic_power.md` (about 0.031).

- Jitter **much smaller** than 0.031 → the n=60 power conclusion holds; run the frozen config.
- Jitter **comparable or larger** → the frozen MDE is optimistic. **Do not quietly add seeds**
  (PRE_REGISTRATION §5 forbids it). Return to `PRE_REGISTRATION.md`, revise n, record the
  reason and the date, re-freeze, then run.

Note that real geography narrowed the greedy-vs-FIFO gap by 19–37% (Amendment A-2). If real
geography compresses differences between allocation strategies generally, the LLM-vs-Greedy
effect is likely smaller than originally planned for — which makes this step more important,
not less.

---

## Once every step passes

```bash
# main grid (about $553)
python3 -m harness.run_experiment --strategies llm_central,llm_negotiate \
  --loads 0.8,1.2,2.0 --n-seeds 60 --target-capacity 240 --efforts high \
  --replicates 3 --out-name expA_llm_high

# effort ablation (about $194)
python3 -m harness.run_experiment --strategies llm_central,llm_negotiate \
  --loads 0.8,1.2,2.0 --n-seeds 20 --target-capacity 240 --efforts low,medium \
  --replicates 3 --out-name expA_llm_ablation
```

## Cost summary

| Step | Estimate | What it buys |
|---|---|---|
| 0 | $0.02 | whether the API path works |
| 1 | $1.00 | cost-estimate accuracy, order of magnitude of the illegal rate |
| 2 | $1.80 | whether the negotiation rounds actually complete |
| 3 | $3.00 | model variance, and whether the power claim survives |
| **Pilot total** | **≈ $6** | **surfacing design defects before spending $748** |

Each stop condition above corresponds to a class of problem that would otherwise cost several
hundred dollars to discover from the full grid.
