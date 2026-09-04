---
trdd-id: 8J8J174D
title: Full mode has no semantic credential gate while headless closed the same hole for all its handlers
column: todo
created: 2026-09-04T13:44:10+0200
updated: 2026-09-04T13:44:10+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
priority: 1
severity: medium
effort: medium
min-approval-requirement: manager
labels: [security, auth, two-server-modes, carved-from-dqvpodkw]
---

# Full mode has no semantic credential gate while headless closed the same hole for all its handlers

## Problem — the two modes disagree about what a bearer proves

Both modes run a **structural** credential check on every `/api/*` request: a header of the
right SHAPE. Neither verifies it there. `middleware.ts` says so in its own words:

> // Credentials present — defer full verification to the route handler

Headless used to be the same, and **stopped being** — TRDD-8Q5EVGV1 (2026-08-23) added a
SEMANTIC gate that actually validates the credential before any handler runs, because it
measured that **142 of 252 headless handlers call no auth helper at all**, so for those the
structural gate WAS the only check and `aim_tk_` + 24 arbitrary characters reached the
handler. That fix closed it "for all 252 at once".

**Full mode never got the twin.** So a Next.js route that omits an auth call is reachable
today with a hand-typed bearer. Found 2026-09-04 while draining TRDD-DQVPODKW: two routes in
one subtree have NO auth call —
`app/api/agents/creation-helper/response/route.ts` and `.../toml-preview/route.ts`.

## What is NOT claimed — measured, not assumed

Both are GET, and I checked each before claiming anything:

- **`toml-preview` is NOT an arbitrary file read.** It confines to `~/agents/haephestos/`,
  `normalize()`s BEFORE the prefix check, then `realpathSync`es and RE-checks containment
  against the symlink target. Properly defended. The residual exposure is reading a file
  under that one directory, plus a heartbeat side effect, with an unverified bearer.
- **`response`** returns the Haephestos pane capture — the persona's own output, to a caller
  that proved nothing.

So the two known instances are LOW severity. **The finding is the ASYMMETRY, not these two
routes**: nothing stops the next full-mode route from shipping with no auth call, and the
class is invisible to the existing ledgers, which scan MUTATING verbs only and therefore
cannot see a GET at all (the same blind spot that let `export`'s GET — a zip containing
`keys/private.pem` — sit in a ledger describing it as low-risk).

## Proposed fix

Port the headless semantic gate to `middleware.ts`, or state deliberately why full mode does
not need it. **Do not fix the two routes and call it done** — that leaves the class open and
is the "fix the symptom" move this repo has a rule against.

Two things the port must not break, both of which the headless version documents having to
handle: the whitelist (bootstrap routes ARE the authentication surface and cannot require
prior authentication), and the async validator (`authenticateFromRequestAsync` is a strict
superset of the sync one — the sync variant silently drops IBCT `eyJ` tokens).

Note the ordering constraint: headless placed its gate AFTER route matching on purpose, so an
unregistered path still 404s rather than 401ing. Middleware runs before routing, so the same
property needs a different mechanism or an explicit decision to change that behaviour.

## Verification

- A request with a credential-SHAPED but invalid bearer is refused BEFORE any handler runs,
  in full mode, on a route that has no auth call of its own.
- Positive control: a valid cookie session still reaches the handler.
- The whitelisted bootstrap routes still work unauthenticated.
- Neuter: disable the gate and the first assertion must redden.

## Provenance

Found while draining TRDD-DQVPODKW's final box. Carved out rather than folded in: that card
is about one subtree's authorization policy, this is a mode-parity gap across the whole app,
and `memgrep recall "two-server-modes"` already owns the general lesson
(`two-server-modes-the-headless-router-reimplements-routes`).

## Estimated risk

MEDIUM to fix (middleware is on every request; a mistake there is total), LOW to leave
short-term given both known instances are confined reads. The risk is the next route.

## Acceptance

- [ ] the two known no-auth routes (`response`, `toml-preview`) are decided — gated, or
      documented in a ledger with a reason
- [ ] the CLASS is closed: full mode either validates the credential before the handler, or
      records a deliberate ruling that it does not, with the reason
- [ ] whitelisted bootstrap routes still work unauthenticated (positive control)
- [ ] IBCT (`eyJ`) tokens still validate — the sync/async trap headless documented
- [ ] neuter observed and recorded

## Approval log

- 2026-09-04T13:44:10+0200 — Filed by ai-maestro-hub-session while draining TRDD-DQVPODKW. Awaiting approval at
  min-approval-requirement `manager`.
