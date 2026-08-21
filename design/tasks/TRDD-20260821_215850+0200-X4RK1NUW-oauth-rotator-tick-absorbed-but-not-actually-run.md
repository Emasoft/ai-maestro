---
trdd-id: X4RK1NUW
title: Server absorbed oauth-rotator-tick but is not actually running it — slot keepalive fails, rotation becomes impossible
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-21T21:58:50+0200
updated: 2026-08-21T23:02:24+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T21:58:50+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: critical
effort: M
labels: [fleet-ask, hub-blocked]
external-refs: [Emasoft/ai-maestro#95, TRDD-1GGQ4HWY, TRDD-DPPYVLVH]
---

## Problem

`ai-maestro-janitor`'s `harness_backend.py` lists `oauth-rotator-tick` in
`SERVER_ABSORBED_TASKS` — by the owner's own rule, once the server is live the janitor yields
this chore unconditionally, no per-capability negotiation. The server is expected to then run it.
On 2026-07-26 it did not: the janitor stopped cleanly (`server-owns-host`), nothing picked the
tick up, every stored account slot's access token (8h lifetime) expired with no renewal, and
rotation became impossible because a candidate account can't be probed for safety with an expired
token — even though every slot still had a valid, unused `refreshToken` the whole time.

**This recurred** (per the issue's 2026-08-21 update): fix verified 2026-08-05, same end state
back today. There is a stated **2026-08-30 deadline** on having a no-human recovery path working,
per the latest issue comment (`reauth-needed` / `refresh-dead` verdict written 34 seconds before
last read, meaning the tick beats but its verdict logic itself is wrong now — not merely absent).

## Root cause

Two related defects, not one: (1) the server accepted ownership of `oauth-rotator-tick` via the
absorption contract but has no scheduled execution path actually performing the slot-keepalive
refresh (using each slot's `refreshToken` against `platform.claude.com/v1/oauth/token`), and (2)
per the 2026-08-21 recurrence, even when the tick DOES fire, its verdict computation
(`reason: refresh-dead`) is producing a wrong diagnosis rather than performing the refresh.

## Proposed fix

1. Confirm/implement the actual scheduled keepalive: refresh any stored account token approaching
   expiry, at ~0.5h headroom before the 8h expiry (matching the janitor's own
   `ROTATOR_KEEPALIVE_AHEAD_H` behavior it is replacing).
2. Fix whatever produces `reason: refresh-dead` when a refresh token is in fact present and valid
   — read the exact tick code path and the two just-landed janitor-side fixes referenced in the
   issue (the issue explicitly names "two fixes just landed in the janitor" the TS daemon needs to
   port; read the issue's full body/comments for the fix details before implementing).
3. Add an observable, low-cost self-check: the tick's own status file
   (`~/.aimaestro/oauth-rotator-tick-status.json`) must be auditable against real slot expiry so a
   silent "beating but wrong" state is caught by monitoring, not by outage.

## Verification

- All three account slots' access tokens stay renewed continuously across a 48h+ observation
  window with no manual intervention.
- Rotation successfully picks a healthy alternate when the primary account is near its weekly cap.
- The tick status file's verdict matches ground truth (slot expiry state) at every read.

## Acceptance

- [x] Server-side scheduled keepalive for oauth-rotator-tick actually executes (not just accepted via the absorption contract)
- [x] The 2026-08-21 `refresh-dead` misdiagnosis root-caused and fixed
- [x] Two janitor-side fixes referenced in the issue ported to the TS daemon
- [ ] Verified clean across a 48h+ window before the 2026-08-30 deadline
- [x] Comment posted on Emasoft/ai-maestro#95 confirming the card and status

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-21

4/5 boxes closed. Evidence: `reports/colony/unit1-X4RK1NUW.md` (gitignored, not pushed) and
GitHub comment https://github.com/Emasoft/ai-maestro/issues/95#issuecomment-5375378217.

- Box 1 VERIFIED live: the tick beats on cadence (mtime advanced 60s apart across two reads;
  rotator.log ONSET/CLEARED cycling through the check).
- Box 2 VERIFIED + FIXED: the "cascade.ts unreachable -> misdiagnosis" hypothesis from the
  2026-08-21 issue comment is REFUTED (deliberate design, already documented in tick.ts's own
  docstring, TRDD-XV9BLQC5). The REAL bug found and fixed: alert CODE selection in
  `server-tick.ts` used a different precedence (stuck-first) than the message (`deriveDecision`,
  reason-first), so one unchanged condition flapped between two alert codes
  (`rotator-stuck:all-maxed` <-> `reauth-needed:refresh-dead`) beat-to-beat. Fixed: code now
  follows reason>stuck, matching the message. Test added + neuter-verified (1 red / 28 green).
- Box 3 VERIFIED already-shipped (2026-08-05): `network.ts:15-31` (UA split), `usage-cooldown.ts`
  (throttled cache). Nothing to port.
- Box 4 OPEN by construction: needs a real 48h+ observation window, which cannot happen inside one
  work session. Recovery for the currently-dead refresh tokens (invalid_grant, all 3 slots) needs
  either a human `/janitor-refresh-cc-logins` or re-arming `reauth-repair`
  (`~/.aimaestro/oauth-reauth-repair.enabled.DISABLED-20260807-headed-browser-windows` — the owner
  disabled it 2026-08-07 for opening disruptive headed browser windows). Both are outside this
  session's scope (credential-affecting / human UX decisions).
- Box 5 done: comment posted.

**NEXT ACTION for whoever resumes this card:** either (a) wait out the 48h window with the current
state and re-verify the tick status file / rotator.log stay consistent, or (b) get the USER's
decision on re-enabling `reauth-repair` (or performing a manual `/janitor-refresh-cc-logins`) to
actually recover the 2 live-cookie slots before their 2026-08-30 cookie expiry, then start the 48h
clock. Neither is code work.

**Changed:** `lib/oauth-rotator/server-tick.ts` (alert code precedence fix, TRDD-X4RK1NUW),
`tests/unit/oauth-rotator-server-tick.test.ts` (new pinning test). Full suite: 6075 passed / 1
pre-existing unrelated failure (`tests/governance/specs-in-sync.test.ts`, confirmed failing
identically at HEAD with this change stashed). tsc clean on touched files.

## Approval log
