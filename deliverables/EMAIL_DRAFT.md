# Email draft — capstone update + API credit request

> **Before you send, three things need your input.** They are marked `[[...]]`
> in the draft and explained at the bottom.

---

**Subject:** Generative AI capstone — progress update and a question about API credits

Dear Professor `[[NAME]]`,

I wanted to share where my capstone project stands, and ask about one resource question.

**The project.** Does LLM multi-agent negotiation allocate a contended resource more fairly
than greedy or first-come-first-served scheduling? The setting is campus parking, built on a
reservation platform I developed, with a discrete-event simulator calibrated on 1,104 real
parking quotes across 24 Bellevue garages and real coordinates from OpenStreetMap.

**Where it stands.** The simulator, five allocation policies, the pre-registered experimental
design, and a complete secondary experiment on dynamic pricing (270 episodes) are all
finished. The main LLM comparison is fully implemented, tested, and pre-registered — but it
**has not been run**, because it requires paid API access. That is the reason for my question.

**The question.** Running the main experiment costs roughly **$6 for a staged pilot** and
**~$550 for the full grid** at the sample size the pre-registration fixes. Does the course or
the lab have API credits available for student projects? If not, I will present the pricing
experiment as the primary result and the LLM comparison as a prepared-but-unfunded extension,
rather than reduce the sample size below what I committed to in advance.

**One result I would flag.** The pricing experiment produced a negative result on its own
pre-registered primary metric: the surge-pricing rule running in my system *reduces* spot
utilization (−3.79% at high contention, d=−3.58, p=2.9e−18) and trades it for revenue. A
same-mean permutation control then showed the revenue gain comes from *demand targeting*
rather than from raising prices at all. I also ran a sensitivity sweep over the one unmeasured
parameter in the model, which revised one of my own headline claims — that is documented
rather than removed.

Everything is here, including the code, the frozen pre-registration, and the two amendments
I logged before collecting any data:

`[[LINK]]`

The progress report closes with five specific questions I would value your guidance on. The
one that matters most: **is a simulation calibrated on real price data an acceptable data
source for this course, or is real user interaction data required?** The honest limitation is
24 garages over ~24.5 hours, with capacity and EV availability synthesized — documented
field by field.

`[[LATE_ROW]]`

Thank you for your time.

Best regards,
Guanya Song
song.guany@northeastern.edu

---

## What you need to fill in

### 1. `[[NAME]]`
The spreadsheet was shared from `li_qianyi@northeastern.edu` — confirm the right name and
title before sending.

### 2. `[[LINK]]`
```
https://github.com/sguanya-stack/campus-park/tree/claude/llm-allocation-study/deliverables
```
Note this is a **branch** link. If you want `main` instead, tell me and I'll merge it first.

### 3. `[[LATE_ROW]]` — pick one

**If you already submitted your row in the team spreadsheet**, delete the placeholder
entirely. Don't raise it.

**If you did not submit it** (it was due Sep 24; the five rows I saw did not include your
name), use this — it owns the miss without over-explaining:

> I also realize I missed the September 24 deadline for the team spreadsheet, and I have now
> added my row. I should have asked sooner rather than letting it slip; my apologies.

**If you are unsure**, check the sheet first. Claiming you submitted when you didn't is far
worse than being 11 days late.

---

## One thing I cannot decide for you

**AI assistance disclosure.** I helped build a substantial amount of this project — the
simulator, the policies, the statistical tooling, the serving layer, the tests, and these
documents. Many courses now require that to be disclosed, and the requirement varies by
instructor and by institution.

I have deliberately **not** added a disclosure line, because whether and how to word it
depends on your course's policy, which I don't know. Check the syllabus. If disclosure is
expected, add it — and if you want, I'll help you write an accurate one that describes the
division of labour honestly.

This is worth getting right. A project this well documented invites scrutiny of how it was
produced.

---

## A note on tone

The draft is deliberately short and leads with the thing he has to act on (credits). Two
things it does on purpose:

- **States that Experiment A has no data, in the third paragraph.** Burying that would be
  worse than leading with it, and the report says the same thing in §2.
- **Says you would rather present a smaller result than cut the sample size below the
  pre-registration.** That single sentence signals methodological seriousness better than
  anything else in the email.

Don't add more detail. If he's interested, the link carries 19,000 lines of it.
