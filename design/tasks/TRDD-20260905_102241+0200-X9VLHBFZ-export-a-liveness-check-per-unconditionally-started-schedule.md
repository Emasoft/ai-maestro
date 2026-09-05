---
trdd-id: X9VLHBFZ
title: Export a liveness check per unconditionally-started scheduler so cache-prune, fleet-plugins-update and github-config-audit can be published to the janitor
column: todo
created: 2026-09-05T10:22:41+0200
updated: 2026-09-05T11:19:25+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
task-type: infra
min-approval-requirement: none
assignee: ai-maestro-hub-session
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-09-05T10:22:41+0200
implementation-commits: [2fb4ef1c]
---

# Export a liveness check per unconditionally-started scheduler so cache-prune, fleet-plugins-update and github-config-audit can be published to the janitor

dc133c04 made server-liveness.ts publish exact janitor chore names, each gated by a predicate proving the chore is live. Three chores were deliberately LEFT UNPUBLISHED because their schedulers start unconditionally in server.mjs with no exported is-it-running check: cache-prune, fleet-plugins-update, github-config-audit. Publishing them on faith would make the janitor daemon yield a chore this process might not be running. Promised on ai-maestro#126 (comment 5550538147). Do: export one boolean per scheduler (the pattern isAbsorbedDutySchedulerRunning already uses in services/auto-update-service.ts), wire each into currentCapabilities, extend tests/unit/server-liveness.test.ts with all-false → absent and each-true → present, neuter one. Acceptance: - [ ] cache-prune has an exported liveness check and is published when live - [ ] fleet-plugins-update likewise - [ ] github-config-audit likewise - [ ] live server-liveness.json shows all three after a restart with each scheduler running - [ ] ai-maestro#126 updated to say the three are now published

## Approval log

- 2026-09-05T10:22:41+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
