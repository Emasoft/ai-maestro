---
trdd-id: ISGUYYLN
title: trddgrep move out of blocked leaves blocked-by populated
column: todo
created: 2026-08-28T01:56:46+0200
updated: 2026-08-28T01:56:46+0200
current-owner: hub-claude
created-by: hub-claude
task-type: bugfix
min-approval-requirement: none
assignee: hub-claude
mandate: true
mandated-by: none
approved: true
approval-judge: hub-claude
approval-datetime: 2026-08-28T01:56:46+0200
---

# trddgrep move out of blocked leaves blocked-by populated

## Problem
Measured on HNJ3T3W0 (2026-08-27): `trddgrep move HNJ3T3W0 planned` set the column but kept `blocked-by: [TRDD-3Q4G9ZK6]`, producing GRAPH-BLOCKED-NOT-BLOCKED + DANGLING-BLOCKER findings until a separate `trddgrep edit` cleared it (commit 8fdebc91). The verb owns both halves of a transition everywhere else — this is the one place it leaves half.

## Proposed fix
When the source column is `blocked` and the target is not, either clear `blocked-by` or refuse without `--clear-blocker`. Refusing is the safer default when a named blocker is still open; clearing is right when every blocker is terminal.

## Acceptance
- [ ] moving a blocked card whose blockers are ALL terminal clears blocked-by
- [ ] moving a blocked card with an OPEN blocker is refused (exit 2) unless --clear-blocker
- [ ] tests in tests/unit/trddgrep-new-and-move.test.ts cover both, with a recorded neuter

## Approval log

- 2026-08-28T01:56:46+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
