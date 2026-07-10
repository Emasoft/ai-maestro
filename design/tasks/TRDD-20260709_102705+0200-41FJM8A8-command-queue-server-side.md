---
trdd-id: 41FJM8A8
title: Server-side persistent command queue for fire-when-idle and fire-when-woken agent commands
column: complete
created: 2026-07-09T10:27:08+0200
updated: 2026-07-10T04:20:51+0200
implementation-commits: [e292afbc]
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 1
severity: HIGH
effort: L
task-type: feature
release-via: none
parent-trdd: TRDD-SCLSRS6E
derived: true
derived-kind: npt
npt: []
eht: []
relevant-rules: []
labels: [command-queue, terminal-control, hibernation, api, script-layer]
test-requirements: [unit, integration]
review-requirements: [human-review]
impacts: [public-api]
external-refs: []
---

# TRDD-41FJM8A8 — Server-side persistent command queue

> **Graph correction 2026-07-10 (corpus sweep).** This TRDD's `eht:` named
> TRDD-280DF70U, the shared script-wrapper platelet. But an `npt:`/`eht:` edge
> declares *parenthood*, and 280DF70U has exactly one parent — the epic
> TRDD-SCLSRS6E, which still claims it. Five siblings named the same platelet, so
> the one-parent law read it as five parents. What the edge really said is "this
> subsystem's endpoints need wrappers" — a dependency on a sibling, which belongs
> in `blocked-by:`. Moot now: 280DF70U is complete, and `blocked-by:` carries only
> OPEN blockers. This TRDD is itself an NPT of the epic; a derived TRDD carries no
> children of its own (depth is exactly 1).

Build a server-side, persistent, generic command queue so any governance agent (the
janitor, MANAGER, etc.) can enqueue a command for a target agent and have it fire
automatically once that agent is idle, online, or has been woken — instead of the
caller having to poll and retry the send itself.

## What exists today

- `hooks/useRestartQueue.ts:52-200` is a **client-side** solution: an in-memory React
  `Map`, restart-only (it only ever calls the restart endpoint), that polls
  `getSessionActivity()` every 1s and fires when `notificationType === 'idle_prompt'`
  and `subagentCount` is not `>0`. It does not persist across page reload/server
  restart and cannot queue arbitrary commands.
- Command send already exists and is reusable: `PATCH /api/agents/[id]/session`
  accepting `{command}` or `{commandKey}` (`app/api/agents/[id]/session/route.ts:51-114`)
  delegates to `sendAgentSessionCommand` in `services/agents-core-service.ts:1536`.
- State read: `getHookState()` (`services/sessions-service.ts:174`), the 8-priority
  activity ladder in `lib/agent-status.ts`, and `GET /api/sessions/[id]/pane-status`
  are all available to determine when an agent is idle.
- The subagent safe-state gate already exists: `lib/session-safe-state.ts`
  (`evaluateExitGate`) — this is what stop/restart use to refuse when subagents are
  provably running; the new drainer should reuse it rather than reinventing it.

## What to build

1. `lib/command-queue.ts` — a server-side queue persisted to
   `~/.aimaestro/command-queue/<agentId>.json`, written atomically (write to `.tmp`,
   rename). Each entry: `{id, command|commandKey, when: 'idle'|'online'|'now-if-idle-else-queue', wakeFirst?: boolean, createdAt, agentId}`.
2. A server-side drainer: a lightweight interval (or hook-driven check on the existing
   activity-polling path) that, when an agent reaches `idle_prompt` **and**
   `evaluateExitGate` from `lib/session-safe-state.ts` passes, pops the next queued
   entry (FIFO) and calls the existing `sendAgentSessionCommand`.
3. Hibernated-agent handling: if the target agent has no live session, the entry is
   held (not dropped). When `wakeFirst: true` is set, the drainer wakes the agent
   first, waits for it to reach `idle_prompt`, then runs the queued command.
4. New routes:
   - `POST /api/agents/[id]/queue` — enqueue `{command|commandKey, when, wakeFirst?}`.
     Strict-classify (destructive: it will eventually inject text into a live agent
     terminal).
   - `GET /api/agents/[id]/queue` — list pending entries for the agent.
   - `DELETE /api/agents/[id]/queue/[entryId]` — cancel a pending entry.
5. Deduplication: reject (or coalesce) an enqueue that exactly matches an already
   pending entry for the same agent, to avoid duplicate command floods from retrying
   callers.

## Files to touch

- NEW `lib/command-queue.ts` — persistence + FIFO queue state machine + drain logic.
- NEW `app/api/agents/[id]/queue/route.ts` — `POST` (enqueue), `GET` (list).
- NEW `app/api/agents/[id]/queue/[entryId]/route.ts` — `DELETE` (cancel).
- edit `services/agents-core-service.ts` — wire the drain hook into the existing
  activity-tracking path (reuse whatever loop already polls agent state).
- reuse `lib/session-safe-state.ts` (`evaluateExitGate`) — no duplication of the
  subagent gate logic.
- `hooks/useRestartQueue.ts` — optionally migrate to consume the new server queue
  instead of its own client-side Map (follow-up, not required for this TRDD to land).

## Tests

- Queue entry persists to disk and survives a simulated server restart (re-read the
  JSON file into a fresh `command-queue.ts` instance and confirm the entry is still
  there).
- Drain fires the queued command only when the agent is BOTH idle AND
  `evaluateExitGate` passes — a test that forces the gate to fail must show the
  command NOT sent.
- Hibernated-agent entry is held (not dropped) until the agent comes online; a
  `wakeFirst: true` entry triggers a wake before the command is sent.
- Cancel (`DELETE .../queue/[entryId]`) removes exactly that entry and no others.
- FIFO ordering: three entries enqueued in order drain in the same order.
- Duplicate enqueue (same agent, same command, same `when`) is deduped/rejected
  rather than creating a second identical pending entry.

## Approval log
