---
trdd-id: PN9LCNNG
title: The configurable session lifetime is stored and shown but never applied
column: backburner
status: tasked
created: 2026-10-07T08:31:27+0200
updated: 2026-10-07T08:38:16+0200
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
approval-datetime: 2026-10-07T08:31:27+0200
implementation-commits: [5add9f527]
---

# The configurable session lifetime is stored and shown but never applied

sessionAuth.sessionTtlDays is stored and clamped 1-90 (lib/security-config.ts), validated by PATCH /api/settings/security and shown in Settings (components/settings/SecuritySection.tsx), but lib/session-auth.ts imports nothing from the security config and fixes SESSION_LIFETIME_MS = 7 days (:34, used at :120 and :241). A user who shortens the lifetime in Settings gets no effect while the UI says it applied. Fix: read the configured value when minting and when setting the cookie Max-Age; test that a shorter setting yields a shorter expiry. Source: design/specs/credentials-and-auth-spec.md CRED-GAP-04.

## Approval log

- 2026-10-07T08:31:27+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
