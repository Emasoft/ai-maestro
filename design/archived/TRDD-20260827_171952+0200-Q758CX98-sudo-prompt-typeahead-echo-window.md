---
trdd-id: Q758CX98
title: The MAESTRO sudo prompt echoes typeahead — a password pasted before read -rs runs lands on screen
column: complete
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-27T17:19:52+0200
updated: 2026-08-27T17:31:18+0200
current-owner: hub-claude
assignee: hub-claude
created-by: hub-claude
task-type: security
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: hub-claude
approval-datetime: 2026-08-27T17:19:52+0200
priority: 2
severity: medium
effort: small
release-via: none
labels: [security, cli, sudo-gate]
npt: []
eht: []
blocked-by: []
external-refs: [TRDD-9MZQ4T7E]
---

# The MAESTRO sudo prompt echoes typeahead

## Problem

`maestro_sudo_ensure` (scripts/shell-helpers/common.sh and the family copy in
scripts/agent-helper.sh) prints the prompt with `printf > /dev/tty` and only THEN runs
`read -rs < /dev/tty`, which is what switches the tty to `-echo`. Keystrokes that arrive in
the gap — a paste, a typeahead, a wrapper feeding the terminal — are echoed by the line
discipline and the password lands on screen (and in any terminal scrollback/log).

Found by measurement, not by reading: the node-pty harness in
`tests/unit/maestro-sudo-gate-pty.test.ts` typed the moment the prompt appeared and, under
full-suite load, read its own secret back in the pty output (1 red in 6438; commit after
`1bfd23ca`). The harness now waits for the tty to report `-echo` before typing, so it no
longer exercises the gap — this card exists so the gap is not forgotten because the test
stopped seeing it.

## Proposed fix

Put the tty into `-echo` BEFORE printing the prompt and restore it after the read, in both
copies (`stty -echo < /dev/tty` … `stty echo < /dev/tty`, with a trap so an interrupted read
does not leave the terminal silent). Keep `read -rs` — the two are belt and braces.

Verification: a pty test that writes the password BEFORE the prompt is printed cannot be
made deterministic (the gap before the gate even starts is bash startup), so the pin is the
ORDER in source: `stty -echo` must precede the prompt `printf` in both files (a source-order
scan with a positive control), plus the existing P2 behavioural test.

## Acceptance

- [x] `stty -echo` precedes the prompt printf in common.sh and agent-helper.sh, restored after the read and on interrupt
- [x] A source-order test (tests/unit/maestro-sudo-gate-order.test.ts; neuter: common.sh swap → 1 red / 1 green) pins the order in BOTH copies; neuter (swap the order in one copy) reds exactly that copy's test
- [x] tests/unit/maestro-sudo-gate-pty.test.ts still 3/3 green

## Approval log

- 2026-08-27T17:19:52+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Tier-0 self-mandate: an in-scope security hardening of a script this repo owns. No approval request was sent.
