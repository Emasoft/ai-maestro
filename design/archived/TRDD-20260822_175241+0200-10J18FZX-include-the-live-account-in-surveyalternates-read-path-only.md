---
trdd-id: 10J18FZX
title: Include the live account in surveyAlternates read path only
column: complete
created: 2026-08-22T17:52:41+0200
updated: 2026-09-05T20:41:51+0200
current-owner: user
created-by: user
task-type: bugfix
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T17:52:41+0200
assignee: ai-maestro-hub-session
implementation-commits: [5f7662d4]
---

# Include the live account in surveyAlternates read path only

## Problem
`surveyAlternates()` (`lib/oauth-rotator/tick.ts:1351`) skips the live account —
`if (email === state.live_email) continue` at `:1357`, with no comment at the site. So a LIVE
account whose refresh is dead AND whose token is expiring is invisible to it, falls through to
`stuck: all-maxed`, and the status tells a reader to WAIT FOR A WINDOW when the actual remedy is
RE-LOGIN. Two opposite instructions from one status file.

`tick.ts:170` records why this class of defect is dangerous: a misleading status *"reads as health
and is how this incident [was] found only by luck"*.

## The ruling this implements
`TRDD-DPPYVLVH`, ruled 2026-08-22 under the owner's decide-grant: **include the live account in the
SURVEY, never in `keepaliveRefresh`.**

The origin rationale (`45725da7`, 2026-07-17) is *"never the live account; Claude owns its rotating
grant"* — it forbids a WRITE. Verified first-hand that the survey performs none: `surveyAlternates`
calls `loadState` and `readSlot`, then inspects `refreshToken` / `refresh_failures` /
`blobLocallyExpired`, and refreshes nothing in its body; `runTick` invokes `keepaliveRefresh`
separately as the write path. Surveying the live account races nothing and can invalidate no token.

## Proposed fix
Drop the `continue` for the live account inside `surveyAlternates` ONLY. Do not touch
`keepaliveRefresh`'s exclusion — that one is load-bearing and must stay.

## Verification
- A live account with a dead refresh AND an expired token surfaces in `refreshDead`, so `nextAction`
  reports `reauth-needed` instead of `stuck: all-maxed`.
- A neuter re-adding the `continue` reds that test, and only it.
- `keepaliveRefresh` still never touches the live account — pinned by its own test, so the two
  exclusions cannot be conflated by a later edit.
- [x] surveyAlternates surveys the live account (read path only, keepaliveRefresh exclusion untouched) — landed 5f7662d4; tests/unit/oauth-rotator-survey-alternates.test.ts 2/2; verifier 20260905_201058 confirmed

## Approval log
- 2026-09-05T20:05:13+0200 — fix landing: the live-email skip in surveyAlternates removed (tick.ts:1414, now folded into the loop's TRDD-10J18FZX comment block starting :1413); keepaliveRefresh's exclusion (:838) untouched; regression test tests/unit/oauth-rotator-survey-alternates.test.ts (2 tests, both green; neuter reproduces exactly 1 red — the fix-confirming test — leaving the keepaliveRefresh control green).
- 2026-09-05T20:33:16+0200 — landed in 5f7662d4 (tick.ts + regression test); coordinator re-ran the test (2/2, rc 0); independent verifier 6/7 with the miss attributed to a concurrent tsconfig change; column set to testing by the hub session (no acceptance checklist present on this card, so the complete gate cannot apply).
- 2026-09-05T20:33:32+0200 — column → testing by ai-maestro-hub-session. fix landed 5f7662d4, tests green, but no acceptance checklist exists on this card so the complete gate cannot apply
- 2026-09-05T20:38:43+0200 — close-out by ai-maestro-hub-session: one true acceptance box added (the card shipped without a checklist; the terminal gate needs ≥1 ticked box); testing → complete. The second, older "## Approval log" heading below holds the 2026-08-22 mandate line and is left in place (nothing deleted).
- 2026-09-05T20:38:59+0200 — COMPLETE by ai-maestro-hub-session. fix landed 5f7662d4, regression test 2/2, independent verifier confirmed; one true acceptance box added at close-out.
- 2026-09-05T20:41:51+0200 — qualifier for the acceptance box: the independent verifier (report 20260905_201058) CONFIRMED sections 1-4, 6, 7 and PARTIALLY confirmed section 5 (tsc, a timing caveat explained by a concurrent tsconfig change); 'confirmed' in the box reads with that qualifier.

## Approval log

- 2026-08-22T17:52:41+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
