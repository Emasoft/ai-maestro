---
trdd-id: 0301PUYW
title: Reconcile soft-delete vs cemetery vs orphan-folder semantics in the Delete Agent dialog
column: planned
created: 2026-07-07T03:45:00+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: HIGH
effort: M
labels: [scenario-improvement, scen-001, scen-002, scen-024, batch-backlog-20260707]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_001_2026-06-23T08-44-04Z.md", "reports_dev/scenarios-runner/scenario_proposed-improvements_002_2026-06-23T10-24-11Z.md", "reports_dev/scenarios-runner/scenario_proposed-improvements_024_2026-05-04T11-36-31Z.md"]
---

# TRDD-0301PUYW — Reconcile soft-delete vs cemetery vs orphan-folder semantics

## Problem
`components/DeleteAgentDialog.tsx` hard-codes `params.set('hard', 'true')` on EVERY
delete (verified still present at :67 on 2026-07-07, with a comment attributing it to
SCEN-002 P0-003's tombstone concern). Only `deleteFolder` is checkbox-controlled.
Consequences: (a) the cemetery archive (G03 in `services/element-management-service.ts`,
which runs only when `hard === false`) is UNREACHABLE from the UI — cemetery is always
empty; (b) unchecking "Also delete agent folder" yields an ORPHAN folder (no registry
entry, no cemetery zip — strictly worse than either a clean hard-delete or a true
soft-delete); (c) SCEN-001 S035-S037 (expects soft-delete + cemetery) and SCEN-002
S059-S060 (expects hard + no cemetery) hold contradictory expectations, so one of them
is un-passable as written.

## Root cause
The dialog was made always-hard to avoid `deletedAt` tombstones polluting the registry
listing (SCEN-002 P0-003), instead of fixing the listing to filter tombstones. The
server soft-delete path (`?hard=false` → cemetery zip + tombstone) is fully implemented
and cannot be triggered from the UI.

## Proposed fix
Recommended (Option A from the source reports): make the dialog expose BOTH semantics —
"Move to Cemetery" → `hard=false` (tombstone + cemetery zip; folder per checkbox) and
"Delete Forever" → `hard=true&deleteFolder=true` (current behavior). Fix the tombstone
concern at the SOURCE: ensure `GET /api/agents` and the sidebar exclude
`deletedAt != null` entries unless `includeDeleted=true` (verify `lib/agent-registry.ts`
list path). Then align SCEN-001 (use "Move to Cemetery") and SCEN-002 (keep
"Delete Forever"). Also add a code comment at the G03 hard-skip site documenting the
decision (SCEN-024 P2-PROP-002) and a Cemetery empty-state banner ("Soft-deleted agents
appear here").

## Verification
`DELETE /api/agents/<id>` without `hard` → agent absent from active list, folder kept,
`<name>-export-<ts>.zip` in `~/.aimaestro/cemetery/`; SCEN-001 S035→S037 pass; SCEN-002
S055/S056 (Delete Forever) produce no cemetery entry; `GET /api/agents` hides tombstones.

## Estimated risk
MED — delete-path semantics; touches dialog + list filtering; both scenarios need
coordinated .scen.md updates. Dependencies: none (but see TRDD-UMWQWQF7 for the optional
preserve-zip-on-hard-delete extension).

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2). Implement together with UMT9HIEB.
