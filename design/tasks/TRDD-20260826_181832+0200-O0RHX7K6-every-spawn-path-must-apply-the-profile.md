---
trdd-id: O0RHX7K6
title: One agent spawned without the sandbox profile defeats the confinement layer for the whole fleet
column: planned
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-09-05T10:21:28+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: manager
mandate: false
approved: true
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
labels: [security, impersonation, sandbox]
external-refs: [TRDD-EVO7T245, TRDD-1V7UZ38I]
approval-judge:  manager 
approval-datetime: 2026-09-05T10:21:28+0200
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

## Prerequisite added 2026-08-26 — TRDD-NB70FKKT

> **`blocked-by:` is deliberately EMPTY, and that is not an oversight.** This card is
> `column: proposal` — it has not been approved, so it is not in the pipeline and cannot be
> "blocked" in the pipeline sense. Setting `blocked-by` here produced a real ERROR
> (`GRAPH-BLOCKED-NOT-BLOCKED`) from `trddgrep validate`. **On approval, this card must enter
> the board as `blocked` with `blocked-by: [TRDD-NB70FKKT]` until that card is answered.**
> The prerequisite is recorded below as prose precisely because the field cannot carry it yet.

Do NOT ship this profile as a claimed boundary while an unconfined process executes scripts
from the agent-writable tree. Found by the janitor session applying this card set's own
writable-guarantor predicate to their own tree, verified here: `scripts/aimaestro-agent.sh` is
`-rwxr-xr-x`, agent-uid-owned, and `plugin_manage.py:194` subprocess.run()s it from OUTSIDE any
agent sandbox.

Today that grants nothing — under single-uid an agent that can write the script can already act
as that uid directly. **It becomes live exactly when this card lands**, which is why it is a
prerequisite and not a follow-up: a confined agent writes the script and waits for an unconfined
process to run it.

General form worth carrying: confinement is defeated by anything unconfined that consumes
attacker-writable input — a script, a config naming a command, or an env var selecting a binary
(`$AIMAESTRO_CLI` is a second instance).

## Approval log

- 2026-09-05T10:21:28+0200 — APPROVED by  manager  (min-approval-requirement: manager). APPROVED:  sandbox module built (lib/agent-sandbox-profile.ts) but NOT wired into lib/agent-runtime.ts spawn path . USER /goal 2026-09-05 'complete all TRDD and pending tasks'; screened 2026-09-05 (reports/triage/20260905_101808+0200-proposal-screen.md), grounding verified in-tree.
