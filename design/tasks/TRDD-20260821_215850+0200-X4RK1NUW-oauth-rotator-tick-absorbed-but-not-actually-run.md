---
trdd-id: X4RK1NUW
title: oauth-rotator-tick beats but its verdict is not yet clean — one 48h observation window stands before the 2026-08-30 deadline
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-21T21:58:50+0200
updated: 2026-08-27T01:25:33+0200
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
labels: [fleet-ask]
blocker-probe: bash /Users/emanuelesabetta/.claude/plugins/cache/ai-maestro-plugins/ai-maestro-janitor/3.3.26/scripts/oauth_rotator/lifetime-status.sh
blocker-holds-if: match:(reauth-needed|refresh-dead|expired|no session)
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
- [ ] Verified clean across a 48h+ window ~~before the 2026-08-30 deadline~~ (deadline struck 2026-08-27: the owner renewed all 3 accounts on 08-26; cookies read 27.4 d ≈ 2026-09-23, refresh tokens alive. Window start 2026-08-27T01:25:33+0200. Re-derive with the three commands in the STATE block; PASS = cookie days still >7 AND the three `expires_at` still staggered-and-recent after 48h)
- [x] Comment posted on Emasoft/ai-maestro#95 confirming the card and status

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-27

> **✅ 2026-08-27T01:30 — THE CREDENTIAL EMERGENCY BELOW IS OVER. THE OWNER RENEWED ALL THREE
> ACCOUNTS ON 2026-08-26, AND EVERY CLAIM IN THE 08-26 BLOCK THAT FOLLOWS IS SUPERSEDED.**
> Do NOT act on the "3.1 days left" block; it is kept verbatim below as the audit trail and as
> the guardrail, never as current fact.
>
> **Measured here, first-hand, not taken on report:**
>
> | claim (08-26 block) | measured 08-27T01:23 | verdict |
> |---|---|---|
> | cookies expire **2026-08-30**, 3.1 days left | `lifetime-status.sh` → **27.4 d** on all 3 (≈ 2026-09-23) | **REFUTED** |
> | all three refresh tokens **dead (`invalid_grant`)** | access tokens minted **23:34 / 00:05 / 00:41**, staggered ~30 min, expiring 07:34 / 08:05 / 08:41 | **REFUTED** |
> | live account exhausted / Fable window spent | `tick` → live `ipazia`, **5h=6% 7d=11%**, "within limits" | **REFUTED** (and already withdrawn below) |
> | the server never runs the absorbed chore | pm2 `ai-maestro` **online 21 h**, `/api/sessions` → 401 (serving); janitor `tick.last-run` still 2026-07-25, i.e. correctly yielded | **the server IS running it** |
>
> **Why the mint times are the decisive evidence and the other readings are not.** Three
> accounts minting **~30 minutes apart inside a 2-hour span** is the signature of a *scheduled
> refresh loop*; a dead refresh token cannot produce it at all, let alone staggered. By
> contrast `oauth-health`'s `refresh=yes` is **PRESENCE of a refreshToken string, not its
> validity** (`build_oauth_health` reads `bool(o.get("refreshToken"))`) — it is structurally
> incapable of seeing an `invalid_grant`, so it was never evidence in either direction. And
> `rotator.py tick` **returns before the candidate loop** while usage is within limits (6%
> here), so a clean `tick` exit does not exercise the refresh path either. Two instruments that
> look like they answer this question and do not.
>
> **The process failure worth keeping (it cost two false relays to the owner).** This session
> read the 08-26 block and relayed "3 days left, owner-only" to the owner **twice** without
> re-deriving a single number — while the owner had already renewed the accounts. That is the
> stale-blocker pattern `lessons-verification.md` records at a measured 4-in-5 rate, and the
> remedy it prescribes applies verbatim here: **a parked card must record the COMMAND that
> re-derives its blocker, never the blocker's current VALUE.** Hence the box below now names
> its own commands.
>
> **Re-derive this card's status in three commands (seconds, no browser, no human):**
> ```bash
> ROT="$CLAUDE_PLUGIN_ROOT/scripts/oauth_rotator"       # janitor plugin root
> env -u CLAUDE_PLUGIN_DATA bash    "$ROT/lifetime-status.sh"        # cookie days per account
> env -u CLAUDE_PLUGIN_DATA python3 "$ROT/rotator.py" oauth-health --json  # expires_at per account
> pm2 jlist | python3 -c 'import json,sys; [print(p["name"],p["pm2_env"]["status"]) for p in json.load(sys.stdin)]'
> ```
> Read `expires_at`: if the three timestamps are **staggered and recent**, the refresh loop is
> alive. If they are identical, or older than one token lifetime, it is not.
>
> **What is still genuinely open:** only the 48h clean-observation window (box 4). It is no
> longer racing a deadline — it is ordinary verification. Window start: 2026-08-27T01:25:33+0200.
> `/janitor-refresh-cc-logins` step 4 is **NOT needed** and must not be run on this evidence.

