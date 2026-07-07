---
trdd-id: EQ6URGCC
title: SCEN-003 scenario file is stale — 3 recurring step discrepancies + deprecated frontmatter
column: planned
created: 2026-07-07T12:35:24+0200
updated: 2026-07-07T13:59:52+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: LOW
effort: S
labels: [scenario-improvement, scen-003, batch-backlog-20260707]
task-type: docs
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_003_2026-06-23T10-35-11Z.md"]
---

# TRDD-EQ6URGCC — Fix stale expectations in tests/scenarios/SCEN-003_agent-creation-wizard.scen.md

## Problem

Three step expectations in `tests/scenarios/SCEN-003_agent-creation-wizard.scen.md` are
wrong against current, correct app behavior, and have been re-discovered on every SCEN-003
run (2026-04-19, 2026-04-20, 2026-04-27, and the 2026-06-23 run this proposal is based
on). The frontmatter also still declares the deprecated chrome-devtools tool list.
Verified 2026-07-07 — all four issues are still present at HEAD:

1. **S029 (line ~286-291)** — `Verify:` says "Unlike INTEGRATOR, MEMBER title allows user
   choice (not locked)". Actual behavior: the MEMBER role-plugin is auto-LOCKED at
   creation (R9.13 — only one compatible plugin exists, so no dropdown appears; a
   dropdown appears only when ≥2 compatible plugins exist).
2. **S040 (line ~385-390)** — `Action:` says click "Delete Agents Too" in the second
   dialog. The DeleteTeam dialog's actual button label (per
   `components/sidebar/TeamListView.tsx`) is "Delete Team + Agents" (only shown when the
   "Delete member agents too" checkbox is checked) or plain "Delete Team" otherwise — the
   step's literal button text does not match either label, and doesn't mention checking
   the checkbox first.
3. **S037 (line ~350-355)** — `Goal:`/`Verify:` expect HTTP 403 for a self-modification
   attempt via `PATCH /api/agents/[id]`. Actual: AID Bearer-auth is checked before the
   no-self-mod AUTHZ rule, so an unauthenticated self-mod attempt returns 401, not 403
   (see the companion doc-gap proposal for the AID ordering itself).
4. **Frontmatter (line 4, 45)** — `version: "2.0"` and a `required_tools:` block listing
   `mcp__chrome-devtools__*` tools are both stale; `browser_stack: dev-browser` per Rule 8
   has superseded `required_tools` project-wide since 2026-04-15.

## Root cause

The scenario file was authored before the current MEMBER auto-lock behavior (R9.13), the
current DeleteTeam cascade-checkbox UI, the AID Bearer-auth-precedes-403 ordering, and the
dev-browser migration were finalized, and was never updated to match. Each SCEN-003 run
re-derives (and manually "adapts" around) the same three discrepancies instead of the
scenario file reflecting ground truth.

## Proposed fix

Edit `tests/scenarios/SCEN-003_agent-creation-wizard.scen.md`:
1. Reword S029's `Goal`/`Verify` to: "verify the plugin is auto-locked at creation (R9.13
   mandatory, single compatible plugin); the post-creation 'Change' affordance is checked
   in S033" (not "allows user choice").
2. Reword S040's `Action` to the actual 2-step flow: open the DeleteTeam dialog, check the
   "Delete member agents too" checkbox, enter the governance password, click the button
   (labeled "Delete Team + Agents" once the checkbox is checked). Since the DeleteTeam
   cascade fix already ships this correctly (verified 2026-07-07 in
   `components/sidebar/TeamListView.tsx`), S040 no longer needs a separate S040b
   "delete the orphaned auto-COS manually" step — the cascade removes it in one action.
   Remove the old S040b if present, or confirm it is now redundant.
3. Change S037's `Verify` to accept "401 OR 403 — request rejected AND no mutation" as the
   pass condition, and add an explicit assertion that the target agent's label is
   unchanged after the attempt (the real security property being tested).
4. Replace the `required_tools: [mcp__chrome-devtools__*]` frontmatter block with
   `browser_stack: dev-browser`.
5. Bump `version:` from `"2.0"` to `"2.1"`.

## Verification

Next SCEN-003 run produces 0 ADAPTED steps (all steps PASS exactly as written) and no
"scenario expectation wrong" notes in the run report.

## Estimated risk

LOW — scenario-file-only edit, no application code touched. Dependencies: none, but item
2's rewrite assumes the DeleteTeam cascade checkbox (verified already shipped) stays
stable, and item 3's rewrite is easier to phrase precisely once the companion AID
401-vs-403 documentation proposal lands (not a hard blocker — the step text can state the
observed behavior either way).

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
- 2026-07-07T13:59:52+0200 — IMPLEMENTED (wave W1): S029 reworded to auto-lock (R9.13); S040 rewritten to the correct single-dialog cascade-checkbox flow (no separate S040b needed — none existed); S037 now accepts 401 OR 403 + unchanged-label assertion; `required_tools:` replaced with `browser_stack: dev-browser`; bumped `version:` to "2.1".
