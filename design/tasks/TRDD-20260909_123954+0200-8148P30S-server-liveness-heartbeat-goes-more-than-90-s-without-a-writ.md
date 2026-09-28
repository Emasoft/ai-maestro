---
trdd-id: 8148P30S
status: tasked
title: server-liveness heartbeat goes more than 90 s without a write while the server is alive, handing the rotator tick to the janitor
column: backburner
created: 2026-09-09T12:39:54+0200
updated: 2026-09-28T08:16:52+0200
current-owner: governance-rules-session
created-by: governance-rules-session
task-type: bugfix
min-approval-requirement: none
assignee: governance-rules-session
mandate: true
mandated-by: none
approved: true
approval-judge: governance-rules-session
approval-datetime: 2026-09-09T12:39:54+0200
---

# server-liveness heartbeat goes more than 90 s without a write while the server is alive, handing the rotator tick to the janitor

## Problem
MEASURED (the janitor plugin's daemon.log, 2026-09-08): the janitor took over its own oauth-rotator-tick in 5 distinct episodes on 09-08 (12:22:55, 12:53:14→12:58:55, 13:17:10, 22:42:20, 23:47:17), 4 on 09-07, 1 on 09-06, while the ai-maestro server pid has been alive since 2026-09-05 11:16 (no restart). The two attributed transitions read `liveness ts=1788900049.0 age=91.4s reason=stale` (22:42:20) and `age=98.7s` (23:47:17): the on-disk server-liveness.json ts was more than 90 s old (reader harness_backend.py:300 LIVENESS_STALE_AFTER_S=90, age computed :386-391) although the writer beats every 30 s (lib/server-liveness.ts:247-254, atomic tmp+renameSync :212-213). So the writer went at least 91 s / 98 s without a successful write — a WRITE GAP. Node coalesces a stalled setInterval into one late fire, so "three missed beats" and "one beat 61+ s late" are the same observation; neither is claimed.

NOT the cause (measured 2026-09-09, reports/lean-worker/20260909_123659+0200-OUAQARPL-sleep-wake-vs-takeovers.md): host sleep/wake — `pmset -g log` carries zero Sleep/Wake/DarkWake events for 09-02..09-09 (61k lines, all assertions). REFUTED as a discriminator: "a [JanitorPublish] beat precedes the stall" (705 beats/day, 1801 pm2-log gaps of 60 s or more since boot). INFERRED, not measured: WHY the write was late — a main-thread stall (a sync fs call on the event loop) vs an IO stall inside the sync writeFileSync/renameSync (Spotlight, APFS snapshot) vs memory pressure (the 23:47 episode sits near pm2-error.log memory-guard lines reporting 305-474 MB free, which on macOS is not by itself pressure; the 22:42 episode has no such line). The late-beat instrument aa961973 (`[server-liveness] late beat: gap …`, transition-only) is committed but NOT running: the live process booted before it and `.next` carries 0 'late beat'.

Consequence: on every episode the janitor's `oauth_rotator/rotator.py tick` runs beside the server's rotator (both write tmp+atomic-rename; a machine-wide rotator-tick flock exists, rotator.py:71,3055). Whether two ticks deciding alternately is harmless is OPEN — the audit card TRDD-OUAQARPL box 3 owns that observation, not this card.

## Proposed fix (two stages)
Stage 1 — attribute, do not guess: extend the late-beat line in lib/server-liveness.ts with the fields that separate the candidates — `os.loadavg()[0]`, `os.freemem()`, the event-loop lag on the same timer (expected fire time vs actual), `process.hrtime` vs `Date.now()` drift across the gap (a wall-clock jump), and the duration of the write itself (IO stall). Deploy = `yarn build` + `pm2 restart`, which is on USER HOLD (uncommitted server.mjs): stage 1 lands in the tree and WAITS for that decision — see STATE.

Stage 2 — after at least one attributed stale event (or 48 h of the running instrument with zero, which re-scopes this card): choose between beating from a `worker_threads` worker (immune to a main-thread stall, not to IO or a clock jump) and asking the janitor side for a reader tolerance (coordinate via SendMessage to the janitor session per the USER /goal 2026-09-05; never edit the janitor repo). Do not pick before the data.

## Acceptance
- [x] the late-beat line carries loadavg, freemem, event-loop lag, hrtime-vs-Date.now drift and write duration; a test drives the late-beat BRANCH with fake timers and asserts every field (neuter: drop one field from the format → red; a format-string check with the branch unreached is vacuous and does not count)
- [ ] the instrument is observed running: at least one `[server-liveness] late beat` line in logs/pm2-error.log after the USER's build+restart, OR 48 h of the running instrument with zero such lines while daemon.log shows zero takeovers — either outcome is recorded here with the log lines
- [ ] the stage-2 choice is implemented with a test that reddens under neuter, and the choice cites the attributed event(s) recorded under box 2

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-09
NEXT ACTION: the stage-1 instrument edit in lib/server-liveness.ts + tests/unit/server-liveness.test.ts (Tier 0, in-tree). BLOCKED AFTER THAT on the USER's server.mjs hold: no build/restart is authorised, so box 2 cannot start until the USER decides. Open question for stage 2: is the janitor's tick idempotent beside the server's — both take the rotator flock, but what each decides on the same window data is unmeasured. Count distinct gaps, never takeover lines: 1/4/5 episodes on 09-06/07/08.
2026-09-27 — STAGE 1 LANDED AND HARDENED (commits 2fd28c4c + 9bc1c55f). The first review's vacuity finding caught a real shipped unit bug: hrtime.bigint()/1_000n yielded MICROseconds not ms (1000x-inflated clockDriftMs since stage 1); fixed to /1_000_000n and pinned by a differential second-beat test (fake Date advances, real hrtime; neuter reddens exactly that test). 25/25 + tsc 0. NEXT ACTION unchanged: box 2 waits on the USER's build+restart decision (server.mjs hold stands) — nothing here is workable without it.
2026-09-27 (cont.) — REVIEW ROUNDS CLOSED. (1) Box 1's named FORMAT-NEUTER now run: dropping freemem from the emitted line reds exactly the presence assertion; corrupting lagMs reds the value assertion; the µs-divisor neuter reds the differential assertion at −2432 (busy-wait margins guarantee ≥3ms real separation — the review's own ±30s widening proposal was arithmetically wrong and corrected, commit 485e9a7b). (2) GARBAGE WINDOW: clockDriftMs values emitted between commits 2fd28c4c and 9bc1c55f are ~1000x inflated (µs divisor); no build/restart occurred in that window so pm2-error.log should carry none — grep before citing any clockDriftMs line as attributed evidence. (3) Known instrument limits, one line each: a wall-clock step before the FIRST late beat is invisible (anchor calibrates to the already-jumped clock); gradual NTP slew accumulates into the same field a discrete step does.
2026-09-27 (cont. 2) — ROUND-3 REVIEW APPLIED. GARBAGE-WINDOW NOTE CORRECTED (it stated an inference as fact): no build/restart was AUTHORISED in the window (USER hold); none is KNOWN to have occurred; a dev-mode/tsx server running from source would emit garbage lines despite no yarn build — grep the log rather than trusting this line. Column stays backburner: blocked requires a non-empty blocked-by naming an OPEN CARD (D4-5b invariant) and a USER decision is not a card, so backburner is the only rule-consistent park. Test upper bound 1005 → 1000 (catches a sign-flip variant at +3, costs nothing). Commit: next.
2026-09-27 (cont. 3) — ROUND-4 REVIEW (accepted, nits applied): the garbage values are an order-1000 error from a µs-scaled hrtime term — sign either way, scaling with real elapsed time, NOT uniformly 1000x of a true drift (a large real window can read hugely negative, e.g. -999000). Garbage signature for the box-2 grep: any clockDriftMs= line whose |clockDriftMs| is implausible against its own gap= field (drift approaching or exceeding the gap by orders of magnitude = the µs signature), or whose timestamp falls in 2fd28c4c..9bc1c55f. Column note corrected: backburner is the only park available WITHOUT minting a tracking card — blocked+unblock-when becomes legal if a USER-decision card is ever minted.
2026-09-27 (cont. 4) — ROUND-5, review loop CLOSED (findings shrank monotonically; further rounds would generate findings for their own sake). Signature sharpened: the large-drift signature is the µs bug OR a GENUINE wall-clock step — buggy drift is overwhelmingly NEGATIVE, a real forward step POSITIVE — so a magnitude-tripped line is a trigger for inspection, never a classifier: corroborate against pmset/NTP logs before discarding any clockDriftMs line. Commit: next.
2026-09-28 — code-review follow-up (commit 2fd6217d1): the server's stranded-record reap now owns EVERY TICK_ALERT_PREFIXES code (was root-only), so the legacy file's leftover reauth-needed/rotator-stuck records from a refused window are reaped at the next healthy beat instead of stranding 7 days. Pinned by tests (4)/(4b) (3cabee64c). OPEN QUESTION re-opened in a new form: the janitor's own tick ALSO writes these codes under the same flock — the server-side clear can now reap a record the janitor still tracks as outstanding (duplicate ONSET on its side). Flock serializes beats; it does not coordinate semantics. The box-2 stage-2 measurement (both writers on the same window) now also covers this reap interaction.

## Approval log

- 2026-09-09T12:39:54+0200 — MANDATE issued by governance-rules-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-09T12:41:03+0200 — minted from the TRDD-OUAQARPL audit (live_auditing) as its fix card; Tier 0 self-mandate. Title deliberately names the measured WRITE GAP and no mechanism: the cause is INFERRED (see Problem). Sleep/wake refuted by pmset log 2026-09-09.
- 2026-09-27T16:37:21+0200 — column → dev by main-agent@ai-maestro. Picked up under the USER's 2026-09-27 parallel lean-worker directive. Stage 1 instrument only — no build/restart (server.mjs hold stands); box 2 remains USER-gated after this.
- 2026-09-27T18:11:16+0200 — column → backburner by main-agent@ai-maestro. Stage 1 fully landed and neutered; remaining boxes are USER-gated (build+restart hold) — a WORK column asserting activity that is not happening is the board lying about itself (review round 2 finding b). Parked, not blocked: a USER decision is not a card, so blocked-by cannot name it.
