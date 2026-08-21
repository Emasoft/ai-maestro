---
trdd-id: P5RB1L01
title: Agent Online status must reflect the client, not just tmux session existence
column: planned
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T21:59:38+0200
created: 2026-07-11T21:37:52+0200
updated: 2026-08-21T21:59:38+0200
current-owner: scenario-runner
assignee: null
priority: 1
severity: HIGH
effort: M
task-type: bugfix
labels: [scenario-improvement, scen-015]
relevant-rules: []
min-approval-requirement: manager
external-refs: ["reports/scenarios-runner/SCEN-015_2026-07-11T18-33-14Z.report.md"]
---

## Problem

During SCEN-015 the agent's `claude` client silently failed to launch, yet the
registry recorded `status: active`, `sessions: 1`, and the dashboard sidebar
showed a green "Online" dot with a pulsing badge. The user (me, driving the UI)
sent a chat message to the agent and it appeared to be delivered — but the pane
was a bare shell with no client, so nothing happened and no error surfaced
anywhere. The status shown to the user was a lie: "Online" meant only "a tmux
session named `<agent>` exists", not "the coding client is running and able to
act".

This is the same failure class the underlying launch bug (fixed this run in
`lib/agent-runtime.ts`) produced, but the STATUS layer is an independent defect:
even after the launch bug, any transient (the client crashing, being `/exit`-ed,
OOM-killed) leaves the same false-green state until the next `SessionReconcile`
sweep.

## Root cause

Agent status is derived from tmux session existence + the hook activity file,
neither of which knows whether the *foreground process* of the pane is the
client or a plain shell. The server already logs
`[SessionReconcile] Killed orphan shell-only pane ... (no program running)`, so
it CAN tell — it just does so on a lazy sweep and does not feed that signal into
the status the UI renders.

## Proposed fix

- File: `services/sessions-service.ts` (status assembly) + the status source
  consumed by `hooks/useSessionActivity.ts`.
- Add a cheap `pane_current_command` probe (the new
  `AgentRuntime.getForegroundCommand`, already added in this run) to the status
  computation. When the pane foreground is a bare login shell
  (`zsh|bash|sh|...`) and the agent's `program` is a client (`claude`/`codex`/
  …), report a distinct status such as `client-not-running` (amber, not green),
  never `active`/`online`.
- Surface that state in `AgentBadge`/`AgentProfile` with a "client not running —
  New Session" affordance, so the user sees the true state and the one-click
  remedy.

## Verification

Create an AUTONOMOUS agent, then in its pane `/exit` the client so the pane
drops to a shell. Within one status poll the sidebar dot must go amber/"client
not running", NOT stay green. Re-launching via "New Session" returns it to green.

## Estimated risk

MED — touches the status pipeline that many UI surfaces consume. Mitigation: add
the new state as additive (never downgrade an already-correct `active`), and gate
the foreground probe behind the same 3s cache the session list already uses so it
adds no per-render tmux cost. Depends on `getForegroundCommand` (landed this run).

## Approval log

- 2026-08-21T21:59:38+0200 — APPROVED by ai-maestro-hub-session (min-approval-requirement: manager). Re-measured: `client-not-running`/`client-failed` status values do not exist anywhere in lib/services/hooks/components (0 hits); the dependency `AgentRuntime.getForegroundCommand` has landed (lib/agent-runtime.ts:227) and is already consumed elsewhere, so the fix is buildable now.
