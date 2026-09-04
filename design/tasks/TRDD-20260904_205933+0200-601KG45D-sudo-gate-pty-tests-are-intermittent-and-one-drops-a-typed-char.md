---
trdd-id: 601KG45D
title: The sudo-gate pty tests fail intermittently and one failure showed a truncated password
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-04T20:59:33+0200
updated: 2026-09-04T23:37:13+0200
current-owner: claude-opus-session
created-by: claude-opus-session
assignee: claude-opus-session
task-type: bugfix
priority: 2
severity: medium
effort: small
release-via: none
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: claude-opus-session
approval-datetime: 2026-09-04T20:59:33+0200
parent-trdd: WV8FDAH0
blocked-by: []
npt: []
eht: []
implementation-commits: [fc3b6f76, 1a2a1b2c, b0ec7002, 5aab3a19, 65a56eeb, bb0e23c2, e3787efb, c74d8798]
labels: [flaky-test, pty, sudo-gate]
---

# The sudo-gate pty tests are intermittent, and these are the tests that pin a security fix

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-04

## ⏵ THE EXPERIMENT FIRED — 2026-09-04T23:37, N = 21, TWICE

**`jq -Rnc stdin: 21 byte(s) for 22 expected`**, on two independent runs of the same batch:

```
run-008  P9 [agent-helper.sh]  TAIL loss: 1 char · jq -Rnc stdin: 21 byte(s) for 22 expected
run-012  P8 [agent-helper.sh]  TAIL loss: 1 char · jq -Rnc stdin: 21 byte(s) for 22 expected
```

**WHAT THIS ESTABLISHES.** The gate handed `jq` a line that was ALREADY short. "The loss is
at or before `read`" stops being an argument from the pipeline's composition and becomes a
MEASUREMENT. **Hypothesis 3 (the shell→curl leg) is now excluded by measurement, not by
reasoning** — the same conclusion the composition argument reached, but this card has
retracted four mechanisms that were reasoned rather than measured, so the distinction is the
point. Two independent firings, both 21, both TAIL, so it is not a one-off reading.

**WHAT IT DOES NOT ESTABLISH.** Which of hypothesis 1 or 2 — both live at or before `read`.
The position is TAIL, which fits H2 (the line terminated one byte early) and does not fit H1
(a flush discards the whole queued line, giving a LEADING/total loss or a stranded `read`,
never a one-char tail). That is the same position argument the card already had; what is new
is only that the boundary is now pinned upstream of `jq`. **And per the review's FINDING N,
the position argument is circular against H1 under load** — see the load caveat below.

**HYPOTHESIS 2 IS THE ONLY SURVIVOR, and it is now the thing to instrument.** The next
question is why a canonical-mode line delivers its terminator one byte early.

**RATE IS STILL NOT CLAIMABLE:** 2 in 13 here vs 1 in 24 before is exactly the comparison
the missing control arm forbids (see the load caveat). Do not quote it as a rate change.

**Both firings were on `agent-helper.sh`.** Across the card's whole history both copies have
now shown it, so it remains copy-independent; the split within one batch is noise at n=2.

**WHAT IS MEASURED — this is the headline, and every mechanism story on this card has died.**

- **Two distinct failure modes.** Truncations: **3 observed** — the batch-A P9, `P8
  [common.sh]` in run 23, and `P8 [agent-helper.sh]` on an incidental run at 22:41. Timeouts:
  3 observed. Earlier revisions pooled the two modes.
- **The truncation position is TAIL, 1 char, three for three**, measured by a validated
  classifier on the last two. **Both COPIES exhibit it** (`common.sh` and `agent-helper.sh`),
  so it is not copy-specific — the two files are verified-identical, so this is a consistency
  check that passed rather than a surprise.
- **The CURRENT wiring is now validated end-to-end.** `diagnoseBody` (not just `fc3b6f76`'s
  `diagnoseTyped`+`pwOf`) produced the 22:41 diagnosis on a real loss, closing the gap this
  block flagged an hour ago.
- **Rate:** 1 truncation in 24 consecutive runs, single-arm, P0 absent, idle machine. Read
  §Step 2 before quoting it — it is per-RUN, the denominator moved this session, and box 1's
  tick was taken and withdrawn.
- **The loss is at or before `read`** — the gate builds its body with `jq -Rnc` from the
  variable, so a well-formed body with a short value cannot come from a downstream cut.

**HYPOTHESES AND THEIR STATUS.** None is tested. Four have been proposed this card; the full
account of each retraction is in the commit trail (`ab90429f`, `d67db73b`, `38f995c1`,
`ca1df277`) and is deliberately NOT re-narrated here — this block is the state, not the diary.

| # | claim | status |
|---|---|---|
| 1 | a `stty` TCSAFLUSH eats queued input | **CONTRADICTED by the code path as read** (idle-machine timing; UNMEASURED under load). The gate's only `stty` calls are at t≈0, at the ^C (t≈300 ms) and after `read` returns; the password is typed at t≈1200 ms, and at 300 ms the queue is empty (the ^C arrives as a SIGNAL under `ISIG`, not as data). A flush there flushes nothing. **Not "REFUTED"** — every step is a source READ, not an instrumented handler, and the one condition batch A ran under (load) is the one not checked. Using the strongest verb for the one refutation nobody instrumented is the wrong asymmetry on a card with four dead mechanisms |
| 2 | the line terminated one byte early | **OPEN and now the SOLE survivor** — and no longer merely by elimination: the boundary is measured upstream of `jq`, and TAIL-1 is what H2 predicts and H1 does not |
| 3 | the loss is in the shell→curl leg | **EXCLUDED BY MEASUREMENT 2026-09-04T23:37** (`jq -Rnc stdin: 21` on two runs), superseding the composition argument that had excluded it by reasoning. The argument was right; it is the class of thing this card has been wrong about four times, so the measurement is what the exclusion now rests on |
| 4 | a wall-clock timing slip (§Proposed fix step 2) | **OPEN for the TIMEOUTS, with two objections.** It came from the card rather than from me and that does NOT pre-validate it — §Proposed fix is a *proposal*, never a finding |

**The two objections to #4, because it is the one currently doing work.** (i) A canonical-mode
tty BUFFERS characters typed while nobody is reading and delivers them on resume, so a merely
late resume predicts a PASS — or an echo failure if the password lands while echo is back
ON — **not a timeout**. (ii) **P10 has never failed** in ~59 runs, and it shares P8's exact
offsets while doing MORE work in the resume window (`trap 'echo PRIOR-INT; return'`); if a
work-in-the-window slip were the mechanism, P10 should fail at least as often as P8.
**Weak evidence, and an earlier version of this line called it a CONTRADICTION, which
over-claims twice over:** 0 failures in ~59 runs is unremarkable at a ~4% rate (P(0) ≈ 9%),
and the argument PRESUPPOSES the per-test uniformity it purports to test — if the mechanism is
caller-shape-specific, per-test rates differ by construction, which is exactly what the P8
concentration claims. A circular control is not a control.

**A trap worth restoring from the compressed narrative, because a future session can
re-derive and re-believe it:** *"the harness writes the secret and its terminator in ONE
`p.write`, so the line discipline holds the line until the terminator"* is a NON-SEQUITUR. How
many `write(2)` calls the WRITER makes says nothing about the RECEIVER — the kernel feeds the
canonical buffer character by character, and a `tcsetattr` from another process can land
between any two. It was the first (wrong) argument used to refute hypothesis 1.

**A ONE-BIT DISCRIMINATOR NOW ESCAPES EVERY TIMEOUT — but read the label carefully, because
the first version of this paragraph had it BACKWARDS and promised a measurement that could
not fire.** Both halves were wrong:

