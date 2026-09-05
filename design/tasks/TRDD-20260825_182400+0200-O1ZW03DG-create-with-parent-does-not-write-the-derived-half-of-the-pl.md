---
trdd-id: O1ZW03DG
title: create with parent does not write the derived half of the platelet invariant
column: dev
created: 2026-08-25T18:24:00+0200
updated: 2026-09-05T17:51:13+0200
current-owner: user
created-by: user
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-25T18:24:00+0200
assignee: ai-maestro-hub-session
---

# create with parent does not write the derived half of the platelet invariant

## Problem

`aimaestro-trdd.sh create --parent <id>` (server route /api/trdd/create) writes `parent-trdd:`
on the child but NOT the derived half of the platelet invariant: `derived: true` +
`derived-kind: npt|eht`. Measured 2026-08-25 on three real mints (TRDD-0EJKEU2C, ACA7013M,
GA53VW1Q — all `grep -c "^derived:" = 0` at birth); repaired by hand in the same session.
Per aimaestro-trdd-approval.md D4 step 4 the invariant is two-sided; a create that writes only
one side mints orphan-platelet violations BY DEFAULT, and the trdd doctor does not currently
flag them.

## The task

Make create with --parent write `derived: true` and `derived-kind:` (from a new flag or from
which parent list the caller targets), and teach the doctor the two platelet checks so the gap
is detectable.

## Acceptance

- [ ] A create --parent mint carries derived + derived-kind at birth (test).
- [ ] Doctor flags a parent-eht child lacking derived: true (seeded fixture).

## Approval log

- 2026-08-25T18:24:00+0200 — MANDATE issued by user (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-09-05T17:51:12+0200 — backburner → dev by ai-maestro-hub-session (assignee; min-approval none, mandated by user): box 1 is being implemented now (a lean-worker: lib/trdd-create.ts emission, CLI --derived-kind, route passthrough, test); box 2 is already satisfied in the tree — rule DERIVED-FLAG-MISSING at lib/trdd-doctor.ts:1155, asserted at tests/unit/trdd-doctor.test.ts:582 — ticked with the box-1 commit.
