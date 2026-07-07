---
trdd-id: 13MZ7EFO
title: Reconcile registry sessions with live tmux state so lifecycle buttons and the R17 wake-gate become reachable
column: proposal
created: 2026-07-07T03:43:13+0200
updated: 2026-07-07T03:43:13+0200
current-owner: scenario-runner
approval-tier: 2
priority: 0
severity: HIGH
effort: M
labels: [scenario-improvement, scen-012, scen-013, batch-backlog-20260707]
task-type: bugfix
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_013_20260623T115232Z.md", "reports_dev/scenarios-runner/scenario_proposed-improvements_012_20260623T114625Z.md"]
---

# TRDD-13MZ7EFO — Reconcile registry sessions with live tmux state

## Problem

The registry persists `status: offline, sessions: []` for agents whose tmux session is
live (observed across SCEN-012 and SCEN-013 runs of 2026-06-23: a freshly-created agent
showed "Online — Session: scen013-codex-r17-test" in the UI Overview while
`GET /api/agents/<id>` reported `sessions: []`). Because the lifecycle buttons key off the
registry (`isHibernated = !isOnline && agent.sessions.length > 0`, AgentBadge.tsx:168),
neither "Wake" nor "Hibernate" ever renders in that divergent state — making the R17
wake-gate (the ONLY path that reinstalls a missing core plugin,
`services/agents-core-service.ts` wake-gate ~1895-1978) unreachable from the UI. After a
`pm2 restart`, the inverse divergence occurs: registry-offline with a lingering tmux pane,
where the next `wakeAgent` short-circuits on `runtime.sessionExists` and never reaches the
R17 gate.

## Root cause

`wakeAgent`/`createSession` and the tmux-discovery poller never write discovered sessions
back into the registry `agent.sessions[]`; the UI "Online" badge derives from a live tmux
probe while the persisted registry state (which the lifecycle buttons read) is never
reconciled. There is also no startup reconciliation after a server bounce.
(`services/session-reconcile-service.ts::ensureSessionsJsonBootstrapped` — verified
2026-07-07 — only rebuilds a MISSING sessions.json; it does not reconcile per-agent
`sessions[]` against tmux.)

## Proposed fix

Two coordinated parts:
1. **Reconcile on discovery** — when the `/api/sessions` discovery path finds a live tmux
   session for a registry agent, persist `sessions[0] = { index: 0, status: 'online', workingDirectory }`
   and `status: 'online'`; when a registry-online agent has no tmux session, flip it
   offline. Site: the `/api/sessions` handler + `services/sessions-service.ts` discovery
   reconciliation.
2. **Reconcile on startup** — in `server.mjs` startup (alongside the "[AgentStartup]
   Filtered N stale agent dirs" pass), for each agent: `tmux has-session`; if a pane exists
   but Claude is not running (shell prompt), kill the orphan pane so the next wake creates
   a fresh, R17-gated session (preferred over reusing — a fresh session re-runs the gate).

## Verification

1. Create an agent → `GET /api/agents/<id>` reports `sessions: [{...}]` + `status: online`
   once tmux is live. 2. Hibernate via UI → "Wake Agent" renders → wake →
   `[Wake] R17:` log line fires and the core plugin is reconciled. 3. `pm2 restart` with a
   divergent agent → registry/tmux agree afterwards and a subsequent wake reaches the R17
   gate. 4. SCEN-012 S027-S029 and SCEN-013 Phases 4 & 6 reach PASS instead of
   PARTIAL-by-design.

## Estimated risk

MED — touches the discovery hot path and startup; must not fight the existing
orphan/unregistered-session handling. No dependencies; unlocks TRDD-8HTHE4LA (lifecycle
buttons) and the wake-gate scenarios.

## Approval log
