---
trdd-id: JQHAXL0N
title: Clean up leftover scen-prefixed agent folders from prior failed scenario runs
column: refused
created: 2026-07-07T12:44:38+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 3
severity: NIT
effort: S
labels: [scenario-improvement, scen-027, batch-backlog-20260707]
task-type: infra
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_027_2026-05-23T00-42-41Z.md"]
---

# TRDD-JQHAXL0N — Clean up leftover scen-prefixed agent folders from prior failed scenario runs

## Problem

SCEN-027 noticed 3 leftover scen-prefixed agent folders under `~/agents/`
that are debris from prior STUCK/PARTIAL runs of OTHER scenarios (not
SCEN-027 itself). Confirmed still present on this host at the time of
this conversion (2026-07-07):
```
/Users/emanuelesabetta/agents/scen006-codex-member
/Users/emanuelesabetta/agents/scen006-manager
/Users/emanuelesabetta/agents/scen022-manager
```
These are not currently causing functional harm but clutter the sidebar
agent list and the `~/agents/` directory listing.

## Root cause

Earlier scenario runs (SCEN-006, SCEN-022) failed or got stuck before
reaching their CLEANUP phase, and per Rule 6 (STICK-TO-UI) the runner
cannot bash-delete agent folders directly — cleanup must go through the
UI's Delete-with-folder flow, which never ran because the scenario didn't
reach that phase.

## Proposed fix

A one-off **manual, UI-driven** cleanup pass (automated bash cleanup would
violate Rule 6 of `tests/scenarios/SCENARIOS_TESTS_RULES.md`):

1. Open the AI Maestro dashboard.
2. For each of the three leftover agents (`scen006-codex-member`,
   `scen006-manager`, `scen022-manager`) — they will likely appear in the
   sidebar's Hibernated/Exited section since their tmux sessions are not
   running — use Profile → Advanced → Danger Zone → Delete Agent, check
   "Also delete agent folder", type the exact agent name to confirm, and
   click "Delete Forever" (re-entering the governance password at the
   sudo modal per Rule 12).
3. Repeat for all three.

This is intentionally a manual/UI action, not a script, per this
project's Rule 6. If a future scenario re-introduces the same class of
leftover-folder debris frequently, consider a separate proposal for a
periodic UI-driven (not bash-driven) housekeeping scenario, rather than
scripting around Rule 6 here.

## Verification

After the manual pass, `ls ~/agents/ | grep '^scen'` (read-only check, not
part of the fix itself) returns empty, and the three agents no longer
appear anywhere in the AI Maestro sidebar (Active or Hibernated).

## Estimated risk

TRIVIAL — manual UI-driven deletion of already-orphaned test agents; no
code change. The only risk is accidentally deleting a real agent if
naming is misread — confirm the exact names above before deleting.

## Approval log

- 2026-07-07T13:24:46+0200 — REFUSED by USER-delegated batch screening (tier 2). Live-host ops cleanup; run interactively, not a tracked code change.
