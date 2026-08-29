---
trdd-id: FY6I2MO2
title: agent-creation wizard completion modal can persist and overlay the dashboard, blocking Delete
column: dev
created: 2026-07-23T12:51:14+0200
updated: 2026-08-29T18:17:27+0200
current-owner: ai-maestro-hub-session
assignee: ai-maestro-hub-session
created-by: ai-maestro-hub-session
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
implementation-commits: [3a9c9041]
external-refs:
  - reports/scenarios-runner/SCEN-031_20260722T203644Z.report.md (ISSUE-001)
  - reports/scenarios-runner/SCEN-031_20260723T054536Z.report.md (ISSUE-001)
---

# TRDD-FY6I2MO2 — Wizard completion modal can persist and overlay the dashboard

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-29

**The code fix has LANDED. What remains is UI verification, and it needs the owner.**

- **The card's diagnosis was half wrong, and the correction is the point.** Boxes 1 and 2
  named a modal that "navigates behind" and a "dismiss-on-navigate" safeguard. Measured
  against the source: the modal DOES unmount — both mount sites render it as
  `{flag && <AgentCreationWizard …/>}` (`components/AgentList.tsx:1663`,
  `components/MobileDashboard.tsx:441`) and both `onClose` and `onComplete` clear that
  flag. And "the user navigates away while the modal is mounted" is UNREACHABLE: the
  wizard is a `fixed inset-0 z-50` overlay, so there is nothing to navigate to.
  **The real defect is the exact reverse** — the completion screen had only ONE exit.
  `handleCreate` sets `isCreating` true and never sets it false on success, and the
  backdrop was `onClick={isCreating ? undefined : onClose}`, so on the completion screen
  the backdrop was inert and "Let's Go!" was the sole way out of a full-screen overlay.
  A missed click therefore parked it over the dashboard, blocking Delete.
- **Fixed** in `components/AgentCreationWizard.tsx`: one shared `dismiss` callback; the
  backdrop guard narrowed to `isCreating && !creationSuccess`; the header X and "Let's
  Go!" both routed through `dismiss`. After success every route goes to `onComplete`,
  never `onClose` — a bare close leaves the parent's `activeAgentId` on the PREVIOUS
  agent, which is the SCEN-005 wrong-agent-delete near-miss (Proposal 31). That second
  bug was live on the header X and is closed by the same change.
- **Test:** `tests/unit/wizard-completion-dismiss.test.tsx`, 6/6 green. Three neuters run,
  each reddening exactly one distinct test (backdrop guard reverted → the in-flight test;
  "Let's Go!" calling `onComplete` directly → the id-handoff test; X wired to a no-op →
  the behavioural X test). The success branch is pinned STRUCTURALLY, not behaviourally:
  reaching it from a unit test needs a full drive of six wizard steps plus a 6.5 s
  animation and a POST — so that half carries a positive control instead.
- `yarn tsc --noEmit` exit 0.

**Adversarial review (2026-08-29) — three corrections worth carrying forward:**

- **The "unreachable overlay" claim was first settled by reading a className, which cannot
  establish hit-testing; the second attempt grepped only the three files already believed
  relevant, which is scoping the search to the hypothesis.** Settled on the third pass over
  the right population — `pointer-events|pointerEvents` across `app/ components/ styles/`
  including `.css`, since a global stylesheet rule applied by className is invisible to a
  `.tsx` grep. Result: the ONLY global CSS rule is `.xterm .xterm-accessibility*` in
  `app/globals.css:154`, irrelevant here; the wizard is not portaled (6 other components
  use `createPortal`, it is not among them); its own subtree's only `pointer-events-none`
  is the decorative blur div at `AgentCreationWizard.tsx:561`, inside the left panel. The
  conditional pane rules (`MobileDashboard.tsx:198,239`, `TabletDashboard.tsx:183,216`,
  `zoom/AgentCardView.tsx:210,235,259`) were the real risk, because they would make the
  overlay click-through exactly when a pane is INACTIVE — the intermittent shape the bug
  report has. They are ruled out by TRACING, not by z-index: MobileDashboard's per-agent
  panes live inside `onlineAgents.map(...)` which opens at line 188 and closes at 276,
  while the wizard mounts at 441, outside it; and neither TabletDashboard nor
  AgentCardView renders `MobileDashboard` or `<AgentList`, so their panes cannot be
  ancestors of either mount.