- **Wrong direction.** I wrote that a timing slip predicts `seen[] === []`. It predicts the
  OPPOSITE: canonical mode BUFFERS input typed while nobody is reading and delivers it on
  resume, so a late resume yields a POPULATED `seen[]` and a late-but-completing run.
  **`requests=0` means the terminator never reached `read` at all** — the signature of input
  being DISCARDED, not of a slow resume. Same fact I had used one commit earlier to build the
  objection to hypothesis 4, applied backwards here.
- **Wrong about it being free.** `diagnoseBody`'s message rides the `seen[0]?.body` assertion,
  which in P8/P9/P10 comes AFTER `expect(out).toMatch(/RC=1/)` — and a 25 s SIGKILL means
  `echo RC=$?` never runs, so THAT assertion fails first and the diagnosis is never reached.
  **An assertion-masking error, made while reasoning about assertion masking**, in the same
  session that split P11 to fix exactly this and wrote the lesson into
  `lessons-verification.md`.

**Fixed in code, then fixed AGAIN when the first fix turned out to mask the same way.**
`timeoutContext(out, seen.length)` is the message on the `RC=1` assertion, and that assertion
is now **FIRST** in P8/P9/P10. Placing it third (its original position) left
`expect(out).toMatch(/PRIOR-INT/)` ahead of it in P8 and P10 — and if a timeout's cause is the
handler failing to complete, `PRIOR-INT` is absent, so that assertion fails first and the
context never prints. **The masking had moved one assertion earlier, not gone.** Asserting
"the run completed" before anything about what it contains is the general form of the fix.

A `secret echoed:` boolean was tried and REMOVED: `expect(out).not.toContain(SECRET)` ran
before it at every call site, so an echoed secret failed there and the boolean could only ever
print `false` — a field with one reachable value, sold in a commit message as a deliberate
security-conscious design. The tail is still deliberately omitted (a real gate's failure would
put a live password in a log).

**`requests=0` spans TWO causes, and the message alone cannot separate them:** `read` never
returned (the timeout case), or `read` returned EMPTY — the gate's `[ -z "$_pw" ]` fail-closed
branch returns before `jq`/`curl`, printing `Error: empty password` and `RC=1`, which is not a
timeout at all. A flush that discarded the queued characters and then let the `\r` through
produces exactly the second. Check `out` for the fail-closed error before reading `requests=0`
as a stranded read.

**`timeoutContext` is pinned by P11h/i/j, split per branch and each NEUTERED.** Three run:
freeze `requests=${seenCount}` → P11h; re-add the raw `out` tail → **P11j**, the secret-leak
regression; drop the size clause → P11h+P11i. Restores verified byte-identical.

**THE ASSERTION-PLACEMENT QUESTION TOOK THREE ATTEMPTS, and the first two were each half
right.** Recorded in full because both wrong versions were shipped and described as the fix:

1. **`RC=1` moved to the front** — the context printed, and it DEMOTED
   `expect(out).not.toContain(SECRET)` behind a liveness check in P8/P10. Wrong trade: the
   echo guarantee is what P6/P8/P9/P10 exist for.
2. **Order reverted, message on whichever assertion is already first** — priority protected,
   **and the diagnosis lost again**, which the card wrongly called "same diagnosis, no cost".
   A message surfaces only when ITS OWN assertion fails, and on a timeout whose handler
   COMPLETED, `PRIOR-INT` is present, so P8/P10's first assertion PASSES and the failure lands
   bare on `RC=1`. In P9 the message rode `not.toContain(SECRET)`, which passes on every
   timeout — so the context printed in **zero** P9 cases. Worse than attempt 1, which at least
   covered the larger subset.
3. **Attached to BOTH landing spots, order untouched** — current. Handler-failed timeouts fail
   on the first assertion, handler-completed ones on `RC=1`, and neither costs a demotion.

**OPEN INSTRUMENT DEFECTS — recorded, NOT fixed, per the stop note below. Do not "just fix"
these; they are the loop's output, and fixing them is what the note forbids.**

1. **An `afterEach` is the right design and is not what is shipped.** Reading the failed task's
   state would carry the context out of *whichever* assertion failed — one hook instead of six
   attachments, strictly smaller than the current code.
2. **The context now prints on NON-timeout failures too.** `timeoutContext` rides
   `toMatch(/PRIOR-INT/)`, so a genuine handoff regression — the real bug P5/P8 pin — fails
   carrying `requests=1 · out 847b`, which is irrelevant to it and is the first thing the
   reader sees. The same trade as the reorder in a quieter form: instrument convenience paid
   for out of the assertion that carries the meaning.
3. **P11g BUNDLES dispatch and delegation, so the split is incomplete there.** It asserts the
   no-request/unparseable DISPATCH *and* `/^TAIL loss/` on a short-value body, which is why
   neuter A (a `diagnoseTyped` mutation) reaches it — a mutation reddening three tests means
   those three share a branch. Split the delegation assertion out, or accept that P11g is two
   tests. **An earlier version of this entry said P11g "is not testing what its name says",
   taken from a review rather than checked: the name ends "— the truncation case", which does
   cover the TAIL assertion.** The defect is bundling, not mislabelling. The three-test
   attribution was measured correctly and then read as reassurance rather than as this.

**"Both copies exhibit it" is nearly a tautology and is recorded as weak.** The two files are
verified-identical, so the only thing the copy split can rule out is per-copy state — load
order, path, mtime. Worth one clause, not a finding.

**One firing validates ONE branch.** The 22:41 failure exercised `diagnoseBody`'s TAIL path
end-to-end. Its "unparseable body" and "no request" branches remain validated by P11g alone,
i.e. by construction, not on real data.

**WHAT MUST BE KEPT NEXT TIME A TIMEOUT FIRES: the full run log.** No log from batches A or C
survives, so nobody can now check what those three timeouts looked like — `out`, RC, or
whether the server saw a request. "It timed out" is a symptom, and the harness captures enough
to separate several causes behind it.

**On the P8 concentration** (all 3 presumed timeouts are P8): treat it as weak. It is 3 events,
2 of them in one batch, on one of ~7 tests that could time out; the work difference between
P8's `eval 'echo PRIOR-INT'` and P9's `eval ''` is MICROSECONDS inside a 900 ms budget, which
is not a mechanism; and P10 contradicts it (above). The partition itself rests on ONE inherited
sentence — §"The clue"'s *"One P9 failure was not a timeout"* — never verified against a log,
which is the same shape as two claims this card has already retracted. Say "the 3 PRESUMED
timeouts", not "the timeouts".

**Verified because it was queried:** the handler DOES run in P9. `maestro_sudo_ensure` installs
`trap '_maestro_sudo_on_int' INT` BEFORE the `read`, replacing the caller's disposition; the
caller's `''` is only saved in `_MAESTRO_PREV_INT` and restored inside the handler. So P8 and
P9 run the same handler, differing only in the body it `eval`s.

**THE INSTRUMENT.** `diagnoseTyped`, `pwOf`, `diagnoseBody` in the pty test (`fc3b6f76`,
`1a2a1b2c`), used as the failure message on every assertion pinning the password's arrival.
Pinned by **P11a-j, one `it()` per branch; 11 neuters, all 10 tests redden.** Provenance,
because "all 11 hold against the current file" was asserted once and is only two-thirds
measured: **A and B were RE-RUN** after the split (A reds P11b+P11c+P11g, B reds P11d) — their
earlier attributions had been carried across a refactor that moved the test boundaries they
depend on. **C-H were run against the P11a-g arrangement and are NOT re-run**; they hold because neither
the function each mutates nor the test each reddens has changed since. **That premise was labelled
"an argument, not a measurement", then CHECKED — twice, because the first check was the wrong
instrument.** `git log -S` was used first and is INSUFFICIENT here: it detects a change in the
COUNT of a string, so an edit that rewrites a line while preserving occurrences is invisible to
it — the same class of hole this card has been finding all session, in the very step claiming
to close one. What establishes the
claim is a **CONTENT diff of the P11 block between the two END TREES** — `1a2a1b2c` (the commit
that created P11a-g, and the tree these neuters ran against) and HEAD: **additions only**,
P11h/i/j inserted, with **no line of P11a-g removed or modified**. A diff of the actual blobs at
two commits cannot miss anything, whatever happened in between, which is why it is the check
cited. The classifier functions are likewise untouched. Premise holds.

