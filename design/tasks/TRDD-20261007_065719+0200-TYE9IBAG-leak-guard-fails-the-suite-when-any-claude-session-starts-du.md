---
trdd-id: TYE9IBAG
title: Leak guard fails the suite when any Claude session starts during a test run
column: backburner
status: tasked
created: 2026-10-07T06:57:19+0200
updated: 2026-10-07T06:57:19+0200
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
approval-datetime: 2026-10-07T06:57:19+0200
---

# Leak guard fails the suite when any Claude session starts during a test run

tests/helpers/real-state-roots.ts flags every NEW entry in the real ~/.aimaestro after the suite. It exempts statusline-state/ only for non-.json names, so a Claude session that starts anywhere on the machine during a run writes statusline-state/<session-id>.json via the live server and fails the suite with exit 1 although every test passed. Observed 2026-10-07: run started 06:47:30, a Reminzer-project session's first transcript record is 06:48:08, the guard flagged statusline-state/497a27b4-6784-43c6-9bf0-d822b6a42ad8.json. Fix must keep the guard able to catch a real test leak into statusline-state/ (e.g. exempt a .json only when its name is the id of a live ~/.claude/projects/*/<id>.jsonl transcript), never delete the guard.

## Approval log

- 2026-10-07T06:57:19+0200 — MANDATE issued by main-agent@ai-maestro (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
