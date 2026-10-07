---
trdd-id: ADYYHLIC
title: Server-created mandates carry no mandate-token so verify cannot confirm them
column: backburner
status: tasked
created: 2026-10-07T07:27:51+0200
updated: 2026-10-07T08:53:55+0200
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
approval-datetime: 2026-10-07T07:27:51+0200
---

# Server-created mandates carry no mandate-token so verify cannot confirm them

lib/trdd-create.ts writes mandate: true / approved: true / approval-judge for a mandate (around line 353) but no create path calls mintTrddDecisionToken; only app/api/trdd/[id]/approve/route.ts does. verifyTrddDecision (lib/trdd-approval-token.ts) returns verified:false for any card whose min-approval-requirement is above none and has no approval-token/mandate-token, so every legitimate server-issued mandate reports UNVERIFIED. The approval overlay was qualified in the same session to say so (rules/aimaestro/aimaestro-trdd-approval.md). Fix: mint a mandate token inside the create critical section once authority is established, write it as mandate-token:, and degrade honestly (no token, still created) when the audit ledger is unavailable, mirroring approve. Then drop the qualification from the overlay.

## Approval log

- 2026-10-07T07:27:51+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.

## Notes

- 2026-10-07T08:53:51+0200 — owner delegated ("decide yourself on the others"); main-agent@ai-maestro chose option 3: mint the mandate token so verify can prove a mandate, then drop the interim stop-and-confirm wording in rules/aimaestro/aimaestro-trdd-approval.md, which deadlocks team agents (confirmation must route through the chief-of-staff).
