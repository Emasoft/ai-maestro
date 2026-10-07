---
trdd-id: ADM0CHTJ
title: A non-numeric sessionTtlDays in the security config yields sessions that never expire
column: backburner
status: tasked
created: 2026-10-07T08:41:44+0200
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
approval-datetime: 2026-10-07T08:41:44+0200
---

# A non-numeric sessionTtlDays in the security config yields sessions that never expire

lib/security-config.ts deepMerges the stored config over DEFAULTS (sessionTtlDays: 7) and clampConfig clamps sessionTtlDays to 1-90 only when typeof value === 'number'. A non-numeric value written directly into the encrypted config file (not through PATCH /api/settings/security, which validates with Zod) survives both, and lib/session-auth.ts sessionLifetimeMs() (since 5add9f527) then multiplies it into a NaN expires_at; a comparison against NaN is always false, so the session never expires. Fix: on load, replace a non-number sessionTtlDays (and sudoTokenTtlSeconds) with the default before clamping, or fail loudly; test with a config whose value is a string.

## Approval log

- 2026-10-07T08:41:44+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.

## Notes

- 2026-10-07T08:42:37+0200 — also check an explicit null/undefined value: how deepMerge treats it was not read; a null overriding the default would give 0 ms, a session that expires immediately (fails closed, but blocks login).
