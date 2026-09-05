---
trdd-id: Y894NLRQ
title: Per-USER authentication and session model for remote registrants
column: todo
created: 2026-09-05T21:04:03+0200
updated: 2026-09-05T21:07:18+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: feature
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-05T21:04:03+0200
parent-trdd: 3QRUDK12
derived: true
derived-kind: eht
---

# Per-USER authentication and session model for remote registrants

## Problem
TRDD-3QRUDK12 mandates multiple remote USERs, each with "NO access to host settings — only the settings of its own user/account". No per-USER auth/session model exists to distinguish one remote USER's identity, session, and settings scope from another's or from MAESTRO-USER's.
This EHT gates TRDD-3QRUDK12's completion — the parent mandate is not complete until this decomposition item ships.

## Scope
Design and implement the per-USER identity and session model: each remote USER (post-registration, TRDD-K8UEIATW) gets its own authenticated session, scoped strictly to its own user/account settings. MAESTRO-USER's host-settings access is NOT exposed through this model to any remote USER session.

## Acceptance
- [ ] Each remote USER's session is bound to its own identity, distinct from every other USER and from MAESTRO-USER
- [ ] A remote USER's session can read/write only its own user/account settings, never host settings
- [ ] Session model is the identity substrate the ASSISTANT auto-provisioning pipeline (TRDD parent's other derived card) authenticates against

## Approval log

- 2026-09-05T21:04:03+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
