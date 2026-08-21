---
trdd-id: TJRFVZRC
title: A chat message to an agent whose client cannot act must surface an error, not vanish
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
task-type: feature
labels: [scenario-improvement, scen-015]
relevant-rules: []
min-approval-requirement: manager
external-refs: ["reports/scenarios-runner/SCEN-015_2026-07-11T18-33-14Z.report.md"]
---

## Problem

When I typed a message into an agent's Chat section, the composer cleared and the
message showed as sent. The agent's client, however, replied on its own terminal
`Not logged in · Please run /login` and did nothing. From the user's seat there
was NO feedback: the chat panel said "0 messages", the message just disappeared.
A human user has no way to tell "the agent is thinking" from "the agent is dead"
— both look identical in the chat UI.

## Root cause

The chat/prompt-builder path injects the message into the pane and returns
success as soon as the keystrokes are sent. It has no readback of whether the
client accepted the turn. When the client is at a `/login` wall (or is a bare
shell, or is mid-crash), the injected text is echoed into whatever is in front
and silently lost.

## Proposed fix

- File: the chat send path (`services/agents-chat-service` + the API route behind
  `AgentChat`'s send) and `components/AgentChat.tsx`.
- Before/right after injecting, probe the pane foreground (reuse
  `AgentRuntime.getForegroundCommand`) and the last pane lines. If the foreground
  is not the client, or the tail matches a known client-blocked banner
  (`Not logged in`, `Please run /login`, `Trust this folder`), return a
  structured `agent_not_ready` result.
- Render that in the chat thread as a system notice ("This agent's client is not
  ready: Not logged in. Start a session or check its terminal.") instead of a
  silent success.

## Verification

Point a test agent at a client that is logged out, send a chat message, and
assert the chat thread shows an `agent_not_ready` system notice naming the reason
— not a silent clear. With a healthy client, the message flows normally.

## Estimated risk

MED — adds a readback step to a hot path; keep it best-effort and time-boxed
(≤1s) so a slow probe never blocks the send. Banner matching is heuristic and
must be additive (never suppress a real delivery on a false negative).

## Approval log

- 2026-08-21T21:59:38+0200 — APPROVED by ai-maestro-hub-session (min-approval-requirement: manager). Re-measured: no `agent_not_ready` result type exists anywhere in lib/services/components/app (0 hits) — a chat message to a not-ready client still vanishes silently, same as filed.
