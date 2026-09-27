---
trdd-id: GA53VW1Q
status: archived
title: Replace the status-route user-controlled new RegExp filter with substring or an anchored escaped pattern
column: complete
created: 2026-08-25T18:17:41+0200
updated: 2026-09-27T17:42:48+0200
current-owner: user
created-by: user
task-type: security
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-25T18:17:41+0200
parent-trdd: 47A35BA2
derived: true
derived-kind: eht
assignee: ai-maestro-hub-session
---

# Replace the status-route user-controlled new RegExp filter with substring or an anchored escaped pattern

## Problem (extracted live item (b) of parent TRDD-47A35BA2 — quoted for self-containment)

Parent §B item (b): the status route feeds a user-controlled `filter` into `new RegExp(filter)`
— ReDoS.

## The task

Replace with substring match or an anchored, escaped pattern. Bounded code fix once the
approach is picked; record the choice in this card.

## Acceptance

- [x] Approach recorded (substring vs anchored/escaped) with the reason.
- [x] The route no longer constructs a RegExp from user input (test proves a pathological pattern is inert).

## Approval log

- 2026-08-25T18:17:41+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-27T16:37:20+0200 — column → dev by main-agent@ai-maestro. Picked up under the USER's 2026-09-27 parallel lean-worker directive; mandate pre-approves. Security fix, Tier 0 (in-repo, bounded).
2026-09-27T17:35:00+0200 — Acceptance ticked: approach = case-insensitive SUBSTRING (no pathological input space; commit 1b3fc7ee6 pre-applied it), verified independently by orchestrator (vitest 3/3, tsc 0). Implementation-commits: 1b3fc7ee6 (fix) + next commit (test).
- 2026-09-27T17:42:48+0200 — COMPLETE by main-agent@ai-maestro. Both boxes ticked; fix pre-landed (1b3fc7ee6), test pinned and independently verified.
