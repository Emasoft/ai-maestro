---
trdd-id: 3OS166YI
title: Archived zone accepts a terminal card with zero acceptance boxes when it bypasses the move verb
column: todo
created: 2026-08-27T23:02:44+0200
updated: 2026-08-27T23:02:44+0200
current-owner: hub-claude
created-by: hub-claude
task-type: bugfix
min-approval-requirement: none
assignee: hub-claude
mandate: true
mandated-by: none
approved: true
approval-judge: hub-claude
approval-datetime: 2026-08-27T23:02:44+0200
---

# Archived zone accepts a terminal card with zero acceptance boxes when it bypasses the move verb

## Problem
39OPYXQ9 went terminal on 2026-08-26 via a direct git mv, bypassing the archive-route checklist gate P6MSMQ2I built into trddgrep move. trddgrep validate now reports TERMINAL-WITHOUT-CHECKLIST on it. The gate holds for its own route only; the corpus-wide invariant (a terminal card carries >=1 acceptance box, all ticked) is not enforced anywhere a hand-mv can reach.

## Proposed fix
Lint the archived zone: trddgrep validate (or the doctor) flags a terminal card with 0 boxes as an ERROR, not a warning, and yarn trdd:doctor refuses to report clean while one exists. Do not repair 39OPYXQ9 itself (frozen, rule 12) — the finding is the invariant, not the card.

## Acceptance
- [ ] a seeded terminal card with 0 boxes in archived/ produces an ERROR-level finding
- [ ] neuter recorded: removing the check turns the seeded case green
- [ ] the live corpus finding on 39OPYXQ9 is reported, not auto-fixed

## Approval log

- 2026-08-27T23:02:44+0200 — MANDATE issued by hub-claude (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
