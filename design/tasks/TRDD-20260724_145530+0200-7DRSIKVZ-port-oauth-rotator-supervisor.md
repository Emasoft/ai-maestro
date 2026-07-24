---
trdd-id: 7DRSIKVZ
title: Port oauth-rotator-supervisor and rotator core into the server
column: complete
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T16:44:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
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
implementation-commits: [eb1439d5, b3846e9b, f0c66776]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

**COMPLETE 2026-07-24.** All 3 D1 parts landed + verified; column → complete. Commits:
- (2) `cookie-vault.ts` — custody port, **`eb1439d5`**. 17/17 parity tests. Load-bearing fix: Chrome's
  *_utc columns exceed 2^53, so INTEGER columns are read via better-sqlite3 `safeIntegers(true)` →
  BigInt (carried as decimal strings in JSON) — a lossy Number would corrupt the timestamp.
- (1) `supervisor.ts` — the alert-only governance layer, **`b3846e9b`**. 24/24 parity tests. PURE
  `diagnose(facts)` covering all six branches (opt-in gate, pinning-env, non-macos short-circuit,
  tick-stalled/daemon-alive-gated, setup-token-expiring, cookie-leg-stuck) + `trackCannotSelfRenew`
  D3 sidecar + injected-dep `gatherFacts`. `daemonAlive` defaults false (Python's fail-safe).
  Root-scoped: `slotFacts` reads the PASSED root's state.json (not global loadState).
- (3) beat wiring — `server-supervisor.ts` + `server.mjs`, **`f0c66776`**. 7/7 DI'd tests.
  LIVE-VALIDATED: `pm2 restart` → startup log "OAuth-rotator supervisor beat started"; /api/sessions
  401 (up). Gate = the rotator OPT-IN (alert-only, no live-write flag needed); `daemonAlive` maps to
  `oauthTickEnabled()` (tick armed = beat owner alive).

**REFRAME that made this small (grounded):** rotator.py's ORCHESTRATION was already ported — `tick.ts`
= "a FAITHFUL port of rotator.py's cmd_auto / _keepalive_refresh / …", the actuator core
(cascade/rotate/network/slots/live/keychain/integrity/safe-storage) ported (tasks #50-55), the tick
server-wired at `server.mjs` (flag-gated OFF). So there was NO separate `rotator.ts` to write — only
supervisor + cookie-vault + the beat. Human-interactive capture (reauth / slot_capture) deliberately
NOT ported; stays the human step. R16-safe throughout: reads observable metadata, writes only the
observability sidecar, never a live credential.

**NEXT (parent KCRMSNL7 / Flock D):** D1 done → the remaining Flock-D NPTs are D2 (SX593MDG freeze
recovery), D4 (S5RUHJRP marketplace-refresh + user-plugins-update locks), D5 (A77JBHC9 honest
capability tokens), D6 (CPETQBAW daemon orchestration loop), D7 (2X4AYX9T GitHub coordination).

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

- [x] `tsc` 0 — verified clean after every part (cookie-vault, supervisor, beat wiring)
- [x] Per-module unit tests (stub keychain/HTTP, 0-IMPACT) proving behavioral parity with
      `supervisor.py` — 48 tests: cookie-vault 17 + supervisor 24 (all 6 diagnose branches) + beat 7
- [x] The supervisor beat runs from the server tick when the flag is present — LIVE-VALIDATED:
      `pm2 restart` → "OAuth-rotator supervisor beat started"; /api/sessions 401 (up); opt-in gate
      inside the beat proven by the 7 DI'd wiring tests

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
- 2026-07-24T16:44:00+0200 — COMPLETED by ai-maestro (self-mandate, min-approval-requirement: none). All 3 D1 parts landed + verified (eb1439d5, b3846e9b, f0c66776); live-validated at boot. dev → complete.
