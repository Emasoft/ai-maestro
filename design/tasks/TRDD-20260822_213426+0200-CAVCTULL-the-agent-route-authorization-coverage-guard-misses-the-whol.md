---
trdd-id: CAVCTULL
title: The agent-route authorization coverage guard misses the whole collection subtree
column: todo
created: 2026-08-22T21:34:26+0200
updated: 2026-08-22T21:34:26+0200
current-owner: main
created-by: main
task-type: security
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: main
approval-datetime: 2026-08-22T21:34:26+0200
external-refs: [TRDD-F1SL03CK]
---

# The agent-route authorization coverage guard misses the whole collection subtree

## Problem

`tests/unit/agent-route-authorization-coverage.test.ts` exists to catch exactly one class of
defect: **a mutating agent route that performs no authorization step.** It could not see the
worst instance of that class, for two independent reasons — and the instance it missed was
`POST /api/agents`, the route that MINTS AGENTS (TRDD-F1SL03CK).

### 1. The scan root is too narrow

    const agentScopedRoot = path.join(repoRoot, 'app', 'api', 'agents', '[id]')

It walks the agent-SCOPED subtree only. The COLLECTION subtree — `app/api/agents/*/route.ts`
outside `[id]/` — has never been under any guard. Measured 2026-08-22:

| | count |
|---|---|
| mutating collection routes outside `[id]/` | **26** |
| of those, with NO authorization step at all | **18** |

The 18 include `create-from-toml`, `create-persona`, `docker/create`, `register`,
`normalize-hosts`, `directory/sync`, `role-plugins/inject-skill`,
`role-plugins/sync-defaults`, `startup`, and 11 `creation-helper/*` routes. This card does
NOT claim all 18 are holes — several may be local-only or genuinely public. It claims that
**nobody has decided**, which is precisely what the existing test's own debt-ledger exists to
make visible.

### 2. Even with the right root, the needle would have passed it

`AUTHORIZES` counts `\bbuildAuthContext\(` as an authorization step, on the stated theory that
the call forwards the caller into a Change* pipeline "whose Gate 0 (`assertAuthorized`) calls
authorize() for it". `POST /api/agents` **already called `buildAuthContext(auth)`** before
F1SL03CK — and `CreateAgent`'s first gate is `G00f`, an **R40 foreign-user check**
(`assertForeignUserMayCall`), not an `authorize()` call. So for this route the pattern read a
context CONSTRUCTION as an authorization DECISION.

That is a proxy standing in for the thing, and it is the same shape as the bug it failed to
catch: there, authentication stood in for authorization; here, constructing an auth context
stands in for checking it. **The theory behind the pattern is sound for the pipelines that do
authorize at Gate 0 — it is unverified per-route.**

## Proposed fix

1. **Widen the scan root** to all of `app/api/agents/`, and seed the debt ledger with the 18 so
   the test passes on day one. The ledger's stated contract already fits: *"it may SHRINK as each
   is decided; it must never grow without a deliberate edit here."* Do NOT ship 18 fresh failures
   — a wall of warnings is how a linter gets routed around.
2. **Split `buildAuthContext(` out of `AUTHORIZES`** into a weaker tier, or verify per-pipeline
   that the named Gate 0 really calls `authorize()`. A route matching only on the forward-spelling
   should be listed as UNVERIFIED rather than counted as covered.
3. Decide the 18, one at a time, shrinking the ledger.

## Verification

- With the root widened and the ledger seeded, the suite is green, and `git`-adding a new
  unauthorized mutating collection route turns it RED. **Seed that route to prove it** — a green
  run over a widened root is otherwise indistinguishable from a root that still matches nothing.
- A route whose only match is `buildAuthContext(` is reported, not silently counted.
- Positive control on the count: the walker must find >= 26 mutating collection routes, so a
  mis-joined path cannot report clean by scanning nothing.

## Estimated risk

**LOW for the guard change** (a test-only edit). The RISK LIVES IN THE 18 UNDECIDED ROUTES, which
this card only makes visible — it does not change their behaviour. Whether any is a live hole is
per-route work, and each one that turns out to be should get its own card rather than being fixed
in a sweep.

## Approval log

- 2026-08-22T21:34:26+0200 — MANDATE issued by main (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
