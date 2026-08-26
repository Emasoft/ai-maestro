---
trdd-id: 3GU9V70H
title: Recover the three rotator slots — every refresh token is invalid_grant and the cookie leg has not recovered them
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T04:47:18+0200
updated: 2026-08-26T10:11:48+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-26T04:47:18+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: critical
effort: S
labels: [credentials, user-action-required]
external-refs: [Emasoft/ai-maestro#95, TRDD-X4RK1NUW]
---

## Problem

Measured 2026-08-26 04:4x from the rotator's own state (janitor DATA dir
`oauth-rotator/state.json` + `rotator.log`): **all three account slots** carry
`last_refresh_failure: credential-dead` — the OAuth endpoint answered `invalid_grant`
after 233 / 576 / 789 exchange attempts respectively — and every slot's access token
expired 2026-08-11..14 (epoch-ms recomputed via node, not eyeballed). The live Claude Code session works only because the
owner re-logged in by hand; the slot copies are all dead.

The no-human recovery rung (the janitor's cookie leg, which mints a fresh OAuth pair
from a live claude.ai session cookie) has not recovered them: `cookie-leg-stuck` alerts cycle in rotator.log for all three
accounts while `refresh_dead_fp == fp` on every slot. NOTE (review-fork correction):
`cookie-leg-since.json` tracks cannot-self-renew ONSET (supervisor.ts:288), not mint
activity — and it reading `{}` while all three slots are dead is itself an anomaly this
card's diagnosis should explain (the tracker's condition should hold for all three).
This is exactly the state TRDD-X4RK1NUW's 2026-08-30 deadline exists to prevent, and
its 48h clean-window acceptance box cannot start while it stands.

## ⏵ STATE UPDATE — 2026-08-26 ~10:1x (janitor cross-session report + first-hand verification)

**The slots are RECOVERED — by the janitor, via real-Chrome login + capture** (their
`41ccc80f`; oauth-health `ok`/`has_refresh:true` on all three at 09:43/09:56/10:00, per their
cross-session message). Their root cause: `slot_capture_browser.py` had NO PEP-723 header, so
`uv run --script` installed nothing and every capture died at import — BOTH re-mint legs down
at once, presenting as "refresh dead" for ~19 days. Python-specific; our TS port does not share
the header mechanism, but the CLASS transfers (a re-mint leg that cannot START, masked as a
credential fault). This also answers the `cookie-leg-since.json == {}` anomaly line of inquiry:
the capture leg could not even start.

**NEW FINDING, verified first-hand at 10:1x — our side has the MIRROR of their TRDD-A8DPTDOU:**
`active-alerts.json` shows `rotator-stuck:all-maxed` with `seen: 10`, `lastSeenAt` seconds ago —
our tick is CURRENTLY re-asserting "no alternate is healthy" AFTER all three slots were
re-minted. Not stale file replay: the alert is live-refreshing. Hypothesis to verify (their
defect class at onset rather than clear): our alternate-health probe reads a per-slot
failure/cooldown store that nothing invalidates on an EXTERNAL re-mint, so "dead until proven
alive" persists until something re-attempts the credential. `rotation-stuck.json` in the shared
DATA dir is separately 15.4h stale (first==last seen 2026-08-25 18:44).

**NEXT ACTION:** (1) diagnose why the tick's alternate-health view lags an external re-mint
(candidate: cooldown/failure store never cleared by fresh slot fp) and whether the next natural
tick heals it — if it does not, that is our A8DPTDOU mirror and needs the same
positive-mint-evidence shape in BOTH onset and clear predicates; (2) the janitor's check 1:
prove OUR capture/re-mint leg can EXECUTE end-to-end (a can-it-start dry-run, not a credential
check) — TRDD-CVQJNW3A's `driveConsent` has never run against the real consent page, so this is
the same gap they had; owner-gated per that card. (3) Durability: do NOT quote "a month" —
janitor data shows refresh chains survived 6-19 days per account before `invalid_grant`.

## What recovery looks like (in order of preference)

1. **Cookie leg (no human):** verify the janitor's cookie layer holds live claude.ai
   cookies for the three accounts and diagnose why the slots stay dead — including
   why `cookie-leg-since.json` reads `{}` when its own tracker condition should hold
   for all three (supervisor.ts:288). The cookie layer lives in the
   JANITOR's keychain — invisible from the server process, so this half is a
   janitor-side check, coordinated via ai-maestro#95.
2. **Human re-login:** the owner runs `/janitor-refresh-cc-logins` (or per-account
   browser capture) to re-mint the three slots.

## Acceptance

- [ ] All three slots in `state.json` show a fresh `fp` with `refresh_failures` reset and a future `expires_at`
- [ ] `oauth-rotator-tick-status.json` reads a non-`reauth-needed` verdict across two consecutive beats
- [ ] Cause of the cookie leg's inaction recorded (here or on ai-maestro#95) — "it minted" or "why it could not"

## Units-hazard check on the shared slot schema (janitor coordination)

**Units-hazard check (janitor's second message, measured 10:2x):** our TS WRITES ms
unconditionally (network.ts:454 `(Date.now()/1000 + expires_in) * 1000`; slots.ts:377 and
tick.ts:712/924 pass ms through) and READS with the SAME >1e12 magnitude heuristic
(slots.ts:150 — its comment says 'matching rotator.py's heuristic' — and supervisor.ts:440-443,
which also accepts BOTH spellings expiresAt/expires_at). So the two daemons are behaviorally
mirrored today: both write ms, both tolerate either on read, and both share the same
guess-dont-fail weakness the janitor proposes to close. Their proposal (pin ms in the shared
schema, fail loudly out-of-range) is a JOINT schema change — coordinate via ai-maestro#95,
change both sides together or not at all. Also on their list to diff jointly: captured_at,
fp/refresh_dead_fp derivation, via, last_switch_at (seconds on their side — the file mixes
units across FIELDS already, which is the strongest argument for pinning).

## Approval log

- 2026-08-26T04:47:18+0200 — MANDATE (self, min-approval-requirement: none).
