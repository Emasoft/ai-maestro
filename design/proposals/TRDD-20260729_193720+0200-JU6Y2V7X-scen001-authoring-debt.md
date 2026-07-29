---
trdd-id: JU6Y2V7X
title: SCEN-001 carries deprecated chrome-devtools frontmatter and two steps that cannot be run through the UI
column: proposal
created: 2026-07-29T19:37:20+0200
updated: 2026-07-29T19:37:20+0200
current-owner: scenario-runner
task-type: docs
min-approval-requirement: chief-of-staff
approval-tier: 1
priority: 2
severity: minor
effort: small
labels: [scenario-improvement, scen-001, test-infrastructure]
external-refs: [reports/scenarios-runner/SCEN-001_20260729T170344Z.report.md]
---

# SCEN-001 authoring debt: stale tool frontmatter, un-runnable RBAC steps, two slow UI paths

## Problem

Four separate frictions surfaced in the 2026-07-29 run. None broke a passing step; all cost
time or forced a DEFERRED.

1. **Stale frontmatter.** SCEN-001 still declares `required_tools:` with five
   `mcp__chrome-devtools__*` entries, deprecated since 2026-04-15 (Rule 8). It has no
   `browser_stack: dev-browser`.
2. **S014 and S032 cannot be executed.** Both instruct the runner to send
   `PATCH /api/agents/<id>` with an identity header and no Bearer. That is an out-of-UI
   mutation attempt — forbidden by Rule 6 and blocked by the subagent write-guard — so both
   are permanently DEFERRED. Their assertion (401 before RBAC runs) is already pinned in
   `tests/authorization.test.ts`.
3. **Create Team sits on "Saving…" for 30-60s** while the auto-COS is created and its
   role-plugin installed. The team and COS are in `teams.json` long before the dialog
   closes; with no progress detail the state is indistinguishable from a hang, and a runner
   that gives up mid-wait leaves a half-built team.
4. **The Settings "Cemetery" nav item is overlapped by the "Update Available" banner** —
   `document.elementFromPoint()` at the item's centre resolves to the banner, so a click at
   that point activates the banner instead of the nav item.

## Root cause

(1) and (2) predate the current rules; (3) is a synchronous create path doing network work
with a binary spinner; (4) is a z-order/layout overlap in the Settings sidebar.

## Proposed fix

- Replace `required_tools:` with `browser_stack: dev-browser` in the scenario frontmatter.
- Rewrite S014/S032 as *read-only* verification steps that cite the covering unit test, or
  delete them and note the coverage in the phase preamble. Do not leave steps whose only
  execution is a rule violation.
- Give the Create Team dialog a staged status ("creating team… creating chief-of-staff…
  installing role-plugin…") sourced from the same pipeline the ops log already emits.
- Fix the Settings sidebar overlap so the banner cannot cover a nav target (or render the
  banner above the nav flow rather than over it).

## Verification

- `yq '.required_tools' tests/scenarios/SCEN-001_*.scen.md` → null; `.browser_stack` → `dev-browser`.
- A full SCEN-001 run reports zero DEFERRED steps.
- Create Team's dialog text changes at least twice before it closes.
- `document.elementFromPoint()` at the Cemetery item's centre resolves inside that item.

## Estimated risk

LOW for the scenario edits and the overlap fix; LOW-MED for the staged status, which needs a
progress channel from the create pipeline to the dialog.

## Approval log