<details><summary>SUPERSEDED 2026-08-27 — the 2026-08-26 emergency block, kept verbatim (do NOT act on it)</summary>



> **⏳ 2026-08-26T20:46 — 3.1 DAYS LEFT, AND THE REMAINING ACTION IS THE OWNER'S ALONE.**
> Relayed by the ai-maestro-janitor session and verified on this side where it touches us.
> **All three OAuth refresh tokens are dead (`invalid_grant`).** The claude.ai **session cookies
> expire 2026-08-30** and are the ONLY remaining path that mints fresh tokens with no human.
> After that date all three accounts are manual-login-only, which ends unattended operation for
> every session on this host.
>
> **VERIFIED HERE, and it is the load-bearing part: nothing automated on EITHER side closes
> this.** Cookie access is outside the server tick's reach *by absence, not by convention* —
> `cascade.ts` and `cookie-vault.ts` were DELETED (`b50cf390`), so `tick.ts:155-158`'s "do not
> teach tick.ts to read cookies" now names files that no longer exist. There is nothing on our
> side to wire up, deliberately.
>
> **CORRECTED 2026-08-26T20:48 — THE OWNER'S ASK IS MUCH SMALLER THAN "RE-LOGIN THREE
> ACCOUNTS", and I relayed the bigger version first.** `/janitor-refresh-cc-logins` is not one
> indivisible re-login; it is FIVE steps, and **3 and 4 are separable**. Read in the skill's own
> text (`skills/janitor-refresh-cc-logins/SKILL.md:64-90`, verified here, not taken on report):
> - **step 3** = the human re-login per account (`open-login.sh`) — and the skill says outright
>   *"The reauth above only saved COOKIES"*;
> - **step 4** = mint OAuth tokens FROM cookies already on disk —
>   `CLAUDE_ROTATOR_AUTO_BOOTSTRAP=1 python3 rotator.py tick` → `_bootstrap_seeded_slots`, which
>   *"re-opens the REAL Chrome and `connect_over_cdp`-attaches to decrypt the cookies you just
>   saved"*.
>
> **Our exact situation IS step 4's precondition** — cookies live until 08-30, refresh tokens
> dead. So **step 4 ALONE may restore all three slots with no re-login at all.** That is what
> `tick.ts:228` has been advising all along (*"check the cookie layer before re-logging in"*);
> on this host it names a different and much smaller action, not just better phrasing.
>
> Two honest caveats, so this is not oversold: step 4 still opens a real Chrome window per
> account (they flash and close), so it is not zero-interaction; and if capture keeps failing the
> skill itself says to fall back to `check-login.sh` because the session may not have persisted.
> Net: **try the small thing first, fall back to the re-login** — which is exactly the order
> tick.ts recommends.
>
> **And it is a SMALLER DECISION than re-arming `reauth-repair`, which I had wrongly treated as
> equivalent.** The 2026-08-07 call was about the DAEMON opening surprise windows unattended; the
> skill states the daemon keeps auto-bootstrap OFF and per-slot capped (TRDD-5OJX3SCF), so a
> command the owner types with `AUTO_BOOTSTRAP=1` authorizes the visible browser **for that run
> only**. Still owner-only and still credential-affecting — no agent may run it — but it does not
> reverse the 08-07 decision.
>
> **The 48h acceptance window below cannot even START until the owner restores a credential
> path.** So this card's `column: todo` currently overstates agent-actionability: read it as
> *waiting on the human*, not as unclaimed work.
>
> **~~Separate and NOT a credential problem: 5h at 2%, 7d at 67%, Fable window spent at 100%,
> so move work off Fable.~~ WITHDRAWN 2026-08-26T20:54 — EVERY NUMBER IN THAT SENTENCE IS
> UNSUBSTANTIATED, and I relayed all of them as measured.**
> The janitor retracted the source (their `9d7819eb`): it came from a stored `active-alerts.json`
> string whose `firstSeenAt` was **3.6 hours before it was read**, while the FILE's mtime was 6
> minutes — delivery bookkeeping rewrites the file WITHOUT recomputing the message. They checked
> the file's age and took it as the claim's age. The 5h/7d figures rode in on the same frozen
> string, so they are withdrawn too — not disproved, simply never measured.
> Independently on this side: **0 of 13 registered agents carry a Fable model**, so the proposed
> remedy was empty here regardless. Their own probes show `seven_day_fable` NULL across all 16,
> with `nimbus_quill` at 0.0% — i.e. there is no evidence a spent Fable window exists at all.
>
> **What SURVIVES is the frame, and it is the part worth keeping:** *window-spent* and
> *credential-dead* are different failures, and the rotator can report STUCK while the account
> is healthy. That distinction is real and is why the alert exists. What failed was reading a
> stored alert's numbers as current.
>
> **The transferable trap, because their two artifacts fail in OPPOSITE directions:**
> `findings-ledger.ndjsonl` is append-only, so a resolved HIGH stays maximally alarming forever;
> `active-alerts.json` IS rewritten, but only its bookkeeping, so the file looks fresh while its
> payload is frozen. **Recency is useless in both cases and misleads in opposite ways.**
> Checked on our side: exactly ONE place reads mtime as an age —
> `safe-storage.ts:169 latchAgeSeconds()` — and it is **safe by construction**, because the latch
> file's only content IS its existence, so the mtime is the datum rather than a proxy for a
> payload. That is the general rule the two artifacts bracket: **mtime is a sound age proxy
> exactly when the file carries no computed payload, and unsound the moment it does.**
>
> Surfaced to the USER 2026-08-26. Recorded here because the janitor's own finding was that the
> deadline had lived only in a chat message: *"what was missing was nobody telling the USER the
> clock exists"*. A fact that exists only in a session dies with it.

