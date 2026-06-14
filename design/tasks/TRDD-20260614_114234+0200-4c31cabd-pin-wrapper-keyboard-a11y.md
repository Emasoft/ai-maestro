---
trdd-id: 4c31cabd-2638-40be-aa44-b98f53dbc9f2
title: Make the chat-bubble pin-on-click affordance keyboard accessible
status: not-started
created: 2026-06-14T11:42:34+0200
updated: 2026-06-14T11:42:34+0200
---

# TRDD-4c31cabd — Keyboard-accessible pin affordance in the chat transcript

**Source:** pre-merge UI review of TRDD-1657a5f4, finding **NIT-1**. Report: `reports/chat-history-review/ui-20260614_110842+0200.md`.

## Problem
`components/agent-profile/sessions/ChatTranscript.tsx:911-918` — the "click to pin to context breakdown" row wrapper is a `<div onClick aria-label="Click to pin…">` with NO `role="button"` and NO `onKeyDown`. The affordance is mouse-only: announced to assistive tech (it has an aria-label) but not actionable via keyboard. Pre-existing (not introduced by TRDD-1657a5f4), low impact (pinning is a convenience; the bubble's role/timestamp/tokens/text are independently exposed), but a real a11y gap.

## Proposed change
Add `role="button"`, `tabIndex={0}`, and an `onKeyDown` handler that fires the pin action on Enter/Space to the wrapper. Do NOT convert it to a `<button>`: the bubble already contains a copy button, export checkbox, reasoning `<summary>`, and cost-toggle, so a `<button>` wrapper would nest interactives (hydration error + the no-nested-button rule). The `role` + `tabIndex` + `onKeyDown` div approach is the correct pattern here.

## Derived tasks / risks
- Add a visible focus indicator (focus-visible ring) so keyboard users can see the focused row.
- `preventDefault` on Space so it doesn't double-trigger page scroll.
- Keep `stopPropagation` on the inner interactives so keyboard activation of the row doesn't conflict with them.

## Acceptance
- The pin affordance is operable by keyboard (Enter/Space) with a visible focus indicator; no nested-button hydration error.
- `yarn test` + `tsc --noEmit` green.
