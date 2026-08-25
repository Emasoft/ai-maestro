---
trdd-id: GA53VW1Q
title: Replace the status-route user-controlled new RegExp filter with substring or an anchored escaped pattern
column: backburner
created: 2026-08-25T18:17:41+0200
updated: 2026-08-25T18:17:41+0200
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
---

# Replace the status-route user-controlled new RegExp filter with substring or an anchored escaped pattern

## Problem (extracted live item (b) of parent TRDD-47A35BA2 — quoted for self-containment)

Parent §B item (b): the status route feeds a user-controlled `filter` into `new RegExp(filter)`
— ReDoS.

## The task

Replace with substring match or an anchored, escaped pattern. Bounded code fix once the
approach is picked; record the choice in this card.

## Acceptance

- [ ] Approach recorded (substring vs anchored/escaped) with the reason.
- [ ] The route no longer constructs a RegExp from user input (test proves a pathological pattern is inert).

## Approval log

- 2026-08-25T18:17:41+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
