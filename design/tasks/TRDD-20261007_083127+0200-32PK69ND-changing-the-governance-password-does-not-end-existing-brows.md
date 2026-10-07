---
trdd-id: 32PK69ND
title: Changing the governance password does not end existing browser sessions
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

# Changing the governance password does not end existing browser sessions

setPassword (lib/governance.ts:197-212) does not touch sessions, and invalidateAllSessions (lib/session-auth.ts, doc comment at :214-216 naming exactly this use) has NO caller (grep of lib app services server.mjs, 2026-10-07). So after a password change every existing aim_session cookie stays valid until its fixed 7-day lifetime. A user rotating the password because it leaked still leaves the old sessions live. Fix: call invalidateAllSessions from the password-change path (all-in-one: change + invalidate together), keep the caller's current session if that is the documented intent, and test that an old cookie is refused after a change. Source: design/specs/credentials-and-auth-spec.md CRED-GAP-03.

## Approval log

- 2026-10-07T08:31:27+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.

## Notes

- 2026-10-07T08:38:15+0200 — main-agent@ai-maestro: correction to the body — sessions are an in-memory Map (lib/session-auth.ts), so before the fix an old cookie stayed valid until its 7-day lifetime OR the next server restart, not for the full lifetime unconditionally. Fixed in 5add9f527. Open for the owner: a change from Settings now logs out the changer too.
