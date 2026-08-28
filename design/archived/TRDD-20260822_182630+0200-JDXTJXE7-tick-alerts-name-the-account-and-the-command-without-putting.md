---
trdd-id: JDXTJXE7
title: Tick alerts name the account and the command without putting an email in the decision log
column: complete
created: 2026-08-22T18:26:30+0200
updated: 2026-08-28T23:05:40+0200
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

- [x] `TickResult.identities?: {unreadable, refreshDead}` populated from the survey at `tick.ts` (the counts reduction site); `deriveDecision` untouched, zero existing tests changed
- [x] `server-tick.ts`: `alertableTick` widened (shape-tolerant), new `composeTickAlert()` = decision line verbatim + `account(s): …` + `re-login: ` + `REAUTH_HUMAN_STEP` (Settings → Claude accounts → Re-login / `POST /api/oauth-rotator/reauth/start {"email"}`); the deliver site sends the composed message through the same `deliverAlerts`
- [x] `oauth-rotator-tick.test.ts` "carries the surveyed identities … decision line stays email-free": `res.identities` has the email, `res.decision` matches no `@`, and the `decide` sink received exactly that line. FINDING while writing it: asserting over EVERY sink line reddened on `auto: live live@x …` — `autoRotate` (rotate.ts) already logs the LIVE account's email through the same sink, pre-existing and out of this card's scope; the pin is scoped to the decision line, which is what the rule governs
- [x] three neuters, 2-file selection (server-tick + tick tests, 66 tests), each restored and re-run green:
      N1 `composeTickAlert` returns `a.decision` (identities dropped) → 2 red: `the delivered alert names the account(s) and the re-login step, with the decision line intact`, `composeTickAlert picks the identities that match the REASON…` · 64 green
      N2 deliver site reverted to `message: alertable.decision` → 1 red: `the delivered alert names the account(s)…` · 65 green
      N3 `runTick` stops returning `identities` → 1 red: `carries the surveyed identities on the result while the decision line stays email-free` · 65 green
      Disjoint red sets across N2/N3; N1 ⊃ N2
- [x] `tsc --noEmit` 0 errors; full `yarn test` run recorded in the Approval log below

## Verification

Paste the neuter run's output onto this card. A test asserting the alert "contains the account" is
worth nothing until a mutation that removes it has been shown to redden that test.

## Approval log

- 2026-08-22T18:26:30+0200 — MANDATE issued by user (min-approval-requirement: none). Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-08-28T23:05:05+0200 — implemented by hub-claude; see the ticked boxes for sites and neuters. Full-suite result appended on close.
- 2026-08-28T23:05:40+0200 — COMPLETED by hub-claude. Full `yarn test`: 494 files, 6554 passed, 2 skipped, 0 red; `tsc --noEmit` 0. Side finding (not this card): `autoRotate` logs the LIVE account email via the decision sink (`auto: live <email> …`, rotate.ts) — the counts-only rule covers the decision line only; whether the auto line should be anonymised is a separate call.
- 2026-08-28T23:05:40+0200 — COMPLETE by emanuelesabetta. archived → complete.
- 2026-08-28T23:07:20+0200 — review-fork settle (two greps): (1) `server-tick.ts` wires NO `decide`, so the decision line takes `runTick`'s default sink `console.log(`[oauth-rotator] …`)` (the pm2 log) — the `decide` dep the test pins IS the server's seam, and `composeTickAlert` is never passed to it. (2) `alert-delivery.ts:221` appends `ONSET <code> — <message>` to `rotator.log` ONCE per alert onset (transition record, keyed by CODE — dedupe/backoff never compare `message`, so a changing account list cannot re-arm them). Consequence stated plainly: the composed alert, emails included, lands in `rotator.log` once per onset. This is the SAME route the supervisor's `${s.email}` alerts already take, bounded to transitions, not the per-beat decision line the counts-only rule protects; the 60 s decision line stays email-free. Recorded, not changed — narrowing ONSET would blind the transition log for the supervisor too, a separate call.
