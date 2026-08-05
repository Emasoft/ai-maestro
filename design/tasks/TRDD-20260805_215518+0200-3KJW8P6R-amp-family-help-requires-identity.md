---
trdd-id: 3KJW8P6R
title: The amp-* family requires an AMP identity to print --help
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-05T21:55:18+0200
updated: 2026-08-05T21:55:18+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-05T21:55:18+0200
derived: true
derived-kind: eht
parent-trdd: T3FXA0Y0
npt: []
eht: []
blocked-by: []
release-via: none
relevant-rules: [23]
labels: [cli, exit-status, amp, derived]
external-refs: [Emasoft/ai-maestro#121]
---
# The amp-* family requires an AMP identity to print --help

## Problem

Measured 2026-08-05 while landing the exit-status contract (`SCRIPT-MANIFEST.md` §6.4,
TRDD-T3FXA0Y0): **`--help` exits non-zero on 29 of the 50 deployed CLIs.** One
(`aimaestro-agent.sh`) is fixed. The other 28 are this card.

**They share ONE root.** Every `amp-*` script does, near the top:

```bash
source "${SCRIPT_DIR}/amp-helper.sh"
```

and `amp-helper.sh` resolves the AMP identity **at source time** — before the script's own
argument loop ever runs. When the session is not bound to an agent it prints a diagnostic and
`exit 1`s. So:

```
$ amp-send.sh --help
Error: AMP identity could not be resolved for this session (34 agents registered).
exit 1
```

The `--help` branch in `amp-send.sh` is *correct* (`show_help; exit 0`) and is **never
reached**. The failure happens two dozen lines earlier, in a sourced file.

`aid-auth.sh` is on the violator list for a **different** reason and must not be lumped in:
it PRINTS a token, so `--help` is not a distinct verb for it. That is a design question, not
this bug.

## Why this is worth its own card, and was NOT bundled into T3FXA0Y0

**The abort must not be weakened.** Read `scripts/amp-helper.sh` around the identity error
before touching anything: the message is deliberately written to name only the paths that
PROVE identity, and to **refuse to print a pickable uuid list**, because an earlier version
invited exactly the state-corrupting act it was meant to prevent — a session that cannot
prove who it is copying a live peer's uuid and then sending mail and moving kanban cards
under that agent's identity. Its own comment says it: *"An error message must not hand the
caller the exploit."*

So this is security-adjacent shared code with 28 dependents. A one-line "skip the check when
`--help` is present" is the obvious fix and is exactly the shape that deserves a design pass
and a neuter rather than a quick edit at the end of a session.

## Scope

1. Decide the mechanism, then apply it once. Two candidates, both need judging against the
   security note above:
   - **(a) help before source** — each script handles `--help`/`-h` before sourcing the
     helper. Most explicit, no shared-code risk, but 28 edits.
   - **(b) helper-side skip** — `amp-helper.sh` skips identity resolution when the caller's
     argv is a help request. One edit for 28 scripts. A sourced file DOES see the caller's
     positional parameters, so this is mechanically possible — but it makes the helper's
     behaviour depend on the caller's argv, which is implicit coupling, and it must be proven
     not to skip the check for any invocation that goes on to perform an AMP operation.
2. Whichever is chosen: **no AMP operation may become reachable without identity.** The
   deliverable is that `--help` prints and exits 0; nothing else changes.
3. Decide `aid-auth.sh` separately — it is a token-printer, so "what does `--help` even mean
   here" is the actual question.

## Acceptance criteria

- [ ] `amp-send.sh --help` prints usage and exits 0 with **no** `AID_AUTH`, **no** agent
      workdir, and **no** `AIM_AGENT_ID` in the environment.
- [ ] The same holds for all 27 sibling `amp-*` scripts.
- [ ] **A true-positive regression test in the SAME run:** a real `amp-send.sh` invocation
      (not `--help`) from an unbound session still refuses, still exits non-zero, and still
      does NOT print a pickable uuid list. A fix that reaches box 1 by weakening the identity
      gate must fail here.
- [ ] Each fixed script is DELETED from `KNOWN_VIOLATORS` in
      `tests/unit/cli-help-exit-contract.test.ts` — the ratchet fails if a listed script
      starts passing, so the list cannot go stale.
- [ ] A neuter is recorded: re-introducing the identity requirement on the help path reddens
      a named test.
- [ ] `aid-auth.sh` either complies or its row moves to a stated exception with a reason.

## Non-goals

- Changing what the identity gate does for a REAL amp operation. The gate is correct; only
  its position relative to `--help` is wrong.
- Widening `--id` acceptance, or anything that makes an unbound session able to act as an
  agent. The card that this one derives from is about exit codes, not authority.

## Verification

Run the acceptance list as real commands in an environment with the identity variables
explicitly cleared, asserting on exit status AND on whether usage text actually appeared —
not on message text alone. The true-positive case runs in the same pass, so a fix that
disables the gate cannot pass.

## Approval log

- 2026-08-05T21:55:18+0200 — SELF-MANDATE (Tier 0, `min-approval-requirement: none`): an EHT
  of TRDD-T3FXA0Y0, inside the same assignment scope, authored directly in `design/tasks/`.
  Split out rather than bundled because the shared code it touches is security-critical.
