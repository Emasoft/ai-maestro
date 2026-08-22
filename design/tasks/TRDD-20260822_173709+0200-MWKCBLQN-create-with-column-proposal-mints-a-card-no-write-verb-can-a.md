---
trdd-id: MWKCBLQN
title: create with column proposal mints a card no write verb can act on
column: todo
created: 2026-08-22T17:37:09+0200
updated: 2026-08-22T17:37:09+0200
current-owner: user
created-by: user
task-type: bugfix
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T17:37:09+0200
---

# create with column proposal mints a card no write verb can act on

## Problem
`aimaestro-trdd.sh create --column proposal --min-approval user` (owner authority) writes
`column: proposal` into `design/tasks/`. Zone routing keys on the caller's VERIFIED AUTHORITY; the
column keys on the FLAG; nothing reconciles them.

Measured 2026-08-22 (TRDD-798OAHMX e2e): card `W7B0TC9B` was created that way, `trddgrep validate`
reported `ZONE-MISMATCH` immediately, and `refuse` then returned
`HTTP 409 — Only a proposal can be refused; W7B0TC9B is in tasks` because the write verbs key on
ZONE. The card was inert: invalid to the linter, unreachable by every verb. Only a manual `git mv`
recovered it.

## Proposed fix
Reconcile at the create route: either derive the column from the resolved zone, or refuse a
`--column` that contradicts the zone the authority selects. Silently honouring both is what mints
the unreachable state.

## Verification
Create with `--column proposal` at owner authority; the card must be actionable by `refuse`
without a manual move, and `trddgrep validate` must report no ZONE-MISMATCH.

## Approval log

## Approval log

- 2026-08-22T17:37:09+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
