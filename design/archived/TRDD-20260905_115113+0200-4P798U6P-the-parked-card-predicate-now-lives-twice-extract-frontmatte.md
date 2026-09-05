---
trdd-id: 4P798U6P
title: The parked-card predicate now lives twice — extract frontmatterDay and the other-park-form check into trdd-vocabulary
column: complete
created: 2026-09-05T11:51:13+0200
updated: 2026-09-05T12:34:22+0200
current-owner: emanuelesabetta
created-by: emanuelesabetta
task-type: refactor
min-approval-requirement: none
assignee: emanuelesabetta
mandate: true
mandated-by: none
approved: true
approval-judge: emanuelesabetta
approval-datetime: 2026-09-05T11:51:13+0200
implementation-commits: [c9937cef]
---

# The parked-card predicate now lives twice — extract frontmatterDay and the other-park-form check into trdd-vocabulary

TRDD-1G8FBSKZ (27350503) needed the doctor's PARKED predicate inside the store's `advanceColumn` gate and could not import it — `lib/trdd-doctor.ts` imports from `lib/trdd-store.ts`, so `store → doctor` would close a cycle — and so re-derived it as private copies. MEASURED 2026-09-05 12:10: `frontmatterDay` (doctor: `grep -n "^export function frontmatterDay" lib/trdd-doctor.ts`) and `frontmatterDayLocal` (store: `grep -n "^function frontmatterDayLocal"`) are byte-identical modulo the name (diff exit 0); `hasOtherParkForm` (store: `grep -n "^function hasOtherParkForm"`) is the doctor's parked predicate (anchor `const parked =`, then: `column === 'blocked' || blocked-by non-empty || future review-after || label hub-blocked/fleet-ask`) MINUS the two terms the store's caller handles, i.e. exactly its other-forms half; and `lib/trdd-vocabulary.ts` is ALREADY imported by both (`grep -n trdd-vocabulary lib/trdd-store.ts lib/trdd-doctor.ts`), so it is the leaf home with no cycle. Two copies of one predicate is the shape recorded in .claude/rules/lessons-verification.md (the linter and its --fix drifted that way): the doctor decides what counts as parked when it LINTS, the store decides separately when it GATES, and the first time a fourth park form is added to one of them the tool refuses a park the lint accepts, or accepts one the lint flags. Fix: move `frontmatterDay` and an `isParkedByOtherForm(fm, todayDay)` (the other-forms half) to `lib/trdd-vocabulary.ts`; the doctor composes `column === 'blocked' || blockedBy.length > 0 || isParkedByOtherForm(...)`, the store calls the shared half; delete both copies; add ONE test that imports the predicate from the vocabulary module and pins each park form once.

## Acceptance

- [x] `frontmatterDay` and the other-park-form predicate live in lib/trdd-vocabulary.ts only; `grep -n "frontmatterDayLocal\|hasOtherParkForm" lib/` returns nothing and both lib/trdd-doctor.ts and lib/trdd-store.ts import them from the vocabulary module
- [x] one test file pins every park form (future review-after, hub-blocked, fleet-ask) through the shared predicate, and a recorded neuter (drop one form) reddens exactly that form's case in BOTH the doctor and the store suites
- [x] tsc 0; tests/unit/trdd-doctor.test.ts and tests/unit/trdd-store.test.ts green with no behaviour change

## Approval log

- 2026-09-05T11:51:13+0200 — MANDATE issued by emanuelesabetta (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T11:51:15+0200 — column → todo by manager. Tier 0 refactor carved out of 1G8FBSKZ by post-close review: two copies of the parked predicate is the lint/fixer-drift shape. Authorization: USER /goal 2026-09-05.
- 2026-09-05T12:10:32+0200 — column → dev by governance-rules-session. lean-worker dispatched 2026-09-05 with the card as spec; write-scope lib/trdd-vocabulary.ts, lib/trdd-doctor.ts, lib/trdd-store.ts + tests
- 2026-09-05T12:34:22+0200 — COMPLETE by governance-rules-session. landed in c9937cef. Box 1: old-name grep 0, both consumers import from the vocabulary (doctor: parkReason + frontmatterDay; store: isParkedByOtherForm). Box 2: per-form neuters (one return line deleted at a time) — review-after 4 red, hub-blocked 4 red, fleet-ask 5 red, each exactly one doctor case + one store case + vocabulary pins; label-form consumer fixtures were added to make the box hold literally. Box 3: tsc 0, four suites 194/194 under Node 22, five-row census unchanged under installed wrapper and npx tsx..
