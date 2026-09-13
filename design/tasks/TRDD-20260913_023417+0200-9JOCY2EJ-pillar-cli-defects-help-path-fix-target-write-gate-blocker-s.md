---
trdd-id: 9JOCY2EJ
title: Pillar CLI defects - help path, fix target, write gate, blocker semantics
column: dev
created: 2026-09-13T02:34:17+0200
updated: 2026-09-13T03:54:39+0200
current-owner: ai-maestro-0a
created-by: ai-maestro-0a
task-type: bugfix
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: ai-maestro-0a
mandate: true
mandated-by: none
approved: true
approval-judge: ai-maestro-0a
approval-datetime: 2026-09-13T02:34:17+0200
implementation-commits: [9c07ffcc2, b16d60e2b, ac94f564b]
---

# Pillar CLI defects - help path, fix target, write gate, blocker semantics

Umbrella for four bounded fixes, each with its own derived card. GitHub issues 159, 160, 161 and 158. Details and file:line references are in the approved plan at nested-sprouting-pelican.md under the claude plans folder. Constraint on every change under lib: never cite a rule id in a comment there; the coverage scanner classifies any rule cited in lib as enforced, and the enforcement-coverage governance test already fails at baseline so a new violation would hide inside an existing red.

## Approval log

- 2026-09-13T02:34:17+0200 — MANDATE issued by ai-maestro-0a (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
