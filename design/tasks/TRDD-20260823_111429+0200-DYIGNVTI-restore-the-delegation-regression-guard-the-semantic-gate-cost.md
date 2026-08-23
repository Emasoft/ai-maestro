---
trdd-id: DYIGNVTI
title: restore the delegation regression guard the semantic credential gate cost
column: todo
created: 2026-08-23T11:14:29+0200
updated: 2026-08-23T11:14:29+0200
current-owner: ai-maestro-00
created-by: ai-maestro-00
task-type: test
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-00
approval-datetime: 2026-08-23T11:14:29+0200
derived: true
derived-kind: eht
parent-trdd: 8Q5EVGV1
npt: []
eht: []
project-id: ai-maestro
repo: Emasoft/ai-maestro
relevant-rules: []
external-refs: []
---

# restore the delegation regression guard the semantic credential gate cost

## Problem

`TRDD-8Q5EVGV1` made the headless router's credential gate semantic (commit `c909aa3f`).
That closed the forged-token bypass for all 252 handlers, and it cost exactly one piece of
real coverage, recorded here rather than left as a silent weakening.

`tests/unit/headless-router-auth-mirror.test.ts` carried:

> `team-update: DELEGATION proof — forged token + malformed id returns 400 (isValidUuid runs
> before auth in full mode)`

Its own comment states its purpose: *"This is the regression guard that a future 'simplify back
to a direct updateTeamById() call' turns red. The full-mode PUT validates isValidUuid BEFORE
authenticateFromRequest, so a forged token on a malformed id is rejected at the UUID gate (400).
The OLD headless handler authenticated FIRST, so the same request would have returned 401 — the
two gate orders are distinguishable, and only the delegated (fixed) path yields 400 here."*

The 400-vs-401 difference WAS the entire signal. The semantic gate now rejects the forged token
before either path runs, so both orders yield 401 and the two are no longer distinguishable
through the router. The test was updated to assert the (stronger) 401 and its body records the
loss, but as it stands **a refactor that replaces delegation with a direct `updateTeamById()`
call would no longer turn anything red.**

The SECURITY property is unharmed — strictly stronger, in fact, since an unauthenticated caller
now reaches neither path. What is gone is the ARCHITECTURE guard.

## Proposed fix

Give the delegation claim a vehicle that does not depend on an unauthenticated caller reaching
the handler. Options, cheapest first:

1. **Static, like the sibling ledger.** `tests/unit/headless-handler-auth-ledger.test.ts` already
   proves a source-text property of this same router and survived the gate change untouched.
   A check that the `PUT /api/teams/:id` handler body contains `delegateNextRoute` and does NOT
   contain a direct `updateTeamById(` is one assertion and cannot be defeated by a gate change.
   Carries the ledger's own stated caveat: it proves the handler *asks*, never that it *obeys*.
2. **Behavioural, with a valid credential.** Mock `@/lib/agent-auth`'s
   `authenticateFromRequestAsync` to succeed (the pattern the three sibling files now use after
   `c909aa3f`), then assert the malformed id still yields 400 from the delegated Next handler.
   Stronger than (1) because it observes the real path, at the cost of a mock.

Prefer (2), and keep (1) if it is free — they fail in different directions.

## Verification

Neuter the delegation itself: replace `delegateNextRoute` in the `PUT /api/teams/:id` handler
with a direct call, and confirm the new test reds. A guard that does not red under that mutation
has not restored anything — this card exists precisely because the previous guard stopped
redding under a mutation nobody made deliberately.

## Acceptance

- [ ] a test fails when `PUT /api/teams/:id` stops delegating to the Next route
- [ ] that failure is demonstrated by an actual neuter run, recorded in the test header with the
      observed red/green counts (not predicted ones)
- [ ] the note in `headless-router-auth-mirror.test.ts` naming this card is updated to point at
      the restored guard

## Approval log

- 2026-08-23T11:14:29+0200 — MANDATE issued by ai-maestro-00 (min-approval-requirement: none).
  Tier-0 derived task (EHT of TRDD-8Q5EVGV1): closes a hole opened by that card's own change,
  inside the same scope. Pre-approved; no approval request was sent.
