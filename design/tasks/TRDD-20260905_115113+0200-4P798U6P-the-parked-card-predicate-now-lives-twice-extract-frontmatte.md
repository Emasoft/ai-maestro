---
trdd-id: 4P798U6P
title: The parked-card predicate now lives twice — extract frontmatterDay and the other-park-form check into trdd-vocabulary
column: todo
created: 2026-09-05T11:51:13+0200
updated: 2026-09-05T11:51:15+0200
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
---

# The parked-card predicate now lives twice — extract frontmatterDay and the other-park-form check into trdd-vocabulary

TRDD-1G8FBSKZ (27350503) needed the doctor's PARKED predicate inside the store's `advanceColumn` gate and could not import it — `lib/trdd-doctor.ts` imports from `lib/trdd-store.ts`, so `store → doctor` would close a cycle — and so re-derived it as private copies: `frontmatterDayLocal` and `hasOtherParkForm` in lib/trdd-store.ts (~745-786) next to the doctor's `frontmatterDay` and its parked-forms check (~1040-1060). Two copies of one predicate is the exact shape recorded in .claude/rules/lessons-verification.md ("the linter and its --fix drifted because they carried two copies of one predicate"): the doctor decides what counts as parked when it LINTS, the store decides separately when it GATES, and the first time a fourth park form is added to one of them the tool refuses a park the lint accepts, or accepts one the lint flags. Fix: move both helpers to `lib/trdd-vocabulary.ts` (already imported by both modules, no cycle) as `frontmatterDay` and `isParkedByOtherForm(fm, todayDay)`, make both call sites import them, delete the copies, and add ONE test that imports the predicate from the vocabulary module and pins each park form once.

## Acceptance

- [ ] `frontmatterDay` and the other-park-form predicate live in lib/trdd-vocabulary.ts only; `grep -n "frontmatterDayLocal\|hasOtherParkForm" lib/` returns nothing and both lib/trdd-doctor.ts and lib/trdd-store.ts import them from the vocabulary module
- [ ] one test file pins every park form (future review-after, hub-blocked, fleet-ask) through the shared predicate, and a recorded neuter (drop one form) reddens exactly that form's case in BOTH the doctor and the store suites
- [ ] tsc 0; tests/unit/trdd-doctor.test.ts and tests/unit/trdd-store.test.ts green with no behaviour change

## Approval log

- 2026-09-05T11:51:13+0200 — MANDATE issued by emanuelesabetta (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T11:51:15+0200 — column → todo by manager. Tier 0 refactor carved out of 1G8FBSKZ by post-close review: two copies of the parked predicate is the lint/fixer-drift shape. Authorization: USER /goal 2026-09-05.
