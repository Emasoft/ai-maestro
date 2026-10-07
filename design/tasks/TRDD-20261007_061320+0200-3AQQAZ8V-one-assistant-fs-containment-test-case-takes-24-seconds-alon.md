---
trdd-id: 3AQQAZ8V
title: One assistant-fs-containment test case takes 24 seconds alone and times out the suite under load
column: todo
status: tasked
created: 2026-10-07T06:13:20+0200
updated: 2026-10-07T06:13:20+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: bugfix
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-07T06:13:20+0200
---

# One assistant-fs-containment test case takes 24 seconds alone and times out the suite under load

## Problem

tests/unit/assistant-fs-containment.test.ts, case 'skips without writing anything for a non-ASSISTANT agent', takes 23990 ms run ALONE (measured 2026-10-07 with the verbose reporter; every other case in the file is under 200 ms). Its limit is 30000 ms, so it fails whenever the machine is loaded: it timed out in 3 of 6 full-suite runs on 2026-10-07, each time passing when re-run alone.

The case calls enforceAgentInvariants on the 'wake' trigger for a temp workdir and mocks getAgent ONCE. Something on that trigger runs for about 24 seconds. Not yet known: which invariant, and whether it is waiting on a real subprocess, a real network call or a timeout — which would also mean a unit test reaches outside its fixture.

## Acceptance

- [ ] The invariant (and the call inside it) that spends the 24 seconds is named, with file:line, from a measurement and not from reading
- [ ] If it reaches a real subprocess, the network or the real home: that is contained at the boundary in the test, and stated
- [ ] The case runs in under 2 seconds alone and still asserts what it asserted; the assertion is not weakened and the timeout is not raised
- [ ] The same cause checked in tests/unit/teams-stats-verb.test.ts (request timeout under load) and the 60 s ratchet case in tests/governance/enforcement-coverage.test.ts: fixed if it is the same cause, otherwise recorded as separate

## Approval log

- 2026-10-07T06:13:20+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
