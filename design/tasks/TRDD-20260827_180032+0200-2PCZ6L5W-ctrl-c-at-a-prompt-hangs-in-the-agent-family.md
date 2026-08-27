---
trdd-id: 2PCZ6L5W
title: Ctrl-C at a read prompt hangs aimaestro-agent.sh because its INT trap returns instead of exiting
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-27T18:00:32+0200
updated: 2026-08-27T18:00:32+0200
current-owner: hub-claude
assignee: hub-claude
created-by: hub-claude
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: hub-claude
approval-datetime: 2026-08-27T18:00:32+0200
priority: 2
severity: medium
effort: small
release-via: none
labels: [cli, sudo-gate, signals]
npt: []
eht: []
blocked-by: []
external-refs: [TRDD-Q758CX98, TRDD-9MZQ4T7E]
---

# Ctrl-C at a read prompt hangs aimaestro-agent.sh

## Problem

`scripts/aimaestro-agent.sh:84` installs `trap cleanup EXIT INT TERM`, and
`agent-core.sh::cleanup()` only removes temp files — it never exits. So on SIGINT the handler
runs and RETURNS, and bash then restarts the interrupted `read`. At the MAESTRO password prompt
(`maestro_sudo_ensure`, the agent-helper.sh family copy) a Ctrl-C therefore leaves the user at a
prompt that cannot be interrupted: every further Ctrl-C reruns cleanup and re-enters the read.

Measured 2026-08-27 with four bounded node-pty probes (8 s cap):

| probe | result |
|---|---|
| A bare `read -rs` + `trap 'echo x' INT` (non-exiting) | **hang** — bash itself, no gate involved |
| B pre-hardening gate + the same non-exiting trap | **hang** (identical) |
| C hardened gate + `trap '…; exit 130' INT` | exit 130, prior trap ran after echo restored |
| D hardened gate, no prior trap | dies by SIGINT (signal 2) |

So the hang is the CALLER's trap shape, pre-existing, and reachable from any `read` in that
script — the sudo prompt is just the first one a user meets. `tests/unit/maestro-sudo-gate-pty.test.ts`
P6 deliberately uses an EXITING prior trap for this reason.

## Proposed fix

`trap cleanup EXIT` stays; the signal traps become `trap 'cleanup; exit 130' INT` and
`trap 'cleanup; exit 143' TERM` (cleanup then die, which is what `EXIT INT TERM` on one
handler was meant to say). Sweep the other `aimaestro-*.sh` for the same shape
(`grep -n "trap .*INT" scripts/aimaestro-*.sh` — one other hit today: `aimaestro-statusline-capture.sh:204`
`trap '' HUP INT`, which IGNORES INT deliberately in a capture loop; read it before touching it).

## Acceptance

- [ ] `aimaestro-agent.sh`'s INT/TERM traps exit after cleanup; EXIT trap unchanged
- [ ] A pty test drives ^C at the sudo prompt through `aimaestro-agent.sh` itself (not the sourced gate) and asserts the process dies with 130 within the cap; neuter (restore the returning trap) → that test hangs to its cap and reds
- [ ] The sweep of `scripts/aimaestro-*.sh` for returning INT traps is recorded here with its result

## Approval log

- 2026-08-27T18:00:32+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Tier-0 self-mandate: a bugfix inside a script this repo owns, found by measurement. No approval request was sent.
