---
trdd-id: 3Q4G9ZK6
title: Purging a cemetery archive orphans the agent workdir with no UI path left to remove it
column: proposal
created: 2026-07-29T19:37:18+0200
updated: 2026-07-29T19:37:18+0200
current-owner: scenario-runner
task-type: bugfix
min-approval-requirement: manager
approval-tier: 2
priority: 1
severity: major
effort: small
labels: [scenario-improvement, scen-001, cemetery, cleanup]
external-refs: [reports/scenarios-runner/SCEN-001_20260729T170344Z.report.md]
---

# Cemetery purge leaves a permanently unreachable agent folder

## Problem

A soft delete ("Move to Cemetery") keeps three things: the registry tombstone, the cemetery
zip, and `~/agents/<name>/`. Purging the archive removes only the zip. The agent is then
invisible under every sidebar filter — SCEN-001 checked ALL, HIBER and ACTIVE with the name
in the search box and got `false` from all three — so there is no UI affordance left that
can reach it, and the DeleteAgent pipeline is the only sanctioned remover of a workdir
(scenario Rule 1 forbids `rm -rf`, and the server legitimately re-creates folders whose
records survive). Every soft-delete-then-purge therefore leaves permanent litter, and a
scenario that follows its own cleanup rules cannot discharge it.

## Root cause

Purge is scoped to the archive file. Nothing in the purge path asks what the archive was the
last recoverable copy OF. Once it is gone the tombstone is unrevivable, so keeping the
tombstone and the folder buys nothing — but no code owns their removal.

## Proposed fix

Make purge complete the deletion it is the last step of. In the cemetery purge handler
(`DELETE /api/agents/cemetery`), after removing the zip:

- if a registry tombstone exists for that agent name and no other archive references it,
  route it through the existing DeleteAgent hard path so the tombstone, the persisted
  session row, the tmux session and — behind an explicit "also remove the folder" choice in
  the Purge Forever dialog — the workdir all go together;
- gate the folder removal on the same `~/agents/` guard DeleteAgent already applies, so an
  adopted external workdir is never touched.

Surface it honestly in the dialog: today it says "Permanently delete the archive of X? This
cannot be undone" while leaving two other artifacts behind.

## Verification

- Soft-delete an agent, purge its archive, then confirm: `ls ~/agents/<name>` fails,
  `jq '.[].name' ~/.aimaestro/agents/registry.json` does not contain it, and
  `jq '.[].id' ~/.aimaestro/sessions.json` has no row for it.
- An adopted-workdir agent (outside `~/agents/`) keeps its folder after the same sequence.

## Estimated risk

MED — it makes a purge more destructive than it is today, so the dialog copy and the
`~/agents/` guard are load-bearing. Depends on DeleteAgent's hard path being callable with
only a tombstone as input.

## Approval log
