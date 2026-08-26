---
trdd-id: O0RHX7K6
title: One agent spawned without the sandbox profile defeats the confinement layer for the whole fleet
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
min-approval-requirement: manager
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
labels: [security, impersonation, sandbox]
external-refs: [TRDD-EVO7T245, TRDD-1V7UZ38I]
---

## Problem

The sandbox layer is only as good as its application. One code path that starts an agent
without the profile leaves that agent unconfined, and an unconfined agent defeats the layer
for the whole fleet — it can reach every other agent's tmux pane, keys and files.

## Evidence (measured 2026-08-26) — and it is FAVOURABLE

```
grep for tmux `new-session` across lib/ services/ app/api:
  lib/agent-runtime.ts   <- the real spawn path
  lib/session-env.ts     <- comment only
  lib/tutorialData.ts    <- documentation string
```

Essentially ONE chokepoint. The only other spawn path is the docker route, already carded as
TRDD-1V7UZ38I. That makes this enforceable rather than aspirational — which is the reason to
card it now, while the count is one.

## Task

1. INVESTIGATE — confirm `lib/agent-runtime.ts` is the sole non-docker spawn path, including
   restart, wake, recovery and headless mode, which may re-enter it or may not.
2. ASSESS — for each entry point that leads to a running agent, whether it passes through
   the chokepoint.
3. SAFEGUARD — apply the profile AT the chokepoint, and add a guard test that fails if a
   second spawn site appears.

## Acceptance

- [ ] Every path that results in a running agent is traced to the chokepoint or listed as an
      exception with its own remedy.
- [ ] The profile is applied at the chokepoint.
- [ ] A test asserts exactly one spawn site exists, and reddens when a second is added.
- [ ] Restart / wake / recovery each demonstrated to produce a CONFINED agent.
