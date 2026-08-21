---
trdd-id: 9YB99SRW
title: Surface why the governance-title control is inert on a dead-client agent
column: proposal
min-approval-requirement: none
priority: 2
severity: low
effort: small
task-type: bugfix
created: 2026-07-14T20:39:44+0200
updated: 2026-07-14T20:39:44+0200
current-owner: scenario-runner
labels: [scenario-improvement, scen-030]
external-refs: [reports/scenarios-runner/SCEN-030_20260714T181702Z.report.md]
---

## Problem

On agent `jack-bot` — whose terminal reads "Agent terminal locked — No AI program
is running in this pane right now — the agent is in transition (waking, restarting,
or you typed /exit)" — the Agent Profile → Overview MANAGER pill and the
Governance-Title row control did NOT open the Title Assignment Dialog across five
distinct click strategies (mouse-click on the pill, on the row button, and on
`MANAGER` buttons located structurally). Either title changes are (correctly)
disabled while the agent is mid-transition and the UI gives no visible reason, or
the dialog opener regressed in this build (0.28.0 / gov 0.35.54).

## Root cause

Undetermined (low confidence; not fully diagnosed because confirming on a healthy
agent would risk mutating a blacklisted litter agent). Two candidates:
1. The dialog opener is gated on session/activity state and short-circuits when the
   agent is in the dead-client "locked/transition" state — but with no disabled
   styling or tooltip, so it looks clickable-but-does-nothing.
2. The opener element moved (SCEN-020, 2026-06-25, opened it via the
   "Governance Title ROW BUTTON (shield svg)"); on a locked agent the row may
   render differently.

## Proposed fix

- Locate the Title-badge / Governance-Title-row `onClick` handler in
  `components/agent-profile/` (Overview + the title row). If it is guarded by a
  transition/locked predicate, make the guard VISIBLE: render the control
  `disabled` with `cursor:not-allowed` + a tooltip ("Title changes are unavailable
  while the agent is in transition — wake or hibernate it first"). If it is NOT
  guarded, fix the opener so a click reliably opens the dialog regardless of
  session state.
- Add a scenario-side note in dev-browser-ui-quirks memory once the mechanism is
  confirmed.

## Verification

- On a dead-client / locked agent: the title control either opens the dialog OR
  visibly shows a disabled state with a reason (no silent no-op).
- On a healthy online agent: clicking the title control opens the Title Assignment
  Dialog every time.
- Add/extend a component test asserting the control's enabled/disabled state tracks
  the agent transition flag.

## Estimated risk

LOW-MED. UI-only. Risk that the "correct" behaviour is context-dependent (locked
agents legitimately shouldn't change title mid-transition) — the fix is primarily
about making that state legible, not about forcing the dialog open.

## Approval log
