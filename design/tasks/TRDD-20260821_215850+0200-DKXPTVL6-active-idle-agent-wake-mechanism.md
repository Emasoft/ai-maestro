---
trdd-id: DKXPTVL6
title: Active idle-agent wake mechanism so a filed directive reaches an idle agent without a human bridge
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-21T21:58:50+0200
updated: 2026-08-26T05:49:44+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: feature
min-approval-requirement: manager
mandate: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: medium
effort: L
labels: [fleet-ask, hub-blocked]
external-refs: [Emasoft/ai-maestro#51, Emasoft/ai-maestro#46, Emasoft/ai-maestro#45, Emasoft/ai-maestro#27, Emasoft/ai-maestro#43, Emasoft/ai-maestro#40]
---

## Problem

GitHub issues are a passive channel: an idle plugin session doesn't poll them, so a filed
directive or work-order isn't delivered until the human owner manually bridges the session. This
stalled cross-plugin coordination waves (governance, approval-tier work) on the owner having to
wake each plugin by hand.

## Root cause

No push path exists from "you have assigned work" (a TRDD assignment, an AMP message, an
approved proposal) to an idle agent's session. Investigated further on this repo's side (see
issue's own follow-up comment): the server-side inject primitive `sendCommand` requires the
target session to be idle, but `services/sessions-service.ts` sets `sessionActivity` on every
call and the idle check (`isSessionIdle`) can never observe a fresh-enough gap — so even the
existing inject path is effectively unusable for a wake, independent of who triggers it. This is
a real blocking bug in the delivery primitive itself, not just a missing trigger.

## Proposed fix

1. Fix `sendCommand`'s idle-gate self-defeat first (`services/sessions-service.ts` — the
   activity-timestamp write must not immediately re-arm the very idle check that gates the send
   that caused it).
2. Build ONE wake path (explicitly not a second nudger competing with the janitor's own cooldown —
   per the issue's 2026-07-25 comment, two independent nudgers defeat each other): either the
   server pushes a "you have assigned work" signal on TRDD-assignment/AMP-delivery, or the janitor
   heartbeat is extended to check assigned TRDDs/issues and nudge through the single injector.
3. Coordinate with the janitor's `fleet-recovery-actuator` (the one injector already established
   for ESC-wedge recovery, see the sibling retry-wedge card) so this does not become a second actor
   touching the same PTY.

## Verification

- A TRDD assignment or AMP mandate delivered to an idle agent results in that agent picking up the
  work without the human owner manually switching to its terminal.
- `sendCommand`'s idle gate passes for a genuinely idle session (verified via a synthetic idle
  session, not just code reading).
- No two independent wake mechanisms fire concurrently on the same session.

## Acceptance

- [ ] `sendCommand` idle-gate self-defeat fixed and verified against a real idle session
- [ ] One wake path built (server push or janitor-heartbeat check), single-injector
- [ ] Verified end-to-end: a filed TRDD/AMP directive reaches an idle agent without human bridging
- [ ] No conflict with the janitor's existing ESC-wedge injector confirmed
- [ ] Comment posted on Emasoft/ai-maestro#51 confirming the card and status

## ⏵ STATE — 2026-08-26 (hub, premise check on resume)

**Claim 1 is ALREADY FIXED in the tree** — verify before building on this card's root-cause
text: `services/sessions-service.ts:1359` runs the `requireIdle && !isSessionIdle` gate BEFORE
the activity bump at `:1374`, and the comment at `:1370` records the exact self-defeat this
card describes as the bug it fixed ("the activity bump used to run BEFORE the idle check, so
isSessionIdle always read ~0"). Box 1's remaining ask is only the "verified against a real
idle session" half. Boxes 2-5 (the wake path) remain the card's substance and are
`min-approval-requirement: manager` with `mandate: false` and NO approval record — this card
is NOT authorized to execute; route it for MANAGER approval (or the USER's word) before any
build. The hub did not build anything on it.

## Approval log
