---
trdd-id: 8HTHE4LA
title: Surface Wake and Hibernate lifecycle actions in the profile panel and for offline agents
column: proposal
created: 2026-07-07T03:43:13+0200
updated: 2026-07-07T03:43:13+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: MEDIUM
effort: S
labels: [scenario-improvement, scen-012, scen-013, batch-backlog-20260707]
task-type: feature
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_012_20260623T114625Z.md", "reports_dev/scenarios-runner/scenario_proposed-improvements_013_20260623T115232Z.md"]
---

# TRDD-8HTHE4LA — Wake/Hibernate lifecycle actions in the profile panel

## Problem

Two UI-reachability gaps observed across SCEN-012/SCEN-013 (2026-06-23): (1) an offline
agent (`sessions.length === 0`) renders only "New Session"/"Resume Session" — never a
"Wake" button — so `POST /api/agents/[id]/wake` (the R17-gated path) has no UI entry
point; (2) the ONLY Hibernate affordance is the sidebar AgentBadge `MoreVertical` dropdown
(hover-gated, `AgentBadge.tsx:365`) — the profile-panel kebab offers only "Delete Agent…",
so a user looking at an online agent's profile cannot hibernate it from there.

## Root cause

Lifecycle buttons are derived from registry `sessions[]`/`isOnline` state and were only
ever wired into the sidebar badge dropdown; the profile panel never received the
`onHibernate`/`onWake` handlers.

## Proposed fix

1. `components/AgentProfile.tsx`: when the agent is offline, render a "Wake" button
   calling `POST /api/agents/[id]/wake` (instead of only "New Session").
2. Add "Hibernate" (online) / "Wake" (hibernated) actions to the profile-panel kebab menu,
   reusing the existing handlers passed to AgentBadge.

## Verification

Open an online agent's profile → kebab shows "Hibernate"; hibernate → profile shows
"Wake"; click Wake → `wakeAgent` runs (the `[Wake] R17:` log line appears when the core
plugin was missing).

## Estimated risk

LOW — UI wiring of existing handlers/routes. Depends on TRDD-13MZ7EFO (registry/tmux
reconciliation) for the online/offline derivation to be trustworthy.

## Approval log
