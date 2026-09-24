---
trdd-id: 6ENR43AP
title: Repair cards whose blocked-by holds commit shas instead of card ids
column: backburner
created: 2026-09-24T10:24:18+0200
updated: 2026-09-24T10:24:42+0200
current-owner: emanuelesabetta
created-by: emanuelesabetta
task-type: bugfix
min-approval-requirement: none
scope: project
project-id: ai-maestro
assignee: emanuelesabetta
mandate: true
mandated-by: none
approved: true
approval-judge: emanuelesabetta
approval-datetime: 2026-09-24T10:24:18+0200
labels: [trdd-hygiene]
---

# Repair cards whose blocked-by holds commit shas instead of card ids

## Approval log

- 2026-09-24T10:24:18+0200 — MANDATE issued by emanuelesabetta (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.

## Problem

Several open cards carry implementation commit shas in blocked-by instead of card ids.
Seen cases: TRDD-7IJ08EUV had blocked-by [8db78d42, 77744dcf]; TRDD-G6EBLBIQ has blocked-by [25e5fc97e, 91b06b30b]; the terminal TRDD-9JUEJFY3 has blocked-by [048476cf].
This breaks the invariant blocked-by non-empty iff column: blocked, and inflates the blocked count on the board.

## Proposed fix

Per card, never scripted: move the sha to implementation-commits, clear blocked-by, and re-derive the correct column for that card.
Add a lint rule that checks blocked-by so a sha-shaped entry (not a TRDD-<id8>) is flagged before it can ship again.

## Acceptance

- [ ] Every open card's blocked-by is scanned for a sha-shaped entry (not TRDD-<id8>).
- [ ] TRDD-7IJ08EUV and TRDD-G6EBLBIQ repaired: shas moved to implementation-commits, blocked-by cleared, column re-derived per card.
- [ ] A lint rule flags a sha-shaped blocked-by entry, with a named neuter that reddens it.
