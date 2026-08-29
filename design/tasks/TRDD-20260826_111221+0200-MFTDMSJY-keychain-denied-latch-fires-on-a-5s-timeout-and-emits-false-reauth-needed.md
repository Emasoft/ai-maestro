---
trdd-id: MFTDMSJY
title: The keychain denied-latch fires on a 5s TIMEOUT and emits a false reauth-needed for 10 minutes each time
column: testing
pre-block-column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T11:12:21+0200
updated: 2026-08-30T00:54:09+0200
implementation-commits: [c471b66d, bda75f7d, 863fbcb3, 60257266]
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

## ⏵ STATE — 2026-08-30: the fix is LANDED. Only a soak window is left, so this is `testing`.

`todo` → **`testing`**. `todo` asserts work is waiting to start; the behavioural fixes shipped
days ago and the sole remaining criterion is a **measurement that takes ≥24 h of wall clock**.

- **LANDED:** a TIMEOUT no longer produces the same machine-wide suppression + ACL-worded
  banner as a real denial; a latch-suppressed read is no longer reported as
  `reauth-needed: slot-unreadable`; a timed-out read is no longer reported as `unreadable`;
  and the `runSecurity` instrumentation (`c471b66d`) that characterised the stall — and
  **refuted** the ACL-prompt hypothesis the banner had been printing as a diagnosis.
- **CLOSED 2026-08-30 (it had been true since 2026-08-26):** the ai-maestro#95 correction.
  Both halves are in comment `2026-08-26T09:14:45Z`. **Nobody had gone back to look**, so a
  priority-0 card carried an open box for four days over work already done.
- **OPEN, and time-gated only:** ≥24 h with zero latch-attributable false `reauth-needed`
  beats **AND ≥95 % of that window's beats non-`slot-unreadable`. Do not drop the floor** —
  without it the box is satisfiable by the failure it exists to detect, because zero false
  beats is also what a fully-latched, fully-silent rotator produces.

**NEXT ACTION.** Start (or read) the soak window against the shipped fix and score BOTH
criteria. No code change is pending. If the floor fails, that is a result, not a retry.

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
- [x] **INSTRUMENTATION LANDED** (`c471b66d`) — `runSecurity` now times every spawn and, at
      >= `SLOW_SECURITY_LOG_MS` (2500 ms, ~40x the measured p95, deliberately BELOW the 5000 ms
      timeout so a stall that recovers at 3 s is still captured), logs elapsed + argv + whether it
      timed out + whether it was the half-open probe. argv is safe to log: the secret is never on
      the command line (`-w` prints to stdout), and WHICH item blocks is the open question.
      3 tests, complementary neuter pair (`if (false)` -> 2 red / 18 green; `if (true)` -> 1 red /
      19 green), so each test falls to exactly one mutation and none is vacuous. Observation only:
      the latch, its cooldown and every verdict are untouched.
