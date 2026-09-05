---
trdd-id: OUAQARPL
title: chore ownership of oauth-rotator-tick flapped between the janitor daemon and the server for four hours
column: live_auditing
created: 2026-09-05T21:13:22+0200
updated: 2026-09-05T21:21:20+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: audit
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-05T21:13:22+0200
labels: [oauth-rotator, janitor-coordination]
---

# chore ownership of oauth-rotator-tick flapped between the janitor daemon and the server for four hours

## Problem
The janitor daemon's log shows its OWN oauth-rotator-tick task starting/finishing interleaved with
"chore-coordination: yielding to active ai-maestro server" lines from 15:01 to 19:18 on 2026-09-05,
then continuous yielding from 19:19:17; i.e. claimed_chores() intermittently read empty while the
server was alive — consistent with a stale or restarted ~/.aimaestro/server-liveness.json
(staleness window 90 s, harness_backend.LIVENESS_STALE_AFTER_S); no corruption because a
machine-wide rotator-tick write flock exists
(ai-maestro-janitor/3.4.14/scripts/oauth_rotator/rotator.py:71,3055), but two rotators alternately
deciding is the flap TRDD-5ADHOZE4 was measuring for.

## Root cause
UNKNOWN, to measure: which side let the liveness file go stale (server writer paused / a server
restart inside the window — none measured: the three `[Startup]` lines at 09:45, 10:10 and 11:16 all precede it / hub tick not writing) vs the daemon reading it.

## Proposed measurement
Correlate server-liveness.json mtimes (or its ts) with the daemon.log yield/own-tick lines for
15:00-19:20; if the writer paused while the server was up, fix the writer's cadence; if the daemon
read a fresh file as stale, the bug is the janitor's (cross-repo -> file an issue, never edit the
janitor).

## Acceptance
- [ ] The 4-hour window is explained with file:line evidence
- [ ] The responsible side is named and the fix (or cross-repo issue) is linked
- [ ] A 24 h re-read of daemon.log shows zero janitor-run oauth-rotator-tick tasks while the server is alive

## Approval log

- 2026-09-05T21:13:22+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T21:21:20+0200 — column → live_auditing by ai-maestro-hub-session. audit card minted from a daemon.log irregularity intakes at live_auditing per manager-approval-defaults B
- 2026-09-05T21:51:11+0200 — Measured our writer side: lib/server-liveness.ts startServerLiveness()
  line 236, interval `opts.intervalMs ?? 30_000` (line 237), setInterval (line 239), atomic
  tmp+renameSync (lines 209-213), a failed write logs `[server-liveness] heartbeat write failed`
  (line 215); server.mjs:2025-2026 starts it with no override so effective period is 30 s. Live
  sample 21:45-21:49 UTC+2: 8 writes at 36/30/30/37/30/30/30/30 s. pm2 error log carries 0
  `server-liveness` lines all day. No server restart in or near 15:01-19:19 (writer pid alive since
  the 11:16:52 boot; prior boot 2026-08-28). Janitor side (its own session, 21:36/21:45): daemon
  logs only transitions (scripts/daemon.py:3610-3621), reader threshold 90 s and bare-except -> None
  (scripts/lib/harness_backend.py:286-310); its single 86.6 s age sample at 21:13:50 was withdrawn
  after an 18-sample sawtooth at 21:42-21:45 showed ~31 s resets, peak 35 s; its last
  yield/resume transition today is 19:19:17. It filed TRDD-HXZ8B0IS (reason+ts+age on every
  transition line; commit 8bcd2975 on its repo) as the attribution fix on its side. Verdict:
  the flap is NOT explained by writer period, by a restart, or by a logged write failure; remaining
  candidates are a stalled event loop delaying the setInterval tick (three missed beats needed) or
  a reader-side effect. Root cause UNCONFIRMED — boxes stay open. Cross-ref: janitor TRDD-HXZ8B0IS
  (commit 8bcd2975 on its repo). By ai-maestro-hub-session.
- 2026-09-05T21:51:11+0200 — Additional measured datum, leading candidate for box 1 (UNMEASURED
  causal link, not an explanation): the janitor's last transition at 19:19:17 correlates with a
  `[JanitorPublish]` beat 2 s earlier in our pm2 error log. JanitorPublish is the one absorbed chore
  using synchronous main-thread fs calls (writeFileSync/readFileSync/readdirSync/statSync);
  memory-guard, fleet-plugins-update, cache-prune and github-config-audit run async execFile
  subprocesses and cannot stall the setInterval heartbeat the way a sync fs call on the main thread
  can. By ai-maestro-hub-session.
