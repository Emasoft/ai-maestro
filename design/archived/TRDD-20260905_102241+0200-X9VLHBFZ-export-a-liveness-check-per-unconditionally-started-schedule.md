---
trdd-id: X9VLHBFZ
title: Export a liveness check per unconditionally-started scheduler so cache-prune, fleet-plugins-update and github-config-audit can be published to the janitor
column: complete
created: 2026-09-05T10:22:41+0200
updated: 2026-09-05T11:20:53+0200
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

dc133c04 made server-liveness.ts publish exact janitor chore names, each gated by a predicate proving the chore is live. Three chores were deliberately LEFT UNPUBLISHED because their schedulers start unconditionally in server.mjs with no exported is-it-running check: cache-prune, fleet-plugins-update, github-config-audit. Publishing them on faith would make the janitor daemon yield a chore this process might not be running. Promised on ai-maestro#126 (comment 5550538147).

## Plan

Export one boolean per scheduler (the pattern isAbsorbedDutySchedulerRunning already uses in services/auto-update-service.ts), wire each into currentCapabilities, extend tests/unit/server-liveness.test.ts with all-false → absent and each-true → present, neuter one. Drop the legacy `family-a` alias in the SAME change that publishes the three names (dropping it earlier would un-claim github-config-audit, which only the alias was claiming).

## Acceptance

- [x] cache-prune has an exported liveness check and is published when live
- [x] fleet-plugins-update likewise
- [x] github-config-audit likewise
- [x] live server-liveness.json shows all three after a restart with each scheduler running
- [x] ai-maestro#126 updated to say the three are now published

## Approval log

- 2026-09-05T10:22:41+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T11:20:53+0200 — COMPLETE by manager. Landed in 2fb4ef1c and DEPLOYED 2026-09-05 11:17 (build + pm2 restart --update-env in one gated sequence; the beat's sha field is the deployment proof for this change because every touched file is a runtime lib/*.ts import, not a .next bundle). Live file measured on the managed child pid 24895 (parent = pm2's tsx wrapper 24806): beat 1 lacks the three names by construction (server.mjs starts the liveness beat at :2017 before the schedulers at :2073/:2089/:2126) and also lacks memory-guard/fleet-stop for the same reason; beats 2 and 3 carry cache-prune, fleet-plugins-update, github-config-audit, memory-guard, fleet-stop and the four prior names; family-a absent. #126 updated (comment 5550840801) with the beat-1 ordering caveat and the marketplace-refresh/version-update conditional caveat. Daemon evidence: daemon.log 09:45:43 yields exactly the five family-a chores, not these two; the daemon ran cache-prune 03:51 and fleet-plugins-update 05:50 while the server was DOWN (pm2 log has no lines 00:00-09:00), so 'ran them beside us' in 2fb4ef1c's message is the yield set's implication, not a measured concurrent run. Verified first-hand: tsc 0, server-liveness 23/23; the worker's default-wiring neuter (its report, not mine) reddened the two non-vacuity tests. Nothing pins that each predicate flips false when its stop fn runs — unpinned. e14d2b52 said 'close' but the move had refused (no checklist; the body was one line from trddgrep new --body) — this transition is the real close. Authorization: USER /goal 2026-09-05 'complete all TRDD and pending tasks'..
