---
trdd-id: EHMGLMTN
title: Migrate the 3-pillars corpus to the canonical scope layout
column: backburner
created: 2026-09-13T02:34:29+0200
updated: 2026-09-13T02:34:29+0200
current-owner: ai-maestro-0a
created-by: ai-maestro-0a
task-type: refactor
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: ai-maestro-0a
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-0a
approval-datetime: 2026-09-13T02:34:29+0200
---

# Migrate the 3-pillars corpus to the canonical scope layout

GitHub issue 163, an owner directive. Six steps in the approved plan. The tools resolve only a design-dir flag defaulting to cwd/design, repeated at eight sites. lib/trdd-create.ts:39-48 collisionRoots is the one function that knows all three scopes, for id-uniqueness only, and its two non-project paths are the old ones. Two caches key on the corpus path and neither migrates - corpusKeyFor at lib/pillar/index-db.ts:275-291 hashes the realpath and defaultKanbanIndexPath at lib/kanban-index.ts:211-213 hashes a resolved path - so a moved root silently orphans its index and starts an empty one, and cards vanish from the board with no error.

## Approval log

- 2026-09-13T02:34:29+0200 — MANDATE issued by ai-maestro-0a (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
