---
trdd-id: MFTDMSJY
title: The keychain denied-latch fires on a 5s TIMEOUT and emits a false reauth-needed for 10 minutes each time
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T11:12:21+0200
updated: 2026-08-26T11:32:22+0200
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

**Zero denials among 350 LOGGED SETs.** Not one matched a `DENIAL_MARKERS` string
(`user interaction is not allowed`, `errSecAuthFailed`, `errSecInteractionNotAllowed`,
`errSecUserCanceled`, …) — the branch the latch was designed for has never fired here. The
parenthetical "(a keychain unlock/ACL prompt)" is a guess printed as a diagnosis, and it aims the
next debugger at an ACL problem that does not exist.

**Two limits on that population, both narrowing the claim rather than inverting it** (review-fork
caveat, then verified first-hand at `safe-storage.ts:213-216` and `:229-232`): (a) the half-open
re-stamp is `{quiet: true}` and writes NO log line, so 350 counts logged SETs, not latch-seconds —
the true exposure is ≥ that, which strengthens the finding; (b) **while latched no op spawns at
all**, so no denial is even OBSERVABLE during those windows — "zero denials" is true by
construction for that ~13% slice and is real evidence only for the rest of the day, when ops did
spawn and produced none. Also note the noisy/quiet split is not a blind spot for CHAINED latches:
a half-open probe that itself times out falls through to the **non-quiet** `setKeychainDenied` at
`:230`, so a persistently-failing keychain still logs one SET per cooldown — CONSISTENT WITH (not
proof of) today's 04:26:18 → 04:36:58 pair, 640 s apart. **That pair does not discriminate** and
is recorded here only as non-contradicting: clear-then-independently-re-fail predicts the same
~640 s spacing as chaining. The claim rests on the CODE READ, which is sufficient; what would
discriminate is whether any non-`UNREADABLE` beat falls in the gap.

**And the "zero denials" grep is NOT structurally blind — verified by reading the branch, not by
assuming it.** `safe-storage.ts:238-241`: `if (returncode !== 0 && isDenial(stderr))
setKeychainDenied('`security` returned an ACL/auth/user-canceled denial')` — **non-quiet**, so a
real denial WOULD emit a `DENIED-LATCH SET` line carrying that distinct string. The `uniq -c`
above shows only the two "hung past Ns" variants, so the absence is observed rather than
unobservable. (Recorded because I first made this claim having stopped my read at `:235`, one
line short of the branch that decides it.)

