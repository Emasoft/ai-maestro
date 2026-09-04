---
trdd-id: WV8FDAH0
title: Three Ctrl-C and sudo-gate tests fail deterministically and appear nowhere on the board
scope: project
project-id: ai-maestro
column: todo
created: 2026-09-04T18:02:35+0200
updated: 2026-09-04T18:02:35+0200
current-owner: user
created-by: ai-maestro-hub-session
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
implementation-commits: []
---

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

- [ ] Reproduce at a commit predating the suspected regression to establish
      when the three failures began.
- [ ] Determine whether the three failures share one root cause or are
      separate defects (test #1's `_chk_auth_args[@]: unbound variable` +
      server-connect error looks unrelated to #2/#3's echo-state ordering).
- [ ] Decide per failure whether the TEST or the CODE is wrong — the tests
      encode a deliberate Ctrl-C / INT-trap contract, so making the suite
      pass may require changing either side.
- [ ] `bash scripts/with-node.sh yarn vitest run tests/unit/aimaestro-agent-ctrl-c.test.ts tests/unit/maestro-sudo-gate-pty.test.ts`
      exits 0.

## Approval log

- 2026-09-04T18:02:35+0200 — Tier 0 self-mandate (min-approval-requirement:
  none): recording a pre-existing failure on the board. No code change
  proposed here.
