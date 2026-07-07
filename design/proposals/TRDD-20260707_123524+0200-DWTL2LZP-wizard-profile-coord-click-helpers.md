---
trdd-id: DWTL2LZP
title: Codify wizard and Profile coordinate-click quirks as shared dev-browser helpers
column: proposal
created: 2026-07-07T12:35:24+0200
updated: 2026-07-07T12:35:24+0200
current-owner: scenario-runner
approval-tier: 2
priority: 3
severity: NIT
effort: S
labels: [scenario-improvement, scen-003, batch-backlog-20260707]
task-type: infra
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_003_2026-06-23T10-35-11Z.md"]
---

# TRDD-DWTL2LZP — Add aim_wizard_select_card and aim_open_profile_tab helpers

## Problem

Two dashboard controls reliably swallow a plain `.filter({hasText}).click()` in
dev-browser scripts and need a `page.mouse.click(x,y)` on the element's center instead:
(1) the Agent Creation Wizard's client-selection cards select a wrapper element rather
than the clicked child, and (2) an agent Profile panel's sub-tab bar is pointer-position
sensitive rather than accessible-name clickable. This coordinate-math workaround is
currently repeated inline in scenario scripts and only documented in scenario-runner
agent memory, not in any shared, reusable test helper.

**Evidence:** repeated inline `page.mouse.click(x, y)` coordinate workarounds observed
across SCEN-003 wizard-driving steps and Profile-tab-switching steps in this and prior
runs. Verified 2026-07-07:
`tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh` contains no
`aim_wizard_select_card` or `aim_open_profile_tab` function.

## Root cause

The coordinate-click quirk was discovered and worked around ad hoc, per-scenario, instead
of being generalized into `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh`
(the shared AI Maestro dev-browser helper file per Rule 8), so every new scenario touching
the wizard or a Profile sub-tab re-derives and re-implements the same coordinate math.

## Proposed fix

Add two functions to `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh`:
- `aim_wizard_select_card "<text>"` — locates the wizard client-selection button whose
  accessible text matches `<text>`, computes its bounding-box center, and clicks via
  `page.mouse.click(cx, cy)` instead of `.filter({hasText}).click()`.
- `aim_open_profile_tab "<Overview|Config|Advanced>"` — selects the named agent Profile
  sub-tab via the same coordinate-click fallback, with a short retry loop (the tab bar can
  render before its click targets are laid out).

Prefer `page.getByText(name, {exact: true})` for sidebar agent-card lookups elsewhere
(that control auto-scrolls correctly and does not need the coordinate workaround) — this
proposal is scoped to the two controls that do need it.

## Verification

A SCEN-003 re-run (or any scenario touching the wizard/Profile tabs) uses the two new
helpers and requires no inline coordinate math in its own script body.

## Estimated risk

LOW — additive test-infrastructure helper functions in a shell script; no application
code or production behavior is touched. No product impact.

## Approval log
