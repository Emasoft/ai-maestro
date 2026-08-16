---
trdd-id: FY6I2MO2
title: agent-creation wizard completion modal can persist and overlay the dashboard, blocking Delete
column: planned
created: 2026-07-23T12:51:14+0200
updated: 2026-08-16T16:43:00+0200
current-owner: session
task-type: bugfix
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-23T12:51:14+0200
relevant-rules: []
eht: []
npt: []
implementation-commits: []
external-refs:
  - reports/scenarios-runner/SCEN-031_20260722T203644Z.report.md (ISSUE-001)
  - reports/scenarios-runner/SCEN-031_20260723T054536Z.report.md (ISSUE-001)
---

# TRDD-FY6I2MO2 — Wizard completion modal can persist and overlay the dashboard

## Problem

The Agent Creation Wizard's completion screen ("Your Agent is Ready! / Let's Go!") does not
reliably dismiss. Observed independently in **two separate SCEN-031 runs**:

- Run `SCEN-031_20260722T203644Z` ISSUE-001 (WARN): the "Let's Go!" completion modal stayed open
  after agent creation and later **overlaid the Profile panel, blocking the Delete flow** until
  manually dismissed.
- Run `SCEN-031_20260723T054536Z` ISSUE-002 (INFO): "Wizard 'Let's Go!' click can miss, leaving a
  stale 'Your Agent is Ready!' modal overlaying the dashboard (MEMORY-known). Harmless here (DOM-level
  Chat interactions still reached the composer) but confusing; dismiss-on-navigate would help."

The recurrence across two independent runs on different days indicates this is not a one-off
timing fluke but a real UI defect: either the "Let's Go!" button's click target is unreliable, or
the modal fails to unmount when the user navigates away (e.g. via a profile/tab switch) without
explicitly clicking through it.

## Proposed fix

1. Locate the Wizard completion step component (search `components/AgentCreationWizard.tsz` /
   `Your Agent is Ready` / `Let's Go`) and verify the "Let's Go!" button's click handler actually
   closes the wizard modal state (not just navigates in the background while the modal stays mounted).
2. Add a **dismiss-on-navigate** safeguard: if the user navigates elsewhere (selects a different
   agent, opens a different tab/panel) while the wizard completion modal is still mounted, force-close
   it as a matter of course — a modal must never persist across a navigation it didn't initiate.
3. Verify the modal's z-index / overlay stacking does not sit above the Profile panel's Danger Zone
   controls once closed — confirm click-through is impossible while any part of the modal is present
   (even semi-transparent/fading-out).
4. Add a UI regression scenario step (or extend an existing wizard-related scenario) asserting the
   modal is fully gone (no DOM node, not just `display:none`) after clicking "Let's Go!".

## Verification

- Re-run SCEN-031 (or a lighter wizard-focused scenario) through agent creation, click "Let's Go!",
  and confirm no residual modal DOM node blocks a subsequent Delete-agent flow via the Profile panel.
- Confirm switching agents/tabs immediately after wizard completion (without explicitly clicking
  "Let's Go!") also leaves no stale overlay.

## Estimated risk

LOW. Confined to a single wizard-completion component; no data-model or governance implications.
No dependencies on other open TRDDs.

## Acceptance

- [ ] The Wizard completion step's "Let's Go!" click handler closes the modal (unmounts it, not just navigates behind it) — verified by reading the component.
- [ ] A dismiss-on-navigate safeguard force-closes the completion modal if the user navigates away (selects another agent/tab) without clicking through.
- [ ] Screenshot/UI check: after clicking "Let's Go!", no residual modal DOM node exists (not just `display:none`), and the Profile panel's Danger Zone Delete control is clickable immediately after.
- [ ] Screenshot/UI check: switching agents/tabs right after wizard completion, without clicking "Let's Go!", leaves no stale overlay blocking the dashboard.
- [ ] SCEN-031 (or a lighter wizard-focused scenario) re-run shows no ISSUE-001/ISSUE-002-shaped finding about the completion modal.

## Approval log

- 2026-07-23T12:51:14+0200 — MANDATE by USER (report→TRDD conversion, "you have my trust").
