---
trdd-id: YRZXUBW8
title: Arm or permanently decline the cold-cache-clear lane (AIM_COLD_CACHE_CLEAR is read and set nowhere)
column: proposal
created: 2026-09-05T09:52:56+0200
updated: 2026-09-05T09:52:56+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: infra
min-approval-requirement: user
assignee: ai-maestro-hub-session
approved: false
---

# Arm or permanently decline the cold-cache-clear lane (AIM_COLD_CACHE_CLEAR is read and set nowhere)

GitHub ai-maestro#157 (from the janitor): both ends of the absorbed cold-cache-clear lane shipped and it never fires. Measured 2026-09-05: the lane is in CONDITIONAL_CHORES (lib/janitor-chore-stamp.ts:97, 'DESTRUCTIVE, ships default-OFF behind its own flag'); AIM_COLD_CACHE_CLEAR=1 is read at lib/cold-cache-clear.ts:148 and is set in no ecosystem/env file (0 hits). That is by design, not a defect: the same shape as TRDD-6YNBQ11J for rules-cleanup. The OWNER decides: (a) ARM it -- add AIM_COLD_CACHE_CLEAR=1 to ecosystem.config.js, pm2 restart --update-env, then verify the lane's log line and that the janitor yields the chore (server-liveness.json must then publish cold-cache-clear); or (b) DECLINE permanently -- record the decision here, answer #157, and leave the daemon owning the chore. Until decided the janitor correctly keeps it. Acceptance: - [ ] owner rules ARM or DECLINE, reason recorded here - [ ] if ARM: env set, restart done, log line observed, liveness publishes the chore - [ ] ai-maestro#157 answered with the decision

## Approval log
