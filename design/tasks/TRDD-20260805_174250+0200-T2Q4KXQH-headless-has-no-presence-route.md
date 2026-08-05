---
trdd-id: T2Q4KXQH
title: Headless mode has no user-input route so presence is never recorded there
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T17:42:50+0200
updated: 2026-08-05T17:42:50+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-05T17:42:50+0200
severity: medium
effort: small
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [presence, headless, two-server-modes, ai-maestro-117]
external-refs: [Emasoft/ai-maestro#117]
---

# Headless mode has no user-input route so presence is never recorded there

## Problem

`POST /api/sessions/me/user-input` exists as a Next route and in **none** of the headless router's
**251** route-table entries (verified with a positive control after two earlier greps returned a
misleading `0` by using the wrong route shape — the table is `pattern: /^\/api\/…/`, not
`path: '…'`).

`services/headless-router.ts` matches against an explicit table and returns `false` for anything
unmatched, so the caller sends a 404. In headless mode the agent's `UserPromptSubmit` hook therefore
404s, presence is **never** recorded, and `fleet-recovery-runner` reads a permanently stale record.

## Why it is not simply "the bug is absent there too"

ai-maestro#117's forgery cannot happen in headless — nothing writes presence, so nothing forges it.
But the **feature** is missing, and the failure runs the other way: recovery never sees a live user
at all, which is the failure mode #117's direction rule exists to prevent (*"inferring 'not human'
from absence would make recovery race a live user"*). Full mode now records presence and vetoes
forged presence; headless records neither. Two modes, two different truths about whether a human is
at the keyboard.

Pre-existing — not introduced by #117. The veto is simply inert there.

## Proposed fix

Add the route to the headless table, delegating to the **same module** as the Next route — the
pattern `/portfolio/verify` already uses (`services/headless-router.ts:1765`), which is what makes
those two modes unable to drift. A hand-reimplemented handler is the shape that produced this class
of gap in the first place.

## Verification

The same request that 404s today must return `{recorded_at_epoch}` in headless, and an injected
prompt must be vetoed there exactly as in full mode. Assert BOTH modes in one test file so a future
route addition to one side alone reddens.

## Estimated risk

LOW — one table entry delegating to existing logic. The risk is in *not* doing it: a mode difference
in whether presence exists at all is invisible until recovery behaves differently on two hosts and
nobody can explain why.

## Approval log

- 2026-08-05T17:42:50+0200 — MANDATE issued by USER ("write all the TRDDs and the derived TRDDs").
  Pre-approved: issuer authority >= required approver (floor `none`, in-scope parity fix).