A commit ENUMERATION (`git log -- <path>`) was also run and agrees, but it is CORROBORATING, not
decisive: an earlier version of this paragraph said it "cannot miss an edit, because it lists
every commit that touched the file at all", and that is too strong — `git log -- <path>` applies
history simplification by default and prunes merges, so an edit made INSIDE a conflict
resolution never appears — `--full-history -m` is what lists everything. Fine here
(`1a2a1b2c..HEAD` is a linear string of this session's own commits, no merges), wrong as a
general claim, and a future session would have copied it onto a repo that has them.

**Both corrections in this paragraph are the same shape: the right answer, credited to a method
that does not carry the guarantee claimed for it** — first `-S`, then the enumeration. Worth
noticing as a pattern rather than twice as an incident.

**Use `-G`, never `-S`, to ask "did anything touch these lines".** `-S` is a pickaxe on
occurrence COUNT; `-G` matches any hunk touching the pattern. Worth writing down because the
card briefly cited `-S` as proof of unchangedness, which it cannot give.

What they pin, in three categories — the two-way split published earlier over-claimed, then
the correction under-claimed:

- **branch EXISTENCE** (delete the branch): C, D, F, H
- **branch DISCRIMINATION** (both predicates compute and select distinctly): A
- **computation**: B (the index), I (request count), K (size) · **message text only**: E, G
- **security**: J — re-adding the raw `out` tail reddens P11j, the only assertion here whose
  failure has a consequence beyond a worse message

**THE `jq` SHIM IS BUILT (`e3787efb`), and the stop note is discharged for exactly that
item — nothing else.** A PATH shim over `jq`, installed only for these tests, records the
BYTE LENGTH (never the content) of what the gate hands `jq -Rnc` at `common.sh:761` /
`agent-helper.sh:279`. Argv-filtered on `-Rnc`; every other call `exec`s through BEFORE
stdin is touched (common.sh calls `jq` ~20 times, one on the RESPONSE at `:770`, several
with a filter and a file and no stdin at all). Zero shipped code changed.

**P12f WAS ADDED BY THE REVIEW, and it is the one that pins the number the experiment turns
on.** A shim that ignored stdin and appended a hard-coded `22` passes P12a (the secret is 22
bytes) AND P12e (which counts lines, not values) — so before P12f, *nothing* asserted the
recorded length was a function of the gate's stdin at all. MEASURED, not argued: that exact
mutation reddens P12f alone, 5 of 6 still green. Two different input lengths make a constant
impossible.

**P12e COVERED ONLY ONE OF THREE SPAWN SHAPES, and not the one that matters.** It drives
`runAtTerminal`; `runGate` and the P8/P9/P10 inline `ptySpawn`s are separate shapes, and
**all three observed truncations happened in P8/P9** — so "the shim is on that PATH too" was
asserted by nobody. P8 and P9 now carry the coverage assertion, deliberately LAST: on a
truncating run the body assertion fails first and `diagnose` already reports the number, so
the new line runs only on an otherwise-green run, which is exactly the uncovered case.
MEASURED — a single-but-WRONG recorded value (`sed 's/^/9/'`) reddens **7**: P12a, P12e,
P12f, and all four P8/P9 variants.

**That same neuter settles what the second review challenged about P12e's `toEqual` form.**
It produces `['922']`, an array of length ONE — so `toHaveLength(1)` would PASS and
`toEqual(['22'])` FAILS. The value form is therefore load-bearing on all three gate paths,
by arithmetic on the neuter's own output rather than by argument. **What it does NOT do is
isolate P12e from P12a** — both call the shim with identical argv and stdin, so no shim
mutation can redden one without the other. P12e's unique contribution is PATH coverage, not
value coverage, and saying otherwise would over-claim.

**Pinned by P12a-f, one `it()` per branch, five neuters run and ATTRIBUTED:** guard never
matches (`-RnZ`) → P12a+P12e · guard matches everything (`-n "$a"`) → P12d+P12e · `wc -c`
→ `wc -l` → P12a · forward replaced by `echo '{}'` → P12b. The last two ran TOGETHER; they
are independent by construction (one writes the record file, one writes stdout, and each
test reads only one of those) and the prediction was stated before the run. Restored,
verified by diff. 29 pass, tsc 0 lines.

**P12e is the only one of the five that is not vacuous alone, and that is why it exists.**
P12a-d drive the shim DIRECTLY, so all four pass with the shim absent from the child's
PATH entirely — in which case `jqStdinNote` prints "NOT RECORDED" forever, which reads
exactly like a run that lost nothing. P12e drives the REAL gate at a real pty and asserts
the shim was in that path. Measured: it is.

**WHAT THE SHIM BUYS, stated narrowly.** "The loss is at or before `read`" was an ARGUMENT
from the pipeline's composition, and it is now MEASURABLE: a short length at `jq -Rnc`
confirms it, a full length REFUTES it. The measurement has NOT been taken — no truncation
has fired since the shim landed.

**THE TIMING CAVEAT, CORRECTED — the first version named the wrong mechanism and was
wrong in the direction that would have discarded a real finding.** It said the shim
"perturbs the timing of the very window the surviving hypotheses live in", so a post-shim
rate was not comparable in either direction. **The shim runs at `common.sh:761`, which is
AFTER `read` returns at `:753`.** Both surviving hypotheses (1, a flush at the prompt; 2,
the line terminating a byte early) resolve at or before `read`, i.e. strictly UPSTREAM of
every line the shim adds. So the shim cannot perturb the truncation window at all, and the
rate SHOULD be unchanged.

**"Cannot perturb at all" was itself too strong, and the second review caught it one
revision later.** It is true WITHIN one gate invocation and false ACROSS runs, which is the
scale the batch actually operates at: one vitest process runs P1, P2, P3, P8×2, P9×2 and
P12a-f in sequence, so the shim's extra forks consume wall-clock and change machine state
BEFORE the next test's `ptySpawn` and its `stty`-vs-type race — and the batch is 40 such
processes back to back. Batch A's truncation is recorded as having happened UNDER LOAD,
which is the one condition this card has never checked.

**So a rate change is AMBIGUOUS, and cannot be read as either answer.** Two revisions of
this paragraph have now over-claimed in opposite directions — first "discount any rate
change", then "a rate change is a finding" — and both were reaching for a conclusion the
design cannot support, because **there is no control arm.** Installing the shim at all six
spawn sites DELETED the shim-off condition; comparing a shim-on batch against a remembered
"1 in 24" from another session, another machine state and a different test count (24 then,
30 now) is not a comparison.

**If the RATE is ever to be claimed, it needs an env-gated shim** (`AIM_JQ_SHIM=0` → plain
PATH) with the two arms INTERLEAVED — the same discipline this card already invokes for
two-arm comparisons. Nothing below depends on that: the POSITION reading (N=21 vs 22 when
a truncation fires) is unaffected by load, and position is what the shim was built for.

Found by the adversarial reviews of `e3787efb` and `8e169da2`. The original caveat was
written to be conservative and was conservative about the wrong axis; the correction then
over-corrected. What survives both is narrow and worth keeping: **the shim is downstream of
`read` within a gate call, so it cannot explain a truncation — and it is upstream of
nothing that would let a rate comparison stand without a control arm.**

**AND "POSITION IS UNAFFECTED BY LOAD" IS CIRCULAR — third review, FINDING N, the most
substantive of that round.** I wrote that rate needs a control arm but position does not.
That holds only under H2, where the tail is fixed by construction. Under **H1** the loss
position depends on how many characters sit in the canonical buffer when the flush lands,
which is a function of the writer's rate against the flush's timing — so a loaded machine
buffers fewer characters and the loss moves toward the START. **The claim therefore assumes
H2, which is exactly what the position reading is supposed to test** — the same circularity
this card already flags in the P10 objection, committed again one paragraph away from it.

Corrected: *position is load-independent under H2 and load-DEPENDENT under H1, so a position
reading taken under one load condition cannot by itself separate them.* Recorded with the
evidence that cuts the other way, because it should not be buried: batch A's truncation is
the one noted as having happened UNDER LOAD, and it was **TAIL** — n=1, and it points toward
H2.

**The `jqStdinNote` message rides `expect(actual, message)` and is TOTAL** — vitest
evaluates it EAGERLY on every run, so a missing record file returns a sentence, never a
throw. Same trap this card hit with `diagnoseBody`, now recorded in
`lessons-verification.md`. `diagnoseBody` itself is UNTOUCHED and keeps its ten pinning
tests; the three message call sites use `diagnose()`, which composes the two.

**STOP INSTRUMENTING THE DIAGNOSTIC. The three defects below stay unfixed.** Seven
revisions of the instrument against ONE 24-run experiment; the diagnostic ceiling is reached
(position is TAIL three-for-three, and no further message refinement separates hypothesis 2
from the shell-side remnant).

**`implementation-commits` IS COMPLETE — six entries, and code commits have stopped.** An
earlier note called the field "one behind by construction, a commit's SHA cannot be written
into itself"; the first half is true and the second made it sound permanent. The lag is one
commit *while code commits continue* and it CLOSES when they stop, which a following card-only
commit does — and has. **`431e13b6` also touched the test file and is deliberately excluded:**
the IND rule says the field accumulates the SHAs that landed this TRDD's **code**, and a
comment lands none. (A review reported six-for-six and missed `431e13b6` entirely; the
exclusion is a decision, not an oversight, which is why it is written down. And "a comment
cannot introduce a bug" would be too strong as a general reason — the comment `431e13b6` added
is the eager-evaluation warning that stops a future edit making `timeoutContext` throw, so
deleting it could contribute to one. The rule's own word "code" is the firmer ground, which is
why the justification now rests there rather than on purpose.)

**THE CLOSING CONDITION, on its second attempt, because the first was unfalsifiable.** From
here, **instrument findings are RECORDED on this card, not fixed**, until the shim exists.
A false claim on the card is corrected **by editing the card to say what is actually true —
including "this is broken and is not being fixed"** — never by changing code.

The first version carved out "a false claim of RECORD gets corrected", and the commit carrying
it then changed six call sites. That exception swallows the rule: **every instrument defect
this loop has surfaced was also, at the moment of discovery, a false claim somewhere** — the
card said the instrument worked, the neuters covered, the context printed. An exception for
false claims exempts the entire output of the review gate, which is what makes a stop note
aspirational. The honest move that pass was to write "the diagnosis is lost in most timeout
cases" and leave it lost.

"Stop" cannot mean "stop when the findings stop": the gate fires on every commit, findings are
always available, and each fix is itself reviewable. **The loop cannot self-terminate; the exit
is to stop committing code here.**

**THE STOPPING RULE, ADOPTED 2026-09-04 — per-FINDING, not per-round.** Three review rounds
each produced code commits while each round's findings were individually defensible as small,
which is what a self-sustaining loop looks like from the inside. The rule that ends it:

> **Fix a finding only if leaving it unfixed would change the NUMBER the experiment reports,
> or make a reader mis-read that number. Everything else is RECORDED and not fixed.**

It is falsifiable without waiting for findings to cease, because each finding is tested
against a fixed question instead of against judgement. Applied to round three: findings K
(marker unreachable for 90), M (a harness failure reads as a security failure), N (the
position/load circularity) and O (`['922']`'s length inferred, not read back) all change how
a reader INTERPRETS the number, never the number — so all four are recorded above and **zero
code changed**. That is the loop terminating under its own rule.

**BACKSTOP, in case a later round argues past it: the batch RUNS TO COMPLETION before any
further instrument edit.** Two batches were already killed mid-flight for instrument fixes; a
third would be evidence the instrument had become the subject. An instrument revised between
every run measures nothing.

21 pty tests pass, tsc 0 lines. **The DETECTOR half is validated for `fc3b6f76`'s wiring
only** — run 23 fired it on a real loss end-to-end, and `1a2a1b2c` then replaced that wiring
with `diagnoseBody`, which has never fired on real data.

**Step (a) is discharged, and so is (c), together.** The body orders a throwaway probe under
`scripts_dev/` then a port to the shipped gate; the probe was skipped because the shipped
harness already has a real pty, a real server and the real pipeline, so nothing had to be
validated and then thrown away.

**NEXT ACTION — in this order.**

1. **Wait for the next TIMEOUT and read its own message.** Free, already built: `seen[] === []`
   discriminates a timing slip, and `diagnoseBody` prints "no request reached the server at
   all" when it holds. **Keep the full run log** either way.
2. **~~Instrument the `jq` boundary from the test.~~ DONE — `e3787efb`.** The shim exists,
   is pinned, and is proven to sit in the gate's own path (P12e). Nothing to build.

3. **RUN THE BATCH AND WAIT FOR A TRUNCATION — this is the whole remaining experiment, and
   it is a MEASUREMENT, not a code change.** At the pre-shim rate (1 in 24 runs, and see the
   caveat above about why that number no longer predicts anything) a truncation needs tens of
   consecutive runs. When one fires, the failure message now carries `jq -Rnc stdin: N
   byte(s) for 22 expected`, and N is the answer:
   - **N = 21** → the loss is at or before `read`. Hypothesis 2 (the line terminated one byte
     early) is the only survivor and becomes the thing to instrument next.
   - **N = 22** → the loss is AFTER `jq`, which REFUTES the composition argument this card
     has been resting on since `38f995c1`, and re-opens hypothesis 3.
   - **N ≤ 20** → a MULTI-byte loss, which no observation on this card has ever shown (all
     three were exactly one char). A different finding, not a stronger version of N=21.
   - **N > 22** → something ENTERED the buffer that the gate did not type — a stray `\r`, an
     echo artefact, input from another test. Also a different finding, and the one that would
     most change what this card is about.
   - **NOT RECORDED** → the shim did not fire on that run. That is a finding about the
     HARNESS, not about the gate; do not read it as either answer.
   - **The baseline control is TAKEN AUTOMATICALLY, on every run — P12e asserts the VALUE.**
     An earlier version of this line said to "take one green reading before trusting a red
     one", which was not executable: `fakeHome` is torn down in `afterEach`, so no later step
     can read the number back, and a control that cannot be run is not a control. P12e now
     asserts `['22']` rather than a length of 1, so a green suite IS the control. It follows
     that P12e also fires on a real truncation — intended, and the note separates the two
     (`NOT RECORDED` = the shim never ran; `21 byte(s) for 22 expected` = the answer).
     **"Cannot be forgotten" was claimed for this control and is WITHDRAWN:** an edit
     reverting the assertion to `toHaveLength(1)` removes it and leaves all 30 tests green,
     and no neuter can catch that — a test cannot pin the FORM of its own assertion. The
     control is taken by every green run; it is not protected against being deleted.
   - **THREE tests now fire on ONE truncation** — the failing gate test via `diagnose`, plus
     P12e or the P8/P9 coverage line. Do not read a count of failed test names as a count of
     truncations: one event, several reporters.

   **`SHIM-ERROR-90/91/92` in the note means a HARNESS failure, never the bug — discard that
   run.** `mktemp` and `cat` both fail toward a SHORT length (a full disk mid-`cat` leaves a
   truncated file, so the shim would record a short length AND hand `jq` short input,
   manufacturing exactly the observation this card hunts).

   **Two defects in the first cut of those guards, both found by the second review:**
   `wc -c … | tr … || exit 92` tested **`tr`'s** status, not `wc`'s — the
   `$?`-after-a-pipeline trap, from this repo's own lessons file — so the guard was
   unreachable in the case it was added for; fixed with `set -o pipefail`. And an `exit` was
   INVISIBLE: the gate calls the shim inside `_body="$(… | jq …)"`, so command substitution
   swallows the code and the reader sees only a generic refusal. "Discard the run" was an
   instruction nobody could follow — the same un-executable-procedure defect as the baseline
   control, one commit later. The guards now WRITE the marker into the record file, so
   `jqStdinNote` prints it and the failure identifies itself.

   **The marker covers 91 and 92 ONLY — `fail 90` cannot write it** (third review, FINDING K).
   `mktemp` fails almost exclusively for reasons that ALSO break the append (`fakeHome` gone,
   unwritable, full), so a 90 degrades to `NOT RECORDED`. **Left unfixed deliberately** under
   the stopping rule below: `NOT RECORDED` is already classified as a harness finding, so
   nothing is misread as the bug — the guard is incomplete, not misleading.

   **A shim failure now turns FOUR SECURITY-NAMED TESTS RED** (P8×2, P9×2 — third review,
   FINDING M). Test names are what a reader scans, so "P8 and P9 failed" reads as an
   echo/secret regression when it may only mean the shim did not fire. The note disambiguates
   *if read*. The cost is accepted for green-run coverage; it is written here so the next
   reader is not sent hunting a security bug that is not there.

   **The runner prints EVERY note, never the first.** Passing tests emit none (measured: 0 in
   a green run, 1 in a neutered one), so every note in a log belongs to a failed test — but
   P3, P8×2 and P9×2 all carry a `diagnose()` message, so a two-failure run has two notes and
   `head -1` would attribute a length to the wrong test.

   **Keep the full run log either way** — no log survives from batches A or C, which is why
   nobody can now say what those three presumed timeouts looked like.

**NOT the way two earlier versions of this line said** — *"print `${#pw}` inside the gate"*
would have added a debug print to `scripts/shell-helpers/common.sh`, which is SHIPPED and runs
against the owner's REAL governance password; it would also not have worked (`_pw` is `local`
and `unset` one line later). Reasons in `ab90429f`/`38f995c1`.

**Waiting on nothing and nobody** — no `blocked-by:`, no owner decision. It sits in `todo`
because the turn ended, not because it is parked; the sibling `TRDD-BAXXIG0J` is the one
awaiting a USER call, and this card does not depend on it.

**Do not re-derive the interleaving requirement for the run that already happened.** Box 4's
randomisation clause governs comparing two ARMS. P0 is deleted, so there is one arm; a
single-arm rate needs no assignment mechanism, and none was claimed.

## Problem

`tests/unit/maestro-sudo-gate-pty.test.ts` has failed intermittently — 4 failures in 35 runs,
and not always the same test. **Read that rate as conditional, not as the file's baseline.**
Split by whether the since-deleted P0 was present, it is **4 / 21 with** and **0 / 14
without** — but **three of those four failures are in ONE batch that also ran under
background load, so the experiment cannot separate P0 from load** (see §Evidence; no
p-value is quotable here and earlier versions of this card wrongly quoted one). The
intermittency is real and was observed; what it depends on is open, and that is step 0.
This matters more than an ordinary flake because P6, P8,
P9 and P10 in that file are the *only* behavioural pin on TRDD-WV8FDAH0's fix — the one that
stops a ^C at the password prompt leaving the terminal echo-off or putting the typed password
on screen. **An unreliable pin on a security fix is close to no pin**: a real regression would
read as "the flaky one again".

## Evidence — measured 2026-09-04, four batches

| batch | P0? | condition | failures / runs | which |
|---|---|---|---|---|
| A | present | pty-based P0 | 3 / 13 | P8 ×2, P9 ×1 |
| B | **absent** | that P0 `it.skip`ped | 0 / 6 | — |
| C | present | the final, non-pty P0 | 1 / 8 | P8 ×1 |
| D | **absent** | P0 fully removed | 0 / 8 | — |

**with P0: 4 / 21 · without P0: 0 / 14.**

Batch B counts as P0-ABSENT, and an earlier version of this card had it the other way round.
`it.skip` does not merely stop the assertion — **a skipped test's `beforeEach` does not run
either**, so B's runs carried no extra HTTP `listen(0)`, no `mkdtemp`, and no pty. Measured
with a throwaway probe rather than assumed: a describe with one skipped and one real test
saw the hook fire **once**, not twice; a second probe with two real tests and one skipped saw
**two**, which removes the "counter read too early" reading of the first. Correcting it moved
6 clean runs across the split — it changed the numbers, and what those numbers support is
settled further down, not here.

**How this was read wrong, four times, compressed.** B looked like "the extra pty causes
it"; C looked like a refutation, so I called the flake pre-existing; D undercut that (C's P0
still ran `beforeEach`); and re-classifying B as P0-absent moved 6 runs across the split.
Then the p-values computed on that table were withdrawn outright. Every wrong reading shared
one mistake — treating a clean batch of 6-8 as evidence of absence — and it is recorded as a
general lesson in `.claude/rules/lessons-verification.md`, not re-argued here.

