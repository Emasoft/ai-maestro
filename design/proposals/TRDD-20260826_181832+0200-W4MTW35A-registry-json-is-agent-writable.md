---
trdd-id: W4MTW35A
title: The identity mapping table that kernel peer credentials rely on is writable by every agent
column: proposal
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-08-26T18:18:32+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: user
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: critical
labels: [security, impersonation, agent-auth, guarantor-integrity]
external-refs: [TRDD-EVO7T245, TRDD-K4BEKT3L]
---

## Problem

(A) — the kernel-peer-credential design — reads the connecting PID truthfully from the kernel,
then consults a FILE to turn that PID into an agent identity. That file is writable by every
agent.

## Evidence (measured 2026-08-26)

```
-rw-r--r-- 1 emanuelesabetta staff 19615  ~/.aimaestro/agents/registry.json
registry writable by this uid: True
```

## Why it matters

Rewrite the mapping, keep the kernel honest, obtain any identity you like. The kernel
attestation is unforgeable and the LOOKUP is not, so the weakest link is the file — and
no amount of hardening the syscall path compensates.

This is the same class as TRDD-K4BEKT3L (writable server tree): the mechanism is sound and
its inputs are attacker-controlled.

## Task

1. INVESTIGATE — enumerate every file the identity resolution reads (`registry.json`,
   `teams.json`, `groups.json`, session/pane maps, anything under `~/.aimaestro`).
2. ASSESS — which of them can change an identity decision if mutated.
3. SAFEGUARD — make the identity-bearing state unwritable by the agent uid (root-owned,
   or server-owned under a separate service account), or authenticate it (signed records
   the server verifies on read).

## Acceptance

- [ ] Every file consulted during identity resolution enumerated, with owner and mode.
- [ ] For each, a statement of what mutating it does to an identity decision.
- [ ] Safeguard applied so the agent uid cannot mutate them.
- [ ] A probe run AS AN AGENT proving the write is no longer possible.
- [ ] A regression check that fails if any identity-bearing file becomes agent-writable.
