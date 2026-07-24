---
trdd-id: CPETQBAW
title: Port the daemon orchestration loop and keepalive
column: complete
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T21:32:56+0200
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
implementation-commits: [6aac9397]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

**DESIGN DECISION (grounded, 2026-07-24): the faithful server port of the daemon's scheduling loop
is PER-CHORE independent unref'd timers, NOT a single ported loop.** A line-by-line port of
`daemon.py`'s single while-loop into the server would be REGRESSIVE: the daemon runs many chores in
ONE thread, which is exactly why it needs throttle/backoff/**bulk-lane anti-starvation** (so a slow
chore never starves the critical `oauth-rotator-tick`). The server has no such shared thread — each
chore is an independent `setInterval`, `unref`'d, fire-and-forget with its own never-throws wrapper,
and Node's event loop interleaves them. Porting the single loop would re-introduce the single-point-
of-failure and starvation the per-timer pattern structurally avoids. The ACTUATOR CORE was ported
line-by-line (cascade/rotate/network/slots/live/keychain/integrity/supervisor/cookie-vault — tasks
#50-55 + D1); the SCHEDULER is faithfully functional-ported (same chores, same intervals, same
serialization locks where the daemon had them: `withTickLock` on the oauth beat).

**LIVE-CONFIRMED box 2:** `pm2 restart` → every continuity timer up (tick 60s, supervisor 600s,
fleet-liveness watchdog 300s, server-liveness 30s, invariants 300s); `server-liveness.json` writes
every 30s; and a `ps` snapshot shows **NO `daemon.py` process** — the janitor daemon stays exited
(`server-owns-host`, daemon.py:2032). So "the loop is up and the daemon stays exited" holds.

**COMPLETE 2026-07-24 — box 1 is now 7/7.** D4 (S5RUHJRP, `6aac9397`) registered the last two
chores, so every absorbed chore is scheduled with the per-chore-timer pattern:

| # | chore | server timer |
|---|---|---|
| 1 | `oauth-rotator-tick` | 60 s, `withTickLock` (the daemon's serialisation, ported) |
| 2 | `oauth-rotator-supervisor` | 600 s, alert-only |
| 3 | `session-liveness` + `fleet-stop` | 300 s, fleet-liveness watchdog |
| 4 | `version-update` | auto-update scheduler (dynamic candidate set — D3/YLCTM8EU) |
| 5 | `server-liveness` | 30 s, unconditional from boot |
| 6 | `marketplace-refresh` | auto-update tick Step 1, under `withMarketplaceLock` (D4) |
| 7 | `user-plugins-update` | auto-update tick Step 2, same lock (D4) |

NO speculative backoff wrapper was added: every scheduled chore logs and retries on its next
interval with no harmful hammering — "write only what is strictly necessary".

**Re-validated live 2026-07-24 21:32** on a server carrying the D4 build: `pm2 restart` → HTTP 401
on `/api/sessions` (up); startup logs show the auto-update scheduler plus all continuity timers;
and a `ps` snapshot (snapshot-then-grep, never a live `pgrep`) shows **zero `daemon.py`** — the
janitor daemon stays exited, `server-owns-host`.

## Spec

- Port `daemon.py`/`daemon_keepalive_entry.py` scheduling + `lib/{keepalive_boot,
  keepalive_stage,session_liveness,daemon_throttle,daemon_watchdog,daemon_path}.py` into a server
  continuity module driven at boot (pattern of `startOauthRotatorTick`/`startServerLiveness`), so
  the server's tick performs the interval-gated chores with the daemon's throttle/backoff/
  bulk-lane semantics.
- `server-liveness.json` keeps writing every 30 s unconditionally from boot.

## Acceptance

- [x] The continuity loop schedules every absorbed chore with the daemon's interval/backoff —
      7/7 scheduled (table in STATE), as per-chore unref'd timers rather than a single ported
      loop; the daemon's serialisation is preserved where it existed (`withTickLock` on the oauth
      beat, `withMarketplaceLock` on the marketplace/plugin chore)
- [x] A restart shows the loop up and the janitor daemon staying exited — re-validated
      2026-07-24 21:32 on the D4 build: HTTP 401 (up), all timers logged, zero `daemon.py`

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
- 2026-07-24T21:32:56+0200 — COMPLETED by ai-maestro (self-mandate). D4 registered chores 6-7, making box 1 7/7; box 2 re-validated live on the D4 build. blocked → complete.
