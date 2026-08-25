---
trdd-id: 8CL6EC48
title: Wire the ama-star skill surface into every role plugin's agents — AMAMA F5883DCC item B.2
column: backburner
created: 2026-08-25T18:25:09+0200
updated: 2026-08-25T18:25:09+0200
current-owner: user
created-by: user
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-25T18:25:09+0200
---

# Wire the ama-star skill surface into every role plugin's agents — AMAMA F5883DCC item B.2

## Problem

AMAMA's TRDD-F5883DCC item B.2, routed to the hub on 2026-08-25: core 3.1.33 ships the full
ama-* skill surface and the governance rules are injected host-wide, but each OTHER role
plugin must still wire its own agents (main + sub) to the ama-* skills with its role slice.
Per-repo work across the 8 role-plugin repos; nothing hub-side tracked it until this card.

## The task

Fan out per-repo asks (issue or SendMessage directive per role-plugin session) to wire ama-*
into each plugin's agents, and track completion per repo on this card.

## Acceptance

- [ ] Every predefined role plugin either wired (release cited) or explicitly declined with reason, recorded here.

## Approval log

- 2026-08-25T18:25:09+0200 — MANDATE issued by user (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
