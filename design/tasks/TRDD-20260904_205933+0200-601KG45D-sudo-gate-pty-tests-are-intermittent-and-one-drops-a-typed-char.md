---
trdd-id: 601KG45D
title: The sudo-gate pty tests fail about one run in eight and one failure showed a truncated password
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-04T20:59:33+0200
updated: 2026-09-04T20:59:33+0200
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

Batch B is what made me hypothesise that the extra pty allocation caused it. **Batch C
refutes that** — the flake survives with no extra pty — so B's clean sweep was small-`n`
luck. Recorded here because the wrong conclusion was one batch away from being written down
as fact: `0/6` is not evidence of absence at a 1-in-8 rate.

Nothing here establishes a rate to more than an order of magnitude. All three batches are
small, and batch A additionally ran while a background agent was live, so load is confounded
with the P0 variable in exactly the batch that looked most significant.

## The clue worth chasing first

One P9 failure was **not** a timeout. The gate reached the server and POSTed a password that
was the real one **minus its final character**:

```
expected '{"password":"wrong-pw-9MZQ4T7E-x7q"}' to contain 'wrong-pw-9MZQ4T7E-x7q2'
```

The harness writes `SECRET + '\r'` in a single `p.write`, so a character was lost *after* the
write and *before* `read` consumed it. That points at the tty, not the timer — and the gate
manipulates the tty around exactly that moment (`stty -echo` on the handler's RETURN trap).

**If `stty` is flushing pending input, this is a real user-facing bug and not a test problem
at all**: a human typing their password while the gate re-disables echo would lose a
character and get an unexplained refusal. `stty` uses TCSAFLUSH in some paths, which
discards queued input. That hypothesis is UNVERIFIED — it is the first thing to test, not a
finding.

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

- The file passes **30 consecutive runs**. A single green run proves nothing at a 1-in-8
  rate; that is the mistake batch B nearly licensed.
- If step 1 finds real input loss, that becomes its own fix with its own pty test, and this
  card cites it.

## Estimated risk

LOW for the harness work. Step 1 could raise the severity sharply if input loss is real.

## Acceptance

- [ ] Established whether the truncated password was tty input loss or a harness artifact,
      with the measurement recorded here.
- [ ] The timing dependence removed wherever an observable marker exists.
- [ ] 30 consecutive green runs of `tests/unit/maestro-sudo-gate-pty.test.ts`.
- [ ] TRDD-WV8FDAH0's STATE block updated to drop its caveat about the pin being intermittent.

## Approval log

- 2026-09-04T20:59:33+0200 — MANDATE issued by claude-opus-session
  (min-approval-requirement: none). Tier 0: a test-reliability bugfix inside this repo,
  reversible, no governance or public surface. Derived from TRDD-WV8FDAH0.
