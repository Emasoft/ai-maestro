---
trdd-id: 7DRSIKVZ
title: Port oauth-rotator-supervisor and rotator core into the server
column: dev
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T14:55:30+0200
current-owner: ai-maestro
created-by: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-24T14:55:30+0200
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: port the daemon's oauth-rotator governance layer into the server, server-native.
**SCOPE REFRAMED 2026-07-24 (grounded):** rotator.py's ORCHESTRATION is ALREADY ported — `tick.ts`
declares itself "a FAITHFUL port of rotator.py's cmd_auto / _keepalive_refresh / _refresh_and_heal_slot
/ _reconcile_live_email / _resolve_untrusted_live", and the actuator core (cascade/rotate/network/
slots/live/keychain/integrity/safe-storage) is ported too (tasks #50-55). The tick is server-WIRED:
`server.mjs:1969` starts `startOauthRotatorTick()` at boot, flag-gated OFF via
`~/.aimaestro/oauth-rotator-tick.enabled` (R16-safe). So there is NO separate `rotator.ts` to write.
REMAINING D1 = (1) `supervisor.ts` — port supervisor.py (422 lines, the 10-min governance/auto-heal
loop that oversees the rotator); (2) `cookie-vault.ts` — port cookie_vault.py (331 lines, custody);
(3) wire the supervisor beat into the server tick, mirroring `server-tick.ts`. NEXT ACTION: port
cookie_vault.py → cookie-vault.ts FIRST (custody, lower risk), reading keychain.ts / safe-storage.ts
for API parity; then supervisor.ts. Preserve the write-mutex + starvation guard; do NOT port the
human-interactive capture (reauth / slot_capture); stays R16 flag-gated.

## Spec

- Port `oauth_rotator/{supervisor,rotator,cookie_vault}.py` → `lib/oauth-rotator/{supervisor,
  rotator,cookie-vault}.ts`.
- The supervisor = 10-min governance/auto-heal loop; the rotator orchestrates ROTATE→RENEW→REAUTH
  over the already-ported `cascade.ts`/`rotate.ts`/`network.ts`/`slots.ts`/`safe-storage.ts`;
  `cookie-vault` = custody.
- Preserve the write-mutex + starvation guard.
- Do NOT port human-interactive capture (`reauth.py`, `slot_capture_browser.py`,
  `open-login.sh`) — the daemon can't rotate without pre-captured slots; that stays the human step.
- Stays R16 flag-gated (arming the live-credential write is the human's action; the port makes the
  mechanism native, it does not decide to rotate).

## Acceptance

- [ ] `tsc` 0
- [ ] Per-module unit tests (stub keychain/HTTP, 0-IMPACT) proving behavioral parity with
      `supervisor.py`
- [ ] The supervisor beat runs from the server tick when the flag is present

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
