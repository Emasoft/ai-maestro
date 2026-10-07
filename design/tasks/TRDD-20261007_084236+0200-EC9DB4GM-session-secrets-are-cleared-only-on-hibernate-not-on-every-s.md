---
trdd-id: EC9DB4GM
title: Session secrets are known to be cleared only on hibernate, other stop paths unread
column: backburner
status: tasked
created: 2026-10-07T08:42:36+0200
updated: 2026-10-07T08:43:53+0200
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
approval-datetime: 2026-10-07T08:42:36+0200
---

# Session secrets are known to be cleared only on hibernate, other stop paths unread

From the credential spec (CRED-GAP-02, CRED-UNV-06): the mst_ session secret has no expiry in its validator (lib/session-secret.ts:53-63); its hash is cleared on hibernate (services/agents-core-service.ts:2759) and replaced on the next session build (lib/session-env.ts:131-141). Other stop/kill/restart paths were not read. Task: enumerate every path that ends an agent session and make each clear the session-secret hash in the same operation; test that a secret from a stopped session is refused.

## Approval log

- 2026-10-07T08:42:36+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
