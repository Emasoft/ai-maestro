---
trdd-id: 86EN8UK7
title: Top-level Profile tab button ignores synthetic element.click calls
column: planned
created: 2026-07-07T12:36:45+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
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

# TRDD-86EN8UK7 — Top-level Profile tab button ignores synthetic element.click calls

## Problem
SCEN-002 noticed at S023, S032, S055 (report ISSUE-5): the top-level
"Profile" tab button (second row of the terminal/chat/messages/worktree/
search/export/**profile** tab bar, at screen coordinates ~(356,101)) did NOT
reliably switch the main view from Terminal to the Profile sub-panel when
activated via `element.click()` inside a `page.evaluate()` (dev-browser
automation). It reliably worked only via `page.mouse.click(x, y)` at the
tab's coordinates, sometimes needing 2-3 retries even then. The
Overview/Config/Advanced sub-tabs inside the Profile panel only mount once
the panel itself actually switches, so this flakiness gates every step that
depends on the Profile panel being open.

## Root cause
The original hypothesis in the source report guessed the button uses a
pointer-event-only handler (`onPointerDown` instead of `onClick`). **This
hypothesis was checked and is INCORRECT for the outer Profile tab button.**
Verified at HEAD (2026-07-07):
- `app/page.tsx:887` — the outer "Profile" tab button is a plain
  `<button onClick={toggleProfilePanel}>` (not `onPointerDown`), so a
  synthetic `.click()` should normally dispatch through React's event
  delegation exactly like a real click.
- `components/AgentProfilePanel.tsx:465-477` (the Overview/Config/Advanced
  sub-tabs INSIDE the panel) were already fixed for keyboard/a11y under
  UI-MAJ-07 (2026-05-05, predating this scenario run) — they are
  `<button role="tab" onClick={...}>` inside a `role="tablist"` container.
  This confirms the sub-tabs are not the flaky element; the OUTER Profile
  button is.

Since the outer button already uses `onClick`, the automation flakiness is
NOT explained by a pointer-only handler. More likely candidates that need
investigation (not yet confirmed — this proposal narrows the search, it
does not claim to have found the exact mechanism):
1. An overlapping absolutely-positioned sibling (e.g.
   `<AgentSubconsciousIndicator>`, rendered immediately before the Profile
   button at `app/page.tsx:885`) intercepting the click at that exact pixel
   under certain render states.
2. A CSS transition/animation on the tab bar delaying when the button
   becomes the actual hit-target at those coordinates (so a `.click()` fired
   before layout settles lands on the wrong element or a stale node
   reference).
3. `element.click()` producing an `isTrusted: false` event that some
   ancestor listener (e.g. a global click-outside handler used elsewhere in
   the dashboard for dropdowns/modals) swallows before it reaches
   `toggleProfilePanel`.

## Proposed fix
1. Reproduce deterministically first: from a `dev-browser` script, snapshot
   the DOM at the Profile button's coordinates immediately before firing
   `element.click()` to confirm which element is actually the hit-target
   (rule out cause #1).
2. If an overlapping sibling is confirmed, adjust z-index/pointer-events on
   the non-interactive sibling so it cannot intercept clicks meant for the
   tab bar.
3. If a timing/animation issue is confirmed, ensure the button's click
   handler is attached before any entry transition completes (or remove the
   transition from the click hit-area).
4. If neither reproduces, add `page.mouse.click` sequencing as the
   documented/expected automation pattern for this specific button in
   `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh` (a
   `aim_open_profile_panel` helper) so every scenario touching the Profile
   panel gets the reliable path for free, and note in
   `tests/scenarios/SCENARIOS_TESTS_RULES.md` Rule 8's helper list that
   `element.click()` is known-unreliable for this control specifically.

## Verification
1. `dev-browser` script: `element.click()` on the Profile tab opens the
   panel on the FIRST attempt, no retry loop needed.
2. If a genuine root cause (overlap/timing/isTrusted) is fixed, keyboard
   activation (Tab + Enter) onto the same button also opens the panel,
   confirming general click-handling health, not just pointer-click.
3. Re-run SCEN-002 S023/S032/S055 without the retry-loop workaround.

## Estimated risk
LOW. This is either a pure test-infrastructure workaround (documenting the
reliable click pattern) or a small CSS/z-index/timing fix scoped to one
button. No functional behavior change for real users who click with a real
mouse (the button already works for them — the defect is automation-only or
would appear during rapid-successive real clicks in the same failure
window).

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
