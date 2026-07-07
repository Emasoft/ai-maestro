---
trdd-id: 01XGWKNF
title: Fix Agent Creation Wizard avatar-pagination vs advance-arrow coordinate collision
column: proposal
created: 2026-07-07T12:35:40+0200
updated: 2026-07-07T12:35:40+0200
current-owner: scenario-runner
approval-tier: 2
priority: 3
severity: LOW
effort: S
labels: [scenario-improvement, scen-024, batch-backlog-20260707]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_024_2026-05-04T11-36-31Z.md"]
---

# TRDD-01XGWKNF — Fix Agent Creation Wizard avatar-pagination vs advance-arrow coordinate collision

## Problem
`components/AgentCreationWizard.tsx` renders both a wizard step-advance arrow
(`ChevronRight` at line 943, confirmed present on 2026-07-07) and a separate
avatar-grid pagination control (`avatarPage` state at line 185, passed to a subgrid
component at line 820) whose on-screen coordinates have been reported as colliding
in prior scenario runs (SCEN-020, SCEN-022, SCEN-023, and now re-reported by
SCEN-024). Automated UI drivers have had to resort to "find the largest SVG-only
button" heuristics to reliably click the intended control, because the two buttons
sit close enough on screen that naive coordinate- or selector-based clicks land on
the wrong one.

## Root cause
The avatar pagination "Next" control and the wizard's own forward-advance arrow were
positioned independently without a layout pass to check for visual/hit-area overlap
at the viewport sizes scenario tests run at (desktop 1280x800 per
`tests/scenarios/SCENARIOS_TESTS_RULES.md` `device` field).

## Proposed fix
In `components/AgentCreationWizard.tsx`, increase the size and/or reposition the
avatar-grid pagination "Next"/"Previous" buttons so they sit clearly outside the
wizard's forward-advance arrow's click area — e.g. move them to the bottom-left/right
margin of the avatar grid itself, away from the wizard's own navigation controls'
vertical track. Add distinct `data-testid` or `aria-label` attributes to both
controls (e.g. `data-testid="wizard-advance"` vs `data-testid="avatar-page-next"`) so
future automated tests can target them unambiguously instead of relying on
size-based SVG heuristics.

## Verification
At the scenario-standard desktop viewport (1280x800), take a snapshot of the wizard's
avatar-selection step and confirm the two controls' bounding boxes do not overlap or
sit within a few pixels of each other. Re-run a scenario that exercises agent
creation (e.g. SCEN-020) using selector-based (not largest-SVG-heuristic) clicks on
both controls and confirm both work correctly.

## Estimated risk
LOW — layout-only change in one wizard step; no data/API changes. Dependencies: none,
though implementing the `data-testid` attributes benefits every scenario that drives
the Agent Creation Wizard.

## Approval log