- [x] **The stall CHARACTERISED from that instrumentation — DONE 2026-08-28, and it REFUTES the
      card's own leading hypothesis.** The instrumentation was already deployed (a prior session
      built + restarted; first sample 02:11) and had been collecting ~12.5 h unattended.
      **29 slow ops, 02:11 → 14:42:**

      | axis | result |
      |---|---|
      | accounts | **4 distinct** — 13 / 10 / 5 / 1 |
      | services | **2** — `Claude Code-rotator-slot` (24), `Claude Code-credentials` (5) |
      | verb | all 29 `find-generic-password` |
      | outcome | **26 RECOVERED**, only 3 timed out |
      | elapsed | p50 3041 ms, max 11062 ms — **but see the caveat below; this is the TAIL's median, not latency's** |
      | by hour | 13 @02h · 6 @03h · 3 @06h · 3 @07h · 4 @14h — **bursty, not a steady tax** |

      **The ACL-prompt hypothesis is dead, and ONE measurement carries it.** The card predicted
      "one item repeatedly ⇒ ACL prompt on that item; across all six ⇒ process-wide" — the stall
      is spread over **4 accounts and 2 services**, so by the card's own written predicate it is
      process-wide. That leg is a measurement against a pre-registered criterion and it stands
      alone; everything below is corroboration, ranked beneath it deliberately.

      ~~Second leg: zero `SecurityAgent` rows in 24 h ⇒ no dialog was displayed.~~ **WITHDRAWN AS
      STATED — the query was insufficient and I called it a measurement because it produced
      output.** It ran at DEFAULT log level and named only `SecurityAgent`; re-run with
      `--info --debug` across `security`/`authd`/`securityd` it returns **1,503,601 rows** in the
      same window, including 166,239 from `authd` and 97,160 from `securityd` — processes in the
      auth path that my predicate excluded. A `loginwindow` positive control proved the log had
      DATA, not that it had SecurityAgent's data; coverage for one process is not coverage for
      another. This was the same error as the assumption it replaced, one layer along.

      **What the wider query actually shows, recorded as a LEAD and not a cause (n=1):**
      `SecurityAgent` is absent even at info+debug (0 rows), consistent with no dialog being
      drawn. But there is exactly ONE prompt-shaped event in 24 h, and it is a SUPPRESSION:

      ```
      2026-08-28 07:00:56 securityd[607]: suppressing keychain prompt
      /usr/bin/security(4076); code signing check failed rc=-67065
      ```

      That is `securityd` declining to prompt for **`/usr/bin/security`** — the exact binary the
      rotator spawns — after a code-signing check failed. It is one event against 29 slow ops, so
      it explains at most one of them and may be unrelated; it is written here because it is the
      only direct evidence in the window about the keychain's prompting behaviour toward our own
      caller, and because `rc=-67065` is a concrete string a future session can search on. **Do
      not promote it to the cause without a second instance correlated to a slow op.**

      **Caveat on the elapsed figures, and it is not cosmetic.** Every one of the 29 lines exists
      only because it crossed the 2500 ms log floor, so "p50 3041 ms" is the median OF THE TAIL,
      not of read latency — the denominator (all reads in the window, the overwhelming majority
      fast) was never observed. For the same reason "26 recovered" means *slow enough to log, fast
      enough not to time out*, not a recovery rate. And the 59 ms p95 it was originally printed
      against came from an INTERACTIVE SHELL, which box 1 itself flags as "a PROXY for the
      server's context; sufficient to kill #3, not to characterise the stall". Comparing the two
      is comparing two populations through a proxy, so the "50-190x" is withdrawn as a statistic.
      What survives is the shape, which is what the box asked for: reads that normally finish in
      tens of ms do sometimes take seconds, and at least one took 11 s.

      **Consequence for the fix:** #1 and #2 are now BOTH clearly right and their justification
      changes. A 5 s timeout against a p95 of 59 ms is not too tight (box 1), but real ops DO
      reach 11 s, so timeouts will keep happening — which makes separating TIMEOUT from DENIAL
      (#1) the load-bearing fix rather than a nicety, and makes the ACL wording in the banner
      actively misleading rather than merely unsupported.

- [x] A TIMEOUT no longer produces the same machine-wide suppression + ACL-worded banner as a real
      denial (whatever shape 1/2/3 the measurement selects), with a test pinning the distinction
      — **DONE 2026-08-28T21:36+0200, `bda75f7d`.** Shape chosen: the consecutive-timeout
      threshold (fix #1, second candidate), `TIMEOUT_LATCH_THRESHOLD = 3`, per-process, reset by
      ANY keychain answer. Chosen over a soft-latch because the measurement said the transient
      RECOVERS (26 of 29) — a shorter cooldown still blinds the machine for its duration, a
      threshold blinds it for nothing. The banner now reads "N consecutive ops TIMED OUT — cause
      NOT observed"; the ACL wording is gone. Pinned by 3 tests in
      `tests/unit/oauth-rotator-safe-storage.test.ts`; neuter `3 → 1` reddens exactly those 3.
- [x] A latch-suppressed slot read is NOT reported as `reauth-needed: slot-unreadable` — **DONE,
      same commit.** `surveyAlternates` returns `probeSuppressed: true` with EMPTY arrays when the
      latch is set (checked AFTER the loop, so it covers a latch set mid-sweep too); `runTick` maps
      it to `stuck: 'keychain-latched'` — not `reauth-needed`, not `ok`. Pinned by one paired test
      in `oauth-rotator-tick.test.ts` (same ghost slot as the `slot-unreadable` test, latch set,
      opposite verdict); neuter `keychainDeniedLatched() → false` reddens exactly it. The two
      neuters' red sets are disjoint. `JANITOR_GLOBAL_STATE_DIR` is now redirected in that test
      file — without it every tick test read the developer's REAL latch.
- [x] **A read that TIMED OUT is not reported as `unreadable`.** Added 2026-08-29T15:51 after the
      window's single false alarm (below) proved `bda75f7d` covers only the LATCHED path. A
      sub-threshold timeout (`TIMEOUT_LATCH_THRESHOLD = 3` consecutive, reset by any answered op)
      returns a failed read that `surveyAlternates` cannot distinguish from a slot that is genuinely
      gone — two-valued where three values are needed. The floor is `none` only while the fix stays
      inside this rotator; if it changes what a beat REPORTS to the supervisor, re-derive it.
      **Do NOT close the 24 h box before this one** — the window cannot come back clean while the
      path that dirtied it is open.
      **DONE 2026-08-29T15:57.** `safe-storage.ts` now keeps a MONOTONIC `securityFailureCount()`
      alongside `consecutiveTimeouts` — the latter cannot answer "did anything fail during THIS
      sweep?" because it resets on any answered op, including a fast one that is below the SLOW
      threshold and never even logged. `surveyAlternates` snapshots it before its loop and compares
      after; on a change it empties `unreadable` and sets a new `readFailed` flag, which is the
      SAME treatment the latch branch already gives (an empty array cannot be misread; a mixed one
      makes every consumer adjudicate). `refreshDead` is deliberately KEPT — it comes from blobs
      that actually came back — so a dead refresh stays actionable and still outranks the new
      `stuck: keychain-read-failed` verdict. That verdict is a NEW `StuckReason`, not a reuse of
      `keychain-latched`, because the two differ operationally: a latch is a deliberate circuit
      breaker that self-clears on its half-open probe; this beat was never latched and simply
      retries.

      **⚠ THE FIRST CUT OF THIS FIX RE-COMMITTED THE CARD'S OWN DEFECT, and an adversarial review
      caught it before it could ship a second false cause.** It shipped as `readTimedOut` /
      `keychain-timeout` / *"at least one keychain read TIMED OUT"* — while the branch feeding the
      counter fires on EVERY non-ENOENT spawn failure. **Settled by measurement, not argument:**
      `node -e "const {spawnSync}=require('child_process');const r=spawnSync('/etc/hosts',[]);
      console.log(r.error&&r.error.code)"` prints **`EACCES`**, which reaches that branch and would
      have been announced to the operator as a timeout that never happened. That is precisely what
      the code being replaced did — *"it set the latch on the FIRST timeout and printed '(a
      keychain unlock/ACL prompt)' — a cause it never observed"* — one layer along. Renamed
      throughout to `readFailed` / `keychain-read-failed` / *"did NOT COMPLETE"*, and the banner
      wording is now PINNED by an assertion (`toContain('did NOT COMPLETE')` +
      `not.toContain('TIMED OUT')`) with its own neuter, so the drift cannot recur silently.

      **THE TRADE, stated rather than left to be discovered.** On a box whose keychain is
      CHRONICALLY slow every sweep has ≥1 failure, so `unreadable` is emptied every beat and
      `reauth-needed: slot-unreadable` can never fire — with **no self-clearing bound**, unlike the
      latch erasure it mirrors (which half-opens in ≤ ~11 min). Accepted because two escape hatches
      are real: a genuine dead refresh still surfaces through the KEPT `refreshDead`, and the
      `rotator-stuck:` prefix escalates its backoff, so a permanently-degraded keychain gets louder
      rather than quieter. It is the weaker half of this fix and is written in the code beside the
      branch.

      **NOT A RACE, though it reads like one:** the counter is process-global and the keepalive and
      live-blob reads bump it too, but `runSecurity` uses `spawnSync` and the survey is synchronous,
      so the two readings bracket a single-threaded span. `surveyAlternates` has exactly **ONE**
      call site (`runTick`, once per beat) — `grep -rn "surveyAlternates(" lib/ app/ services/`.
      **4 tests** in `tests/unit/oauth-rotator-survey-read-timeout.test.ts`, the third member of a
      triplet whose siblings live in `oauth-rotator-tick.test.ts` — all three seed the same
      registered-but-unreadable slot and differ in exactly one precondition.
      **COMPLEMENTARY NEUTER PAIR, both observed and restored:**
      `if (false && securityFailureCount() !== failuresBefore)` ⇒ **3 red / 55 green** (tests 1, 3,
      4; the positive control — counter non-zero but UNCHANGED — stayed green, and neither sibling
      file moved). `else if (false && survey.readTimedOut)` ⇒ **1 red / 57 green**, the verdict test
      alone. So each stage is pinned by its own mutation and none of the four is vacuous.
      Only `securityFailureCount` is mocked, and that is forced rather than chosen: these tests run
      with `CLAUDE_SAFE_STORAGE_BACKEND=none`, so `security` is never spawned and a real timeout
      cannot be provoked. The guard itself — the comparison and the verdict branch — is real code.
      After restore: `tsc` 0, 84/84 across the four rotator test files.
- [ ] ≥24 h with zero false `reauth-needed` beats attributable to a latch, measured from the logs
      **AND a coverage floor: ≥95 % of that window's beats non-`slot-unreadable`.** The floor is
      not decoration — WITHOUT it this box has the same proxy defect the window criterion had:
      **zero false beats is also what a fully-latched, fully-silent rotator produces**, so the box
      would be satisfiable by the failure it exists to detect. Measured blindness fraction per day
      (`UNREADABLE` beats ÷ `auto:` beats) over the last 12 days: **0.0 / 0.0 / 0.0 / 1.2 / 2.3 /
      5.1 / 12.2 / 12.5 / 12.8 / 13.5 / 16.8 / 42.1 %** — so a blind-but-clean window is not
      hypothetical here, it is what 2026-08-20 was.
      **INTERIM 2026-08-29T12:37:51+0200 — 15.0 h of the 24 h elapsed, both criteria still met.**
      Re-measured window-scoped (the earlier ad-hoc attempt counted the WHOLE cumulative log and
      reported 40903 beats / 25309 `reauth-needed`, which is a count over the wrong population —
      the file starts 2026-07-29, a month before the fix). Filtering lexically from the window
      start, `awk '$0 >= "2026-08-28 21:36:00"'`: **881 `auto:` beats · 0 `reauth-needed` of any
      kind · 11 latch-suppressed** ⇒ blindness **1.25 %**, coverage **98.75 %** (floor 95 %).
      The 11 are unchanged from the 9.7 h reading, so every beat since has been a clean read —
      blindness FALLS as the window lengthens because the numerator is fixed.
      **The rotator is confirmed ALIVE, not silent** — the distinction this box exists to make,
      since a fully-latched silent rotator also reports zero false beats: last beat 12:37:13, i.e.
      24 s before the measurement, with 95 beats in the preceding 1.6 h.
      ~~**Window closes 2026-08-29T21:36.**~~ **IT DID NOT — THE WINDOW ABORTED AT 17.6 h, AND
      IT FAILED. Measured 2026-08-29T15:49+0200 over BOTH logs (the prior readings counted
      `pm2-out.log` only).**

      | | |
      |---|---|
      | window | 21:36:09 → **15:10:23**, when the server was STOPPED by owner directive ⇒ **17.57 h**, not 24 h |
      | `auto:` beats | **1024** (out) |
      | latch-suppressed | **11**, all 2026-08-28 21:51–22:01 — unchanged since the 9.7 h reading |
      | coverage | 98.93 % — the floor is **met** |
      | `reauth-needed` | **1**, not 0 — the criterion **FAILS** |

      **The one event is a FALSE alarm of exactly the class this card exists to kill, and it is
      NOT the latched path the fix covers.** `15:10:12 [oauth-rotator] reauth-needed: 1 alternate
      slot(s) UNREADABLE`, delivered at `15:10:22` by the supervisor — ONE event appearing in both
      logs, not two. In the SAME second, `15:10:12 [safe-storage] SLOW security op: 13916ms
      (timeout 5000ms, TIMED OUT) verb=find-generic-password service=Claude Code-rotator-slot-backup`.
      The latch was NOT set, so `probeSuppressed` was false and `tick.ts` fell through to the
      `unreadable > 0` arm.

      **How "not set" is established — by PRESENCE, not by absence.** I first justified it with
      *"no `keychain denied-latch is set` beat appears after 22:01 the previous night"*, which is
      the very proxy shape this session keeps failing on: an absence of log lines argued as an
      absence of state, and unfalsifiable. The conclusion is true, but the sound argument runs the
      other way — `reauth-needed: slot-unreadable` is reachable ONLY through the
      `else if (unreadable > 0)` arm, which is reachable ONLY when `probeSuppressed` is false. **The
      existence of that log line IS the proof the latch was unset at the check.** (Both readings
      agree here; recorded because the next auditor would otherwise inherit the weak one.)

      **And the fix was verifiably DEPLOYED for the window, not merely committed at its start** —
      the deploy-vs-commit proxy that has bitten this repo before. The 11 latch-suppressed beats
      carry the post-fix `stuck: keychain-latched` wording, which does not exist in the pre-fix
      code, so the log self-evidences that `bda75f7d` was the running build.

      **The gap, read from the code, not inferred:** `safe-storage.ts:342` latches only at
      `TIMEOUT_LATCH_THRESHOLD = 3` **consecutive** timeouts, and `:369` resets that counter on
      **any** answered op — including a fast one, which is below `SLOW_SECURITY_LOG_MS` and
      therefore never logged. So an interleaved timeout/success run keeps the counter under 3
      indefinitely while each individual timeout still returns a failed read, which
      `surveyAlternates` classifies as `unreadable`. `bda75f7d` made the LATCHED path honest; it
      left the SUB-THRESHOLD path emitting the same false `reauth-needed` it always did. The
      threshold change traded a latched blackout for an un-latched false alarm.

      **What that costs this box:** its "zero false `reauth-needed`" half is no longer purely
      structural (the note below says it is — that note is now WRONG for the un-latched path).
      A re-run of the window cannot pass until a timeout-caused read failure stops being reported
      as `unreadable`. That is the SAME three-valued problem TRDD-DQ6XN2VP is blocked on
      (`could-not-read` ≠ `read-and-absent`), and CPV's exit-2 is the pattern both want.

      **CORRECTION to my own earlier framing, stated precisely.** The 12:37 reading of "0
      `reauth-needed`" was CORRECT for the window it covered (21:36 → 12:37); the event happened
      at 15:10, after it. The handoff's claim that the miss was caused by reading `pm2-out.log`
      only is ALSO wrong: `pm2-out.log` carries the event too. The real defect was extrapolating a
      partial window to the whole one — the same population error, one layer along.
      **PRIOR INTERIM 2026-08-29T07:20+0200 — 9.7 h elapsed, both criteria met.**
      Window starts at the fix, `bda75f7d` (2026-08-28T21:36); first post-fix beat 21:37:05, last
      read 07:20:38 ⇒ **9.73 h**. Measured over **571 `auto:` beats**: **0** `reauth-needed` of any
      kind, and **11** latch-suppressed beats ⇒ blindness **1.93 %**, coverage **98.07 %** (floor
      95 %). Those 11 are the fix working, not the bug: each reads *"the keychain denied-latch is
      set, so this beat did not read any slot"* and carries `stuck: keychain-latched` — the
      verdict `bda75f7d` introduced — where the old code would have emitted a false
      `reauth-needed`. Re-derive with:
      `awk '$0 >= "<fix ts>"' logs/pm2-out.log | grep '\[oauth-rotator\]'` then count `auto:`,
      `reauth-needed`, and `keychain denied-latch`.
      ⚠ **Do NOT reuse this box's original numerator needle.** The 12-day series above counted
      `UNREADABLE` beats; the fix RENAMED that wording, so `grep -ci unreadable` over the post-fix
      window returns **0** and reports a flawless **100 %** coverage — a needle keyed to the
      pre-fix spelling, blind to the population it is supposed to count, failing in the reassuring
      direction. The post-fix numerator is the `keychain denied-latch is set` beats.
      ⚠ **The "zero false `reauth-needed`" half of this box is now STRUCTURAL, so the coverage
      floor carries all of its discriminating power.** `lib/oauth-rotator/tick.ts:1462` places
      `if (survey.probeSuppressed) { nextAction='stuck'; stuck='keychain-latched' }` **before**
      `else if (unreadable > 0) { nextAction='reauth-needed' }` — so while the fix is present, a
      latch-attributable `reauth-needed` cannot be emitted at all. Measuring zero of them is
      therefore guaranteed by branch order, not observed; it confirms the fix is INSTALLED, not
      that the window was healthy. The ≥95 % floor (11/571 = 1.93 % blind) is the half that can
      still fail, which is why its author added it.
      **NARROWED the same hour — the paragraph above over-corrected and threw away real evidence.**
      `probeSuppressed` short-circuits only the **11 latched beats**; on the other **560** the
      `else if (deadRefresh > 0) { reason = 'refresh-dead' }` branch at `tick.ts:1464` was fully
      live and fired **zero** times. So the structural claim holds for **`slot-unreadable` only**,
      and the `refresh-dead` class is 560 beats of genuine observation. Correcting *past* the truth
      in the humble direction is its own way of misstating a measurement — the same defect as
      overclaiming, just harder to notice because it sounds careful.
      ⚠ **`rotator.log` is the WRONG source for this box** and reads as clean for the same
      spurious reason: post-fix it holds **7 lines, 0 `auto:` beats** — the server logs state
      TRANSITIONS there (`aim-server/` kinds), not beats, so the denominator is zero and the
      coverage floor is unmeasurable from it in either direction. Per-beat truth is
      `logs/pm2-out.log` (571 beats over the same span) and `~/.aimaestro/oauth-rotator-tick-status.json`.
- [x] X4RK1NUW's 48 h window criterion re-checked against the fix (it is amended in the meantime)
      — **DONE 2026-08-29T07:20+0200.** X4RK1NUW's window closed PASS at 54 h and that card is now
      `complete`/archived. Its criterion (cookie days > 7 AND the three `expires_at`
      staggered-and-recent) is **unaffected by this fix and was not weakened by it**: cookies read
      25.1 d on all three, and the access tokens were minted hours before the reading, so the
      refresh path ran through the window. The fix is visible INSIDE that window doing the right
      thing rather than merely not interfering — the two latch events of 2026-08-28T21:52:50/:52
      appear as `ONSET rotator-stuck:keychain-latched` **with `CLEARED reauth-needed:slot-unreadable`
      on the same beat**, which is precisely the distinction `bda75f7d` introduced. Recorded in
      X4RK1NUW's "Observation window — CLOSE" section, which attributes those two alerts to THIS
      card rather than calling its own window spotless.
- [x] Correction posted on ai-maestro#95 (the capture-caused cause clause + the "no card needed"
      line) — **VERIFIED 2026-08-30, and it had been done since 2026-08-26.** Comment
      `2026-08-26T09:14:45Z` carries both halves: **(a)** *"The latch was NOT caused by the
      browser capture… the capture ran 09:40-10:05; the latch fired at 10:33:21, 28 minutes
      after it ended"*, and **(b)** *"'No card needed' was wrong, and it is the load-bearing
      error"* — with the 350/350-are-timeouts classification and this card named as the one
      X4RK1NUW asked for. Read from the comment bodies via `gh`, not from the box.

