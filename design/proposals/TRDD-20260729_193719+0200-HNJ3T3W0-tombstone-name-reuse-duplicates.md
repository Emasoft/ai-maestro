---
trdd-id: HNJ3T3W0
title: A name held by a soft-deleted tombstone can be re-created, producing two registry entries with the same name
column: planned
created: 2026-07-29T19:37:19+0200
updated: 2026-08-21T22:02:08+0200
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T22:02:08+0200
blocked-by: [TRDD-3Q4G9ZK6]
current-owner: scenario-runner
task-type: bugfix
min-approval-requirement: manager
approval-tier: 2
priority: 2
severity: minor
effort: small
labels: [scenario-improvement, scen-001, agent-registry]
external-refs: [reports/scenarios-runner/SCEN-001_20260729T170344Z.report.md]
---

# Name uniqueness is enforced against live agents only, so a tombstoned name can be taken twice

## Problem

`scen-test-title-agent` was soft-deleted (tombstone with `deletedAt`, workdir preserved).
The Agent Creation Wizard then accepted the same name without complaint, and
`~/.aimaestro/agents/registry.json` briefly contained two entries named
`scen-test-title-agent` — one tombstoned, one live — sharing one workdir and one tmux
session name. The tmux session name is derived from the agent name, so the live agent
attached to the folder the tombstone still claims.

Discovered while discharging cleanup for TRDD-3Q4G9ZK6: this is currently the ONLY UI-only
way to remove an orphaned workdir (re-create the name, then hard-delete with "Also delete
agent folder"). So it should not be closed until that proposal ships, or the orphan becomes
unremovable.

## Root cause

The CreateAgent uniqueness gate filters out `deletedAt` entries when checking for a name
collision, which is right for "the name is free again" and wrong for "the folder and session
name are still claimed".

## Proposed fix

In the CreateAgent name gate, treat a tombstoned name as taken *when its workdir still
exists on disk*, and say so: offer the two real choices — revive from the cemetery, or
purge/hard-delete the tombstone first. A tombstone whose folder is already gone stays
re-usable, which is the common and harmless case.

## Verification

- Soft-delete an agent, then try to create the same name via the wizard while
  `~/agents/<name>/` still exists → refused with a message naming the tombstone.
- `jq -r '.[].name' ~/.aimaestro/agents/registry.json | sort | uniq -d` is empty after any
  create/delete sequence.
- Same name after the folder is gone → allowed.

## Estimated risk

LOW. Blocked by TRDD-3Q4G9ZK6: closing this without it removes the last UI route to an
orphaned folder.

## Approval log

- 2026-08-21T22:02:08+0200 — APPROVED by ai-maestro-hub-session (min-approval-requirement: manager).
  Re-measured: `services/element-management-service.ts:10007` still does
  `loadAgents().find(a => !a.deletedAt && a.name === name)` — a tombstoned name is unconditionally
  free again, with no workdir-existence check. Card stays `blocked-by: [TRDD-3Q4G9ZK6]` per its own
  stated ordering (closing this before 3Q4G9ZK6 ships removes the last UI route to an orphaned
  folder); TRDD-3Q4G9ZK6 was approved in the same screening pass.
