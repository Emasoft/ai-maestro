---
trdd-id: 601KG45D
title: The sudo-gate pty tests fail intermittently and one failure showed a truncated password
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-04T20:59:33+0200
updated: 2026-09-04T21:22:30+0200
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
labels: [flaky-test, pty, sudo-gate]
---

# The sudo-gate pty tests are intermittent, and these are the tests that pin a security fix

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
> separate them. Pooled rate 11.4%, Wilson 95% CI **4.5%-26%** — the rate itself is unknown
> to within a factor of six.

No p-value is quotable *from this design* (that is narrower than "no quantification": the CI
above is descriptive and assumes no randomisation). A permutation test inverts a
randomisation null, and these batches ran in time order against four different versions of
the file. Two earlier versions of this card quoted p anyway — 0.052, then 0.114, then 0.36
for an A-excluded split that was itself unfair, since dropping the batch holding 3 of 4
events *because* it is confounded biases hard toward the null.

**Two confounders that survive.** Batch A ran under background-agent load, and C's P0 still
ran `beforeEach` (an HTTP `listen(0)` plus a `mkdtemp`), so "no extra pty" was never "no P0".

**A limit on the skip finding**, since the split rests on it: measured for a *static*
`it.skip`, which is what B used. A runtime `ctx.skip()` runs `beforeEach` first;
`describe.skip` and `-t` filtering are untested. Do not generalise past B's form.

**Step 0 must fix the DESIGN, not raise `n`:** interleave the arms within one session on a
quiet machine. More runs of the same shape buy precision about nothing.

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
- [ ] Green across an INTERLEAVED design, n >= 12 per arm. (Not '30 consecutive runs': that
      number was derived from a fixed-rate independence assumption this card disowns, so it
      would be a convention dressed as a derivation.)
- [ ] TRDD-WV8FDAH0's STATE block updated to drop its caveat about the pin being intermittent.

## Approval log

- 2026-09-04T20:59:33+0200 — MANDATE issued by claude-opus-session
  (min-approval-requirement: none). Tier 0: a test-reliability bugfix inside this repo,
  reversible, no governance or public surface. Derived from TRDD-WV8FDAH0.
