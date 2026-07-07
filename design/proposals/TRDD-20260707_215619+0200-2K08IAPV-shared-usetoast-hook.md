---
trdd-id: 2K08IAPV
title: Add a shared useToast hook to replace the hand-rolled toast in 6+ components
column: proposal
created: 2026-07-07T21:56:19+0200
updated: 2026-07-07T21:56:19+0200
current-owner: code-review
assignee: null
priority: 3
severity: NIT
effort: M
labels: [code-review, review-batch-20260707, reuse, tech-debt, frontend]
task-type: refactor
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports/code-review/20260707_175225+0200-finder-CLEAN.json"]
---

# TRDD-2K08IAPV — Add a shared useToast hook to replace the hand-rolled toast in 6+ components

## Problem

The dismissable auto-hide toast pattern —
`useState<string|null>(null)` + `useEffect(() => setTimeout(dismiss, N))` +
a dismiss-button — is hand-rolled independently in at least six places:
`contexts/SudoContext.tsx` (TRDD-HZDD1CUD, 8000ms),
`components/settings/SecuritySection.tsx` (4000ms),
`AgentProfilePanel.tsx`, `MessageCenter.tsx`, `MobileMessageCenter.tsx`,
`TeamOverviewSection.tsx`, `ClientSection.tsx`. No shared
`useToast()`/`ToastProvider` exists.

## Root cause

The pattern was copied each time a component needed a toast; no shared hook was
ever extracted, so each copy picks its own duration and markup.

## Proposed fix

Add one `hooks/useToast.ts` (or a small `ToastProvider` + `useToast()` context)
that owns the state, the auto-dismiss timer (single default duration, overridable
per call), stacking order, focus management, and markup. Migrate the six+ call
sites to it and delete their local toast state/effect/markup.

## Verification

- Grep shows the local `setTimeout(... setToast(null) ...)` pattern gone from
  the migrated components; two toasts firing in one view stack consistently.
- `npx vitest run` green; a hook unit test covers auto-dismiss + manual dismiss.

## Estimated risk

LOW. Pure UI consolidation, no server/behavior change. Do it as one PR touching
only the six+ components + the new hook so the diff is reviewable in one pass.

## Approval log
