---
trdd-id: 4ALV5ISB
title: An idle agent never wakes to process an inbound AMP mandate — the fleet delegation chain breaks at the worker
column: proposal
created: 2026-07-23T06:34:43+0200
updated: 2026-07-23T06:34:43+0200
current-owner: scenario-runner
task-type: bugfix
min-approval-requirement: manager
approval-tier: 2
priority: 0
severity: critical
effort: L
labels: [scenario-improvement, scen-031, fleet-continuity, agent-messaging]
relevant-rules: []
external-refs:
  - reports/scenarios-runner/SCEN-031_20260723T033213Z.report.md
  - design/tasks/TRDD-20260716_151613+0200-KCRMSNL7-absorb-janitor-continuity-family-a-server.md
  - design/proposals/TRDD-20260722_231837+0200-F898NXLU-manager-must-create-fleet-and-delegate.md
---

# Idle agent never wakes to process an inbound AMP mandate

> **Canonical mechanism (2026-07-24):** tracked at **ai-maestro#51** (active idle-agent wake) and
> implemented server-side by the terminal-continuity automaton's *idle-with-inbox wake* event —
> [[TRDD-9DYUI97S]] under parent [[TRDD-5CIL7A07]]: the server detects an online-but-idle pane with a
> pending AMP inbox and injects a turn-trigger so the agent drains it. The worker-side half (drain
> the inbox and act on the mandate when woken) routes as a plugin issue (Flock C, [[TRDD-H4L3HHKX]]).

## Problem
SCEN-031 re-run (2026-07-23): with the launch-args fix (TRDD-GZ1KOHNR) live, the MANAGER
persona loaded correctly and the MANAGER autonomously (a) created a `zipsearcher-dev`
(AUTONOMOUS) and `zipsearcher-maint` (MAINTAINER) agent, (b) authored a requirements
TRDD-04HFVTND, created the repo from the template, opened PR #4, and (c) delegated the build
via **two real, well-formed AMP mandate messages** — `manager→zipsearcher-dev` and
`manager→zipsearcher-maint` (subject "Build zipsearcher v1.0.0 - mandate TRDD-04HFVTND"),
then started a persistent Monitor for their replies.

The delegation was correct. But **both worker agents never acted on their mandates.** Over
6+ minutes of observation both sat at the idle `❯` prompt with `📊 0/1.0m` (ZERO tokens
consumed). The AMP messages were delivered to the filesystem inbox
(`~/.agent-messaging/agents/<uuid>/messages/inbox/...`), verified present — but nothing woke
the idle Claude session to READ its inbox and start working. The fleet organizes itself,
then stalls at the first handoff.

## Root cause
Two independent gaps, both confirmed read-only:
1. **No AMP push-notification was injected into the worker panes.** `tmux capture-pane` of
   `zipsearcher-dev` showed no `[MESSAGE] From: ...` banner — the core-plugin notification
   path that should inject an inbox alert into an idle pane did not fire (or fired without
   triggering a turn).
2. **No `[janitor-heartbeat]` cron is armed for ANY of the three agents** — no
   `~/agents/<name>/.claude/scheduled_tasks.json` for the MANAGER or either worker. So there
   is no periodic wake to fire a turn during which the agent would drain its inbox.

AMP local delivery is pure-filesystem (per CLAUDE.md); the recipient needs an out-of-band
nudge (a notification-injected turn, or a heartbeat-fired turn) to notice a new message. With
neither present, an idle recipient is deaf to delegation. This is exactly the "never-stop"
substrate the scenario's S005/S015 require, and it is not delivering.

## Proposed fix
- Guarantee that an inbound AMP message to an idle, online agent triggers a **turn** (not just
  a passive banner). The core-plugin's message-notification hook must inject a prompt that
  causes the agent to check and process its inbox (an actual keystroke+Enter into the pane, or
  a server-side session `inject` of an inbox-check instruction), gated on the recipient being at
  a safe idle prompt.
- Ensure the janitor heartbeat cron **arms automatically on first wake** for every
  server-created agent (it did not arm here for MANAGER or workers). This is the periodic
  backstop that drains the inbox even if a single notification is missed. Track under the
  KCRMSNL7 continuity-daemon work.
- Files to investigate: the AMP notification path (core-plugin `ai-maestro-hook.cjs` →
  `aimaestro-hook.sh`), `services/sessions-service.ts` / notification broadcast, and the
  janitor arm-on-wake path.

## Verification
Re-run SCEN-031 to S009: after the MANAGER sends its AMP mandate, the recipient worker must
begin consuming tokens (`📊 > 0`) and its transcript must show it reading its inbox and starting
the build WITHOUT any runner intervention — within one notification cycle or one heartbeat
interval. Confirm a `[janitor-heartbeat]` cron exists in each fresh agent's
`scheduled_tasks.json`.

## Estimated risk
MED. Injecting a turn into an idle pane on message arrival must respect the safe-state gate
(no permission prompt pending, not mid-turn) to avoid corrupting an in-flight session.
Dependencies: KCRMSNL7 (continuity daemon), the core-plugin notification hook.

## Approval log
