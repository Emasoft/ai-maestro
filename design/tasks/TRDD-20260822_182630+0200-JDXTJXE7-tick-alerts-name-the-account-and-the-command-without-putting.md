---
trdd-id: JDXTJXE7
title: Tick alerts name the account and the command without putting an email in the decision log
column: todo
created: 2026-08-22T18:26:30+0200
updated: 2026-08-22T18:26:30+0200
current-owner: user
created-by: user
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T18:26:30+0200
---

# Tick alerts name the account and the command without putting an email in the decision log

## Problem

The rotator's TICK alerts are the only ones a human cannot act on directly: they say *how many*
accounts need a re-login, never *which*. So the recipient of the most urgent alert in the subsystem
has to go and find the account themselves, at the moment the fleet is stalled.

`TRDD-RFQFCCU4` closed with this as its one open box — *"the message names the specific account and
the exact command — TRUE for the supervisor's findings … the tick's decision line is COUNTS-ONLY BY
RULE. Needs a decision, not code."* The decision was taken on 2026-08-22 (recorded in full on that
card): **do not relax the counts-only rule — break the accidental coupling that extends it to the
alert.** This card is that implementation.

## Root cause — a LOG rule silently became an ALERT rule

Two surfaces, one string:

- `lib/oauth-rotator/tick.ts:1417` states the rule, and states it about the LOG:
  *"its decision line is counts-only by rule, never an email"* — correct, and the 4 506 lines over
  4 days that `RFQFCCU4` was filed for is exactly why an append-only 60 s log must not carry
  identities.
- `lib/oauth-rotator/server-tick.ts:226` then does `deliver([{ code, message: alertable.decision }])`
  — the alert message **IS** the decision line, verbatim. `alertableTick` (`:43`) narrows the result
  to `nextAction | reason | stuck | decision`, and no identity exists on `TickResult` to narrow to.

Nobody decided the alert should be anonymous. It inherited it.

**The identity is already computed and then thrown away.** `runTick` calls `surveyAlternates()`,
whose own comment says the loop exists because *"a repair must know WHOSE slot to re-capture, and
that identity is exactly what this loop used to throw away"* — then reduces it to
`unreadable = survey.unreadable.length` / `deadRefresh = survey.refreshDead.length`
(`tick.ts:1404-1406`). So this is not new data collection; it is not discarding what is in hand.

**And the alert channel already carries emails, by design, from its other producer.** Verified
first-hand in `lib/oauth-rotator/supervisor.ts:232` and `:243` — both `setup-token-expiring` and
`cookie-leg-stuck` interpolate `${s.email}` straight into the message, through the SAME
`deliverAlerts` into the SAME `active-alerts.json`. That store is keyed by CODE, holds one current
message per code, and is DROPPED on resolution — bounded and self-clearing, unlike the log. So the
tick is the odd one out, and making it consistent adds no new class of data to any file.

## Proposed fix

Additive, and the log line must not change.

1. Add an identity field to `TickResult` — e.g. `identities?: { unreadable: string[]; refreshDead: string[] }`
   — populated from the `survey` already in hand at `tick.ts:1404`.
2. Widen `alertableTick`'s `Pick<>` to carry it, keeping its deliberate tolerance for a shapeless
   stub (its doc comment at `server-tick.ts:36` explains why that dep is `Promise<unknown>`; a stub
   that is legal for `writeTickStatus` must stay legal here).
3. At `server-tick.ts:226`, compose the alert message as the decision line **plus** the identities
   and the exact re-login command. The decision line itself is passed through unchanged.
4. `deriveDecision` is NOT touched. Its counts-only contract and every test over it stay exactly as
   they are — that is the point of the ruling.

**Do NOT implement this by relaxing `deriveDecision`,** and do not add identities to
`appendRotatorLog`. If a future reader finds an email in the 60 s decision log, this card was
implemented wrongly.

## Acceptance

- [ ] `TickResult` carries the surveyed identities; `deriveDecision`'s output is byte-identical for
      every existing test (i.e. no test of it needed changing)
- [ ] a tick alert for `reason: 'refresh-dead'` / `'slot-unreadable'` names the account(s) and the
      command, delivered through the existing `deliverAlerts`
- [ ] the decision line written to the rotator log still contains NO email — pinned by a test that
      fails if one appears there
- [ ] at least ONE recorded neuter, by name, with its red set pasted verbatim — deleting the
      identity from the alert message must redden a test. An alert-content change with no neuter is
      exactly the shape that produced the original 4 506-line incident: detection that looks wired
      and delivers nothing
- [ ] `tsc` 0 and the full suite green

## Verification

Paste the neuter run's output onto this card. A test asserting the alert "contains the account" is
worth nothing until a mutation that removes it has been shown to redden that test.

## Approval log

- 2026-08-22T18:26:30+0200 — MANDATE issued by user (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
