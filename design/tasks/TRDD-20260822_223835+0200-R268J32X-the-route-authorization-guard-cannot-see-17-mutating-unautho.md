---
trdd-id: R268J32X
title: The route-authorization guard cannot see 17 mutating unauthorized routes outside app/api/agents
column: todo
created: 2026-08-22T22:38:35+0200
updated: 2026-08-22T22:38:35+0200
current-owner: user
created-by: user
task-type: security
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T22:38:35+0200
---

# The route-authorization guard cannot see 17 mutating unauthorized routes outside app/api/agents

## Problem — the same "scan root too narrow" finding, one level up

TRDD-CAVCTULL found that `tests/unit/agent-route-authorization-coverage.test.ts` walked
`app/api/agents/[id]/` only, so the whole COLLECTION subtree had never been under any guard. It
was widened to cover both. **`app/api/` outside `agents/` is still not covered by anything.**

Measured 2026-08-22 across all of `app/api/**/route.ts`:

| | count |
|---|---|
| routes calling `enforceAuth` | 44 |
| of those, with a MUTATING verb (POST/PATCH/PUT/DELETE) | **33** |
| of those, with NO `authorize(` / `requireSudoToken(` / `canIssue(` | **26** |
| of those 26, INSIDE `agents/` (the guard's root) | 9 |
| of those 26, **OUTSIDE it — invisible to every guard** | **17** |

The 17: `conversations/parse`, `export/jobs/[jobId]`, `groups/[id]` · `groups/[id]/notify` ·
`groups/[id]/subscribe` · `groups/[id]/unsubscribe` · `groups`, `plugin-builder/build`,
`plugin-builder/scan-repo`, `sessions/[id]/rename`, `sessions/activity/update`,
`sessions/create`, `sessions/restore`, `settings/global-elements/convert-skill`,
`settings/mcp-discover`, `v1/mesh/chat`, and one more.

## This card does NOT claim 26 holes — and that distinction is the point

`enforceAuth` encodes a REAL policy. Its docstring: *"Handy for mutations where authorization is
uniform — e.g. 'any authenticated caller can call this'."* For several of these that is plainly
right (`sessions/activity/update` is an agent reporting its OWN activity; `conversations/parse`
may be read-shaped). The claim is narrower and harder to dismiss:

**Every use of `enforceAuth` on a mutating route is an unchecked ASSERTION that "any
authenticated caller" is the intended policy, and for 17 of them no guard can even see the
assertion being made.**

TRDD-DQVPODKW measured what that costs: of the first four such assertions examined in one
subtree, **three were wrong** — `create-persona`, `create-from-toml` and `docker/create` mint
agents and were reachable by any authenticated agent of any title, which is exactly what
TRDD-F1SL03CK had just closed on `POST /api/agents`. A 3-in-4 error rate on a sample is not proof
about the other 17, but it is the reason not to assume them fine.

## Proposed fix — the ledger shape, not a sweep

1. Widen the guard's scan root to **all of `app/api/`**, as a THIRD parallel block (the
   `agents/[id]` ledger is provably empty and the `agents/` collection ledger is shrinking; do not
   fold a new debt pile into either — that destroys both signals).
2. Seed the 17 as a debt ledger so the suite is green on day one. **Do NOT ship 17 fresh failures**
   — a wall of red is how a linter gets routed around, which is this guard's own stated reasoning.
3. Prove it fires: seed an unauthorized mutating route OUTSIDE `agents/` and confirm the suite
   goes red and NAMES it. A widened root that still matches nothing is indistinguishable from a
   clean tree.
4. Positive control on the count, so a mis-joined path cannot report clean by scanning nothing.
5. Decide the 17 one at a time, each real one getting its own card.

## Verification

- The walker reaches every `app/api/**/route.ts`, asserted by a floor derived from a real count
  (not a number copied from this card — re-derive it, this one has a silent timestamp).
- Seeding an unauthorized mutating route outside `agents/` reds the suite and names the file.
- The three ledgers stay SEPARATE and each may only shrink without a deliberate edit.

## Estimated risk

LOW to add (test-only). The risk lives in the 17 undecided routes, which this card makes visible
and does not change. Severity per route is unknown until decided — `sessions/create` and
`plugin-builder/build` look worth reading first, on blast radius alone.

## Provenance

Found while working TRDD-DQVPODKW's last acceptance box ("audit `enforceAuth`'s callers outside
this subtree"). Numbers measured by walking `app/api` and testing each file for a mutating verb, a
non-comment `enforceAuth(` call, and the absence of a strong authorization needle. **Re-derive
before acting** — a count in a card is a measurement taken once.

## Approval log

- 2026-08-22T22:38:35+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
