---
trdd-id: BZW1QAZ5
title: Headless handlers that mutate teams or titles — audit authorization against their full-mode twins
column: todo
status: tasked
created: 2026-10-05T03:07:39+0200
updated: 2026-10-05T03:07:39+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: security
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-05T03:07:39+0200
---

# Headless handlers that mutate teams or titles — audit authorization against their full-mode twins

## Problem

Split out of TRDD-A50RC5G8 (2026-10-05). The headless router re-implements routes and has no sudo layer. tests/unit/headless-handler-auth-ledger.test.ts keeps a list of handlers with no per-handler check; per worker, that ledger measures the presence of authentication only, not authorization. The chief-of-staff route was password-only until f53b8a1f6. The audit of the OTHER handlers that write team membership, chair or orchestrator slots, or agent titles was started and not completed.

Read by the orchestrator: PUT /api/teams/:id/orchestrator requires the MANAGER or that team's chief of staff for agent callers.

Related, already on record: headless DELETE /api/agents/:id has no sudo check for a hard delete (A50RC5G8).

## Proposed fix

For each mutating headless handler, quote its gate and compare it with the full-mode route it mirrors; fix the ones that are weaker; extend the ledger (or a sibling test) to assert authorization, not only authentication.

## Acceptance

- [ ] Table of every mutating headless handler: gate quoted, full-mode twin's gate quoted, verdict
- [ ] Each weaker handler fixed with a test driven through the real router
- [ ] A test that fails when a mutating headless handler has authentication but no authorization

## Approval log

## Approval log

- 2026-10-05T03:07:39+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
