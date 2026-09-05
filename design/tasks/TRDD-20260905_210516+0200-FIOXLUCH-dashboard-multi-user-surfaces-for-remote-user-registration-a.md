---
trdd-id: FIOXLUCH
title: Dashboard multi-user surfaces for remote USER registration and ASSISTANT collaboration
column: todo
created: 2026-09-05T21:05:16+0200
updated: 2026-09-05T21:07:22+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: feature
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-05T21:05:16+0200
parent-trdd: 3QRUDK12
derived: true
derived-kind: eht
---

# Dashboard multi-user surfaces for remote USER registration and ASSISTANT collaboration

## Problem
TRDD-3QRUDK12 mandates that a remote USER registers and works entirely through a browser ("any browser from an ip inside the same tailscale VPN can register to ai-maestro and work remotely, giving instructions to its ASSISTANT"), has NO access to host settings, and can "install extensions or configure its own ASSISTANT as he wish" within the stated limits. No dashboard surface exists today for this remote, per-USER experience.
This EHT gates TRDD-3QRUDK12's completion — the parent mandate is not complete until this decomposition item ships.

## Scope
Build the dashboard UI surfaces a registered remote USER needs: the registration flow (against TRDD-K8UEIATW's service), a scoped settings view showing only that USER's own account settings (never host settings, per TRDD-Y894NLRQ's session model), the USER's own ASSISTANT chat/terminal view, and an extension install/configure panel scoped to the USER's own ASSISTANT (excluding the immutable assistant role plugin and required core extensions).

## Acceptance
- [ ] A remote USER can complete registration and reach their own ASSISTANT's chat view entirely through the dashboard, from a browser on the tailnet
- [ ] The USER's settings panel exposes only their own user/account settings — no host-settings controls are rendered or reachable
- [ ] The USER can install/configure extensions on their own ASSISTANT only, and cannot modify the assistant role plugin or required core extensions from this surface

## Approval log

- 2026-09-05T21:05:16+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
