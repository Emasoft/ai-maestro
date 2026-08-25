---
trdd-id: ACA7013M
title: Decide and apply the auth policy for the GET role-plugins status and governance reachable info-leak endpoints
column: backburner
created: 2026-08-25T18:17:40+0200
updated: 2026-08-25T18:17:40+0200
current-owner: user
created-by: user
task-type: security
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-25T18:17:40+0200
parent-trdd: 47A35BA2
---

# Decide and apply the auth policy for the GET role-plugins status and governance reachable info-leak endpoints

## Problem (extracted live item (a) of parent TRDD-47A35BA2 — quoted for self-containment)

Parent §B item (a): the GET role-plugins-status and governance-reachable endpoints are
un-authed within the IP filter and leak roster + paths.

## The task

Auth'ing a GET info endpoint is a POLICY decision, not pure drift — decide the policy, then
apply it to both endpoints.

## Acceptance

- [ ] Policy decision recorded in this card.
- [ ] Both GETs conform to it (test or curl evidence attached).

## Approval log

- 2026-08-25T18:17:40+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
