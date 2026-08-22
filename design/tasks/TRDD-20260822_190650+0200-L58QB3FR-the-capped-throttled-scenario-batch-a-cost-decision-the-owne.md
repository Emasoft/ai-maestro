---
trdd-id: L58QB3FR
title: The capped throttled scenario batch — a cost decision the owner has never been asked
column: todo
created: 2026-08-22T19:06:50+0200
updated: 2026-08-22T19:07:25+0200
current-owner: user
created-by: user
task-type: spike
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T19:06:50+0200
assignee: ai-maestro-hub
priority: 2
labels: [scenarios, tokens, owner-act, budget]
external-refs: [TRDD-TBGGUA2V]
---

# The capped throttled scenario batch — a cost decision the owner has never been asked

# The capped, throttled scenario BATCH — a cost decision the owner has never been asked

Descoped out of **TRDD-TBGGUA2V** (overnight supervision mandate) as its only unfinished item.
P0-P7 of that mandate shipped and are commit-verified; P8 is not engineering, it is a **spend
authorization**, and it had been holding an otherwise-delivered XL card in `human_review`.

## What is already done, so nobody re-does it

- The **calibration probe**: SCEN-020 PASS 17/17, **0 application bugs**, per-scenario cost
  MEASURED.
- The **safety scaffold** (`a5cffe3a`): the token kill-switch `batch-budget-guard.sh` with two
  closed gates.

So the instrument exists, it is calibrated, and the guard is built. The one thing that has never
happened is somebody deciding to spend the money.

## Why it is gated, in the mandate's own words

> P1-P6 are *"editing + committing — bounded, delegatable, no blowup risk"*, while P8 is
> **the ONLY blowup vector**.

That stance is not decoration — a prior Opus agent batch with no ceiling burned a week of tokens.
`~/.claude/rules/token-economy-agents-and-scenarios.md` makes the precondition explicit: *"Before
launching a fan-out: pin the model (cheapest viable), measure ONE unit's cost, set a max-units
cap, a wall-clock deadline, and a STOP sentinel the loop checks before each unit. A batch with no
measured per-unit cost and no cap is forbidden."* Three of those five are in hand; the cap and
the deadline are numbers only the owner can set.

## What the owner is actually being asked

1. **Run the batch at all, or not?** The calibration says the tooling works. Declining is a
   legitimate answer and closes this card.
2. If yes: **the cap** — max scenarios, or a token ceiling, and a wall-clock deadline.
3. If yes: **the model pin.** The standing guidance is `sonnet[1m]` for bulk execution with Opus
   reserved for hard-judgment stages; the rate, not the token count, is the lever (a measured
   probe had Sonnet using MORE tokens and still costing 2.4x less).

## Do NOT

- Do not launch any fan-out before a cap and a deadline exist as numbers.
- Do not re-run the calibration to "check" — it passed 17/17 with a measured cost; re-running it
  spends money to re-learn a recorded fact.

## Acceptance

- [ ] The owner rules: run the batch, or decline it
- [ ] If run: a max-units cap, a wall-clock deadline, and the model pin are recorded HERE as
      numbers before the first agent is spawned
- [ ] If run: `batch-budget-guard.sh`'s two gates are confirmed armed against those numbers, by
      running the guard, not by reading it
- [ ] The run's ACTUAL total is recorded against the projection, so the next batch is estimated
      from a measurement rather than from this card

## Approval log

- 2026-08-22T19:06:50+0200 — MANDATE issued by user (min-approval-requirement: user). Pre-approved: issuer authority >= required approver. No approval request was sent.