**Window correction:** "350 in the last month" was MY window, not the file's. `head -1
logs/pm2-error.log` reads **2026-07-11 17:17:25**, so the population spans **46 days**, i.e.
~7.6 latches/day — today's 8 is an ordinary day, not a spike, and the "last month" phrasing
overstated the rate by ~1.5×.

**Frequency, measured:** 350 logged latches over the log's full 46-day span (~7.6/day) · **8
today** (04:26:18, 04:36:58,
05:07:18, 05:21:12, 06:02:06, 06:29:24, 10:33:21, 11:03:30) · 51 on 2026-08-20. Six of today's
eight fired BEFORE the janitor's 09:40-10:05 browser capture, which is what refutes the
capture-caused story (see the correction below).

> **⚠ CORRECTING MY OWN FIGURE, same session, before anyone builds on it.** The first draft of
> this card — and the 11:1x comment on ai-maestro#95 — cited **"607 `reauth-needed` beats today"**
> as the measure of latch noise. That number is real and it is the WRONG POPULATION: it is every
> reauth beat, and splitting it by reason gives
>
> ```
> 530  N alternate slot(s) have a dead refresh and are expiring …   ← REAL (slots were dead until ~09:5x)
>  79  N alternate slot(s) UNREADABLE from this process …           ← the latch-attributable class
> ```
>
> So the honest latch figure today is **79 beats, not 607** — and 79 ≈ 8 latches × ~10 beats at
> the ~1 beat/min tick, which is exactly what a 600 s cooldown predicts, so the arithmetic now
> corroborates the attribution instead of quietly contradicting it (8 × 600 s = 80 min could never
> have produced 607). By hour: **04:18, 05:20, 06:21 (59 PRE-recovery) · 10:11, 11:9 (20
> POST-recovery)**.
>
> **The conclusion is unchanged and the evidence for it is now smaller and correct:** 20 false
> beats in the ~1.5 h since the slots went fresh is still far more than a 48 h window can absorb
> under a break rule of "any `reauth-needed`". I caught this by checking my own arithmetic against
> the tick cadence; a bare count of a mixed population is not a measurement of one class in it.

~~`PROBE_TIMEOUT_MS = 5_000` governs the read path. A `security find-generic-password` on a loaded
box can exceed 5 s with no prompt involved, so the timeout is very likely simply too tight~~ —
**MEASURED AND REFUTED 2026-08-26T11:3x. Do not spend a session on the timeout.**

```
N=36 (3 accounts × 2 services × 6 rounds), fails=0
p50=25.9 ms   p95=59.0 ms   max=78.3 ms   min=16.4 ms   over_5000ms=0
```

**A 5 s timeout is 64× the observed maximum.** Baseline read latency does not come within two
orders of magnitude of tripping it, so "the timeout is too tight" is dead and **proposed fix #3
is withdrawn** — raising `PROBE_TIMEOUT_MS` would mask whatever is actually stalling, which is the
one thing #3 could do that the others cannot.

> **⚠ AND THIS PARTLY REVERSES THIS CARD'S HEADLINE FRAMING — recording it rather than quietly
> keeping the stronger claim.** If a read is normally 26 ms, then a >5000 ms stall is not slowness,
> it is a **block** — and the most obvious thing that blocks a `security` read indefinitely is
> exactly what the banner names: **a keychain unlock/ACL prompt waiting on a human who is not
> there.** Note the asymmetry that makes this invisible to the `DENIAL_MARKERS` path: a prompt that
> HANGS never returns, so it can only ever surface as a TIMEOUT, never as a denial string. So
> "350 timeouts / zero denials" is consistent with BOTH readings — spurious stalls *and* real
> hanging ACL prompts — and I presented it as evidence for the first. **It is not: it cannot
> discriminate them.** The wording "(a keychain unlock/ACL prompt)" is still unjustified *by the
> code* (it is printed for ANY non-ENOENT spawn error, including ones that have nothing to do with
> a prompt), but the cause it names has gone from "an ACL problem that does not exist" to **the
> leading hypothesis**. That sentence in the Problem section above is hereby narrowed to the code
> objection only.
>
> **What this does NOT change:** the false `reauth-needed: slot-unreadable` is wrong either way — a
> read the server DECLINED to attempt is not an unreadable slot — so proposed fix #2 (and the
> coverage floor) stand on their own regardless of which hypothesis wins. **What it sharpens:** the
> question is no longer "is 5 s too tight" but **"what blocks a 26 ms read for >5 s, 7.6× a day,
> while 87 % of reads in the same period succeed?"** A blanket ACL denial is ruled out by that 87 %
> — the server plainly reads these items most of the time.
>
> **Caveat on my own instrument, stated because it is the same trap this thread keeps hitting:**
> these 36 samples were taken from an INTERACTIVE SHELL, not from the server process. Shell
> latency is a PROXY for server latency — different session, different keychain ACL context. It is
> sufficient to kill fix #3 (nothing about the server makes a 26 ms operation take 5 s *by
> latency*) and it is NOT sufficient to characterise the stall. Measuring that needs the timing
> instrumented inside `runSecurity` itself, which is a code change and belongs in the fix.

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
3. ~~**Raise/justify `PROBE_TIMEOUT_MS`** only if the measurement below shows real read latency
   near 5 s.~~ **WITHDRAWN — the measurement was taken and killed it** (p95 59 ms against a 5000 ms
   budget). Raising the timeout would only lengthen the block.
4. **NEW, and now the highest-value one: instrument the stall.** Record the elapsed time and the
   argv of any `security` call that exceeds ~1 s, inside `runSecurity` itself. That is the only
   measurement that can answer "what blocks a 26 ms read for >5 s, 7.6× a day, while 87 % of
   reads in the same period succeed" — and it distinguishes a hanging ACL prompt (the banner's
   own claim, now the leading hypothesis) from anything else, which decides whether 1 is even the
   right frame.

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

- [x] `security` read latency measured on this box (p50/p95/max, N≥30) and recorded here —
      **DONE 2026-08-26T11:3x: N=36, 0 fails, p50 25.9 ms / p95 59.0 ms / max 78.3 ms, zero
      samples over 5000 ms.** Verdict: 5 s is NOT too tight (64× the max), fix #3 withdrawn, and
      the framing shifts from "spurious timeout" toward "something BLOCKS the read" — see the
      reversal note in Problem. Measured from an interactive shell, which is a PROXY for the
      server's context; sufficient to kill #3, not to characterise the stall (that is new fix #4).
- [ ] The stall characterised from INSIDE `runSecurity` (elapsed + argv for any call > ~1 s), so
      a hanging ACL prompt is distinguishable from any other block — this is what decides the
      fix, now that latency is ruled out
- [ ] A TIMEOUT no longer produces the same machine-wide suppression + ACL-worded banner as a real
      denial (whatever shape 1/2/3 the measurement selects), with a test pinning the distinction
- [ ] A latch-suppressed slot read is NOT reported as `reauth-needed: slot-unreadable`
- [ ] ≥24 h with zero false `reauth-needed` beats attributable to a latch, measured from the logs
      **AND a coverage floor: ≥95 % of that window's beats non-`slot-unreadable`.** The floor is
      not decoration — WITHOUT it this box has the same proxy defect the window criterion had:
      **zero false beats is also what a fully-latched, fully-silent rotator produces**, so the box
      would be satisfiable by the failure it exists to detect. Measured blindness fraction per day
      (`UNREADABLE` beats ÷ `auto:` beats) over the last 12 days: **0.0 / 0.0 / 0.0 / 1.2 / 2.3 /
      5.1 / 12.2 / 12.5 / 12.8 / 13.5 / 16.8 / 42.1 %** — so a blind-but-clean window is not
      hypothetical here, it is what 2026-08-20 was.
- [ ] X4RK1NUW's 48 h window criterion re-checked against the fix (it is amended in the meantime)
- [ ] Correction posted on ai-maestro#95 (the capture-caused cause clause + the "no card needed"
      line)

## Approval log

- 2026-08-26T11:12:21+0200 — MANDATE (self, min-approval-requirement: none). Carded from an
  adversarial review of `2b7dc8e7`; every number above re-measured first-hand before filing.
