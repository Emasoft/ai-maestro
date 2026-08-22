---
trdd-id: U991KMFL
title: Owner performs the live recovery-relay verification with real SMTP credentials
column: todo
created: 2026-08-22T17:48:31+0200
updated: 2026-08-22T17:48:31+0200
current-owner: user
created-by: user
task-type: security
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T17:48:31+0200
---

# Owner performs the live recovery-relay verification with real SMTP credentials

## ⏵ STATE — READ THIS FIRST

**One physical act, owned here so two other cards stop deferring to each other.** Descoped
2026-08-22 from **`7U927FCM`** (its "live 2A" box) and **`P7XKV3N9`** (its recovery-email SMTP
box). Both had the same unperformable item in their acceptance, each pointing at the other.

**NOT PERFORMABLE BY AN AGENT, AND NOT UNDER ANY DELEGATION.** Two independent bars, either
sufficient:

1. It begins with the owner RESETTING THEIR PASSWORD (Settings → Revoke) to re-enter first-run.
   An agent must never rotate a credential — a standing prohibition the owner's decide-authority
   grant explicitly does not touch.
2. It requires the MAESTRO relay's REAL SMTP credentials, typed by the owner. `7U927FCM` names
   this as HUMAN-ONLY by R16: *"the relay credentials are entered by the owner and never by an
   agent or a model."*

This is stated plainly because the sibling case went the other way: `K2WJH7RF`'s e2e was parked as
"human-only" on a premise that turned out to be FALSE, and once measured it was agent-performable
after all. This one was re-checked and the constraint is real.

**NEXT ACTION (the owner, at the machine):** Settings → Revoke to re-enter first-run; enter the
MAESTRO relay SMTP host/port/TLS and credentials; confirm the verify step succeeds and app entry
unlocks. Or take the documented opt-out, which is an equally valid outcome and closes this card.

## What is already done, so this is a verification and not a build

The engineering shipped and is tested. `7U927FCM` carries 8 unit tests plus 2 neuters over the
gate-flag logic (`ff648fa0`), with the UNVERIFIED-email case as the load-bearing one, and
`P7XKV3N9`'s `396b5d10` added the SMTP host/port/TLS override with 2 route tests covering the
override-vs-autodetect branch. What no test can cover is the owner's ACTUAL relay answering.

## Acceptance

- [ ] The owner completes first-run recovery setup against their real relay and app entry unlocks —
      OR takes the opt-out. Either outcome closes this card.
- [ ] The result is recorded here: which path was taken, and any divergence from what the route
      tests predicted, as a finding rather than silently reconciled.

## Approval log

## Approval log

- 2026-08-22T17:48:31+0200 — MANDATE issued by user (min-approval-requirement: user). Pre-approved: issuer authority >= required approver. No approval request was sent.
