---
trdd-id: DECSGBD4
title: Sidebar "+" icon aria-label claims to create an agent but only toggles compact view
column: proposal
created: 2026-07-07T12:36:45+0200
updated: 2026-07-07T12:36:45+0200
current-owner: scenario-runner
approval-tier: 2
priority: 3
severity: LOW
effort: S
labels: [scenario-improvement, scen-002, batch-backlog-20260707]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_002_2026-06-23T10-24-11Z.md", "reports_dev/scenarios-runner/SCEN-002_2026-06-23T10-24-11Z.report.md"]
---

# TRDD-DECSGBD4 — Sidebar "+" icon aria-label claims to create an agent but only toggles compact view

## Problem
SCEN-002 S007/S010 found that the sidebar's "+" icon button
(`aria-label="Create new agent"`) toggles the sidebar's compact/normal
view — it does NOT open the Agent Creation Wizard. The Wizard is launched
by a separate, always-present "Create Agent" TEXT button in the sidebar
header. Two controls with near-identical create-agent intent in their
label/text ("Create new agent" aria-label on the icon vs "Create Agent"
text button) is confusing for both users and browser-automation scripts
that locate elements by accessible name.

## Root cause
Verified at HEAD (2026-07-07) in `components/AgentList.tsx:710-711`: the
"+" icon button carries `aria-label="Create new agent"` and
`title="Create new agent"`, but its `onClick` handler (confirmed by
scenario observation, not re-verified line-by-line in this light
spot-check) toggles the sidebar's compact/normal display mode, not the
agent-creation wizard. The mislabeling is on the icon button, not on the
"Create Agent" text button, which does correctly launch the wizard.

## Proposed fix
Pick one of two disambiguation directions in `components/AgentList.tsx`
around line 695-715:
- **Option A (make "+" do what it says):** wire the "+" icon's `onClick`
  to ALSO open the Agent Creation Wizard (most users expect a "+" icon to
  mean "create new"), and give the compact/normal toggle its own separate,
  differently-labeled control (or keep the existing dedicated
  compact/normal toggle button that the report notes already exists as a
  sibling).
- **Option B (relabel, keep behavior):** change the icon button's
  `aria-label`/`title` from `"Create new agent"` to something accurate for
  its actual function, e.g. `"Switch to compact/normal view"` (matching
  the wording the report notes already exists on a sibling control), so no
  two controls both claim to create an agent.

## Verification
1. Either: clicking the "+" icon opens the Agent Creation Wizard (Option
   A) — re-run SCEN-002 S007/S010 to confirm the icon now behaves as
   labeled; OR: the icon's `aria-label`/`title` no longer says "Create new
   agent" (Option B) — re-run S007/S010 to confirm the text button remains
   the sole wizard launcher and is unambiguously the only "create agent"
   control.
2. An accessibility-tree scan of the sidebar header shows exactly one
   control labeled to create an agent, not two.

## Estimated risk
LOW. Pure UI relabeling or a small wiring change; no data model or API
impact either way.

## Approval log
