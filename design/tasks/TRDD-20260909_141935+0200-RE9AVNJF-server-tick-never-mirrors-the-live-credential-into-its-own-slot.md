---
trdd-id: RE9AVNJF
title: server tick never mirrors the live credential into its own slot, so every slot goes refresh-dead after hours live
column: todo
created: 2026-09-09T14:19:35+0200
updated: 2026-09-09T14:19:35+0200
current-owner: governance-rules-session
created-by: governance-rules-session
task-type: bugfix
min-approval-requirement: none
assignee: governance-rules-session
mandate: true
mandated-by: none
approved: true
approval-judge: governance-rules-session
approval-datetime: 2026-09-09T14:19:35+0200
labels: [oauth-rotator, continuity]
external-refs: [TRDD-CVQJNW3A, TRDD-MN0Q1IA2, TRDD-X4RK1NUW, TRDD-8148P30S]
---

# server tick never mirrors the live credential into its own slot, so every slot goes refresh-dead after hours live

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-09

Minted after the owner rotated by hand for the third time (2026-09-09 13:40, 13h40m unrotated
with a usable alternate). Root cause verified in code + logs (below). Proposed diff reviewed by
the per-turn fork (verdict recorded in this block next turn). NEXT ACTION: implement the diff in
`lib/oauth-rotator/tick.ts` + the two tests, run both neuters, `yarn test` + `tsc`. NO build /
restart — the owner's `server.mjs` hold stands (TRDD-8148P30S STATE); the fix goes live on the
owner's next `yarn build` + `pm2 restart`.

## Problem

MEASURED 2026-09-09 (janitor DATA `oauth-rotator/state.json`, `rotator.log`, `logs/pm2-out.log`):
all three slots `captured_at 2026-08-26`, all three `refresh_dead_fp == fp`,
`last_refresh_failure: credential-dead` (11 / 5 / 13 failures). The server rotator logged
"exhausted … all paid accounts maxed" every minute from 00:00 to 13:39 while
`emanuele.sabetta` sat at 5h=0% 7d=60%. The owner logged in by hand at 13:40 (beacon change).

## Root cause

Claude Code refreshes the LIVE account on its own; the grant is single-use rotating (tick.ts
module header, reauth-flow.ts:20-21). Every such refresh leaves that account's SLOT holding a
pre-rotation pair, which the endpoint rejects as `invalid_grant` the moment the tick switches
away and tries to renew it. The janitor's `cmd_capture` (rotator.py:1537) is exactly the
live→slot mirror that prevents this — and in daemon context it is skipped every tick
("primary live credential unreadable — skipping capture (F1)", every tick in rotator.log). The
server port `reconcileLiveEmail` (tick.ts:764-786) fixes `state.live_email/live_fp` on drift and
never calls `writeSlot`; the only server `writeSlot` sites are the refresh paths
(`refreshAndHealSlot`, `keepaliveRefresh`), which by design never touch the live account. So on
this machine NO path re-mirrors the live credential, and every account that is live for a few
hours comes back with a dead slot. The cookie-based re-mint legs that would recover a dead slot
are all off: janitor auto-bootstrap opt-in never set; the server's unbrowse re-auth leg
flag-disabled by the owner 2026-08-07 (TRDD-MN0Q1IA2 — zero successes ever, TRDD-CVQJNW3A).

## Proposed fix (one change)

In `reconcileLiveEmail`, once the drifted live credential's account is resolved, mirror it into
that account's slot (`writeSlot`) and REPLACE the slot meta (`captured_at`, `fp`, `expires_at`,
`via: 'live-mirror'`) — same REPLACE rule as `fileSlot`, so the superseded token's
`refresh_failures` / `refresh_dead_fp` ban is dropped. Keyed on `meta.fp !== realFp`, so it costs
one keychain write per genuine drift and nothing in steady state. Fail-soft on
`SlotKeychainWriteError` like `refreshAndHealSlot` (the state reconcile still runs). Export
`nowLocalTz` from slots.ts for the `captured_at` stamp. No new module, no new flag.

## Verification

- `tests/unit/oauth-rotator-tick.test.ts`: (1) slot holds OLD + branded dead, live file holds a
  rotated pair, `/roles` resolves the same email → after `runTick` the slot holds the new pair,
  meta fp/via replaced, `refresh_dead_fp` and `refresh_failures` gone; (2) slot already equals
  the live pair, only `state.live_fp` stale → state reconciled, slot NOT rewritten (`via` stays).
- Neuters, each named: delete the mirror block → (1) red, (2) green; drop the fp guard → (2)
  red, (1) green.
- `yarn test` green, `npx tsc --noEmit` 0 errors.

## Risk

LOW. Adds one keychain write per live-credential drift (Claude Code refreshes roughly per
access-token lifetime). A wrongly-resolved email would file the live pair under the wrong slot —
the same exposure `reconcileLiveEmail` already carries for `state.live_email`, unchanged.
Untestable in this harness: the `SlotKeychainWriteError` branch (backend `none` cannot refuse),
exactly like the existing branch in `refreshAndHealSlot`.

## Out of scope (recorded, not done here)

- The false "all paid accounts maxed" wording when the cause is dead credentials — own card.
- Re-arming the unbrowse re-auth leg (`~/.aimaestro/oauth-reauth-repair.enabled`) — owner
  decision; it has never completed a live consent run.
- Today's three dead slots: this fix prevents recurrence, it does not resurrect them —
  `/janitor-refresh-cc-logins` re-mints from the live cookies (valid until 2026-09-23).

## Acceptance

- [ ] mirror block in `reconcileLiveEmail` + `nowLocalTz` export landed
- [ ] two tests landed; both neuters run and each reddened exactly the test it should
- [ ] `yarn test` green, `tsc --noEmit` 0 errors
- [ ] owner built + restarted (on the owner's hold — not this session's to lift)
- [ ] observed: a slot's `captured_at` advances after the live account is refreshed by Claude Code

## Approval log

- 2026-09-09T14:19:35+0200 — MANDATE issued by governance-rules-session (min-approval-requirement: none). Tier 0: in-scope bugfix, reversible, no governance change. No approval request was sent.
