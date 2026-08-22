---
trdd-id: 06G43RK2
title: approval provenance has a blind spot where a review verdict is the authority
column: todo
created: 2026-08-22T17:42:47+0200
updated: 2026-08-22T17:42:47+0200
current-owner: user
created-by: user
task-type: security
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T17:42:47+0200
---

# approval provenance has a blind spot where a review verdict is the authority

## Problem
`aimaestro-trdd.sh verify` exists to answer *"is this card's approval REAL? — the host-signed,
ledger-anchored token pinned to it, not the (forgeable) prose in the file."* It cannot answer that
for any card whose authority is a **review verdict** rather than a proposal `approve`.

Measured 2026-08-22, with a control so the instrument is not in doubt:

| card | how it reached terminal | `verify` |
|---|---|---|
| `8I0JUCK9` | `approve` | **exit 0 — VERIFIED**, `approved by system-owner (user)` |
| `K2WJH7RF` | `promote` + `archive` | **exit 2 — UNVERIFIED**, "approval is prose only" |

Only `approve` mints an `approvalToken` (its response carries `approvalToken` + `verifiable: true`).
`promote` and `archive` execute server-side and move the zone correctly, but anchor NOTHING. So a
card closed on a `human_review -> complete` verdict is unverifiable no matter how it is closed —
by hand or through the verbs. There is no verb that can anchor a review verdict.

This matters because the two authorities are not interchangeable. A proposal `approve` says "this
work is authorized"; a review verdict says "this work is DONE and correct". The second is the one
that ends a card, and it is the one with no provenance. Anyone with repo write can type an
`## Approval log` line claiming a human review happened.

## Proposed fix
Either (a) let `promote` mint a verdict token when the transition is into a terminal column or out
of `human_review`, so `verify` can distinguish a reviewed close from a typed one; or (b) state
explicitly in the spec that `verify` covers the PROPOSAL gate only, and stop `verify`'s output
implying a card is suspect when it simply was not closed by that gate.

Do not do neither. Today `verify` reports UNVERIFIED for correctly-closed cards, which trains
readers to ignore it — the classic path to a guard nobody believes.

## Verification
Close a card through a review verdict; `verify` either returns 0 with a verdict token naming the
reviewer, or returns a distinct status meaning "not applicable — no proposal gate", never a bare
UNVERIFIED that reads as a failure.

## Approval log

## Approval log

- 2026-08-22T17:42:47+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
