---
trdd-id: V93RLKEB
title: Shell rc files and the Claude Code shell-snapshot directory are agent-writable and execute in every other agent
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
external-refs: [TRDD-EVO7T245, TRDD-Q79M7JV7]
---

## Problem

Files that every future shell executes are writable by every agent, so writing one puts code
inside EVERY other agent's process tree — the same effect as `send-keys`, but persistent and
not requiring the tmux socket at all.

## Evidence (measured 2026-08-26)

```
~/.zshrc                    exists=True writable=True
~/.zprofile                 exists=True writable=True
~/.claude/shell-snapshots   exists=True writable=True
```

The snapshot directory is the sharper one: Claude Code's Bash tool sources a generated
snapshot (observed live in this session's own process table), so it is executed on the
agent's hot path rather than only at login.

## Relationship to the user's roadmap

The owner has ruled that user-scope config is transitional — everything moves to project or
local scope. That ruling covers `~/.claude` config; it does NOT cover the shell rc files,
which are the operating system's, not ai-maestro's. This card therefore survives that
migration and must not be closed by it.

## Task

1. INVESTIGATE — enumerate every file executed by a shell an agent spawns: rc files,
   profile files, the Claude Code shell-snapshot directory, `ENV`/`BASH_ENV` targets.
2. ASSESS — for each, which agents execute it and when.
3. SAFEGUARD — deny writes in the per-agent profile; consider whether the snapshot should
   be generated per-agent inside the agent's own confined tree.

## Acceptance

- [ ] Executed-file set enumerated with the trigger that runs each.
- [ ] Profile denies writes to all of them, with a non-vacuity control.
- [ ] The agent still starts and its Bash tool still works under the deny, demonstrated.
