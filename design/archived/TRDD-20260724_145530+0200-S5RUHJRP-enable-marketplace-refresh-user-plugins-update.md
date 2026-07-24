---
trdd-id: S5RUHJRP
title: Enable marketplace-refresh and user-plugins-update under the shared locks
column: complete
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T21:32:56+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
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

**COMPLETE 2026-07-24 (commit `6aac9397`).** Unblocked by READING THE JANITOR SOURCE rather than
waiting on janitor#100 — the USER's "port the daemon line-by-line" directive is the instruction to
do exactly that. Two corrections to this TRDD's own earlier plan, both material:

1. **WRONG DIRECTORY.** The plan said `~/.claude/janitor-control/marketplace-op.lock`. The shipped
   daemon uses `global_state_dir()/marketplace-op.lock` (`global_state.py:433` —
   `_marketplace_lock_path()`, **not** `_control_path()`). Building as planned would have given the
   two processes two different files and ZERO mutual exclusion, silently. This is the rework the
   "wait for the reply" hold was protecting against; the answer was in the source all along.
2. **WRONG PREMISE — sharing the janitor's lock is IMPOSSIBLE in pure Node.** It uses kernel
   `fcntl.flock(2)`; an O_EXCL lockfile cannot interoperate (both sides "acquire"). The USER
   already ruled this identical trade-off on 2026-07-17 for the rotation tick: take a
   SERVER-INTERNAL lock rather than add a native dep under the Node-22 ABI constraint. So the lock
   is `marketplace-op-server.lock` — a DISTINCT name, because borrowing the janitor's would LOOK
   like coordination while providing none (silent, and it reads as correct). A test pins the name.

**What landed:** `lib/server-lockfile.ts` (the O_EXCL + pid-liveness + stale-reclaim mechanism
EXTRACTED from `oauth-rotator/tick-lock.ts`, which is now a thin binding with its API unchanged —
its 29 tests pass untouched); `lib/marketplace-lock.ts` (name + a deliberately generous 30-min
stale window: reclaiming from a slow-but-live holder would start the second concurrent `claude
plugin` mutation the lock exists to prevent); and the guard in `runTickSafely` so it covers the
scheduled tick AND a "Run now" from another process (`tickInFlight` only ever guarded one).
Held ⇒ SKIP, never block.

**Honest scope:** this excludes SERVER-family processes from each other. It does NOT exclude a
live Python `#N` daemon. That is acceptable because the daemon EXITS when the server owns the host
(re-verified: a `ps` snapshot shows zero `daemon.py`), and the janitor's own source calls these
locks "the collision backstop". The real fix is the janitor moving `marketplace-op.lock` into the
FIXED control dir as it already did for `oauth-rotator-tick.lock` — asked on janitor#100.

The auto-update master toggle stays default-OFF (human opt-in, per D3/YLCTM8EU): this ships the
MECHANISM, arming remains the human's.

## Spec

- The `auto-update-service` exists but `enabled:false` by default; wire the server to run both
  `marketplace-refresh` and `user-plugins-update` on schedule, contending on
  `~/.claude/janitor-control/marketplace-op.lock` + writing `*.last-run.ts` so N processes run
  each at most once/period.

## Acceptance

- [x] Both `marketplace-refresh` and `user-plugins-update` run on schedule — the auto-update
      scheduler is started at server boot (`server.mjs:1882`) and its tick performs both (Step 1
      marketplace refresh, Step 2 plugin updates); live-confirmed on restart, "Auto-update
      scheduler initialized". Firing still requires the human's master toggle, by design.
- [x] A concurrent-run test proves the shared lock prevents double exec — `marketplace-lock.test.ts`:
      a second acquire is refused while held, `withMarketplaceLock` returns null WITHOUT running the
      body, and the lock is released even when the body throws. (Proven at the lock layer; the
      service wiring is the one-line `withMarketplaceLock(() => runTick(s))` in `runTickSafely`.)

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
- 2026-07-24T21:32:56+0200 — COMPLETED by ai-maestro (self-mandate). Landed `6aac9397`; both boxes met. Unblocked by grounding the lock path in the janitor SOURCE (two corrections to this TRDD's own plan, recorded in STATE) rather than waiting on the janitor#100 reply, which never came. dev → complete.
