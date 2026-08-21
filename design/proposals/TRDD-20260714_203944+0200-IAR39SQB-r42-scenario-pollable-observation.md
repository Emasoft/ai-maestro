---
trdd-id: IAR39SQB
title: Make SCEN-030's R42 observation pollable and split from fleet-build
column: planned
min-approval-requirement: none
priority: 2
severity: low
effort: medium
task-type: infra
created: 2026-07-14T20:39:44+0200
updated: 2026-08-21T22:36:05+0200
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:36:05+0200
current-owner: scenario-runner
labels: [scenario-improvement, scen-030]
external-refs: [reports/scenarios-runner/SCEN-030_20260714T181702Z.report.md]
---

## Problem

SCEN-030's load-bearing step S008 asks the runner to WATCH for up to 10 minutes
while a MANAGER, a COS and a MEMBER launch, load role-plugins, process a directive,
and exchange AMP messages — to observe whether the MANAGER ASKs (AMP) or tries to
INJECT. A forked `opus[1m]` runner cannot cheaply block for minutes (foreground
sleep is disallowed; it must re-poll across turns, each turn re-reading the whole
transcript), and the scenario ALSO front-loads the heaviest possible setup: demote
a pre-existing MANAGER (see TRDD-Q6JM2RU3), hand-drive the wizard 3× for
titled/teamed agents, and wake 3 sessions. The combined turn/token cost biases the
run toward STUCK/PARTIAL for reasons unrelated to R42 behaviour — the very thing
the scenario exists to measure.

## Root cause

The scenario couples an expensive, order-dependent fleet-build with an open-ended
live observation, in one forked context. Nothing gives the observation a cheap,
bounded, pollable success signal, and nothing lets the build phase be verified/
checkpointed independently of the observation.

## Proposed fix

1. **Pollable success signal.** S008/S009 already define the artifact
   `~/agents/scen030-member/HELLO-R42.md` with exact content. Reframe S008 as a
   bounded poll: check (a) the member's `HELLO-R42.md`, and (b) the MANAGER's AMP
   `sent/` dir for a message to the COS, on a short interval with a hard cap
   (e.g. 8×45s), stopping the moment either the artifact appears or a drive-attempt
   403 is logged. No fixed 10-minute wall-clock block.
2. **Split build from observation.** Allow the fleet-build (S003-S006) to be a
   reusable fixture the setup can pre-provision when the host is pristine, so the
   observation run starts from three idle agents rather than rebuilding them.
3. **Document the budget reality** in the scenario preamble: this scenario needs a
   pristine host and is unusually turn-heavy; a forked runner should treat the
   first-action classification (S008 a/b/c) + the disk-verified artifact as the
   minimum viable verdict, and defer S010-S012 forensic reads if budget is low.

## Verification

- A dry run on a pristine host reaches an S008 verdict (LAWFUL / UNLAWFUL-BUT-REFUSED
  / STALLED) within a bounded number of polls, without a fixed multi-minute sleep.
- The disk-verified `HELLO-R42.md` + the MANAGER→COS AMP `sent/` entry are sufficient
  to classify the run even if the runner stops early.

## Estimated risk

LOW. Scenario-authoring + setup-script changes only; no product code. Dependency:
TRDD-Q6JM2RU3 (clean-environment precondition) should land first, since the build
phase presumes a free MANAGER slot.

## Approval log

- 2026-08-21T22:36:05+0200 — APPROVED by ai-maestro-hub-session (min-approval-requirement: none). Re-measured: still unfixed. `tests/scenarios/SCEN-030_r42-manager-must-ask-not-inject.scen.md` S008 still reads "Watch the three terminals ... for up to 10 minutes" — a fixed wall-clock block, no bounded poll against `HELLO-R42.md` / the MANAGER's AMP `sent/` dir. Premise still holds. Note for the implementer: `tests/scenarios/SCENARIOS_TESTS_RULES.md` now carries Rule 15 (THE-RUNNER-NEVER-WAITS), added after this proposal was filed, which generalizes exactly this fix (orchestrator polls cheaply, a spawned runner never blocks) — implement per Rule 15's split rather than this card's original bespoke poll-loop shape.
