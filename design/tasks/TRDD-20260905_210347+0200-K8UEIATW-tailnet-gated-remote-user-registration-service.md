---
trdd-id: K8UEIATW
title: Tailnet-gated remote USER registration service
column: todo
created: 2026-09-05T21:03:47+0200
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
approval-datetime: 2026-09-05T21:03:47+0200
parent-trdd: 3QRUDK12
derived: true
derived-kind: eht
---

# Tailnet-gated remote USER registration service

## Problem
TRDD-3QRUDK12 (USER ruling, 2026-08-08) mandates: "multiple USER that can connect remotely and register remotely from any device connected to the same tailscale VPN of the ai-maestro" and "any browser from an ip inside the same tailscale VPN can register to ai-maestro and work remotely". No registration service enforcing the tailnet perimeter exists today — this is the foundational prerequisite the rest of the multi-user/ASSISTANT model depends on.
This EHT gates TRDD-3QRUDK12's completion — the parent mandate is not complete until this decomposition item ships.

## Scope
Build the registration service that lets a remote USER self-register from any device on the SAME Tailscale VPN as the ai-maestro host, and REFUSES registration from any origin outside that tailnet. The tailnet boundary IS the registration perimeter per the parent ruling — no exceptions, no fallback to a non-tailnet path. Exactly ONE admin (MAESTRO-USER) stays LOCAL-only registration, unaffected by this service.

## Acceptance
- [ ] Registration endpoint verifies the requesting origin is inside the ai-maestro host's own Tailscale VPN before accepting a new remote USER
- [ ] A registration attempt from outside the tailnet is refused, with the refusal reason recorded
- [ ] MAESTRO-USER's existing local-only registration path is untouched by this service

## Approval log

- 2026-09-05T21:03:47+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
