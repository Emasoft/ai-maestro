---
trdd-id: 2K08IAPV
title: Add a shared useToast hook to replace the hand-rolled toast in 6+ components
column: complete
created: 2026-07-07T21:56:19+0200
updated: 2026-08-29T17:14:37+0200
current-owner: code-review
assignee: ai-maestro-hub-session
priority: 3
severity: NIT
effort: M
labels: [code-review, review-batch-20260707, reuse, tech-debt, frontend]
task-type: refactor
min-approval-requirement: none
parent-trdd: null
npt: []
eht: []
relevant-rules: []
implementation-commits: [30c6b831]
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

## ⚠ CORRECTED ON EXECUTION — "6+ components" is FOUR, and one of them was BROKEN

The card names seven files. Measured before touching anything (`grep -nE "setTimeout\(|const \[[a-zA-Z]*[Tt]oast"` on each), the auto-dismiss toast pattern exists in **four**:

| file | state shape | duration | correct? |
|---|---|---|---|
| `contexts/SudoContext.tsx:74` | `string \| null` | 8000 ms | yes (effect + cleanup) |
| `components/settings/SecuritySection.tsx:376` | `{type,message} \| null` | 4000 ms | yes (effect + cleanup) |
| `components/MessageCenter.tsx:64` | `{message,type} \| null` | 3000 ms | yes (ref + clear + unmount) |
| `components/MobileMessageCenter.tsx:81` | `{message,type} \| null` | 3000 ms | **NO** |

**Three of the seven named files have no toast at all** — `AgentProfilePanel.tsx`,
`TeamOverviewSection.tsx` and `ClientSection.tsx` match zero toast state and zero dismiss timer.
An earlier count of 3/2/1 "toast" hits in them was the substring matching something else. So the
card's population was overstated by 43%, and had I trusted it I would have gone looking for
toast code in three files that never had any.

**The finding the card missed is the one that justifies the work.** `MobileMessageCenter`'s
`showToast` called a bare `setTimeout` it never stored: no ref, no clear, no unmount cleanup. Two
consequences, both real — a second toast inherited the first one's pending timer and was cleared
early, and unmounting mid-toast fired `setToast` on a dead component. So this was never only
tidiness (`severity: NIT`); one of the four copies was simply wrong, and consolidating fixes it.

## Acceptance

- [x] One shared hook owns the state, the timer and the cleanup.
      **DONE.** `hooks/useToast.ts` — `{ toast, showToast, dismiss }`, per-call type and duration
      override, timer held in a ref, cleared on replace, on dismiss and on unmount. Deliberately
      NOT a provider/queue: every call site shows one message at a time from one component, so
      stacking would be machinery no caller asked for.
- [x] All four real call sites migrated, and the hand-rolled pattern is gone from them.
      **DONE.** `grep -nE "setToast|toastTimerRef|setToastMessage"` across the four returns
      **nothing**. Each keeps its own duration (8000 / 4000 / 3000 / 3000) via the hook's
      argument — the durations were deliberate, so consolidating the mechanism did not flatten
      them into one number. `SudoContext`'s close button is now the hook's `dismiss`, which is
      also what keeps `dismiss` from being a speculative API with no consumer.
- [x] A unit test covers auto-dismiss and manual dismiss, against the REAL hook.
      **DONE.** `tests/unit/use-toast.test.ts`, 6 tests: default show, auto-dismiss sampled at
      2999 ms AND 3000 ms (the before-sample is what stops a hook that dismissed instantly from
      passing), per-call duration override, replacement, dismiss-cancels-the-timer, and unmount
      clearing via `vi.getTimerCount()`.
      **Neuter run:** removed `clearTimer()` from `showToast` — i.e. re-introduced the
      MobileMessageCenter bug — and **exactly the replacement test reddens**, 5 others green.
      Restored; 6/6.
- [x] Nothing else regressed.
      **DONE.** `tsc --noEmit` 0; full suite **502 files / 6600 passed / 2 skipped**, exit 0 (up
      from 501/6594 — this card's 6 tests); `yarn build` exit 0. A build was run rather than
      trusted because this is the first change of the session to touch rendered components.

## Notes on scope, so the next reader knows what was deliberately NOT done

`MobileMessageCenter` carries a SECOND defect of the same family, found while migrating and left
alone: `copySuccess` and `showCopyDropdown` are written (`:271-274`, `:310-313`, including
another unstored `setTimeout`) and **never read anywhere in the file**, so the copy button's
confirmation is invisible. That is a missing-UI bug, not a toast-consolidation one; deleting the
state would erase the only trace of the intended feature, so it is recorded here and not touched.

## Approval log

- 2026-08-20T22:20:37+0200 — classified min-approval-requirement: none (was UNSET) and re-filed design/proposals/ → design/tasks/ as column: planned. Floor is none: a shared useToast() hook replacing six hand-rolled copies is an in-scope, reversible, local refactor of this project's own source, with zero D3 floor signals. Proposals are Tier 1/2/3 BY DEFINITION — a Tier-0 task does not belong in the proposals folder, so this was a filing error, not a pending decision. Nothing was approved here; a Tier-0 card has no approver and needed none. It sat unroutable in the wrong zone for six weeks.
- 2026-08-29T17:14:37+0200 — COMPLETED by ai-maestro-hub-session. Tier-0 self-mandate (floor `none`, so no approver was needed or recorded). Hook + 4 migrations + 6 tests with a recorded neuter; tsc 0, suite 502/6600, build 0.
