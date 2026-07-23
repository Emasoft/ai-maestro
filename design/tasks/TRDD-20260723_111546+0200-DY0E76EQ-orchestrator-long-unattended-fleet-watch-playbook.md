---
trdd-id: DY0E76EQ
title: Orchestrator playbook for long unattended fleet watches — event-driven monitors, burn-guard-first, terse status
column: planned
created: 2026-07-23T11:15:46+0200
updated: 2026-07-23T11:15:46+0200
current-owner: session
task-type: docs
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-23T11:15:46+0200
relevant-rules: []
eht: []
npt: []
implementation-commits: []
external-refs:
  - reports/fleet-evaluation/20260723_110953+0200-scen031-fleet-behaviour-eval.md
  - ~/.claude/rules/token-economy-agents-and-scenarios.md
---

## Problem (orchestrator self-assessment during the SCEN-031 watch)
While stewarding the multi-hour SCEN-031 ship, I (the orchestrating session) made avoidable
token/process mistakes the USER explicitly cares about: (1) I OVER-POLLED the fleet on early janitor
heartbeats — several turns of detailed registry/pane/PR checks that each re-billed my large persistent
context; (2) I armed the AgentLensPro burn guard AFTER the first fan-out, though the skill says arm it
BEFORE; (3) I wrote verbose `/distill` status blocks each turn (each re-billed context); (4) I
over-deliberated the launch decision. Corrected mid-run, but the pattern should be captured so the next
long watch starts right.

## Proposed fix (a documented playbook — docs/ or a short rule)
Write "Orchestrating a long unattended fleet watch" capturing:
1. **Turn 1: set up event-driven monitors** (a ship-progress Monitor that wakes on milestones/failures,
   a burn guard) — NEVER poll the fleet on every heartbeat; heartbeats run the stub + a one-line reply.
2. **Arm the burn guard BEFORE any fan-out** (`agentlenspro --guard`, FILTERED to the real stop-signals:
   CACHE_THRASH + server-health), and cover the week-window via deliberate `get_window_eta` checks at
   checkpoints — NOT per-burst token-count alerts (which false-trip on other projects' cache-reads).
3. **Keep the persistent session lean**: fork UI-heavy work to sub-runners; keep status TERSE (the long
   session re-bills its context every turn).
4. **Gate on COST, not token-count**: `get_window_eta` (cost-based) is the authoritative week-window
   check; the token-based BURN_SPIKE alone is not a stop condition.
5. **Decide faster once the key facts are in** — don't circle a reversible, bounded decision.

## Verification
The playbook exists (docs/ or ~/.claude/rules/) and is referenced by the next long-watch task; a
follow-up long watch shows event-driven monitoring from turn 1 and no per-heartbeat fleet polling.

## Estimated risk
LOW. Documentation of learned discipline.

## Approval log
- 2026-07-23 — MANDATE by USER (improvement series, "you have my trust").