- **The SCEN-031 note "DOM-level Chat interactions still reached the composer" LIKELY does
  not contradict this, but that is an inference, not a reading.** A synthetic event
  dispatched on an element reference bypasses hit-testing, while a CDP-driven click does
  not — and the runner's actual dispatch path was not read. Do not treat this line as
  settled: it is the only EMPIRICAL observation in the file, and dismissing observed
  behaviour with an unread mechanism is backwards. Read the runner before relying on it.
- **NEW surface, accepted, not guarded:** the backdrop is now live on the success screen,
  so two rapid clicks before the parent re-renders would fire `onComplete` twice → two
  `onRefresh()` + two `onAgentCreated(id)`. Both VERIFIED idempotent by reading their
  definitions, not assumed: `handleAgentCreated` (`app/page.tsx:474`) is two setState calls
  with identical values, and `refreshAgents` (`hooks/useAgents.ts:316`) just calls
  `loadAgents()`, which the hook already re-runs on a poll timer — so a second fire costs
  one wasted request and nothing else. Recorded rather than guarded; revisit if either
  callback stops being idempotent.
- **The behaviour-preservation argument for "Let's Go!" was backwards** and is corrected
  in the code comment: it does not rest on `showLetsGo ⇒ creationSuccess` at set time, it
  rests on `creationSuccess` being MONOTONIC (one write site, `true`, never reset).

**NEXT ACTION — needs the owner, do not self-authorize.** Acceptance boxes 3-5 are UI
checks and the ai-maestro server is STOPPED by owner directive ("do NOT restart"). Ask
for a go-ahead to start the server, then drive the wizard to completion and confirm (a)
no residual modal DOM node after "Let's Go!", (b) the backdrop and X now dismiss the
completion screen, (c) Delete in the Profile panel is immediately clickable.

**Instruments added for that run:** `data-testid="agent-creation-wizard"` (the modal
root — assert its ABSENCE, not `display:none`), `wizard-close`, `wizard-lets-go`.

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

- [x] The Wizard completion step's "Let's Go!" click handler closes the modal (unmounts it, not just navigates behind it) — verified by reading the component. **It already did**: both mount sites are `{flag && <AgentCreationWizard …/>}` and both callbacks clear the flag. The premise was wrong; see STATE.
- [x] ~~A dismiss-on-navigate safeguard force-closes the completion modal if the user navigates away (selects another agent/tab) without clicking through.~~ **Unreachable as written** — a `fixed inset-0 z-50` overlay leaves nothing to navigate to. Implemented the safeguard the symptom actually calls for: after success the backdrop and the header X dismiss the completion screen (through `onComplete`, keeping the agent-id handoff), so a missed "Let's Go!" no longer traps the user under the overlay.
- [ ] Screenshot/UI check: after clicking "Let's Go!", no residual modal DOM node exists (not just `display:none`), and the Profile panel's Danger Zone Delete control is clickable immediately after. **BLOCKED — server stopped by owner directive; needs a go-ahead to start it.**
- [ ] Screenshot/UI check: the backdrop and the X dismiss the completion screen, leaving no stale overlay blocking the dashboard. **BLOCKED — same.** (Restated from the unreachable "switch agents/tabs" phrasing; see STATE.)
- [ ] SCEN-031 (or a lighter wizard-focused scenario) re-run shows no ISSUE-001/ISSUE-002-shaped finding about the completion modal. **BLOCKED — same.**

## Approval log

- 2026-07-23T12:51:14+0200 — MANDATE by USER (report→TRDD conversion, "you have my trust").
- 2026-08-29T18:17:27+0200 — `planned → dev` by ai-maestro-hub-session (min-approval-requirement: none). Code fix landed in `3a9c9041`; boxes 1-2 closed with their premises corrected (see STATE), boxes 3-5 BLOCKED on the owner's go-ahead to start the stopped server.
