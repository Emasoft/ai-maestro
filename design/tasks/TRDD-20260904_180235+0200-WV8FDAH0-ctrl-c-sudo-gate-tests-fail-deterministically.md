---
trdd-id: WV8FDAH0
title: Three Ctrl-C and sudo-gate tests fail deterministically and appear nowhere on the board
scope: project
project-id: ai-maestro
column: ai_review
created: 2026-09-04T18:02:35+0200
updated: 2026-09-04T21:10:30+0200
current-owner: user
created-by: ai-maestro-hub-session
assignee: claude-opus-session
task-type: bugfix
priority: 1
severity: high
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-04T18:02:35+0200
blocked-by: []
npt: []
eht: []
implementation-commits: [5542ca89, b93f1ada, e4393a49]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-09-04

**All three failures are fixed and the four gate test files are green (23/23, exit 0).**
They were **two independent defects**, not one:

1. **Test #1** — `_chk_auth_args[@]: unbound variable` under bash 3.2's `set -u`. Fixed in
   `5542ca89`; the remaining unguarded arrays are their own card, **TRDD-FPE86FIF**.
2. **P6 (both copies)** — an **echo-ordering bug in the gate's own SIGINT handler**, fixed
   here. `kill -INT $$` raised INSIDE a trap is **DEFERRED** until that trap returns (bash
   will not re-enter a trap it is running), so the handler's trailing `stty -echo` — which
   exists for the resume case — ran BEFORE the caller's trap. Measured at a real pty: the
   caller saw `-echo`, and **a ^C at the password prompt left the user's own terminal
   echo-off**. That is the user-visible bug P6 was reporting; the test was right.

**The fix** (`_maestro_sudo_on_int`, added identically to both copies) runs the caller's
prior trap **body inline** instead of re-raising, so the ordering is ours: restore echo →
caller's trap → re-disable **only if that trap returned** (the read resumes). `kill -INT $$`
survives for the no-prior-trap case (P7), where there is nothing to order against.

**Both halves neuter-proven at a pty (2026-09-04):** drop the leading `stty echo` → the prior
trap sees `-echo` (P6 red); drop the trailing `stty -echo` → the text typed after the ^C is
echoed (P8 red). The pre-fix run is itself the third neuter — the old shape reddened exactly
P6, both copies, everything else green.

**`b93f1ada` REGRESSED the password-on-screen guarantee, and `e4393a49` fixes it.** An
adversarial review caught it and both cases reproduce at a pty (`LEAK=YES` → `LEAK=no`).
Running the caller's body inline is not a *pure* reordering, and this card said it was:

1. **`trap '' INT`** — SIGINT *ignored* — has an **empty body**, which the handler read as
   "no prior trap" and re-raised on. Under an ignored SIGINT the kill is a no-op, so the read
   resumed with echo ON. An empty BODY is not an absent trap; the branch now tests the SPEC.
2. **A body ending in `return`** returns from the *handler*, so a trailing re-disable is
   never reached. It is now a `RETURN` trap on the handler — fires on whatever path leaves
   the function, and `exit` still skips it, which is what P6 wants.

**P9/P10 pin both, per copy**, and were neutered one copy at a time: spec→body reds exactly
P9 [common.sh]; RETURN-trap→trailing-line reds exactly P10 [common.sh]; the agent-helper.sh
twins stay green in both runs.

**Two smaller behaviour changes this card did NOT state and should have:** the caller's trap
now sees `$?` = 0 (from the preceding `unset`) rather than the interrupted read's status, and
`FUNCNAME`/`BASH_SOURCE` differ from a trap bash invoked itself. Neither is pinned by a test;
both are inherent to running the body inline rather than re-raising.

**`tests/unit/maestro-sudo-gate-order.test.ts` was updated, and that is the one thing to check
if you distrust anything here.** Its Ctrl-C assertion was `/trap '[^']*stty echo[^']*' INT/` —
keyed on the trap having an INLINE body, a shape the fix necessarily breaks. The CONTRACT is
unchanged and is now pinned *more* tightly: the order INSIDE the handler, which is the
property that actually regressed and which the old regex could not express.

**CAVEAT ON THE PIN — TRDD-601KG45D.** P6/P8/P9/P10 are the only behavioural pin on this
fix, and that file has failed intermittently — 4 failures in 35 runs. Treat that rate as
CONDITIONAL: split by whether a since-deleted test was present it is **4/21 with** and
**0/14 without**, which leans toward that test having caused it (p ≈ 0.05) but does not
settle it. Whether the file is flaky as it now stands is open — step 0 on that card. A real
regression here could still read as "the flaky one again".
One failure showed the gate POSTing the password *minus its last character*, which may be
tty input loss around the handler's `stty` — if so that is a user-facing bug, not a test
problem. Filed separately; do not treat the pin as reliable until it closes.

**NEXT ACTION.** None on this card. Its pin's reliability is 601KG45D.