**What the data supports, and it is not much:**

> **4 failures in 35 runs. All 4 in P0-active batches; 3 of those in ONE batch that also ran
> under background load.** P0 and machine load varied together, so this design cannot
> separate them. The rate is **not** summarised here as an interval: a binomial CI needs
> independent draws from ONE population, and these are four file versions under varying
> load. A Wilson CI was briefly quoted and withdrawn — same borrowed authority as the
> p-values, in the more persuasive costume of caution.

No p-value is quotable *from this design*, and neither is a binomial interval. A permutation
test needs randomisation; a CI needs independence and homogeneity; this data supplies
neither. A permutation test inverts a
randomisation null, and these batches ran in time order against four different versions of
the file. Two earlier versions of this card quoted p anyway — 0.052, then 0.114, then 0.36
for an A-excluded split that was itself unfair, since dropping the batch holding 3 of 4
events *because* it is confounded biases hard toward the null.

**Two confounders that survive.** Batch A ran under background-agent load. And C was never a
clean control: its P0 still EXISTED and merely lacked a pty, so it still ran `beforeEach` —
an HTTP `listen(0)` plus a `mkdtemp` before the first pty test. "No extra pty" was therefore
never the same condition as "no P0".

**A limit on the skip finding**, since the split rests on it: measured for a *static*
`it.skip`, which is what B used. A runtime `ctx.skip()` runs `beforeEach` first;
`describe.skip` and `-t` filtering are untested. Do not generalise past B's form.