## Approval log

- 2026-08-26T11:12:21+0200 — MANDATE (self, min-approval-requirement: none). Carded from an
  adversarial review of `2b7dc8e7`; every number above re-measured first-hand before filing.
- 2026-08-28T21:05:00+0200 — characterisation box TICKED by ai-maestro-hub-session from 29 slow-op
  samples the already-deployed instrumentation had collected over 12.5 h. No code changed; this is
  a measurement, not a fix. The ACL-prompt hypothesis this card had promoted to "leading" is
  REFUTED (spread across 4 accounts / 2 services, and 26 of 29 recovered unaided — a prompt does
  not clear itself). Card stays `todo`: three acceptance boxes remain and the next one needs a
  code change to the latch. Also note the deploy was NOT mine to claim — a prior session had
  already built and restarted; I nearly recorded "instrumentation is undeployed" from a grep whose
  needle mis-escaped the backticks in `SLOW \`security\` op`, and only a positive control on the
  real literal (`safe-storage] SLOW`) showed 1 hit in `.next` and corrected it.
- 2026-08-28T21:12:00+0200 — characterisation CORRECTED by ai-maestro-hub-session after a
  ninth adversarial fork. The conclusion is unchanged and now rests on measurement rather than
  assumption: leg (b) of the ACL refutation was an unverified claim about macOS prompt semantics
  that I had explicitly ranked "Stronger" than the measured spread. Replaced with a real
  measurement (zero SecurityAgent rows in a demonstrably-covered 24 h window) and the assumption
  struck through. The elapsed statistics are now qualified as tail-truncated, and the "50-190x vs
  p95" comparison is withdrawn — it compared a server-context tail against an interactive-shell
  proxy the card had already declared insufficient for exactly this purpose.
- 2026-08-28T21:22:00+0200 — evidence RE-RANKED by ai-maestro-hub-session after a tenth fork.
  The SecurityAgent leg is withdrawn as stated: it queried one process at default level and I
  read its emptiness as a fact about the platform. The wider query returns 1.5 M rows including
  authd and securityd, so the original zero was a property of my predicate. The measured spread
  (4 accounts / 2 services) now carries the refutation alone, which is where it should have been
  ranked from the start. One genuine new lead recorded (securityd suppressing a keychain prompt
  for /usr/bin/security, code-signing rc=-67065), explicitly n=1 and not promoted.
