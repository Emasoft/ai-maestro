---
trdd-id: CPETQBAW
title: Port the daemon orchestration loop and keepalive
column: blocked
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T17:04:00+0200
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
blocked-by: [S5RUHJRP]
pre-block-column: dev
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

**box 1 = 5/7 absorbed chores scheduled NOW; blocked on D4 for the last 2.** Scheduled: oauth-tick,
oauth-supervisor, session-liveness+fleet-stop (fleet-liveness-watchdog), version-update (auto-update
dynamic, D3/YLCTM8EU), server-liveness. MISSING: `marketplace-refresh` + `user-plugins-update` — those
are **D4 (S5RUHJRP)**, itself blocked on the janitor confirming the `marketplace-op.lock` path (my D7
ASK on janitor#100). So this TRDD is BLOCKED-BY D4 until those two chores register with the same
per-chore-timer pattern. NO speculative backoff wrapper added (all 5 scheduled chores log+retry-next-
interval on failure with no harmful hammering — "write only what is strictly necessary").

## Spec

- Port `daemon.py`/`daemon_keepalive_entry.py` scheduling + `lib/{keepalive_boot,
  keepalive_stage,session_liveness,daemon_throttle,daemon_watchdog,daemon_path}.py` into a server
  continuity module driven at boot (pattern of `startOauthRotatorTick`/`startServerLiveness`), so
  the server's tick performs the interval-gated chores with the daemon's throttle/backoff/
  bulk-lane semantics.
- `server-liveness.json` keeps writing every 30 s unconditionally from boot.

## Acceptance

- [ ] The continuity loop schedules every absorbed chore with the daemon's interval/backoff
- [ ] A restart shows the loop up and the janitor daemon staying exited

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
