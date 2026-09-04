---
trdd-id: 601KG45D
title: The sudo-gate pty tests fail intermittently and one failure showed a truncated password
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-04T20:59:33+0200
updated: 2026-09-04T21:10:30+0200
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
without**. The intermittency is real and was observed; what it depends on is open, and that
is step 0. This matters more than an ordinary flake because P6, P8,
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
saw the hook fire **once**, not twice. The wrong reading made the P0 hypothesis look weaker
than the data supports, by moving 6 clean runs onto the wrong side of the split.

The order matters, because three of the four batches overturned the reading of the one
before, and two of those readings were nearly committed as fact (A was the first data and
overturned nothing):

- After **B**, I believed the extra pty allocation caused it.
- **C** appeared to refute that — the flake survived with no extra pty — so I called B's
  clean sweep small-`n` luck and the flake "pre-existing".
- **D** undercuts that in turn: C's P0 still ran `beforeEach`, so C was never a clean
  P0-free condition, and with P0 fully gone the file is 0/8.

- Re-classifying **B** as P0-absent then moved 6 clean runs across the split, which is what
  produced the numbers in the table above.

What every one of those readings shared was treating a clean batch of 6-8 as evidence of
absence. It is not: even at the corrected 19%, six clean runs happen 28% of the time.

**Two confounders that survive all of this.** Batch A ran while a background agent was live,
so machine load is confounded with the P0 variable in exactly the batch that carries most of
the failures. And C's P0, though it allocated no pty, still ran `beforeEach` — an HTTP
`listen(0)` plus a `mkdtemp` — so "no extra pty" was never the same condition as "no P0".
**Step 0 therefore re-measures with P0 absent, on a quiet machine, at n >= 24.**

**Where that leaves it: leaning toward P0-active mattering, at about p = 0.05, not settled.**
With P0 active the rate is 4/21 ≈ **19%**, and at that rate a clean 14-run P0-free stretch
comes up by luck only **5.2%** of the time. An earlier version of this card said "neither
hypothesis is established", which was the right instinct applied to the wrong denominator —
once B moves to the correct side of the split, the data leans one way and saying otherwise
is over-caution, which is its own kind of wrong. Step 0's n >= 24 stands regardless.

Note what it would mean if it holds: the flake is not pre-existing, and *adding almost
anything* to this file destabilises it — a statement about the harness's margins rather
than about P0.

## A separate gap this turned up: nothing executes the shebang

The deleted P0 asked "does the harness's bash match the scripts' `#!/usr/bin/env bash`?"
That question was **confused from the start**, and noticing why is worth more than the test
was. The pty tests run `bash -c '… source <copy>; maestro_sudo_ensure …'` — they **source**
the scripts into an already-running bash (5 such sites) and **never execute the shebang at
all**. So no test in this file ever depended on the answer.

But production *does* invoke these scripts through that shebang, and **no test exercises
that path** — `scripts/agent-helper.sh` carries the line and nothing runs it as a program.
That is a real, previously unstated gap. It is NOT this card's job: it belongs in its own
file, where an extra pty costs nothing, and it should execute the script directly rather
than sourcing it. Recorded here because this is where it surfaced.

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

- The file passes **30 consecutive runs**. The number is not arbitrary — it is where "clean"
  stops being cheap across the plausible range of the underlying rate: 30 clean runs happen
  by luck **0.2%** of the time at the P0-active rate (4/21) and **2.6%** at the pooled rate
  (4/35). Ten runs would come up clean 12-30% of the time, i.e. prove almost nothing. Do not
  trim this without redoing the arithmetic against whatever rate step 0 measures.
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
- [ ] 30 consecutive green runs of `tests/unit/maestro-sudo-gate-pty.test.ts`.
- [ ] TRDD-WV8FDAH0's STATE block updated to drop its caveat about the pin being intermittent.

## Approval log

- 2026-09-04T20:59:33+0200 — MANDATE issued by claude-opus-session
  (min-approval-requirement: none). Tier 0: a test-reliability bugfix inside this repo,
  reversible, no governance or public surface. Derived from TRDD-WV8FDAH0.
