---
trdd-id: ADM0CHTJ
title: A non-numeric sessionTtlDays in the security config yields sessions that never expire
column: backburner
status: tasked
created: 2026-10-07T08:41:44+0200
updated: 2026-10-07T09:26:18+0200
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
implementation-commits: [cf72b4e54, b4e68b306, a93e97285]
---

# A non-numeric sessionTtlDays in the security config yields sessions that never expire

lib/security-config.ts deepMerges the stored config over DEFAULTS (sessionTtlDays: 7) and clampConfig clamps sessionTtlDays to 1-90 only when typeof value === 'number'. A non-numeric value written directly into the encrypted config file (not through PATCH /api/settings/security, which validates with Zod) survives both, and lib/session-auth.ts sessionLifetimeMs() (since 5add9f527) then multiplies it into a NaN expires_at; a comparison against NaN is always false, so the session never expires. Fix: on load, replace a non-number sessionTtlDays (and sudoTokenTtlSeconds) with the default before clamping, or fail loudly; test with a config whose value is a string.

## Approval log

- 2026-10-07T08:41:44+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.

## Notes

- 2026-10-07T08:42:37+0200 — also check an explicit null/undefined value: how deepMerge treats it was not read; a null overriding the default would give 0 ms, a session that expires immediately (fails closed, but blocks login).
- 2026-10-07: FIXED in cf72b4e54 (non-finite numeric fields), b4e68b306 and a93e97285 (a section that is not a plain object now loads its defaults; the section list is derived from DEFAULTS, so keyRotation, argon2 and ibct are covered too). Full suite 615 files / 8159 passed, eslint 0, on a93e97285.
- 2026-10-07: falling back to defaults instead of refusing to unlock is deliberate: an unloadable config locks the owner out. The config file key is HKDF over the password and never reads the argon2 section; lib/argon2.ts already falls back to the same defaults per field.
- 2026-10-07: STILL OPEN (do not close this card on the commits above): (1) the fallback is a console warning only, not a security-ledger entry; (2) a wrong-typed NON-numeric field inside a valid section still passes through; (3) whether the PATCH Zod schema rejects a non-object section was not read; (4) only the keyRotation case of the every-section test was shown red under a neuter, the warning assertions and the empty-object test were not.
