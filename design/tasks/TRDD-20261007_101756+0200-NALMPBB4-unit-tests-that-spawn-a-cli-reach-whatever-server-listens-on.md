---
trdd-id: NALMPBB4
title: Unit tests that spawn a CLI reach whatever server listens on port 23000
column: backburner
status: tasked
created: 2026-10-07T10:17:56+0200
updated: 2026-10-07T10:17:56+0200
current-owner: main-agent@ai-maestro
created-by: main-agent@ai-maestro
task-type: bugfix
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: main-agent@ai-maestro
mandate: true
mandated-by: none
approved: true
approval-judge: main-agent@ai-maestro
approval-datetime: 2026-10-07T10:17:56+0200
---

# Unit tests that spawn a CLI reach whatever server listens on port 23000

tests/unit/teams-stats-verb.test.ts spawns the real teams CLI with no API override, so its outcome depends on the developer's running server and its build (the test's own comments say so). On 2026-10-07 during a full-suite run the request to /api/teams/stats timed out after 30 s and the test failed; it passed alone, the server error log shows nothing for that endpoint in that minute, and whether the cause was CPU starvation under 618 test files or a slow endpoint on the running build was not separated. The assertion was widened in 9ec296854 to accept the CLI's timeout line, which keeps the dependency. Task: (1) make the test deterministic by pointing the CLI at a closed port, or at a stub server, (2) find out why the endpoint took over 30 s, (3) check the other tests that spawn a CLI with no API override for the same dependency and for writes to real state. Unverified leads from a grep heuristic, not read: aimaestro-settings-cli, agent-list-status-filter, teams-cli-github-project, trdd-refuse-requires-a-defect, assistant-fs-containment.

## Approval log

- 2026-10-07T10:17:56+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
