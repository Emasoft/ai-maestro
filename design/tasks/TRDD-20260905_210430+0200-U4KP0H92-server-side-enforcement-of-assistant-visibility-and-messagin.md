---
trdd-id: U4KP0H92
title: Server-side enforcement of ASSISTANT visibility and messaging restrictions
column: todo
created: 2026-09-05T21:04:30+0200
updated: 2026-09-05T21:07:20+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: security
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-05T21:04:30+0200
parent-trdd: 3QRUDK12
derived: true
derived-kind: eht
---

# Server-side enforcement of ASSISTANT visibility and messaging restrictions

## Problem
TRDD-3QRUDK12 mandates: "the ASSISTANT ... cannot even see other agents or message them unless he is approved by the MANAGER as a collaborator to the same project. only in that case it can message the other agents working at the same project, and of course it can always message with the MANAGER." Provisioning an ASSISTANT (TRDD-HB3OKWBN) opens a hole: without server-side enforcement, an ASSISTANT could see or message agents it has no approved collaboration with, relying only on client-side or hook-level restriction.
This EHT gates TRDD-3QRUDK12's completion — the parent mandate is not complete until this decomposition item ships.

## Scope
Implement SERVER-SIDE (not merely hook-based) enforcement of the ASSISTANT visibility/messaging matrix: by default an ASSISTANT sees and messages nobody except the MANAGER; once the MANAGER approves the USER as a project collaborator, the ASSISTANT gains visibility/messaging ONLY to agents working that same project. This closes the hole that auto-provisioning (TRDD-HB3OKWBN) opens — an ASSISTANT must not reach unauthorized agents even if a hook is bypassed.

## Acceptance
- [ ] By default a newly-provisioned ASSISTANT can message only the MANAGER, enforced server-side (not solely by a client-side or hook check)
- [ ] After MANAGER approval of a project collaboration, the ASSISTANT's visibility/messaging server-side check expands to exactly the agents on that one project, no others
- [ ] Revoking the collaboration approval removes the ASSISTANT's server-side visibility/messaging grant for that project

## Approval log

- 2026-09-05T21:04:30+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
