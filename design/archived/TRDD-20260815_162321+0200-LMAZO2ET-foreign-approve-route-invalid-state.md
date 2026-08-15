---
trdd-id: LMAZO2ET
title: foreign-approvals approve route half-commits across 5 stores — duplicate agents on retry
column: completed
created: 2026-08-15T16:23:21+0200
updated: 2026-08-15T16:53:26+0200
implementation-commits: [a084a1d5]
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
derived: true
derived-kind: eht
parent-trdd: 1ZMEXD9X
priority: 1
severity: high
effort: medium
release-via: none
scope: project
project-id: ai-maestro
labels: [gap-survey, a2, r51, invalid-state, foreign-approvals]
npt: []
eht: []
blocked-by: []
relevant-rules: [51]
---

# foreign-approvals approve half-commits across 5 stores

## Problem (A2 survey §3a, hub-verified 2026-08-15 by reading the route)

`app/api/agents/foreign-approvals/[id]/approve/route.ts` (133 lines) runs a hand-rolled
5-store sequence with ZERO compensation and no `runGateSequence`:
importAgent→agent-registry (:81) · saveKeyPair→amp-keys (:93) ·
markAgentAsAMPRegistered→registry again + ledger emit (:99) ·
recordAidReissue/recordForeignApproval→signed ledger (:109-110) ·
updateForeignApproval→approval registry (:114). One outer catch returns a bare 500.

Failure shape: a throw at step 4 (ledger locked/corrupt) leaves a NEW agent registered and
keyed, looking AMP-registered, while the approval stays `pending` and the ZIP stays staged —
so a retry click runs `importAgent({newId:true})` AGAIN, minting a SECOND duplicate agent,
with the first orphan (registered, keyed, never ledger-associated) left permanently. An
invalid multi-store state reachable by one mid-flight I/O error. The AIO-TXN-10 ratchet
cannot see it: its scan surface is `services/element-management-service.ts` only, and this
route calls `agents-transfer-service` directly.

## Fix shape

Move the materialize→key→bind→ledger→mark sequence into a `runGateSequence`-wrapped
pipeline (service layer), each gate with an honest undo (delete the imported agent dir +
registry row, remove the keypair; ledger ops are append-only — order them LAST so nothing
abortable follows, per the R51.6 boundary discipline). The route becomes a thin caller.
Window boundary per the InstallElement precedent where a mutation is shared/irreversible.

## Acceptance

- [x] The 5-store sequence runs under the transaction runner with per-gate undos —
      `services/foreign-approval-service.ts::approveForeignAgent` (a084a1d5); route is a thin
      caller; R51.7 invariants; approval flip ordered BEFORE the ledger appends so even the
      no-rollback CRASH window cannot mint a duplicate (retry refused by the pending-check)
- [x] A seeded mid-sequence failure leaves NO orphan agent — 5 per-gate failure tests in
      `tests/integration/foreign-import-approval.test.ts` (real fs sandbox), one per mutating
      gate, each asserting registry/keys/approval/ZIP all back to pre-call state
- [x] Retry after a failed approve does not duplicate the agent — the G05 test fails the final
      ledger append, then retries with real deps: exactly ONE agent, fresh fp backed
- [x] ~~Ratchet/coverage: the pipeline joins the census~~ REWORDED 2026-08-15 (the census
      detector does not exist yet — it IS TRDD-4EBVIYBA's whole deliverable, and a box that
      waits on a sibling card is a `blocked-by:`, not a box): what THIS card owes is that the
      fix is VISIBLE to that future scan — satisfied, the sequence routes through the bare
      identifier `runGateSequence` in `services/`, exactly the surface 4EBVIYBA enumerates

## Verification record (2026-08-15)

- tsc 0 errors · 6 affected suites 68/68 green (integration, r34-r35 governance [mocks
  upgraded to a stateful world], sudo-op-binding, sudo-guard strict coverage, aio-txn-10
  ratchet, foreign-approval-registry unit)
- Neuter N1 (G01 un-import undo → no-op): 4 reds, exactly the G02-G05 rollback tests;
  G01's own test green (nothing to revert on its path) — the undo is load-bearing per gate
- Neuter N2 (compensating aid_revoke → no-op): exactly 1 red — G04's `revoked === true`
  (the non-vacuous half; bare ok-false is also satisfied when no associate ever landed)
- Both neuters reverted; blob hash equals HEAD's

## Approval log

- 2026-08-15T16:53:26+0200 — COMPLETED by ai-maestro (self-mandate, min-approval-requirement
  none). All four boxes checked; verification record above; implementation commit a084a1d5.
