---
trdd-id: 0EJKEU2C
title: Deep-validate non-one-shot bearers at the term connection handler without consuming one-shot AID tokens
column: backburner
created: 2026-08-25T18:17:38+0200
updated: 2026-08-25T18:17:38+0200
current-owner: user
created-by: user
task-type: security
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-25T18:17:38+0200
parent-trdd: 47A35BA2
---

# Deep-validate non-one-shot bearers at the term connection handler without consuming one-shot AID tokens

## Problem (extracted live item SF3 of parent TRDD-47A35BA2 — quoted for self-containment)

Parent §B "SF3 — CONFIRMED REAL (upgraded)": the pre-handshake gate is presence-only BY DESIGN
(one-shot AID tokens must reach their downstream crypto consumer); the `wss.on('connection')`
handler (server.mjs:1089-1283) validates only the session NAME — so a forged-shape
`Bearer aim_tk_…` reaches terminal RW on any tmux session addressed by `?name=`. Bounded by
`isAllowedSource()`.

## The task

Decide /term's legitimate-client set (cookie-only dashboard vs bearer clients), then
deep-validate NON-one-shot bearers at the connection handler WITHOUT consuming one-shot AID
tokens. DESIGN-SENSITIVE: a naive gate-level deep-validate consumes one-shot tokens and breaks
their consumers — the parent documents why.

## Acceptance

- [ ] The /term legit-client decision is recorded in this card.
- [ ] Non-one-shot bearers are deep-validated at the handler; one-shot AID tokens still reach their downstream consumer un-consumed (test proves both).

## Approval log

- 2026-08-25T18:17:38+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
