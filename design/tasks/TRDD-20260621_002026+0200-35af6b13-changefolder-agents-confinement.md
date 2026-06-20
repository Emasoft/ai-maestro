---
trdd-id: 35af6b13-1d0e-489e-97a1-ecfc06a33b60
title: ChangeFolder must confine an agent's workingDirectory to ~/agents/ — workdir-write escape
column: complete
created: 2026-06-21T00:20:26+0200
updated: 2026-06-21T00:20:26+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
task-type: security
release-via: none
parent-trdd: TRDD-903b7a20
relevant-rules: []
test-requirements: [unit, typecheck]
labels: [security, governance, scope-writes]
---

# TRDD-35af6b13 — ChangeFolder ~/agents/ confinement

**Source:** overnight fleet-readiness verification (TRDD-903b7a20), `gov-scope-writes`
finding. Evidence: `reports/overnight-verify/gov-scope-writes.findings.json`.

## Problem
`ChangeFolder` (`services/element-management-service.ts`) validated only (G01) no `..`
traversal and (G02) the target exists + is a directory. It did NOT confine the new
`workingDirectory` to `~/agents/` — any existing absolute directory was accepted
(e.g. `~/.claude`, `~/ai-maestro`). The agent-shell-guard permits writes anywhere
under an agent's workingDirectory, and DeleteAgent's folder-delete safety (G09) is
gated on the folder being under `~/agents/`. So relocating an agent outside
`~/agents/` let it write into the user's home / source / config trees AND orphaned
its folder from the delete-safety guard. The PATCH route
(`app/api/agents/[id]/route.ts:70-84`) already DOCUMENTED this as the intended
"ChangeFolder Gate 3" invariant — but the confinement was missing (G03 only fetched
the agent).

Authority-gated (gate0Auth `modify-agent`: self/MANAGER/COS), so exploitation
requires an authorized actor misusing the op — MEDIUM severity, but it breaks the
load-bearing "every agent lives under ~/agents/" invariant the whole security model
(shell-guard, delete-safety, scenario Rule 0) assumes.

## Fix
Added gate **G01b** (BEFORE the existsSync/stat probe, so an out-of-bounds path never
touches the FS): `resolve(resolved)` must equal `resolve(HOME,'agents')` or start
with it + `/`, else REFUSE. Mirrors CreateAgent G03-ENFORCE and DeleteAgent G09. Hard
reject (no override flag) — the only caller (`agents-core-service.ts` PATCH dispatch)
passes the raw `workingDirectory`, the unit test mocks ChangeFolder, and no
legitimate flow relocates an agent outside `~/agents/`.

## Acceptance
- Folder outside ~/agents/ (`~/.claude`, `/tmp`) → refused "must be under ~/agents/"; no registry write.
- Folder under ~/agents/ → passes the boundary (reaches the existence check).
- Path traversal still rejected (G01 unchanged).
- `tsc --noEmit` clean; `tests/integration/change-folder-confinement.test.ts` green.

## Implementation (2026-06-21)
`services/element-management-service.ts` ChangeFolder G01b (dynamic `await import('path')`
for `resolve`, matching the file's existing in-function import pattern). Test:
`tests/integration/change-folder-confinement.test.ts` (real ChangeFolder, `isSystemOwner`
authContext, no element-mgmt mock). Landed in the overnight campaign (TRDD-903b7a20). Not pushed.
