---
trdd-id: TGNU1EP7
title: Schedule the D4 watchdog — trdd-doctor runs nowhere today
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T17:35:51+0200
updated: 2026-08-05T17:35:51+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-05T17:35:51+0200
severity: high
effort: small
derived: true
derived-kind: npt
parent-trdd: 8F8PJEXI
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [governance, d4-watchdog, scheduling, 3P-ZON-11]
external-refs: [Emasoft/ai-maestro#59]
---

# Schedule the D4 watchdog — trdd-doctor runs nowhere today

## Problem

`trdd-doctor` is referenced **only** in `package.json` (`trdd:doctor` / `trdd:fix` / `trdd:board`).
It appears in neither of the repo's two workflow files nor in `.githooks/`. So the governance
watchdog is a command a human types, not a sweep — which answers ai-maestro#59's open question
*"where does it run"* with **nowhere**.

This is an NPT of [[8F8PJEXI]] rather than part of it because the two fail independently and in
opposite directions: giving the check an objective floor while it runs nowhere produces a correct
guard nobody executes; scheduling it while it compares a claim to itself produces a sweep that
reliably reports nothing. Either alone reads as done.

3P-ZON-11 makes this explicit — *"a watchdog scheduled NOWHERE satisfies nothing here — being
scheduled is part of the clause"* — so the parent cannot reach `complete` while this is open.

## Proposed fix

Pick ONE host and say so; do not add a second. Candidates, with the trade stated:

1. **The janitor heartbeat.** Natural home: it already has the cadence, the detector framework, and
   the "surfaces drift, never edits content" discipline. Cost: the authority ladder is ai-maestro's
   model, so the janitor would be enforcing a contract it does not own (cross-ref janitor#84).
2. **A server-side idle sweep.** Owns the model; needs its own scheduling and must not become a
   second nudger — ai-maestro#51's 2026-07-25 comment records that two mechanisms with independent
   cooldowns defeat each other, and that caution binds here.

Whichever is chosen, the sweep is **reporting-only on first landing**. A wall of ERRORs over 381
existing cards is how a linter gets routed around permanently.

## Verification

After scheduling: a seeded forged-mandate card MUST appear in the sweep's output without anyone
running a command, and the run MUST be visible in the sweep's own log. Absence of findings on a
clean corpus is NOT evidence the sweep ran — the log line is.

## Estimated risk

LOW to implement, MED to get right: the failure mode is a sweep that runs and reports nothing while
looking healthy, which is indistinguishable from a clean corpus. That is the reason the verification
above asserts the RUN, not the findings.

## Approval log

- 2026-08-05T17:35:51+0200 — MANDATE issued by USER ("write all the TRDDs and the derived TRDDs").
  Pre-approved: issuer authority >= required approver (floor `none`). Derived NPT of TRDD-8F8PJEXI;
  depth-1 per the derived-TRDD rule, so its own `npt:`/`eht:` are empty.
