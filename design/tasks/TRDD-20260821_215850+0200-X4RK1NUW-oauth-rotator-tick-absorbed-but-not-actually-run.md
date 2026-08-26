---
trdd-id: X4RK1NUW
title: oauth-rotator-tick beats but its verdict is not yet clean — one 48h observation window stands before the 2026-08-30 deadline
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-21T21:58:50+0200
updated: 2026-08-26T11:22:49+0200
review-after: 2026-08-24
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T21:58:50+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: critical
effort: M
labels: [fleet-ask, hub-blocked]
external-refs: [Emasoft/ai-maestro#95, TRDD-1GGQ4HWY, TRDD-DPPYVLVH]
---

## Problem

`ai-maestro-janitor`'s `harness_backend.py` lists `oauth-rotator-tick` in
`SERVER_ABSORBED_TASKS` — by the owner's own rule, once the server is live the janitor yields
this chore unconditionally, no per-capability negotiation. The server is expected to then run it.
On 2026-07-26 it did not: the janitor stopped cleanly (`server-owns-host`), nothing picked the
tick up, every stored account slot's access token (8h lifetime) expired with no renewal, and
rotation became impossible because a candidate account can't be probed for safety with an expired
token — even though every slot still had a valid, unused `refreshToken` the whole time.

**This recurred** (per the issue's 2026-08-21 update): fix verified 2026-08-05, same end state
back today. There is a stated **2026-08-30 deadline** on having a no-human recovery path working,
per the latest issue comment (`reauth-needed` / `refresh-dead` verdict written 34 seconds before
last read, meaning the tick beats but its verdict logic itself is wrong now — not merely absent).

## Root cause

Two related defects, not one: (1) the server accepted ownership of `oauth-rotator-tick` via the
absorption contract but has no scheduled execution path actually performing the slot-keepalive
refresh (using each slot's `refreshToken` against `platform.claude.com/v1/oauth/token`), and (2)
per the 2026-08-21 recurrence, even when the tick DOES fire, its verdict computation
(`reason: refresh-dead`) is producing a wrong diagnosis rather than performing the refresh.

## Proposed fix

1. Confirm/implement the actual scheduled keepalive: refresh any stored account token approaching
   expiry, at ~0.5h headroom before the 8h expiry (matching the janitor's own
   `ROTATOR_KEEPALIVE_AHEAD_H` behavior it is replacing).
2. Fix whatever produces `reason: refresh-dead` when a refresh token is in fact present and valid
   — read the exact tick code path and the two just-landed janitor-side fixes referenced in the
   issue (the issue explicitly names "two fixes just landed in the janitor" the TS daemon needs to
   port; read the issue's full body/comments for the fix details before implementing).
3. Add an observable, low-cost self-check: the tick's own status file
   (`~/.aimaestro/oauth-rotator-tick-status.json`) must be auditable against real slot expiry so a
   silent "beating but wrong" state is caught by monitoring, not by outage.

## Verification

- All three account slots' access tokens stay renewed continuously across a 48h+ observation
  window with no manual intervention.
- Rotation successfully picks a healthy alternate when the primary account is near its weekly cap.
- The tick status file's verdict matches ground truth (slot expiry state) at every read.

## Acceptance

- [x] Server-side scheduled keepalive for oauth-rotator-tick actually executes (not just accepted via the absorption contract)
- [x] The 2026-08-21 `refresh-dead` misdiagnosis root-caused and fixed
- [x] Two janitor-side fixes referenced in the issue ported to the TS daemon
- [ ] Verified clean across a 48h+ window before the 2026-08-30 deadline
- [x] Comment posted on Emasoft/ai-maestro#95 confirming the card and status

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-21

4/5 boxes closed. Evidence: `reports/colony/unit1-X4RK1NUW.md` (gitignored, not pushed) and
GitHub comment https://github.com/Emasoft/ai-maestro/issues/95#issuecomment-5375378217.

> **⛔ 2026-08-21T23:05 — COORDINATOR CHECK: THE BOX-2 FIX IS COMMITTED AND IS *NOT RUNNING*.**
> This card is titled *"absorbed but not actually run"*, and its own fix is now in exactly that
> state. Measured, not inferred:
> - fix commit `1a4b8cdf` authored **23:02:38**;
> - `pm2 jlist` → `ai-maestro` current instance started **16:29:22 UTC = 18:29:22 local**
>   (`restarts=27`), i.e. **4½ hours BEFORE the fix**;
> - `grep -c 'server-tick' server.mjs` → **1**, so `lib/oauth-rotator/server-tick.ts` is
>   **runtime-imported** by `server.mjs` (transpiled per-boot), NOT bundled — which means it goes
>   live on a `pm2 restart` ALONE and needs no `yarn build`, and equally means **no restart ⇒ the
>   old code is still executing**;
> - the live verdict written **23:03:01** (34 s before this check) still reads
>   `"reason":"refresh-dead"` — consistent with the pre-fix precedence.
>
> So box 2's tick is TRUE of the repo and FALSE of the running system. That distinction is this
> card's entire subject, which is why it is recorded here rather than quietly restarted away.
>
> **I did NOT restart the server, deliberately.** A `pm2 restart` drops the WebSocket/PTY stream
> for every live agent session (~19 peers were up), so it is disruptive and outward-facing — the
> owner's call, not a verification side effect. **NEXT ACTION for whoever holds that call:**
> `pm2 restart ai-maestro`, then confirm the alert CODE and the decision MESSAGE agree by reading
> `~/.aimaestro/oauth-rotator-tick-status.json` plus `rotator.log` across two beats. Until then,
> treat box 2 as *landed, undeployed*.

- Box 1 VERIFIED live: the tick beats on cadence (mtime advanced 60s apart across two reads;
  rotator.log ONSET/CLEARED cycling through the check).
- Box 2 VERIFIED + FIXED: the "cascade.ts unreachable -> misdiagnosis" hypothesis from the
  2026-08-21 issue comment is REFUTED (deliberate design, already documented in tick.ts's own
  docstring, TRDD-XV9BLQC5). The REAL bug found and fixed: alert CODE selection in
  `server-tick.ts` used a different precedence (stuck-first) than the message (`deriveDecision`,
  reason-first), so one unchanged condition flapped between two alert codes
  (`rotator-stuck:all-maxed` <-> `reauth-needed:refresh-dead`) beat-to-beat. Fixed: code now
  follows reason>stuck, matching the message. Test added + neuter-verified (1 red / 28 green).
- Box 3 VERIFIED already-shipped (2026-08-05): `network.ts:15-31` (UA split), `usage-cooldown.ts`
  (throttled cache). Nothing to port.
- Box 4 OPEN by construction: needs a real 48h+ observation window, which cannot happen inside one
  work session. Recovery for the currently-dead refresh tokens (invalid_grant, all 3 slots) needs
  either a human `/janitor-refresh-cc-logins` or re-arming `reauth-repair`
  (`~/.aimaestro/oauth-reauth-repair.enabled.DISABLED-20260807-headed-browser-windows` — the owner
  disabled it 2026-08-07 for opening disruptive headed browser windows). Both are outside this
  session's scope (credential-affecting / human UX decisions).
- Box 5 done: comment posted.

**NEXT ACTION for whoever resumes this card:** either (a) wait out the 48h window with the current
state and re-verify the tick status file / rotator.log stay consistent, or (b) get the USER's
decision on re-enabling `reauth-repair` (or performing a manual `/janitor-refresh-cc-logins`) to
actually recover the 2 live-cookie slots before their 2026-08-30 cookie expiry, then start the 48h
clock. Neither is code work.

**Changed:** `lib/oauth-rotator/server-tick.ts` (alert code precedence fix, TRDD-X4RK1NUW),
`tests/unit/oauth-rotator-server-tick.test.ts` (new pinning test). Full suite: 6075 passed / 1
pre-existing unrelated failure (`tests/governance/specs-in-sync.test.ts`, confirmed failing
identically at HEAD with this change stashed). tsc clean on touched files.

## Approval log

## Observation window — 2026-08-22T14:25+0200 (evidence for the one open box)

**The tick BEATS. The card's TITLE is stale; its body already knew.** Status file written
`12:24:59Z`, read 10 seconds later — so "absorbed but not actually run" is false as of today, and
the body's own correction ("the tick beats but its verdict logic itself is wrong now — not merely
absent") is the accurate statement. The title is the part that never caught up.

```
{"nextAction":"reauth-needed","at":"2026-08-22T12:24:59.383Z","reason":"refresh-dead",
 "stuck":"all-maxed","windows":{"fiveHourPct":7,"sevenDayPct":96,"scopedModel":"Fable",
 "scopedPct":100,"fiveHourResetsAtSec":1787416800}}
```

**`stuck: all-maxed` here is NOT the old false alarm — checked before reporting it as one.** I read
this as a self-contradiction (`all-maxed` beside a 5h window at **7%**) and was about to file it.
`lib/oauth-rotator/tick.ts:230-252` already fixed exactly that on 2026-08-07, with a
neuter PAIR whose red sets are disjoint. Today's numbers are precisely the case that fix exists
for: account windows healthy (5h 7%, 7d 96%), Fable scoped at 100% ⇒ the MODEL is spent, not the
account, and the remedy is switch-the-model rather than wait. The raw `stuck` field still reads
`all-maxed`; the human-facing message is what distinguishes them. Nothing to fix here.

**What is genuinely open is narrower than the card's Problem section.** Boxes 1-3 and 5 are ticked
and hold up; the single open box is a 48h+ clean observation, which cannot be ticked by effort —
only by elapsed time — and **the window has not started, because the current state is not clean.**
`reason: refresh-dead` / `nextAction: reauth-needed` is, per the fixed message at `tick.ts:226`,
a report of what was OBSERVED (the OAuth rung is dead) and explicitly NOT a claim that a human is
required: *"a live claude.ai cookie can still mint these with NO human; check the cookie layer
before re-logging in."*

**OWNER-FACING, and why I am not acting on it.** Restoring the OAuth rung touches stored
credentials, which is the one category this session does not act on unilaterally — and the
remaining verification is an elapsed-time observation regardless. Surfaced to the owner
2026-08-22 with the **2026-08-30 deadline** named. Left at `column: todo` rather than `dev`: no
one is working it, and the next honest move is a reading taken later, not a change made now.

**NEXT ACTION** — re-read the status file and compare against the deadline:
`cat ~/.aimaestro/oauth-rotator-tick-status.json`. Clean for 48h ⇒ tick the last box and close.
Still `reauth-needed` ⇒ the cookie layer is the thing to check, per the message's own remedy.

### 2026-08-26T04:47 — box-2 deploy VERIFIED; card BLOCKED on credential recovery (TRDD-3GU9V70H)

- **Box-2 fix is DEPLOYED** (review-fork-corrected wording): the live pm2 process was last (re)started
  **2026-08-26 04:27:34** (`~/.pm2/pm2.log` events, the thing itself: every restart in the last
  24h is `Stopping app` + SIGINT — deliberate operator restarts at 17:24 / 18:16 / 23:05 on
  08-25 and 04:27 today, zero unexpected exits; note `pm2_env.created_at` re-stamps per
  execution and `unstable_restarts` only sees sub-min_uptime deaths, so neither counter alone
  proves this — the daemon log does. The handoff's "restart ~00:05" was off: it was 23:05:31), which
  post-dates the fix by 5 days, and `server-tick.ts` is runtime-imported, so the code in memory
  is the fixed one. The "landed, undeployed" ⛔ above is resolved. **The discriminating
  BEHAVIOR is honestly unproven**: old and new code diverge only when `all-maxed` and a reason
  BOTH hold, and the post-restart log has 0 `all-maxed` lines — so "code/message agree" and
  "no flap" are equally true of the old build. Vacuous absence, not verification; it settles
  only if an all-maxed beat is ever observed clean.
- **The 48h window cannot start.** Ground truth in `state.json`: ALL THREE slots are
  `credential-dead` (`invalid_grant` × 233/576/789), access tokens expired 08-11..08-14
  (epoch-ms recomputed; an earlier draft said 08-08..11), `cookie-leg-stuck`
  cycling for all three accounts. (`cookie-leg-since.json` = `{}` was earlier misread as "the
  leg minted nothing" — supervisor.ts:288 shows it tracks cannot-self-renew ONSET, and `{}`
  with three dead slots is itself an anomaly for 3GU9V70H to explain. The dead-slot conclusion
  rests on `refresh_dead_fp == fp` in state.json, which was read first-hand.) Recovery is the janitor's cookie leg or a human
  `/janitor-refresh-cc-logins` — carded as **TRDD-3GU9V70H**, which now blocks this card.
- **New observation, NOT the box-2 defect:** the REASON flaps `slot-unreadable ↔ refresh-dead`
  beat-to-beat (18:58→19:09→22:58→23:19→04:26), spanning pre- and post-restart. Code and
  message agree at every transition, so it is not verdict logic — `readSlot` intermittently
  returns null for slots that exist (transient keychain read failure from the server process).
  Alarm-noise defect in the READ layer; card it separately if it persists after 3GU9V70H's
  recovery (a healthy slot set may make it moot).

~~**NEXT ACTION**: complete TRDD-3GU9V70H (cookie-leg check via ai-maestro#95, else the owner runs
`/janitor-refresh-cc-logins`), then start the 48h observation window~~ — **SUPERSEDED
2026-08-26T10:47: 3GU9V70H is COMPLETE** (slots re-minted by the janitor's `41ccc80f` — the
capture leg had no PEP-723 header and could never start; three consecutive non-`reauth-needed`
ticks verified 10:43-10:45). This card is UNBLOCKED (`blocked-by: []`, back to `todo`).

~~**NEXT ACTION**: start the 48h observation window NOW … only a `reauth-needed` breaks the
window.~~ — **AMENDED 2026-08-26T11:12, 25 minutes after it was written: THE WINDOW AS SPECIFIED
IS UNPASSABLE BY CONSTRUCTION.** An adversarial review caught it and I re-measured every number
first-hand: the server's keychain denied-latch fires **350× in the last month, 8 times today**
(04:26:18, 04:36:58, 05:07:18, 05:21:12, 06:02:06, 06:29:24, 10:33:21, 11:03:30), each
suppressing every `security` op for 600 s and publishing a FALSE `reauth-needed: slot-unreadable`
throughout — **79 latch-attributable `slot-unreadable` beats today** (CORRECTED same session from
"607", which was every reauth beat of both reasons; 530 of those were the REAL `refresh-dead`
population from before the slots were re-minted. 79 ≈ 8 latches × ~10 beats at the ~1 beat/min
tick, which is what the 600 s cooldown predicts; by hour 04:18 / 05:20 / 06:21 pre-recovery,
10:11 / 11:9 POST-recovery), one of them at 11:03:31, i.e. the window
broke 4 minutes BEFORE the commit that opened it. At 7-8 latches/day no 48 h window can survive a
break rule of "any `reauth-needed`". Carded as **TRDD-MFTDMSJY** (priority 0).

~~**NEXT ACTION**: … Attribute by timestamp — a beat is latch-attributable iff a
`[safe-storage] KEYCHAIN DENIED-LATCH SET` line in `logs/pm2-error.log` precedes it by
< 600 s.~~ — **THAT RULE IS UNSOUND; REPLACED 2026-08-26T11:2x.** It scores from the LOGGED SET
line, and `setKeychainDenied(reason, {quiet: true})` returns before its `console.error`, so the
half-open **re-stamp is silent** — it does `fs.renameSync`, whose own comment says it "refreshes
mtime, which is what `_latchAgeSeconds` reads", so the latch's real age moves with no log line.

> **Narrowing this, measured at `safe-storage.ts:229-232`:** the sentence originally continued
> "…so a keychain that keeps timing out stays latched for 1200 s, 1800 s, … behind a SINGLE logged
> line." **That overstates it.** A half-open probe that ITSELF times out falls through to the
> **non-quiet** `setKeychainDenied` at `:230`, so a persistently-failing keychain logs one fresh
> SET per cooldown — visible in today's 04:26:18 → 04:36:58 pair, 640 s apart ≈ one cooldown plus
> the probe. The residual hole is only the few seconds between the silent re-stamp at T+600 and
> the noisy SET at T+600+timeout. **The rule is still the wrong instrument** — it reads a log line
> as a PROXY for latch state, needs arithmetic nobody will redo the same way twice, and has a real
> if small blind window — which is why it is replaced rather than patched.

**NEXT ACTION — the break criterion, replaced with one the tick already computes:**
**a `reauth-needed` beat with `reason: refresh-dead` BREAKS the window; a beat with
`reason: slot-unreadable` does NOT.** No timestamp correlation, immune to the silent re-stamp,
and one grep to score. Sound because `tick.ts:1407-1408` sets `refresh-dead` on `deadRefresh > 0`
(a real credential fault) and `slot-unreadable` on `unreadable > 0` — and while the latch is set
NO `security` op spawns at all, so every slot reads null and a `slot-unreadable` beat carries
**zero** credential information either way. Excusing it costs nothing; it is unreadable, not
healthy. `stuck:all-maxed` also remains CLEAN (a model-window verdict — 3GU9V70H's REFUTED
blockquote). Score with:

```bash
grep -a "2026-08-2[6-9].*reauth-needed" logs/pm2-out.log \
  | sed -E 's/.*reauth-needed: [0-9]+ alternate slot\(s\) //' | cut -c1-20 | sort | uniq -c
```

(today: 530 `have a dead refresh` — all PRE-recovery — and 79 `UNREADABLE`.) Spot-check the live
verdict with `cat ~/.aimaestro/oauth-rotator-tick-status.json`.
**Prefer landing MFTDMSJY first** — a window scored under any attribution rule is weaker evidence
than one with no false beats in it, and the 2026-08-30 deadline still has room.

**Resolved during 3GU9V70H, do NOT re-investigate as a `readSlot` fault:** the
`slot-unreadable ↔ refresh-dead` flap noted above is the KEYCHAIN DENIED-LATCH. Mechanism
verified to the second — latch SET 18:58:53 → first `UNREADABLE` beat 18:58:53 → last 19:08:24 →
19:09:25 back to `refresh-dead`, i.e. exactly the 600 s cooldown, and the same for 22:58:27 /
23:09:41 / 04:26:18, matching every edge recorded above. **CORRECTION to my earlier note here and
on ai-maestro#95:** the latch was NOT caused by the janitor's browser capture — that ran
09:40-10:05 and the latch fired at 10:33:21, 28 minutes later, with 349 other latches unrelated to
any capture. It is a routine 5 s `security` TIMEOUT (350/350 recorded latches are timeouts; **zero**
are real denials). And it DOES need a card — this is precisely the alarm-noise defect this STATE
block asked to be carded "if it persists after 3GU9V70H's recovery": **TRDD-MFTDMSJY**.
