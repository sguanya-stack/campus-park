# Cost analysis: the proposal's budget reasoning needed correcting

Generated offline by `python -m harness.estimate_cost` — no API key, no spend.

Scope: the compact scenario (`--target-capacity 30`; 24/36/60 requests at rho=0.8/1.2/2.0),
n=30 seeds per cell, 3 load levels, both LLM arms (T1 + T2) run to completion.

**Accuracy statement.** Token counts are a chars/4 heuristic, not the real tokenizer, and the
output figure includes an **assumed** thinking-token budget. These are order-of-magnitude
planning numbers, not a bill. The real figure comes from running one pilot episode and reading
`cost_usd`.

## Finding 1: the budget is almost entirely determined by the broker's thinking tokens

| Broker thinking tokens per call | T1 subtotal | T2 subtotal | **Total** |
|---|---|---|---|
| 0 (thinking off) | $9.65 | $16.32 | **$25.96** |
| 250 | $17.33 | $31.69 | **$49.03** |
| 500 | $25.02 | $47.07 | **$72.09** |
| 1000 | $40.40 | $77.82 | **$118.21** |
| 1500 (default assumption) | $55.77 | $108.57 | **$164.34** |
| 2000 | $71.15 | $139.32 | **$210.46** |
| 3000 | $101.90 | $200.82 | **$302.71** |

The same experiment costs anywhere from $26 to $303 — a factor of **11.7** — and **the only
thing varying is a parameter the proposal never mentioned**. Claude Opus 5 bills adaptive
thinking as output tokens, and `output_config.effort` controls thinking depth directly, so the
effort level is the real cost dial for this study.

## Finding 2: the proposal's "use Haiku 4.5 for the agents to save money" argument does not hold

Per-episode cost split for T2 (under the thinking=1500 assumption):

| rho | Haiku 4.5 agents | Opus 5 broker |
|---|---|---|
| 0.8 | 24 calls, **$0.0136** | 22 calls, **$0.9449** |
| 1.2 | 38 calls, **$0.0209** | 26 calls, **$1.1232** |
| 2.0 | 66 calls, **$0.0366** | 34 calls, **$1.4797** |

The user-agent side accounts for **1.4%–2.4%** of total cost. The proposal spent a paragraph
on "agents use Haiku 4.5 as a cost tradeoff; switching to all-Opus 5 is a decision for the
instructor" and listed it among the items needing sign-off. **That decision is close to
irrelevant.** Even moving every user agent to Opus 5 would raise the total by far less than
dropping the broker from `high` to `medium` effort would lower it.

The reason is that the broker is called often at compact scale: T2 calls it twice per
10-minute window (tentative, then final), so one episode involves roughly 34 high-effort,
long-context Opus 5 calls. That, not the agent fleet, is the cost.

## Three levers that actually work, in order of effect

1. **Lower the broker's `output_config.effort`.** Dropping from high to medium moves the total
   from roughly $164 into the $50–70 range per the table above. This is the only
   order-of-magnitude lever. It should be treated as an ablation variable — proposal §3.3
   already specifies sweeping effort over {low, medium, high} — and the pilot should confirm
   whether low effort degrades allocation quality before relying on it.
2. **Widen the decision window.** Moving from 10 to 30 minutes cuts broker calls to a third.
   But it changes the experiment's semantics (a wider window increases the LLM arms' batching
   information advantage — see the asymmetry noted in the README), so this is a design change
   to weigh carefully, not a free optimisation.
3. **Move the spot menu into the cached prefix.** The system prompt (stable) already uses
   `cache_control`, but the spot menu inside each user message (semi-stable — only free-lane
   counts change) does not. Moving the static part of the menu (id, price, capacity, EV flag)
   into the cached prefix and leaving only the dynamic free-lane counts at the tail would save
   some input tokens. Smaller than the first two.

The Batch API's 50% discount still applies and should be used, but it halves the total without
changing the structural fact that broker thinking dominates it.

## Recommended changes to the proposal

Section 6.2's cost table should:

- make broker effort / thinking tokens the **main axis** of the table rather than quoting a
  single $40–150 range;
- drop "user-agent model choice" from the list of open decisions (a footnote stating that it
  is under 3% of cost is enough);
- recompute the "all-Opus 5, about $600" figure — it assumes the agent side dominates cost,
  which the measurements contradict.
