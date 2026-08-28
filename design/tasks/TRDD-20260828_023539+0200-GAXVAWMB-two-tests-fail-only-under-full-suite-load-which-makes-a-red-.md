---
trdd-id: GAXVAWMB
title: Two tests fail only under full-suite load, which makes a red suite ambiguous
column: todo
created: 2026-08-28T02:35:39+0200
updated: 2026-08-28T02:35:39+0200
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
- `tests/unit/statusline-capture-wrapper.test.ts` — already recorded as a pre-existing flake (reds alone on a 5 s timing case, green in full runs). Note it flakes in the OPPOSITE direction, which is why neither was diagnosed as a shared cause.

## Why this matters more than two flaky tests
A suite that is sometimes red for reasons unrelated to the change under test trains the reader to dismiss red. The next real regression arrives looking exactly like this. It also breaks the one thing the gate is for: 'the suite was green before my change and red after' stops being evidence.

## Proposed work
1. Decide per test whether the timing dependency is essential. `groups-cli` asserts REACHABILITY through the dispatch — that claim probably does not need a live transport round-trip; a dispatch-table assertion may pin it deterministically.
2. If a real round-trip IS essential, raise that test's own timeout deliberately (with the reason) instead of inheriting the 30 s default, and mark it slow.
3. Do NOT paper over it with a blanket global timeout raise — that hides the next genuinely-hung test.

## Acceptance
- [ ] each of the two is either deterministic or has an explicit, justified per-test timeout
- [ ] three consecutive full-suite runs green
- [ ] whichever fix is chosen, the reason is written at the test so it is not undone as noise

## Approval log

- 2026-08-28T02:35:39+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
