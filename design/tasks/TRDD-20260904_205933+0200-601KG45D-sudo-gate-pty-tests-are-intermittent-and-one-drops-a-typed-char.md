---
trdd-id: 601KG45D
title: The sudo-gate pty tests fail about one run in eight and one failure showed a truncated password
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-04T20:59:33+0200
updated: 2026-09-04T21:05:12+0200
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

`tests/unit/maestro-sudo-gate-pty.test.ts` fails intermittently at roughly **1 run in 8**,
and it is not always the same test. This matters more than an ordinary flake because P6, P8,
P9 and P10 in that file are the *only* behavioural pin on TRDD-WV8FDAH0's fix — the one that
stops a ^C at the password prompt leaving the terminal echo-off or putting the typed password
on screen. **An unreliable pin on a security fix is close to no pin**: a real regression would
read as "the flaky one again".

## Evidence — measured 2026-09-04, three batches

| batch | condition | failures / runs | which |
|---|---|---|---|
| A | with a pty-based P0 present | 3 / 13 | P8 ×2, P9 ×1 |
| B | that P0 skipped | 0 / 6 | — |
| C | with the final, non-pty P0 | 1 / 8 | P8 ×1 |
| D | P0 fully removed | 0 / 8 | — |

Batch B is what made me hypothesise that the extra pty allocation caused it. **Batch C
refutes that** — the flake survives with no extra pty — so B's clean sweep was small-`n`
luck. Recorded here because the wrong conclusion was one batch away from being written down
as fact: `0/6` is not evidence of absence at a 1-in-8 rate.

**What is NOT established: that the flake pre-dates P0.** An earlier draft of this card said
"pre-existing" in its own headline. Every observed failure had *some* version of P0 present,
and the only P0-free evidence is batch B's `0/6` — which at a 1-in-8 rate comes up clean by
luck about **45%** of the time. The honest statement is: *never observed without some P0
present, and 0/6 cannot distinguish that from chance.* Batch C's P0 also ran `beforeEach`
(an HTTP `listen(0)` plus a `mkdtemp`) before the first pty test, so even "no extra pty"
did not restore batch B's baseline. **Step 0 is therefore to re-measure with P0 fully
absent, at n ≥ 24, and settle it.**

Nothing here establishes a rate to more than an order of magnitude. All three batches are
small, and batch A additionally ran while a background agent was live, so load is confounded
with the P0 variable in exactly the batch that looked most significant.

P0 itself has since been REMOVED (it was vacuous — see the note in the test file). Batch D
is the first data with it fully absent: **0 / 8**. Combined with batch B that is **0 / 14
P0-free** against **4 / 27 with some P0** — suggestive, still not decisive (0/14 comes up
clean by luck ~15% of the time at 1-in-8), which is why step 0 asks for n >= 24 rather
than declaring it settled here. Note what this would mean if it holds: the flake is not
pre-existing at all, and *adding almost anything* to this file destabilises it — which is a
statement about the harness's margins, not about P0.

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

- The file passes **30 consecutive runs**. The number is not arbitrary: at the observed
  ~1-in-8 rate, 30 clean runs happen by luck about **1.8%** of the time (`(7/8)^30`), so it
  is the point where "clean" stops being cheap. A single green run proves nothing here, and
  10 would still come up clean ~26% of the time — do not trim this without redoing that
  arithmetic against whatever rate step 0 measures.
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