</details>

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

> **⚠ THE REASON FILTER ALONE IS NOT ENOUGH — SECOND DEFECT IN THE SAME CRITERION, caught by the
> next review fork and verified first-hand. A COVERAGE FLOOR IS MANDATORY.** `surveyAlternates`
> does `const b = readSlot(email); if (!b) { unreadable.push(email); continue }` — the `continue`
> is BEFORE the refresh check — and `tick.ts:1407-1408` gives `unreadable` PRECEDENCE over
> `deadRefresh`. So **`refresh-dead` is structurally unpublishable while ANY slot is unreadable**,
> and a criterion that breaks only on `refresh-dead` reads "no `refresh-dead` published" as a
> proxy for "no `refresh-dead` condition existed". Under a latch the tick is *incapable of
> emitting the signal being watched for*: absence is guaranteed, not observed — the third instance
> today of a proxy read in place of the thing, this time load-bearing inside my own fix for the
> previous one. Two aggravations: the gate is `unreadable > 0`, not *all* unreadable, so ONE flaky
> slot masks a genuinely dead credential on every other account; and a sustained latch makes the
> blindness unbounded rather than ≤600 s.
>
> **It already happened, 59 times, today, in my own data:** the slots were genuinely dead until
> the ~09:47 re-mint, and 59 of the 79 `slot-unreadable` beats fall in 04-06h — INSIDE that dead
> period. Those were real credential faults reported under the reason this criterion excuses.
>
> **THE FLOOR (both clauses, both one grep):** the window counts as clean only if, in addition to
> no `refresh-dead` beat, **(i) ≥95 % of its beats are non-`slot-unreadable`** and **(ii) no
> contiguous `slot-unreadable` run exceeds one cooldown (~12 beats)**. Clause (ii) exists because
> a 5 % budget over 48 h is ~2.4 h, which could all be one blind block. Measure with:
>
> ```bash
> grep -a "oauth-rotator\]" logs/pm2-out.log | awk '{d=$1} /UNREADABLE/{u[d]++} /auto:/{t[d]++} \
>   END{for(k in t) printf "%s unreadable=%d/%d (%.1f%%)\n",k,u[k],t[k],100*u[k]/t[k]}' | sort | tail -14
> ```
>
> **Measured now, last 12 days:** `0.0 · 0.0 · 0.0 · 1.2 · 2.3 · 5.1 · 12.2 · 12.5 · 12.8 · 13.5 ·
> 16.8 · 42.1 %`. So **5 of the last 12 days would FAIL the floor** and 2026-08-20 ran 42 % blind —
> a clean-but-blind window is not a hypothetical here, it is what most weeks look like. This is
> also why *"prefer landing MFTDMSJY first"* below is now effectively *required*: until the latch
> stops firing, the floor is what will fail, and correctly so.
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
