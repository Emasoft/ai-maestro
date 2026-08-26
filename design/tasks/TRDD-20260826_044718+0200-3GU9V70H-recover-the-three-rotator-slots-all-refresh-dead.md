---
trdd-id: 3GU9V70H
title: Recover the three rotator slots — every refresh token is invalid_grant and the cookie leg has minted nothing
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T04:47:18+0200
updated: 2026-08-26T04:47:18+0200
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
expired around 2026-08-08..11. The live Claude Code session works only because the
owner re-logged in by hand; the slot copies are all dead.

The no-human recovery rung (the janitor's cookie leg, which mints a fresh OAuth pair
from a live claude.ai session cookie) has produced nothing: `cookie-leg-since.json`
is `{}` and `cookie-leg-stuck` alerts cycle in rotator.log for all three accounts.
This is exactly the state TRDD-X4RK1NUW's 2026-08-30 deadline exists to prevent, and
its 48h clean-window acceptance box cannot start while it stands.

## What recovery looks like (in order of preference)

1. **Cookie leg (no human):** verify the janitor's cookie layer holds live claude.ai
   cookies for the three accounts and diagnose why it has minted nothing
   (`cookie-leg-since.json` empty is the symptom). The cookie layer lives in the
   JANITOR's keychain — invisible from the server process, so this half is a
   janitor-side check, coordinated via ai-maestro#95.
2. **Human re-login:** the owner runs `/janitor-refresh-cc-logins` (or per-account
   browser capture) to re-mint the three slots.

## Acceptance

- [ ] All three slots in `state.json` show a fresh `fp` with `refresh_failures` reset and a future `expires_at`
- [ ] `oauth-rotator-tick-status.json` reads a non-`reauth-needed` verdict across two consecutive beats
- [ ] Cause of the cookie leg's inaction recorded (here or on ai-maestro#95) — "it minted" or "why it could not"

## Approval log
