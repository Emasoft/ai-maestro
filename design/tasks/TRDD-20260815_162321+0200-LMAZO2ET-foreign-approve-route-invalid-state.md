---
trdd-id: LMAZO2ET
title: foreign-approvals approve route half-commits across 5 stores — duplicate agents on retry
column: todo
created: 2026-08-15T16:23:21+0200
updated: 2026-08-15T16:23:21+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
derived: true
derived-kind: npt
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

- [ ] The 5-store sequence runs under the transaction runner with per-gate undos
- [ ] A seeded mid-sequence failure leaves NO orphan agent (test drives the throw at each gate)
- [ ] Retry after a failed approve does not duplicate the agent
- [ ] Ratchet/coverage: the pipeline joins the census (see TRDD-4EBVIYBA for the scan-surface fix)
