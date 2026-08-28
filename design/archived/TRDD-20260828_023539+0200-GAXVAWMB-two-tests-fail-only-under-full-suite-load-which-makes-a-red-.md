---
trdd-id: GAXVAWMB
title: Two tests fail only under full-suite load, which makes a red suite ambiguous
column: complete
created: 2026-08-28T02:35:39+0200
updated: 2026-08-28T02:44:05+0200
current-owner: hub-claude
created-by: hub-claude
task-type: infra
min-approval-requirement: none
assignee: hub-claude
mandate: true
mandated-by: none
approved: true
approval-judge: hub-claude
approval-datetime: 2026-08-28T02:35:39+0200
---

# Two tests fail only under full-suite load, which makes a red suite ambiguous

## Problem
Two tests pass in isolation and fail intermittently in a full `yarn test` run:

- `tests/unit/groups-cli.test.ts` > 'the verbs are REACHABLE through the dispatch' > `list` is a real subcommand — failed 2026-08-28 with `Test timed out in 30000ms` during a 494-file run; `19/19` green when run alone. The file took 35984 ms in that run. It drives the REAL CLI with no credentials and waits on a transport error, so it is inherently latency-bound.
- `tests/unit/statusline-capture-wrapper.test.ts` — INVESTIGATED 2026-08-28, DELIBERATELY NOT
  CHANGED. Did not reproduce (21/21 green in isolation, 8.99 s), and its timing assertion is already
  the disciplined form this card asks for: it bounds elapsed at 2000 ms against a MEASURED 47 ms mean
  and a 5000 ms failure mode, with the margin and its reasoning written at the assertion
  (`:203-220`), plus a neuter recorded 2026-08-02. Changing a justified bound on an UNREPRODUCED
  report would be fixing what has not been diagnosed. It also flakes in the OPPOSITE direction to
  groups-cli (reds ALONE, green in full runs), which actively contradicts a shared load cause — so
  the two were never one bug. NEXT STEP if it recurs: capture the failing runs elapsed value; the
  bound is only wrong if a real failure lands between 2000 ms and 5000 ms.

## Why this matters more than two flaky tests
A suite that is sometimes red for reasons unrelated to the change under test trains the reader to dismiss red. The next real regression arrives looking exactly like this. It also breaks the one thing the gate is for: 'the suite was green before my change and red after' stops being evidence.

## Proposed work
1. Decide per test whether the timing dependency is essential. `groups-cli` asserts REACHABILITY through the dispatch — that claim probably does not need a live transport round-trip; a dispatch-table assertion may pin it deterministically.
2. If a real round-trip IS essential, raise that test's own timeout deliberately (with the reason) instead of inheriting the 30 s default, and mark it slow.
3. Do NOT paper over it with a blanket global timeout raise — that hides the next genuinely-hung test.

## Acceptance
- [x] each of the two is either deterministic or has an explicit, justified per-test timeout
- [x] three consecutive full-suite runs green
- [x] whichever fix is chosen, the reason is written at the test so it is not undone as noise

## Approval log

- 2026-08-28T02:35:39+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-08-28T02:44:05+0200 — COMPLETE by ai-maestro-hub-session. groups-cli made deterministic (36s -> 769ms, neuter re-executed); statusline investigated and deliberately unchanged with reasoning recorded; 3 consecutive full suites green.