## Problem

`tests/unit/aimaestro-agent-ctrl-c.test.ts` and
`tests/unit/maestro-sudo-gate-pty.test.ts` fail deterministically, and this
failure appears nowhere on the board (no open TRDD covers it).

## Evidence

Reproduced 2026-09-04 by running:

```
bash scripts/with-node.sh yarn vitest run tests/unit/aimaestro-agent-ctrl-c.test.ts tests/unit/maestro-sudo-gate-pty.test.ts
```

Result: **3 failed / 8 passed (11)**, exit code 1.

Failing tests:

1. `aimaestro-agent-ctrl-c.test.ts > TRDD-2PCZ6L5W — Ctrl-C at the sudo prompt
   kills aimaestro-agent.sh > probe → prompt → ^C: the process exits 130
   instead of resuming the read` — fails before ever reaching the Ctrl-C
   assertion: `agent-helper.sh:956: _chk_auth_args[@]: unbound variable`, then
   `Error: Cannot connect to AI Maestro at http://127.0.0.1:64428`. The prompt
   text `MAESTRO password` never appears in the probe output.
2. `maestro-sudo-gate-pty.test.ts > TRDD-9MZQ4T7E — MAESTRO sudo gate driven
   at a real pty > P6 [scripts/shell-helpers/common.sh]: Ctrl-C mid-prompt
   hands off to the caller's prior INT trap, AFTER echo is restored`
3. `maestro-sudo-gate-pty.test.ts > TRDD-9MZQ4T7E — MAESTRO sudo gate driven
   at a real pty > P6 [scripts/agent-helper.sh]: Ctrl-C mid-prompt hands off
   to the caller's prior INT trap, AFTER echo is restored`

For P6 (both copies), the actual output was `"MAESTRO password (sudo,
one-shot): PRIOR-INT\n-echo\n"` against the expected pattern
`/PRIOR-INT\necho\n/` — the captured `stty -a` line reads `-echo` (echo OFF)
where the test expects `echo` (echo back ON) at that point in the sequence.

Determinism: re-ran the same two files in isolation twice on 2026-09-04; both
runs gave **3 failed / 8 passed (11)**. Not a flake.

Full-suite context read earlier the same day: 2 files failed, 509 passed
(511); 3 tests failed, 6660 passed, 2 skipped (6665).

The last commits touching the two failing test files are `0f23fb50`
(TRDD-2PCZ6L5W) and `a65847c7`, `ff32d9211` (TRDD-Q758CX98) — i.e. other
cards' work.

## What is NOT established

Whether these failures **predate 2026-09-04** was NOT established. The only
check run was `git log --since` over the two test files plus
`scripts/shell-helpers/common.sh` and `scripts/agent-helper.sh`, which rules
out direct edits to those four paths in the checked window and does **not**
rule out a transitive break via a dependency, nor an environment-dependent
failure (e.g. the P8 tests in the same run, driving the same two scripts,
passed — so the P6 failure is not a blanket "the script is broken" claim).
Do not treat these failures as pre-existing without further verification.

## Proposed fix

None proposed here. This card exists to record the failure and gate its
investigation; see Acceptance.

## Acceptance

- [x] ~~Reproduce at a commit predating the suspected regression to establish
      when the three failures began.~~ **SUPERSEDED, and NOT measured — do not
      read this box as a bisect.** The mechanism was established directly at a
      pty (bash defers a `kill -INT $$` raised inside a trap), which is the
      thing the archaeology would have been evidence *for*. *When* it began
      changes nothing that remained to be decided.
- [x] Determine whether the three failures share one root cause or are
      separate defects. **SEPARATE**, as the card suspected: #1 is the bash-3.2
      empty-array crash (fixed `5542ca89`), #2/#3 are the echo-ordering defect
      fixed here. Nothing links them but the run they appeared in.
- [x] Decide per failure whether the TEST or the CODE is wrong.
      **#1 CODE. #2/#3 CODE** — P6 was reporting a real user-visible bug (^C at
      the prompt left the terminal echo-off). One test file DID change:
      `maestro-sudo-gate-order.test.ts` was keyed on the trap having an inline
      body, which is a SHAPE, not the contract. **But this is NOT a pure
      reordering, and an earlier version of this box said it was** — running the
      caller's body inline also narrowed *when* echo is re-disabled, which
      regressed the password-on-screen guarantee in two caller shapes (fixed in
      `e4393a49`, pinned by P9/P10). See the STATE block.
- [x] `bash scripts/with-node.sh yarn vitest run tests/unit/aimaestro-agent-ctrl-c.test.ts tests/unit/maestro-sudo-gate-pty.test.ts`
      exits 0. **Exit 0, 11/11.** All four gate files together: 19/19, exit 0.

## Approval log

- 2026-09-04T18:02:35+0200 — Tier 0 self-mandate (min-approval-requirement:
  none): recording a pre-existing failure on the board. No code change
  proposed here.
