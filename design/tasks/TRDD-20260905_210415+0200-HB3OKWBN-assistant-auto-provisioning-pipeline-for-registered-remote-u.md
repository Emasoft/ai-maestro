---
trdd-id: HB3OKWBN
title: ASSISTANT auto-provisioning pipeline for registered remote USERs
column: todo
created: 2026-09-05T21:04:15+0200
updated: 2026-09-05T21:07:19+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: feature
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-05T21:04:15+0200
parent-trdd: 3QRUDK12
derived: true
derived-kind: eht
---

# ASSISTANT auto-provisioning pipeline for registered remote USERs

## Problem
TRDD-3QRUDK12 mandates: "Each remote USER gets a dedicated agent, titled ASSISTANT, created to respond ONLY to that USER (this is the auto-provisioning #39 AC4 describes)". This resolves the open half of ai-maestro#39 AC4 — auto-provisioning does not exist yet.
This EHT gates TRDD-3QRUDK12's completion — the parent mandate is not complete until this decomposition item ships.

## Scope
Build the pipeline that, on successful registration (TRDD-K8UEIATW) and session establishment (TRDD-Y894NLRQ), automatically provisions exactly ONE ASSISTANT-titled agent bound to that one remote USER. The ASSISTANT must never join a team (permanent constraint, consistent with existing R39.x rules) and must respond only to its own USER.

## Acceptance
- [ ] A successful remote USER registration triggers automatic creation of exactly one ASSISTANT agent scoped to that USER
- [ ] The provisioned ASSISTANT cannot be assigned to any team, at creation or later
- [ ] The ASSISTANT responds only to messages from its own registered USER (not from other USERs or other agents by default)

## Approval log

- 2026-09-05T21:04:15+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
