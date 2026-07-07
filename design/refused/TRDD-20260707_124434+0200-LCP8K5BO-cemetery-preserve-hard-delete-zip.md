---
trdd-id: LCP8K5BO
title: Optional per-host setting to preserve a ZIP export before hard-delete-with-folder
column: refused
created: 2026-07-07T12:44:38+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: LOW
effort: M
labels: [scenario-improvement, scen-027, batch-backlog-20260707]
task-type: feature
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_027_2026-05-23T00-42-41Z.md"]
---

# TRDD-LCP8K5BO — Optional per-host setting to preserve a ZIP export before hard-delete-with-folder

## Problem

When a user deletes an agent via the Danger Zone with "Also delete agent
folder" checked, the agent is fully removed AND the cemetery archive step
is skipped entirely — verified in SCEN-027 S019/S018 and consistent with
prior scenario runs (SCEN-009 through SCEN-024). A user who changes their
mind seconds after a hard-delete-with-folder has **no recovery option**,
even though a cemetery-style ZIP export was technically possible before
the folder was removed.

## Root cause

Confirmed at HEAD (2026-07-07): `services/element-management-service.ts:6300`
explicitly logs `'G03: Hard-delete — skipping cemetery archive'` as part
of the `DeleteAgent` gate sequence — the hard-delete-with-folder path
intentionally bypasses the cemetery-archive step (line 6480's neighboring
comment: `"Soft-delete preserves the folder (data is in the cemetery
zip)"` confirms archiving is currently tied to the soft-delete path only).
This is a deliberate design choice ("if you wanted a backup, uncheck
folder-delete or export first") but it is unforgiving of an accidental or
hasty confirmation.

## Proposed fix

1. Add a configurable per-host setting, e.g.
   `cemetery.preserve_hard_delete_zip: boolean` (default `false`, so
   current behavior is unchanged unless a user opts in).
2. When `true`, the hard-delete-with-folder path in
   `services/element-management-service.ts` (around gate G03, line 6300)
   STILL writes the ZIP export to the cemetery archive **before** the
   working directory is removed, instead of skipping it.
3. Mark that cemetery entry with an `is_orphan: true` flag (there is no
   live workdir to revive into by default, distinguishing it from a
   normal soft-delete cemetery entry).
4. Update the Cemetery "Revive" UI/flow to detect `is_orphan` entries and
   offer "Revive into new workdir at `<path>`" instead of assuming the
   original workdir path is still valid.

## Verification

1. Flip `cemetery.preserve_hard_delete_zip` to `true` on a test host.
2. Repeat the delete-with-folder flow from SCEN-027 S018 on a disposable
   test agent.
3. Confirm the Cemetery UI (Settings → Cemetery tab) now lists the deleted
   test agent even though "Also delete agent folder" was checked.
4. Click Revive; confirm it creates a fresh workdir at a new path (since
   the original was removed) and restores the agent's files from the ZIP.
5. Flip the setting back to `false` (or leave it at default) and confirm
   the original skip-cemetery behavior returns.

## Estimated risk

MEDIUM — touches settings plumbing, the cemetery schema (new `is_orphan`
flag), and the Revive flow's assumption that a cemetery entry's original
workdir path is meaningful. Purely additive/opt-in (default `false`), so
existing behavior for users who don't enable the setting is unaffected.

## Approval log

- 2026-07-07T13:24:46+0200 — REFUSED by USER-delegated batch screening (tier 2). Marginal once TRDD-0301PUYW lands — soft-delete becomes the preserving path; hard-delete stays an explicit user choice.
