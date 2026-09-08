---
trdd-id: LZR1M3TQ
title: ChangeTeam freeze context is a scalar — G07b overwrites G04e
column: backburner
created: 2026-09-08T21:24:19+0200
updated: 2026-09-08T21:24:19+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-08T21:24:19+0200
---

# ChangeTeam freeze context is a scalar — G07b overwrites G04e

## Problem

ChangeTeam carries two R31 freeze gates that write the SAME context fields. Measured 2026-09-08 on governance-rules at 112086b9 (`services/element-management-service.ts`):

- G04e (leave, `:7387-7397`): `c.freezeTeamId = currentTeam.id; c.freezeWasFrozenBefore = !!team.frozen; … c.freezeHibernated = hibernated`.
- G07b (join, `:7548-7558`): `c.freezeTeamId = targetTeamId; c.freezeWasFrozenBefore = !!team.frozen; … c.freezeHibernated = hibernated`.

A member moving from a COMPLETE team A to an INCOMPLETE team B freezes A at G04e and freezes B at G07b; after G07b the context names only B. Anything that reads the context after both gates — the compensating undo, or a post-commit consumer such as the COS notice proposed for TRDD-0KMDJVON box 6 — sees one team where two were frozen.

INFERRED, not yet read: that the G04e/G07b `undo` bodies read `c.freezeTeamId` / `c.freezeHibernated` (only the `undo: async (c: TeamCtx) => {` opener at `:7407` was read). If they do, a failure after G07b clears `frozen` and wakes the hibernated members of B only, leaving A frozen with its members hibernated and no record that this pipeline did it.

## Proposed fix

Make the freeze record a list, as DeleteAgent's G04b already does (`c.freezeAffected: Array<{ teamId, wasFrozenBefore, hibernated }>`, `:9760-9775`): G04e and G07b each `push` one entry; each undo unwinds every entry it pushed, in reverse; any post-commit consumer iterates the list.

## Verification

- Read both undo bodies first and record what they read (turn the INFERRED line above into a measurement).
- `tests/unit/roster-mutation-refreeze.test.ts`: a move from complete team A to incomplete team B with a downstream gate failure injected after G07b → both teams end `frozen: false` and every hibernated member of BOTH teams is woken. Neuter: restore the scalar fields → the test reds on team A's `frozen` still true.

## Estimated risk

LOW. One ctx type change and two gates; the DeleteAgent shape is the template.

## Acceptance

- [ ] Both undo bodies read and cited; the INFERRED line replaced by what they do.
- [ ] ChangeTeam's freeze record is a list; G04e and G07b each push; each undo unwinds its own entries.
- [ ] The A-to-B move-with-failure test passes and its recorded neuter reds it.

## Approval log

## Approval log

- 2026-09-08T21:24:19+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
