---
trdd-id: P9H0Q7SZ
title: USER-escalation script verb with acknowledgment state
column: todo
created: 2026-08-19T14:01:56+0200
updated: 2026-08-19T14:01:56+0200
implementation-commits: []
current-owner: hub-session-brrjk57p-phase2
created-by: hub-session-brrjk57p-phase2
assignee: hub-session-brrjk57p-phase2
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
priority: 2
project-id: ai-maestro
labels: [scripts-spec-needs, decoupling-layer, autonomous, escalation]
external-refs: [TRDD-1R72424K, AUTONOMOUS reply 2026-08-19 (BRRJK57P ledger)]
---

# USER-escalation script verb with acknowledgment state

## Problem (spec-first — requested by ai-maestro-autonomous-agent, 2026-08-19)

The AUTONOMOUS Tier-3 workflow (solo project, no MANAGER) must reach the USER for
golden-rule changes, irreversible ops, credential issues — and the loop must KNOW whether
the USER saw it. Today the spec offers only `aimaestro-hook.sh notify` (dashboard activity
line, no ack) and `aimaestro-groups.sh notify` (agent-to-agent). TRDD-1R72424K records the
inverse gap ("a non-maestro user has no channel to me at all").

## Proposed shape (to refine at design)

`aimaestro-agent.sh escalate-user --message M --priority P [--needs-ack]` plus an
ack-status poll verb (`escalation-status <id>`). Server side: escalation record + dashboard
surfacing + ack write when the USER views/acks; script side: two verbs, AID-authenticated.
Spec regenerates via gen-specs.mjs after implementation; the spec EDIT precedes coding.

## Acceptance

- [ ] spec section drafted first (usage block in the script header) and reviewed against
      the autonomous plugin's escalation workflow
- [ ] server records escalation + ack; poll verb returns pending/acked with timestamps
- [ ] autonomous session confirms the verb serves the Tier-3 loop (their reply ledgered)

## Approval log

- 2026-08-19T14:01:56+0200 — MANDATE under the USER's 2026-08-19 orchestration directive
  ("many plugins needs some specific functionalities... ask them, implement them, create
  the scripts and update the specs"). Queued at todo; spec-first at design.
