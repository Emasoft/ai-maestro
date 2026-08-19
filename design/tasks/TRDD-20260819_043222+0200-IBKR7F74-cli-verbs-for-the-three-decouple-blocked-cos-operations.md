---
trdd-id: IBKR7F74
title: CLI verbs for the three DECOUPLE-BLOCKED COS operations
column: blocked
scope: project
project-id: ai-maestro
created: 2026-08-19T04:32:22+0200
updated: 2026-08-19T04:32:22+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
derived: false
npt: []
eht: []
blocked-by: [K2WJH7RF]
pre-block-column: todo
release-via: none
relevant-rules: []
labels: [cli-surface, decoupling, cos, fleet-reported, owner-ours]
external-refs: [Emasoft/ai-maestro#76]
---
# CLI verbs for the three DECOUPLE-BLOCKED COS operations

## Problem

The COS role-plugin correctly refuses to call the server API directly (the no-direct-API
decoupling rule), which leaves three operations with NO working path for a running COS agent —
marked DECOUPLE-BLOCKED at their `scripts/amcos_team_registry.py:314,596` and
`amcos_approval_manager.py:223` with graceful degradation. Degradation is not a path, and the
USER's harness-readiness goal makes COS responsible for handing teams correctly-configured
agents. Reported by the COS session 2026-08-19 (their card 8E8D6618 closes when these land).

The three missing verbs, as reported and to be validated against the real routes before design:

- (a) **add-agent with status** — `aimaestro-agent.sh create` requires a working directory and
  exposes no `--status`.
- (b) **generic agent-status-set** — hibernate/wake/restart are ACTIONS, not label writes;
  there is no `update-status` verb.
- (c) **password-less status-PATCH for approval sync** — approve/reject are password-gated
  formal endpoints (a DIFFERENT operation, correctly so per R28/R41); the sync write has no
  AID-authorized verb.

## Why blocked

(c), and possibly (b), write agent state through routes governed by the strict-route/sudo model —
exactly the open policy question of TRDD-K2WJH7RF (agent authorization policy for the ten
remaining strict routes, `column: dev`). Shipping an AID-authorized write verb before that policy
lands would pre-decide it from the tool side. (a) is likely policy-free but ships with the set so
the COS repoints once, not three times.

## Acceptance

- [ ] K2WJH7RF's policy names which of (a)/(b)/(c) an agent may perform under AID auth, and this
      card's verb design cites it per operation.
- [ ] The verbs land in the `aimaestro-*` script layer (never a raw API bypass), with `--help`
      exercised through the bare command name on PATH.
- [ ] COS confirms their three DECOUPLE-BLOCKED sites repoint cleanly and 8E8D6618 closes.
