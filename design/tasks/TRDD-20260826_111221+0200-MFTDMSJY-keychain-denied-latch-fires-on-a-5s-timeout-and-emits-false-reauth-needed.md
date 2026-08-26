---
trdd-id: MFTDMSJY
title: The keychain denied-latch fires on a 5s TIMEOUT and emits a false reauth-needed for 10 minutes each time
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T11:12:21+0200
updated: 2026-08-26T11:12:21+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-26T11:12:21+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: critical
effort: M
labels: [credentials, alarm-noise, blocks-deadline]
external-refs: [Emasoft/ai-maestro#95, TRDD-X4RK1NUW, TRDD-3GU9V70H, TRDD-EQJPPZ2L]
---

## Problem

**Measured 2026-08-26 11:0x-11:1x, first-hand from `logs/pm2-error.log` and `logs/pm2-out.log`.**

`lib/oauth-rotator/safe-storage.ts::runSecurity` treats **any** `spawnSync` failure — including
a plain `ETIMEDOUT` — as a keychain DENIAL, sets the machine-wide denied-latch, and logs

> `a security op hung past 5s (a keychain unlock/ACL prompt)`

While the latch is set, **every** server-side `security` op short-circuits without spawning, so
`readSlot` returns null for slots that are perfectly readable, `surveyAlternates` counts them as
`unreadable`, and `tick.ts:1407` publishes `reauth-needed: slot-unreadable` — a **false** call for
a human re-login. The latch's 600 s half-open (TRDD-EQJPPZ2L) then clears it, so each event is a
~10-minute block of false alarm.

**The stated cause is unsupported in every single recorded case.** Classifying all 350 latch
events in `pm2-error.log`:

```
$ grep -a "DENIED-LATCH SET" logs/pm2-error.log | sed 's/.*DENIED-LATCH SET: //' | sort | uniq -c
 349  a `security` op hung past 5s  (a keychain unlock/ACL prompt)…
   1  a `security` op hung past 10s (a keychain unlock/ACL prompt)…
```

**350 of 350 are TIMEOUTS. Zero are denials.** Not one matched a `DENIAL_MARKERS` string
(`user interaction is not allowed`, `errSecAuthFailed`, `errSecInteractionNotAllowed`,
`errSecUserCanceled`, …) — the branch the latch was designed for has never fired here. The
parenthetical "(a keychain unlock/ACL prompt)" is a guess printed as a diagnosis, and it aims the
next debugger at an ACL problem that does not exist.

**Frequency, measured:** 350 latches in the last month · **8 today** (04:26:18, 04:36:58,
05:07:18, 05:21:12, 06:02:06, 06:29:24, 10:33:21, 11:03:30) · 51 on 2026-08-20 · **607
`reauth-needed` beats today alone**. Six of today's eight fired BEFORE the janitor's 09:40-10:05
browser capture, which is what refutes the capture-caused story (see the correction below).

`PROBE_TIMEOUT_MS = 5_000` (`lib/oauth-rotator/keychain.ts:30`) governs the read path. A
`security find-generic-password` on a loaded box can exceed 5 s with no prompt involved, so the
timeout is very likely simply too tight — but that is a HYPOTHESIS this card must measure, not
assume.

## Why this is priority 0

It **blocks TRDD-X4RK1NUW's 48 h clean window against the 2026-08-30 deadline.** At 7-8
latches/day × 600 s of false `reauth-needed` each, a window whose break condition is "any
`reauth-needed`" is **unpassable by construction**. Either the break criterion excludes
latch-induced `slot-unreadable`, or this defect is fixed first. X4RK1NUW's NEXT ACTION has been
amended to say so.

## Correction this card carries forward

`TRDD-3GU9V70H` (archived, frozen) and the 2026-08-26 10:47 comment on ai-maestro#95 both state
the latch fired *"exactly while the janitor's browser-capture was rewriting the keychain items"*.
**That causal clause is FALSE** — the capture ran 09:40-10:05 and the latch fired at 10:33:21, 28
minutes after it ended, with 349 other latches unrelated to any capture. A same-second-looking
coincidence read as causation. The MECHANISM in those two places is right (latch ⇒ suppressed
`security` ⇒ false `slot-unreadable`, self-clearing after 600 s, matching the older 2026-08-25
flap's edges to the second); only the trigger attribution is wrong. #95 gets a follow-up
correction; the archived card stays frozen and is corrected here instead.

Also corrected: that comment said *"no card needed"* for the flap. This card IS the one
X4RK1NUW asked for *"if it persists after 3GU9V70H's recovery"* — it demonstrably persists
(11:03:30 latch, post-recovery, against fresh slots).

## Proposed fix (shape, not yet decided — the measurement below picks)

1. **Separate TIMEOUT from DENIAL.** A timeout must not set the same machine-wide latch a real
   ACL denial does, and must not print an ACL cause it did not observe. Candidates: a distinct
   soft-latch with a much shorter cooldown, or a consecutive-timeout threshold before latching.
2. **A latch-suppressed read must not be reported as `slot-unreadable`.** `surveyAlternates`
   cannot currently distinguish "the keychain says no" from "we declined to ask". A third state
   (`probe-suppressed`) keeps `reauth-needed` for real credential faults only — the same
   same-label-different-noun trap 3GU9V70H hit with `all-maxed`.
3. **Raise/justify `PROBE_TIMEOUT_MS`** only if the measurement below shows real read latency
   near 5 s. A bare bump without the measurement is a guess replacing a guess.

## Verification

- Measure real `security find-generic-password` latency on this box under load (N samples, report
  p50/p95/max) — this decides whether 5 s is too tight or whether something else stalls.
- After the fix: zero `reauth-needed: slot-unreadable` beats whose window coincides with a latch,
  across ≥24 h, while `grep -c "DENIED-LATCH SET"` may still be non-zero (a timeout may still be
  recorded — it just must not produce a re-login call).

## Estimated risk

MED. Touches the credential read path shared with the janitor daemon. The latch exists to stop an
unattended process hanging on a GUI prompt — any change must keep that property (a REAL denial
must still suppress ops without prompting). Coordinate on ai-maestro#95 if the shared slot
contract moves; a purely server-side latch/classification change does not need to.

## Acceptance

- [ ] `security` read latency measured on this box (p50/p95/max, N≥30, under representative load)
      and recorded here — decides whether 5 s is too tight
- [ ] A TIMEOUT no longer produces the same machine-wide suppression + ACL-worded banner as a real
      denial (whatever shape 1/2/3 the measurement selects), with a test pinning the distinction
- [ ] A latch-suppressed slot read is NOT reported as `reauth-needed: slot-unreadable`
- [ ] ≥24 h with zero false `reauth-needed` beats attributable to a latch, measured from the logs
- [ ] X4RK1NUW's 48 h window criterion re-checked against the fix (it is amended in the meantime)
- [ ] Correction posted on ai-maestro#95 (the capture-caused cause clause + the "no card needed"
      line)

## Approval log

- 2026-08-26T11:12:21+0200 — MANDATE (self, min-approval-requirement: none). Carded from an
  adversarial review of `2b7dc8e7`; every number above re-measured first-hand before filing.
