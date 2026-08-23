---
trdd-id: DYIGNVTI
title: restore the delegation regression guard the semantic credential gate cost
column: testing
created: 2026-08-23T11:14:29+0200
updated: 2026-08-23T12:07:24+0200
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
implementation-commits: [8bdfa5a5, 13b53096]
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

## Implementation 2026-08-23

Landed as `8bdfa5a5` (the guards) and `13b53096` (the observed neuter + the mirror-suite note).
`tests/unit/headless-teams-put-delegation.test.ts`, a new file so the success-path auth mock
cannot leak into the mirror suite, which deliberately uses none.

**THE PREFERRED FIX ABOVE — option (2) — IS REFUTED, and was not built.** It asked to mock auth
to succeed and *"assert the malformed id still yields 400 from the delegated Next handler"*.
Measured before building: `services/teams-service.ts:558` opens `updateTeamById` with its own
`if (!isValidUuid(id)) return { error: 'Invalid team ID', status: 400 }`, added *"for consistency
with getTeamById (CC-008)"*. So **both** paths answer 400 on a malformed id, and that test would
have passed under the very neuter it exists to catch — rebuilding the vacuity this card was
written to remove. The card's own reasoning inherited the premise from the DEAD guard, which
worked only because auth ordering differed; once the semantic gate equalised the auth outcome,
nothing was left to distinguish the two paths *at that input*.

What discriminates instead is the Next route's zod `.strict()` (`app/api/teams/[id]/route.ts:41`),
which the direct path — a raw rest-spread — never had. Gate order verified first: `safeParse` at
PUT-relative line 21, `requireSudoToken` at 74, so the strict rejection is reachable with auth
mocked and nothing else. The injected key is `blocked`, the exact one the handler's own security
comment names as clearing the manager-gated freeze.

Both vehicles kept, per this card's "they fail in different directions":

- **STATIC** — the handler body says `delegateNextRoute` and does not say `updateTeamById(`.
  Reads source text, so no gate change can defeat it. Comment-stripping is load-bearing, not
  tidiness: the handler carries a 25-line comment naming `updateTeamById()` five times to explain
  why it must not be called, so an unstripped body matches the forbidden needle on prose alone and
  would red against correct code. That hazard is turned into the file's own positive control — the
  RAW body must contain the needle, or the stripped assertion has stopped discriminating.
- **BEHAVIOURAL** — observes the real path, asserting the zod `issues` array rather than the bare
  400, precisely because 400 is not a discriminator here.

**Neuter OBSERVED, 2 red / 1 green**, restore verified by blob hash. The 1 green is the control and
is green by design: it asserts the response is NOT `Validation failed`, which a direct path also
satisfies. Aimed by LINE NUMBER — `delegateNextRoute(` appears at ~20 sites in this router, so a
shape-matched expression would have rewritten all of them and produced a plausible red set
belonging to other pipelines. The first attempt used `sed` syntax against a `perl` harness, matched
nothing, and was ABORTED by the harness rather than reported as the `0 red` that a no-op mutation
and an untested guard produce identically.

## Acceptance

- [x] a test fails when `PUT /api/teams/:id` stops delegating to the Next route — two do
- [x] that failure is demonstrated by an actual neuter run, recorded in the test header with the
      observed red/green counts (not predicted ones). 2 red / 1 green; the expression, the red
      test names, and why the green one is correct are all in the header
- [x] the note in `headless-router-auth-mirror.test.ts` naming this card is updated to point at
      the restored guard. It named the card only as "an EHT of TRDD-8Q5EVGV1", not by id; it now
      names `TRDD-DYIGNVTI`, points at the new file, and records the refuted option so the next
      reader does not re-propose it
- [x] the card's own preferred fix was checked before being built, and refused with a measurement
      rather than implemented on the strength of the card saying "prefer (2)"

## Approval log

- 2026-08-23T11:14:29+0200 — MANDATE issued by ai-maestro-00 (min-approval-requirement: none).
  Tier-0 derived task (EHT of TRDD-8Q5EVGV1): closes a hole opened by that card's own change,
  inside the same scope. Pre-approved; no approval request was sent.
