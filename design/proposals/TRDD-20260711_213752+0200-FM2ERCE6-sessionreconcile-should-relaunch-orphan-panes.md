---
trdd-id: FM2ERCE6
title: SessionReconcile should relaunch an orphan shell-only pane, not just kill it
column: planned
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T21:59:38+0200
created: 2026-07-11T21:37:52+0200
updated: 2026-08-21T21:59:38+0200
current-owner: scenario-runner
assignee: null
priority: 2
severity: MEDIUM
effort: M
task-type: feature
labels: [scenario-improvement, scen-015]
relevant-rules: []
min-approval-requirement: manager
external-refs: ["reports/scenarios-runner/SCEN-015_2026-07-11T18-33-14Z.report.md"]
---

## Problem

The server periodically logs
`[SessionReconcile] Killed orphan shell-only pane for "<agent>" (no program
running) -- next wake will re-run the R17 gate`. So the reconciler already
DETECTS an agent whose client died and dropped to a bare shell. But it only
KILLS the pane and defers recovery to "next wake" — which, for an AUTONOMOUS
agent nobody wakes, may be never. The agent sits dead-but-listed until a human
notices.

## Root cause

`SessionReconcile` treats "shell-only pane" purely as cleanup (kill the orphan)
rather than as a recoverable fault (the client should be running here; relaunch
it). Combined with the launch-timing bug fixed this run, this made the failure
sticky: even after the pane was recreated, nothing re-attempted the client.

## Proposed fix

- File: the SessionReconcile routine (search `SessionReconcile] Killed orphan`).
- When it finds a shell-only pane for an agent whose `program` is a client and
  whose registry `status` is `active`, instead of only killing it, re-run the
  launch sequence (now `prepareShellForLaunch` + `sendKeys(startCommand)` — the
  same shared path used by create/wake) once, with a small backoff and a cap
  (e.g. max 2 relaunch attempts per session before marking it `client-failed`
  and stopping, to avoid a crash-loop).

## Verification

Create an agent, `/exit` its client from the pane, and wait one reconcile cycle:
the reconciler relaunches the client (pane foreground returns to the client) up
to the cap; after the cap it stops and marks the agent `client-failed` rather
than looping.

## Estimated risk

MED — an unbounded relaunch of a client that crashes on startup is a crash-loop,
so the attempt cap + `client-failed` terminal state are load-bearing, not
optional. Depends on the shared `prepareShellForLaunch` (landed this run).

## Approval log

- 2026-08-21T21:59:38+0200 — APPROVED by ai-maestro-hub-session (min-approval-requirement: manager). Re-measured: services/session-reconcile-service.ts:104-116 still only kills the orphan shell-only pane and never relaunches the client; the shared prepareShellForLaunch path (dependency) has landed and is in use elsewhere (services/agents-core-service.ts, services/sessions-service.ts).