**Step 0 must fix the DESIGN, not raise `n`:** interleave the arms within one session on a
quiet machine. More runs of the same shape buy precision about nothing.

## Relationship to WV8FDAH0, and a correction its own commit cannot carry

WV8FDAH0 closed `complete` (`b47c423e`) while this card was open, and that was right: its
code is landed and verified, and what THIS card governs is confidence in the TEST, not
completion of the FIX. So this is not a `blocked-by:` of it.

**`b47c423e`'s commit message gives a different, wrong reason** — that a `blocked-by:` would
"make the board claim work is in flight". It would not; `blocked` is precisely the column for
a card sitting still with a named blocker. The card is frozen and the commit is immutable, so
the correction lives here, on the unfrozen card that owns the relationship and that a reader
asking the closure question will reach.

## A separate gap this turned up: nothing executes the shebang

The deleted P0 asked "does the harness's bash match the scripts' `#!/usr/bin/env bash`?"
That question was **confused from the start**, and noticing why is worth more than the test
was. The pty tests run `bash -c '… source <copy>; maestro_sudo_ensure …'` — they **source**
the scripts into an already-running bash (5 such sites) and **never execute the shebang at
all**. So no test in this file ever depended on the answer.

But production *does* invoke these scripts through that shebang, and **no test exercises
that path**. A review challenged this as fabricated, on the grounds that
`aimaestro-agent-ctrl-c.test.ts` runs the agent script — so it was measured, and the gap is
real. Every invocation in the suite passes the script as an ARGUMENT to bash:

- `ptySpawn('bash', [AGENT, 'probe', …])` — aimaestro-agent-ctrl-c.test.ts:42
- `execFileSync('bash', [join(SCRIPTS, 'aimaestro-agent.sh'), …])` — cli-help-exit-contract, capabilities
- `source ${copy}` — the five gate-pty sites

**`bash <script>` does not use the shebang line either** — that is the part the challenge
missed, and it is why "a test runs the script" is not the same as "a test exercises the
shebang". Searched for a `.sh` executed with no leading interpreter across `tests/`,
`package.json` and `.github/`, covering literal paths, template literals, `shell: true`, and
`./x.sh` / `sh -c` forms: no hits. **Bounded claim:** the search names a literal `.sh`, so a
PATH-resolved bare name or a path held in a variable would not be caught; nothing here puts
`scripts/` on PATH, but the negative is 'no direct-execution form naming a .sh literal',
not a proof. (An earlier grep matched only identifier-shaped arguments under `tests/unit`,
supporting far less than the sentence beside it claimed.)

It is NOT this card's job: it belongs in its own file, where an extra pty costs nothing, and
it must invoke the script as a program (`execFileSync(SCRIPT, …)`), not under `bash`.

## The clue worth chasing first

One P9 failure was **not** a timeout. The gate reached the server and POSTed a password that
was the real one **minus its final character**:

```
expected '{"password":"wrong-pw-9MZQ4T7E-x7q"}' to contain 'wrong-pw-9MZQ4T7E-x7q2'
```

The harness writes `SECRET + '\r'` in a single `p.write`, so nothing split the *write*. The
loss happened between that write and `read` consuming the line. Two hypotheses, both
UNVERIFIED — do not treat either as a finding, and do not test only the first:

1. **`stty` flushed queued input.** `stty` uses `TCSAFLUSH` on some paths, which discards
   pending input, and the gate manipulates the tty at exactly that moment (`stty -echo` on
   the handler's RETURN trap). **If this is it, it is a user-facing bug, not a test
   problem** — a human typing while the gate re-disables echo loses a character and gets an
   unexplained refusal. Against it: a flush would tend to drop a leading or middle run, not
   exactly the final byte.
2. **The line terminated one byte early.** The pty is in canonical mode, so the line
   discipline assembles the line; a `\r` arriving while `stty` is mid-transition can end it
   before the last byte lands. This fits "short by exactly the tail" better than (1) does.

Ruled out: a truncated HTTP body. The JSON parsed cleanly and only the *value* was short.
Also not `MAX_CANON` (1024 on Darwin) — the secret is 22 characters.

## Step 1, 2026-09-04: ONE loss seen in a probe (n=1), position unrecorded

**Two one-character shortfalls exist, with very different evidential strength. Both belong
here; an earlier draft deleted the stronger one while correcting an overstatement.**

| observation | where | position | strength |
|---|---|---|---|
| `…x7q` for `…x7q2` (the original P9 failure) | the **SHIPPED gate**, full pipeline + live HTTP | **MEASURED: a tail loss** | 1 event, but position established |
| `len=35/36` | `fix2.sh`, a **reimplementation**, no pipeline | **unrecorded** (lengths compared, not strings) | 1 event, position unknown |

**Whether they share a mechanism is open** — that is the question, not a settled link. What
the second adds is that a single-character shortfall is **reachable outside the full gate**,
across 1 loss in 12 runs spanning TWO probe variants (a 2-run pair with a `printf` in the
RETURN-trap window, and a 10-run batch without it). That is not one measured cell, and no
rate should be quoted from it.

**What this card said an hour ago, and why it was wrong — three times over.**

1. *"10/10 intact, evidence against hypothesis 1."* A delay sweep with no demonstrated power.
2. *"The instrument cannot detect input loss at all."* Retracted on an eat-control that
   consumed nothing (`ATE=[]`, measured). Either the outer `read` had already taken the line,
   or canonical mode had not yet released it — **both make the control void**, so it never
   showed the probe was blind. This was a stronger false claim than the one it replaced.
3. *"The P9 signature reproduced — short by exactly one, at the tail."* **The tail is
   unmeasured.** The probe compared LENGTHS only; `len=35` is equally consistent with a lost
   first, middle, or last character. "At the tail" was inherited from the original P9 failure
   (`…x7q` vs `…x7q2`, genuinely a tail loss) and silently transferred onto an observation
   that cannot support it. Commit `6c07f598`'s message carries that overstatement — a reader
   following `implementation-commits` back should not inherit it.

**One event is not a reproduction.** A single LOSS is exactly as weak as a single clean run,
which this card spent several revisions establishing about clean runs. It shows the outcome
is possible; it gives no rate and no mechanism.

**No mechanism is attributed.** An earlier draft blamed extra work (`printf`) inside the
RETURN-trap window. The data contradicts it: the variant with `sleep 0.4` + a `read` in that
same window lost nothing in 2 runs, and the losing run's own sibling at a different delay was
intact. The variable that differed was the delay, on n=1. Guess withdrawn.

**Next, in order:** (a) rebuild the probe under `scripts_dev/` and **validate its loss
branch**: the last version does contain diffing logic, but it has produced 10 INTACT and
**zero losses, so that branch has never executed** — an untested error path is not a working
instrument, which is this card's own recurring theme. Induce a loss deliberately and confirm
the diff output is right BEFORE trusting any position it reports. (b) Then run to a few
hundred iterations for a rate and a position. (c) Port to the SHIPPED gate — this probe is
not it. (d) Only then discriminate the hypotheses.

**SUPERSEDED 2026-09-04 by the STATE block — (a) and (c) are DONE, and (c) absorbed (a).**
The paragraph above is kept because its REASON still governs: an untested error path is not
an instrument. What changed is only where the instrument lives. Building it in the shipped
harness discharged (a) and (c) in one step and left no throwaway to port, so a reader
following this list must not go and rebuild the `scripts_dev/` probe it describes.

## Step 2, 2026-09-04: the flake REPRODUCED, and the position is TAIL

24 consecutive runs of the shipped pty file, single arm (P0 deleted), ~10 s each, idle
machine. Logs `/tmp/flake601/`.

| | |
|---|---|
| **rate** | **1 failure / 24 runs (4.2%)** |
| **which test** | `P8 [scripts/shell-helpers/common.sh]`, run 23 |
| **what the instrument said** | `TAIL loss: 1 char(s) dropped at the end (received is a prefix of expected): expected '{"password":"wrong-pw-9MZQ4T7E-x7q"}' to contain 'wrong-pw-9MZQ4T7E-x7q2'` |

**Three things this settles, and two it does not.**

SETTLED:
1. **The truncation OCCURS with P0 absent.** That is all one failure establishes, and it is
   worth having: a P0-caused defect cannot fire with P0 deleted. **It does NOT establish
   "the intermittency does not depend on P0", which is what an earlier version of this line
   claimed** — that is a comparative claim, and pooling §Evidence's batches B and D (0/14,
   P0-absent) with today's run gives **1/38 (2.6%) without P0 against 4/21 (19%) with it**.
   That gap is at least as consistent with P0 mattering, or with load mattering (batch A's
   confound), as with neither. I quoted the new number and left the 14 runs already sitting
   in the table I was editing out of the comparison — ticking on the favourable half of my
   own data, which is worse than ticking on n=1.
