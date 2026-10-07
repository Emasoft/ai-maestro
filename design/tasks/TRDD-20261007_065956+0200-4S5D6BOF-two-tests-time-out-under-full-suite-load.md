---
trdd-id: 4S5D6BOF
title: Two tests time out under full-suite load
column: backburner
status: tasked
created: 2026-10-07T06:59:56+0200
updated: 2026-10-07T06:59:56+0200
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
approval-datetime: 2026-10-07T06:59:56+0200
---

# Two tests time out under full-suite load

Under full-suite load (load average 50-80 on 14 cores) two tests time out while passing alone: tests/unit/statusline-cli.test.ts (the no-hosts.json base-resolution case exceeds the 30 s test timeout) and tests/unit/teams-stats-verb.test.ts (calls the real running server through the real CLI; its request times out at 30 s). Seen on 2026-10-07 in two of several full runs. Each needs its own cause found and fixed; raising timeouts alone is not a fix.

## Approval log

- 2026-10-07T06:59:56+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
