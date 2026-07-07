---
trdd-id: 3AQD8Z0S
title: Anchor the Help-Assistant drawer inside the viewport and unmount it when closed
column: planned
created: 2026-07-07T03:45:00+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: LOW
effort: S
labels: [scenario-improvement, scen-001, batch-backlog-20260707]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_001_2026-06-23T08-44-04Z.md"]
---

# TRDD-3AQD8Z0S — Help drawer viewport anchoring + closed-state unmount

## Problem
The Help/Assistant right-side drawer renders at x=1280-1700 — fully OFF-SCREEN in a
1280px viewport — and its collapsed state keeps the DOM mounted with `position:fixed`
(translated off-screen) instead of unmounting. Its text leaks into full-page DOM/text
queries and shifts profile-tab x-positions, repeatedly breaking DOM-based automation;
it would equally confuse a screen reader and any narrow-viewport user.

## Root cause
Drawer position is not clamped to the viewport; closed state hides by translation, not
by unmount/`display:none`.

## Proposed fix
(1) Clamp the drawer's left edge to `min(anchorX, viewportWidth - drawerWidth)` so it is
always fully visible when open. (2) When closed, unmount it (or `display:none`) so its
DOM/text is absent from the document. Re-verify the component location first (drawer
component in `components/`) — proposal originates from a 2026-06-23 run.

## Verification
At 1280px width: open the drawer → fully visible; close it → its text absent from
`document.body.innerText`. Automation no longer needs the aria-label-close workaround.

## Estimated risk
LOW — presentation-layer change. Dependencies: none.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
