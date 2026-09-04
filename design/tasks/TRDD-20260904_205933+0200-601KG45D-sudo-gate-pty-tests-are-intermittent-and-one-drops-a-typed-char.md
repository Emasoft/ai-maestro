---
trdd-id: 601KG45D
title: The sudo-gate pty tests fail intermittently and one failure showed a truncated password
scope: project
project-id: ai-maestro
column: dev
created: 2026-09-04T20:59:33+0200
updated: 2026-09-04T22:07:15+0200
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
implementation-commits: [fc3b6f76]
labels: [flaky-test, pty, sudo-gate]
---

# The sudo-gate pty tests are intermittent, and these are the tests that pin a security fix

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-04

**The instrument exists and is validated. The measurement it was built for has not been taken.**

- **DONE — step (a), by a different route than the body prescribes.** `diagnoseTyped` +
  `pwOf` live in `tests/unit/maestro-sudo-gate-pty.test.ts` (`fc3b6f76`) and are the failure
  message on every assertion that pins the password reaching the server. Both neuters run
  SEPARATELY and each reddens its own assertion (swap prefix/suffix → the TAIL line; freeze
  the divergence index → the `index 2` line). 15 passed, tsc 0 lines.
- **The route change, stated because the body still reads the old way.** The body ordered
  (a) rebuild a throwaway probe under `scripts_dev/`, then (c) port it to the shipped gate.
  The probe was SKIPPED: the shipped harness already has a real pty, a real server and the
  real pipeline, so building an instrument there means never validating one that was going
  to be thrown away. **(a) and (c) are therefore both discharged, and (b) and (d) now read
  off the shipped file directly.** If a future reader wants the standalone probe back, the
  reason it was skipped is this — not that it failed.
- **What that buys the remaining steps.** A P-failure now self-reports WHERE the byte went,
  so one run series answers step 0 (rate), (b) (rate + position) and feeds (d)
  (hypothesis discrimination). They stopped being separate exercises.

**NEXT ACTION.** 24 consecutive runs of the pty file are in flight (`/tmp/flake601/`),
single-arm because P0 is deleted and there is no second arm left to interleave against.
Score failures/24 and, on any failure, read the diagnosis line — that is the position three
revisions of this card turned on. **A clean 24 does not close box 1's question**: §Verification's
table shows a 4.5% true rate comes up clean about a quarter of the time at n=30, so report
the count, not a verdict.

**Do not re-derive the interleaving requirement for this run.** Box 4's randomisation clause
is about comparing two ARMS. P0 is gone, so there is one arm; a single-arm rate needs no
assignment mechanism, and none is claimed here.

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
- [ ] Established whether the truncated password was tty input loss or a harness artifact,
      with the measurement recorded here, testing BOTH hypotheses in the clue section.
- [ ] The timing dependence removed wherever an observable marker exists.
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
