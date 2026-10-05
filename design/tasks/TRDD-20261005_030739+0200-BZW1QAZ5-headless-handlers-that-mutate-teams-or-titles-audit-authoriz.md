---
trdd-id: BZW1QAZ5
title: Headless handlers that mutate teams or titles — audit authorization against their full-mode twins
column: todo
status: tasked
created: 2026-10-05T03:07:39+0200
updated: 2026-10-05T03:25:37+0200
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
relevant: [TRDD-A50RC5G8]
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
- [x] AUDIT DONE (read-only, by a worker; static reading, nothing executed; report under reports/bzw1qaz5/, headless-authorization-audit): 254 routes, 150 mutating handlers, all 150 classified — 39 gated-equal, 51 gated-in-service, 34 WEAKER than their full-mode twin, 23 authentication-only in BOTH modes, 3 not established. Coverage cross-checked by two counts and a script (per worker)
- [ ] WEAKER, highest first (each traced by static reading, not executed; a worker is re-verifying and fixing in services/headless-router.ts): W1 config/deploy — any agent writes hooks / MCP servers / launch args into ANY agent (twin: authorize modify-agent); W3 POST /api/agents — any agent creates and spawns an agent (twin: create-agent); W4 cemetery list + download — any agent downloads deleted agents' archives incl. keys (twin: owner only); W5 agents/import — no check at all (twin: owner only); W6 governance trust add/remove — password only (twin: owner + password); W9 any agent reads any mailbox; W7 a dozen owner-only or MANAGER-only mutations with no check; W8 login has no rate limit in headless
- [ ] W2 PATCH /api/agents/:id/session: the authorization ACTION is read from the request body, so a MANAGER/COS can pick a weaker action and type into another agent's terminal — the act R42 revokes. Fix in services/agents-core-service.ts (a second worker)
- [ ] CROSS-CUTTING, not being fixed in this round: headless handlers skip the write-block / lockdown / kill-switch checks that full-mode route guards run first; headless has no sudo layer, so a stolen owner session cookie suffices for strict operations; several hand-built contexts read 'no agent id' as system owner and several services rebuild the auth result without the user id (re-opening the non-owner-user hole when the user-authority model is on); 23 handlers are authentication-only in BOTH modes
- [ ] The ledger test asserts only that an authentication call is present; add a test that fails when a mutating handler authenticates without authorizing

## Approval log

## Approval log

- 2026-10-05T03:07:39+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
