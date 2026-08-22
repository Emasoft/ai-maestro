---
trdd-id: 10J18FZX
title: Include the live account in surveyAlternates read path only
column: todo
created: 2026-08-22T17:52:41+0200
updated: 2026-08-22T17:52:41+0200
current-owner: user
created-by: user
task-type: bugfix
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T17:52:41+0200
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

## Approval log

## Approval log

- 2026-08-22T17:52:41+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
