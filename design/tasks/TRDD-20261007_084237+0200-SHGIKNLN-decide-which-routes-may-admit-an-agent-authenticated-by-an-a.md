---
trdd-id: SHGIKNLN
title: Decide which routes may admit an agent authenticated by an AMP key alone
column: backburner
status: tasked
created: 2026-10-07T08:42:37+0200
updated: 2026-10-07T08:42:37+0200
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
approval-datetime: 2026-10-07T08:42:37+0200
---

# Decide which routes may admit an agent authenticated by an AMP key alone

From the credential spec (CRED-GAP-07, CRED-UNV-07): lib/aid-token.ts describes AMP keys as the message-routing credential and aim_tk_ as the governance one, but authenticateAgent accepts an AMP key on every route that uses it and yields an agentId with no governance title. Which actions then admit an untitled agent was not traced. Task: list every route reachable with an AMP key alone, check what lib/authorization.ts authorize returns for an untitled agent on each, and restrict governance-mutating routes to aim_tk_ where the AMP key was never meant to reach them; test the refusals.

## Approval log

- 2026-10-07T08:42:37+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
