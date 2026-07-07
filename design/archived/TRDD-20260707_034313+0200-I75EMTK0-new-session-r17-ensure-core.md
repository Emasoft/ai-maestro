---
trdd-id: I75EMTK0
title: Make the New Session path run the R17 core-plugin self-heal (ensureCorePluginInstalled)
column: complete
created: 2026-07-07T03:43:13+0200
updated: 2026-07-07T15:48:02+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: HIGH
effort: M
labels: [scenario-improvement, scen-012, batch-backlog-20260707]
task-type: security
implementation-commits: [c9b77089]
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_012_20260623T114625Z.md"]
---

# TRDD-I75EMTK0 — New Session path must run the R17 core-plugin self-heal

## Problem

The R17 wake-gate (`services/agents-core-service.ts` ~1895-1978) — the only enforcement
path that reinstalls a missing/disabled core plugin — fires exclusively inside `wakeAgent`,
and only when no tmux session exists. The dashboard's "New Session" button
(`components/AgentProfile.tsx` `handleNewSession`) does NOT call `wakeAgent`: it injects a
`claude` launch command into the existing tmux pane. A user whose core plugin is
disabled/removed/corrupted who clicks "New Session" launches a Claude instance with no
ai-maestro-plugin hooks — AI Maestro is blind and R17 never self-heals. Observed live in
SCEN-012 S029 (2026-06-23). Verified 2026-07-07: no `ensureCorePluginInstalled` helper
exists in the codebase.

## Root cause

Three session-launch surfaces with asymmetric R17 coverage: `wakeAgent` (has the gate),
`createSession` (has defense-in-depth), and "New Session" terminal-injection (has neither —
it reuses the live pane).

## Proposed fix

Extract the R17 presence-check + reinstall block from the wake-gate into an exported
`ensureCorePluginInstalled(agentId, workingDirectory, clientType, authContext)` helper in
`services/agents-core-service.ts`, and call it from (a) the wake-gate, (b) the
`createSession` defense-in-depth path, and (c) a thin new strict route
`POST /api/agents/[id]/ensure-core` that `handleNewSession` awaits BEFORE injecting the
launch command into the pane.

## Verification

Disable the core plugin in the agent's `settings.local.json` → click "New Session" →
assert the relaunched Claude has the plugin re-enabled AND its hooks fire (a `[hook]`
state update reaches `/api/sessions/activity`).

## Estimated risk

MED — refactors a live enforcement block into a shared helper; the new route must be
classified in security-registry.json (interacts with TRDD-RF122HBJ's template guard).

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
- 2026-07-07T15:11:42+0200 — IMPLEMENTED (wave W4): extracted ensureCorePluginInstalled() in agents-core-service.ts, wired into wakeAgent, sessions-service.ts, and a new strict POST /api/agents/[id]/ensure-core route called from AgentProfile.tsx handleNewSession before command injection; classified in security-registry.json + sudo-guard.ts STRICT_AGENT_RULES.
- 2026-07-07T15:48:02+0200 — COMPLETED (implementation-commits recorded); archived per the TRDD lifecycle.