2. **The position of THIS loss is TAIL, and it is MEASURED rather than eyeballed.** Two
   single-character tail losses now exist — the original P9 and this P8 — but **do not read
   them as one phenomenon confirmed twice.** They are two CALLER SHAPES: P9 is `trap '' INT`
   (an empty handler body, no work in the tty-transition window) and P8 is a returning trap
   that prints. If hypothesis 2 is right that window is exactly where the risk lives, so the
   shape is a signal and should be tabulated across future failures, not averaged away.
   (Gate VERSION does not separate them: `git log -S "P9 ["` shows P9 was INTRODUCED by
   `e4393a49`, so it cannot predate that rewrite. A review claimed it did; measured, it
   does not.)
2b. **A correction that belongs to a commit message, which cannot be edited.** `1a2a1b2c`
   justifies the `diagnoseBody` split by calling the unparseable-body case "the instrument's
   own most likely real failure" — and §"The clue worth chasing first" **rules that out**:
   *"Ruled out: a truncated HTTP body. The JSON parsed cleanly and only the value was
   short."* The split is still worth having (it is honest, it is cheap, P11g pins it), but
   its justification is **"a case that would otherwise be described falsely,"** not "the most
   likely failure." Recorded here because a reader following `implementation-commits:` back
   would otherwise inherit a claim this card contradicts two sections earlier.
3. **The `fc3b6f76` wiring fired end-to-end.** Run 23 exercised `diagnoseTyped(SECRET,
   pwOf(...))` on a REAL loss through the real pipeline and printed the right answer — the
   one thing a synthetic mutation could not supply. **But that is not the code in the tree**:
   `1a2a1b2c` replaced that wiring with `diagnoseBody`, which has never fired on real data.
   The classifier is validated by P11a-g; the current capture path is validated only by
   construction.

NOT SETTLED:
4. **The rate is one event, and "4.2%" is not even a rate OF anything stable.** 1/24 is
   per-RUN, and a run contains ~6 password-typing opportunities on the ^C path (P8/P9/P10 ×
   2 copies) plus P1/P2/P3 — so per-opportunity it is nearer **1/144 ≈ 0.7%**. Worse, the
   per-run denominator is a function of how many tests the file has, **which I changed in
   this same session by splitting P11**. A number that moves when you refactor the test file
   is not a property of the bug. Quote the count and the denominator you mean.
5. **These 24 runs are LOW-LOAD only.** Batch A's confound was background load, and this
   machine was idle. A clean-ish result here says nothing about the loaded condition under
   which 3 of the original 4 failures occurred.

