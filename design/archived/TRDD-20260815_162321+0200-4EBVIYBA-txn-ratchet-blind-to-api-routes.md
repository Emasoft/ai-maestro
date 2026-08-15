---
trdd-id: 4EBVIYBA
title: The R51 ratchet scans one file — multi-store writers in app/api are invisible to it
column: completed
created: 2026-08-15T16:23:21+0200
updated: 2026-08-15T22:53:07+0200
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

- [x] Detector exists with the allowlist-with-reasons + downward ratchet —
      `tests/governance/r51-multistore-scan-surface.test.ts`. `KNOWN_UNWRAPPED` requires a
      REASON per entry (an allowlist of bare filenames can never be shrunk, because nobody can
      tell a decided entry from a merely tolerated one), and a second test refuses a STALE
      entry — one reserving a ratchet slot for a file that no longer violates, which would make
      the count unable to fall.
- [x] Seeded-violation positive control + neuter runs recorded (below)
- [x] Current census recorded (below). **LMAZO2ET's service is VISIBLE and WRAPPED**, i.e. it
      dropped off exactly as predicted — and a test now pins that it stays visible, because if
      it ever reads as <2 stores the detector has gone narrower than the invariant again.

## The census — measured 2026-08-15, 297 files scanned

| file | stores | |
|---|---|---|
| `services/element-management-service.ts` | agent-registry, team-registry, group-registry, session-persistence, aid-ledger | WRAPPED |
| `services/foreign-approval-service.ts` | agent-registry, agent-import, keypair, amp-registration, aid-ledger, foreign-approval | WRAPPED (TRDD-LMAZO2ET, `a084a1d5`) |
| `services/agents-core-service.ts` | agent-registry, session-persistence | unwrapped |
| `services/agents-transfer-service.ts` | agent-registry, agent-import, keypair | unwrapped |
| `services/amp-service.ts` | agent-registry, keypair, amp-registration | unwrapped |
| `services/headless-router.ts` | team-registry, agent-import | unwrapped |
| `services/sessions-service.ts` | agent-registry, session-persistence | unwrapped |
| `services/teams-service.ts` | team-registry, task-registry | unwrapped |

`MAX_UNWRAPPED = 6`, downward-only. The six are declared `UNREVIEWED` with that word in their
reason — an honest label, not a verdict. **Classifying them is follow-up work**, and each may
resolve as benign or as its own R51 gap; `headless-router` was already read far enough to
record that its two writes are in SEPARATE handlers, so the file-granular signal is coarse
there rather than a single sequence.

**THE VOCABULARY HAD TO BE WIDENED FIRST, and that is the finding.** Seeded with only the six
`all-in-one-single-path` store guards, the detector saw 4 multi-store files and could not see
LMAZO2ET's own service at all (one matching store out of six) — narrower than the invariant, in
exactly the way the file-scoped ratchet it replaces is. Adding keypair / amp-registration /
aid-ledger / foreign-approval / agent-import doubled the census to 8. A detector built on the
first vocabulary would have reported a confident green over the very gap this card exists for.

## Neuter runs (2026-08-15)

- **N1 — a NEW undeclared multi-store writer** (two store writes appended to
  `app/api/agents/[id]/continuity/compact/route.ts`, a file not in the allowlist) → reds
  exactly *"every unwrapped multi-store writer is DECLARED"*, 5 green. Blob-verified back to
  HEAD.
  **The FIRST attempt reddened NOTHING and that was a finding about the MUTATION:** it was
  aimed at `sessions-service.ts`, which is already declared, so adding stores to it cannot make
  it undeclared. A neuter has to target the branch it names.
- **N2 — a broken scan path** (`app/apiXX`) → reds 4 tests including the non-vacuity guard, so
  a scan that reads nothing fails LOUDLY instead of reporting zero violations. The precise
  mechanism is that `find` exits non-zero and `execFileSync` throws; the `> 200 files`
  assertion is what covers the subtler case of a scan that succeeds and returns too little.
