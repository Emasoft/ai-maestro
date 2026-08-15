---
trdd-id: 4EBVIYBA
title: The R51 ratchet scans one file — multi-store writers in app/api are invisible to it
column: todo
created: 2026-08-15T16:23:21+0200
updated: 2026-08-15T16:23:21+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
derived: true
derived-kind: eht
parent-trdd: 1ZMEXD9X
priority: 2
severity: medium
effort: medium
release-via: none
scope: project
project-id: ai-maestro
labels: [gap-survey, a2, r51, ratchet, detector-scope]
npt: []
eht: []
blocked-by: []
relevant-rules: [51]
---

# Extend the R51 coverage detector past element-management-service.ts

## Problem (A2 survey, hub-verified)

`tests/governance/aio-txn-10-runner-coverage.test.ts` proves 19/19 pipelines wrapped
(MAX_HANDROLLED=0, verified green) — but its scan surface is ONE file. The
foreign-approvals route (TRDD-LMAZO2ET) is a genuine uncompensated 5-store sequence the
ratchet cannot see by construction: it lives in `app/api/` and calls a different service.
A check whose scope is narrower than the invariant it guards reports green and could never
have caught this (the lessons file's own scope lesson).

## Fix shape

A second detector sweep: enumerate `app/api/**/route.ts` + `services/*.ts` writers that
touch ≥2 independent stores (import-fan-out + write-verb census, the A2 survey's method)
WITHOUT routing through `runGateSequence`; allowlist the verified read-only ones
(ibct, ledger-health, aid-recover — A2 refuted them by reading) with a WHY per entry, and
ratchet the violator count downward. Positive control: a seeded two-store writer fixture
must be found. Grep the BARE identifier `runGateSequence`, never `runGateSequence(` — a
generic-typed call site (`runGateSequence<RemoveCtx>(`) drops out of the paren form (A2
measured 19 vs 20 on exactly this).

## Acceptance

- [ ] Detector exists with the allowlist-with-reasons + downward ratchet
- [ ] Seeded-violation positive control + neuter run recorded
- [ ] Current census recorded; LMAZO2ET's route is finding #1 and drops off when fixed
