---
trdd-id: P6MSMQ2I
title: archive route bypasses the terminal checklist gate
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

# archive route bypasses the terminal checklist gate

## Problem
`POST /api/trdd/[id]/archive --state completed` moves a card with NO acceptance checklist at all
into `archived/completed`. The completion gate — a terminal column requires a checklist that EXISTS
(>=1 box) and is fully ticked — is enforced by the LINTER, not by the route performing the
transition. So the API mints exactly the false completion that gate exists to prevent.

Measured 2026-08-22 (TRDD-798OAHMX e2e): card `G6A54OYK` was archived this way and
`trddgrep validate` now reports a standing `TERMINAL-WITHOUT-CHECKLIST` ERROR against it. That card
is left in place deliberately as the live reproduction; it is terminal and therefore frozen, so it
must not be "repaired" by adding ticked boxes for work nobody did.

## Proposed fix
Enforce the same predicate in the archive route that the linter applies: refuse a terminal
transition when the card carries no acceptance checklist or any unticked box.

## Verification
Archive a checklist-less card via the route; expect a refusal naming the gate, and
`trddgrep validate` clean afterwards.

## Approval log

## Approval log

- 2026-08-22T17:37:09+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