**The flake has (at least) TWO failure modes, and §Evidence pooled them.** Of the 4 historical
failures, exactly ONE was a truncation (the P9 in batch A — §"The clue" says it "was **not** a
timeout"); the other three were timeouts. So `4/35` is a rate for *"the file went red"*, not
for the truncation, and today's `1/24` is a rate for the **truncation alone**. Do not compare
them as if they measured the same event. Two consequences:

- **Box 1's tick is about P0-dependence and is still sound, but read it narrowly.** For the
  truncation specifically the evidence is 1 event with P0 present and 1 without — thin, and
  it is the direction that matters (a P0-caused defect cannot fire with P0 deleted), not the
  magnitude.
- **P8 is the usual failer, not P9.** P8 ×3 and P9 ×1 historically, P8 again today. Earlier
  prose on this card framed the phenomenon around "the P9 failure" because that was the one
  with the readable signature; the failing test is more often P8.

**P8, P9 and P10 type IDENTICALLY — verified in the source, not assumed.** All three send
`\x03` at 300 ms and `SECRET + '\r'` in ONE `p.write` at 1200 ms (`:346`, `:371`, `:390`);
only the prior-trap prelude differs. So which of them fails carries no information about the
input-delivery mechanism, and pooling the P9 and P8 truncations on THAT question is
legitimate. Both are also post-`e4393a49` — the §Evidence batches were all run on the fixed
file, since these tests exist to pin that fix — so no gate-version difference separates them.

**Where it leaves the hypotheses — and there are THREE, not two.**

**The biggest correction on this card so far: the hypothesis space has been two-valued since
it was written, and both entries are TTY-LAYER, while the observation is SERVER-SIDE.**
Between the tty and the body the instrument reads sit bash's `read`, a shell variable,
whatever composes the JSON, `curl -d @-`, and a pipe. §"The clue worth chasing first"
asserts *"the loss happened between that write and `read` consuming the line"* — **that was
never established.** It was assumed on the first occurrence and has been inherited unexamined
through every revision since, including the ones that were busy correcting other overreach.
So:

3. **The loss is in the shell→curl leg, after `read` already had the full line.** **CORRECTED
   the same session, and mostly CLOSED — I over-stated it, using the accusation that the card
   was sloppy to introduce a hypothesis the card had already narrowed.** The gate's actual
   chain is `IFS= read -rs _pw < /dev/tty` → `printf '%s' "$_pw" | jq -Rnc '{password:
   input}'` → `curl -d @-`. Two consequences I should have derived before writing the
   hypothesis:
   - **The JSON is CONSTRUCTED by `jq` from `$_pw`**, so a well-formed body carrying a short
     value means `jq` already received a short input. A loss anywhere AFTER `jq` would cut
     the JSON mid-string (`…x7q` with no closing quote or brace) — and the observed body was
     `{"password":"wrong-pw-9MZQ4T7E-x7q"}`, intact. §"The clue" said exactly this
     (*"Ruled out: a truncated HTTP body. The JSON parsed cleanly and only the value was
     short"*) and I quoted that very line in `11c90b6e` while leaving this hypothesis
     over-broad in `ab90429f`.
   - The only shell-side survivor is a short write on the `printf`→`jq` pipe, and that is not
     credible for 22 bytes: `printf` is a builtin issuing one write, far under `PIPE_BUF`,
     where writes are atomic.

   **So the loss is at or before `read`, and hypotheses 1 and 2 are the live space after
   all.** What hypothesis 3 leaves behind is not a candidate but a MEASUREMENT worth taking,
   because it is the only thing that separates "the line `read` returned was short" from
   every story about what happened later.

**And the tty reasoning I published an hour ago was broken in two places, though its
conclusion survives.** Recorded rather than quietly rewritten, because a reader who checks a
broken argument discards the conclusion with it:

- **The "one `p.write`" step was a non-sequitur.** How many `write(2)` calls the HARNESS made
  says nothing about the RECEIVER: the kernel feeds the canonical buffer character by
  character, and a `tcsetattr(TCSAFLUSH)` from the `stty` process can land between any two of
  them regardless. I used a fact about the writer as a fact about the line discipline.
- **The hedge was backwards, and it weakened my own claim.** I wrote *"a flush landing when
  only the last byte is still queued would also take the tail."* Under canonical mode it
  cannot: the earlier characters can only LEAVE the buffer when a terminator arrives, and the
  terminator comes after the last byte — so at the moment the final `2` is queued, all 22 are
  queued, and a flush there discards all 22 and produces **no request at all**, not a tail
  loss. Worked through properly, a flush predicts a **LEADING or total** loss at every point.

**HYPOTHESIS 1 IS REFUTED ON TIMING, and this replaced a "relocation" I published minutes
earlier — the second mechanism story this card produced and killed in one pass.**

Read the gate's actual `stty` calls. There are exactly three, all in
`maestro_sudo_ensure`/`_maestro_sudo_on_int`: `stty -echo` **before** the prompt (t≈0); the
INT handler's `stty echo` plus its RETURN trap's `stty -echo`, both at the **^C** (t≈300 ms);
and `stty echo` **after** `read` returns. The harness types the password at **t≈1200 ms**.

So no `stty` runs within ~900 ms of the password write. At t≈300 ms the input queue is
**empty** — nothing has been typed, and the `^C` arrives as a SIGNAL under `ISIG`, not as
queued data. **A flush there flushes nothing.** It cannot shorten the password (the original
hypothesis 1) and it cannot strand `read` either (the "relocation"), because by the time the
password is typed the handler has been finished for most of a second.

**What I had published between those two positions.** That a flush blocks `read` until the
25 s `SIGKILL`, hence explains the 3 timeouts. Each step of that is defensible in isolation;
the argument never checked whether a flush happens anywhere near the password, and it does
not. **It was the same failure as the statusline attribution earlier in the session** — a
chain of plausible steps published without measuring the one quantity that decides whether
any of it occurs. Recorded rather than deleted because the pattern is the finding: this card
has produced one confident mechanism per pass, and retracted every one.

**One survivor of the timing argument, and it is a hypothesis, not a rescue.** The 900 ms gap
is measured on an **idle** machine, where the handler is a few shell commands and one
subshell. Batch A — which holds 3 of the 4 historical failures — ran under **background
load**. Whether load can stretch that handler by ~900 ms is untested, and saying "it might"
is exactly the move this section exists to warn against. It is written down as a thing to
measure, not as a reason hypothesis 1 lives.

**So for the TRUNCATION nothing is left but hypothesis 2, unexamined — and for the TIMEOUTS,
nothing at all.** That is a worse position than the card claimed an hour ago and a more
honest one.

**If the loss is at the tty (hypothesis 2), this is a USER-FACING bug, not a test problem** —
a human typing while the gate re-disables echo loses their last character and gets an
unexplained refusal. §Proposed fix step 1 said so from the start. **If it is hypothesis 3 it
may well be harness-only**, since a human does not pipe through this harness's `curl` path.
That is exactly why the cheap length probe comes first: the two branches differ in severity,
not just in mechanism.

## Proposed fix

Investigate in this order, and do not skip to the third:

1. **Decide whether input is genuinely being lost**, by driving the gate at a pty and typing
   a known string across the stty transition, asserting on what the server received. If
   characters are lost, the defect is in the gate and this card changes shape entirely.
2. If the tty is innocent, remove the harness's dependence on wall-clock timing. The tests
   type at fixed offsets (^C at 300 ms, password at 1200 ms) after seeing the prompt, which
   assumes the caller's trap ran and the read resumed inside 900 ms. Drive on OBSERVED
   output where a marker exists (P8/P10 print `PRIOR-INT`).
3. Only P9 has no marker — `trap '' INT` prints nothing by construction — so it is the one
   case that may legitimately need a wider margin. Widen it last, and say in the test why
   that one is timing-bound when the others are not.

## Verification

> **STALE — this section predates the two-modes split (§Step 2) and is kept for its
> reasoning, not its numbers.** Every rate below is **per-run and ALL-MODES**: it pools the
> truncations and the timeouts, which §Step 2 shows are distinct events with different
> candidate causes. So the table answers "how often does the FILE go red", not "how often
> does the truncation happen", and the "30 consecutive runs" criterion inherits that. Do not
> read it as current guidance; recompute per mode when the modes have rates worth pooling.

- The file passes **30 consecutive runs** — but read what that does and does not buy, because
  it depends entirely on the true rate, which is the thing in dispute. The table below is
  **ILLUSTRATIVE ONLY**: each row assumes independent runs at a fixed rate, which is the same
  assumption the withdrawn p-values leaned on and which this data does not satisfy. It is
  here to show how strongly the answer depends on a rate nobody has measured cleanly — not
  to be quoted as a probability.

  | assumed rate | 30 clean runs by luck |
  |---|---|
  | 19.0% (P0-active, 4/21) | 0.2% |
  | 11.4% (pooled, 4/35) | 2.6% |
  | **4.5% (batch A excluded, 1/22)** | **24.8%** |

  So if the A-excluded picture is the true one — and §Evidence says it may well be — then
  **30 green runs prove almost nothing**, coming up clean a quarter of the time anyway. Do
  not read a 30-run sweep as closure until step 0 has fixed the rate; and do not trim the
  number without redoing this arithmetic against whatever step 0 measures.
- If step 1 finds real input loss, that becomes its own fix with its own pty test, and this
  card cites it.

## Estimated risk

LOW for the harness work. Step 1 could raise the severity sharply if input loss is real.

## Acceptance

- [ ] Step 0: re-measured the flake rate with P0 fully absent, n >= 24, settling whether the
      intermittency pre-dates P0 at all — every failure so far had some P0 present.
      **UNTICKED after being ticked prematurely (§Step 2 item 1).** The n>=24 half is done
      (24 runs, P0 absent, 1 truncation), and it establishes the phenomenon OCCURS without
      P0. The *settling* half is not: pooled with §Evidence's P0-absent batches it is 1/38
      vs 4/21 with P0, which does not settle the comparison in either direction. Note the
      box's own wording is unsatisfiable as written — no forward measurement can show what
      "pre-dates" P0 — so when this is next worked, restate the box as the answerable
      question (does P0 raise the rate?) rather than tick the unanswerable one.
- [ ] Established whether the truncated password was tty input loss or a harness artifact,
      with the measurement recorded here, testing BOTH hypotheses in the clue section.
- [ ] The timing dependence removed wherever an observable marker exists.
- [ ] **UNSATISFIABLE AS WRITTEN — restate before working it (2026-09-04).** Two reasons.
      (i) Its arms were P0-present vs P0-absent and **P0 is deleted**, so there are no arms to
      interleave; the STATE block's "do not re-derive the interleaving requirement" reads as
      *don't worry about it* when what it means is *this box needs restating*. (ii) Since the
      two failure MODES were split, "green" is ambiguous — a series that fixes the timing slip
      and leaves the truncation would show a long green streak and satisfy this box while the
      security-pin defect it exists for remains. Restate as a per-MODE criterion. Original
      text kept below.
- [ ] Green across an INTERLEAVED design. **The arm size is a CONVENTION, not a derivation** —
      nothing here derives one, and 12/arm would be WEAKER than the '30 consecutive' it
      replaced. Prefer a relative criterion: run until the arms' counts differ by more than
      chance, or report that they do not. Any fixed n quoted before the interleaved run has
      produced a rate estimate is decoration. NOTE: the interleaved design RESTORES
      randomisation ONLY IF the arm order is RANDOMISED per run (coin-flip per iteration,
      sequence recorded). Deterministic alternation is balancing against a time trend, not
      random assignment, and stays vulnerable to any period-2 effect — it would NOT earn a
      p-value. Randomise, or carry no test.
- [ ] TRDD-WV8FDAH0's STATE block updated to drop its caveat about the pin being intermittent.

## Approval log

- 2026-09-04T20:59:33+0200 — MANDATE issued by claude-opus-session
  (min-approval-requirement: none). Tier 0: a test-reliability bugfix inside this repo,
  reversible, no governance or public surface. Derived from TRDD-WV8FDAH0.
