---
trdd-id: 9KMWH05E
title: One-time cleanup pass for orphan scen* teams, COS agents, and cemetery entries
column: proposal
created: 2026-07-07T12:35:24+0200
updated: 2026-07-07T12:35:24+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: LOW
effort: S
labels: [scenario-improvement, scen-003, batch-backlog-20260707]
task-type: infra
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_003_2026-06-23T10-35-11Z.md"]
---

# TRDD-9KMWH05E — Manual cleanup of accumulated scen* test residue

## Problem

The host carries leftover scenario-test residue from prior runs, left by earlier
incomplete cleanups (most plausibly caused by the DeleteTeam revert-not-delete behavior
before it was fixed by the "Delete member agents too" cascade checkbox). Verified
2026-07-07 via `~/.aimaestro/teams/teams.json`, the orphan teams `scen003-test-wizard-team`
and `scen8-noplugin-team` are STILL present alongside the user's real `Test Kanban Team`.
`~/.aimaestro/cemetery/` also carries multiple stale `scen*` archive entries from
past runs (e.g. `scen001-test-title-agent-export-*.zip`, `scen005-test-manager-export-*.zip`,
`scen005-test-team-member-export-*.zip`, `cos-scen005-test-governance-team-export-*.zip`,
`cos-scen006-governance-team-export-*.zip`, `scen-test-manager-export-*.zip`, and others).

## Root cause

Downstream of the (now-fixed) DeleteTeam revert-only behavior: prior to the cascade
checkbox landing, team-disband reverted members to AUTONOMOUS and hibernated them instead
of deleting them, orphaning the auto-COS agent for each disbanded team. Combined with the
sidebar-search-misses-hibernated-agents bug (companion proposal TRDD-0EZG26KI), these
orphans were hard to find and were never manually cleaned up.

## Proposed fix

A one-time, UI-driven cleanup pass (per Rule 6 — no direct file/registry edits):
1. Open the Teams tab, identify `scen003-test-wizard-team` and `scen8-noplugin-team` as
   test residue (NOT `Test Kanban Team`, which is a real user team — confirm with the user
   before touching anything named ambiguously).
2. Delete each orphan team via the DeleteTeam dialog with "Delete member agents too"
   checked, so their member agents (including auto-COS) are removed via the full
   DeleteAgent pipeline in the same action.
3. Navigate to Settings → Cemetery tab and Purge every `scen*`-prefixed entry
   (`scen001-test-title-agent-export-*`, `scen005-test-manager-export-*`,
   `scen005-test-team-member-export-*`, `cos-scen005-test-governance-team-export-*`,
   `cos-scen006-governance-team-export-*`, `scen-test-manager-export-*`, and any other
   `scen*`/`cos-scen*` entries found at cleanup time).
4. Do not delete `_aim-assistant-export-*` or any non-`scen*`-prefixed cemetery entry —
   those are not scenario-test artifacts.

This is a one-time host-state cleanup, not a code change. See also TRDD-WHAE30E7
(cemetery TTL + batch purge), a separate proposal for an ongoing/automatic retention
policy — that proposal prevents future re-accumulation; this proposal clears the existing
backlog and is not superseded by it.

## Verification

Post-cleanup: `GET /api/teams` (or the Teams tab) lists only the user's real teams (`Test
Kanban Team` and any others confirmed real); zero `scen*`/`cos-scen*` teams remain; the
Cemetery tab shows zero `scen*`/`cos-scen*` entries.

## Estimated risk

LOW — deletes only already-identified test residue via the standard UI delete pipeline
(which itself is audited and reversible via the cemetery archive step for member agents,
if the cascade delete is soft rather than hard — confirm dialog wording at execution
time). Dependencies: best done after confirming the DeleteTeam cascade fix and the
sidebar-search fix (TRDD-0EZG26KI) are in place, so future runs don't re-accumulate the
same residue.

## Approval log
