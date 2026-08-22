---
trdd-id: R268J32X
title: The route-authorization guard cannot see 17 mutating unauthorized routes outside app/api/agents
column: todo
created: 2026-08-22T22:38:35+0200
updated: 2026-08-22T23:01:16+0200
current-owner: user
created-by: user
task-type: security
implementation-commits: [a2e1f2d0]
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

## LANDED — 2026-08-22T22:48:21+0200 — and the POPULATION nearly went wrong

Third parallel block in `tests/unit/agent-route-authorization-coverage.test.ts`. 10/10.

**The card's "17" was right, and I nearly built the guard on the wrong number.** Re-derived on
pickup (a count in a card has a silent timestamp), outside `agents/`: **122 mutating routes, 73 of
them with no `authorize`/`requireSudoToken`/`canIssue`/`enforceSystemOwner`.** Seeding 73 would
have been indefensible — that set contains `auth/login`, `auth/logout`, `v1/auth/token`,
`v1/auth/challenge`: **the authentication surface itself, which cannot require prior authorization
by definition.** A 73-entry ledger is exactly the "wall of warnings is how a linter gets routed
around" failure this file's own collection block warns about.

Both numbers are correct about DIFFERENT populations, and the narrower one is the one the card's
argument actually supports: a route calling `enforceAuth` has CHOSEN authentication-only, and that
choice is an unchecked ASSERTION. That set is **17**, reproduces exactly, and contains nothing
correct-by-construction.

**PROVEN TO FIRE**, because a widened root that still matches nothing is indistinguishable from a
clean tree: seeding `app/api/zz-probe-authn-only/route.ts` reddens the suite and NAMES the route;
moving the probe to `scripts_dev/probes/` (moved, not deleted — RULE 0) returns it to green.

**My first walker control was wrong and its failure was the useful part.** I asserted no scanned
file contains `/agents/`, and five legitimately do — `v1/agents/route.ts`,
`v1/agents/me/route.ts`, `v1/agents/resolve/[address]/route.ts` and two under
`sessions-browser/agents/[id]/`. They are NOT under `app/api/agents/` and do belong to this root.
A substring check calls those a bleed and reds a correct walker. Now asserts the PRECISE property
(path prefix), which is what "bleed" actually means.

## Decisions — the 17, one at a time

Two decided 2026-08-22, both on the blast-radius pick this card named. **Both CLEAR.** Recording
the reasoning, not just the verdict, because "we looked and it was fine" is the finding that
otherwise gets re-litigated by the next reader.

**`sessions/create` — CLEAR. Forward-and-authorize, not authentication-only.** The route runs
`enforceAuth`, then ALSO `authenticateFromRequest` + `buildAuthContext`, and plumbs the context
into `createSession` under a comment tagged `SVC2-MAJ-01 (2026-05-06)`. The receiving end
authorizes on it — `services/sessions-service.ts:808` short-circuits a system owner and `:815`
calls `authorize(authResult, 'create-session', agentId)`, returning 403 on denial. **The ledger
mislabelled it**: this third root's needle is `MUTATING && CALLS_ENFORCE_AUTH && !STRONG_AUTHZ`,
and STRONG_AUTHZ is looked for IN THE ROUTE FILE, so a route that forwards to a service that
authorizes reads as authentication-only. The `agents/` root already separates a FORWARD-ONLY tier
for exactly this; the third root has no such tier, so its 17 conflates "authenticates only" with
"forwards to something that authorizes". That is a defect in the LEDGER's resolution, not in the
route — and CAVCTULL is the reason to check rather than assume, since there the same theory held
for 11 routes and failed for 1.

*Nearly filed a false finding here.* A sweep for `createSession` callers that omit `authContext`
returned 13, which looks like the FRRJ80YQ presence-gated-bypass shape. It is not: `lib/session-auth.ts:86`
exports a same-named `createSession(ip?)` for BROWSER LOGIN sessions, and the four `auth/*` and
`governance/password/reset` hits call THAT one — which legitimately has no authContext because it
IS the authentication boundary. Others were a different signature again (three positional args).
Discriminating by IMPORT rather than by name leaves **two** real callers: this route (passes it)
and `element-management-service.ts:10671` (omits it). That omission is the case
`sessions-service.ts:795` documents — EMS's CreateAgent pipeline already ran `gate0Auth('create-agent')`
before reaching it — so it is legitimate, though it should pass an explicit
`buildSystemAuthContext(...)` for audit traceability the way `fleet-hard-recovery-runner.ts:52`
does, rather than relying on the fallback. Cosmetic; noted, not filed.

**`plugin-builder/build` — CLEAR. `enforceAuth` follows blast radius here.** `buildPlugin(config: unknown)`
takes no auth context and so cannot authorize internally, which is the shape that made
DQVPODKW a hole — but the outcome differs because the *effect* differs. The build writes to
`$TMPDIR/ai-maestro-plugin-builds/<uuid>` and **nothing reads that directory**: the only two
references are its own declaration and use inside the service. It does not install, and it drives
a build script already present in the user's marketplace cache via `execFile` (not a shell) with
path segments validated against traversal, behind a concurrency slot. It mints no identity,
mutates no governance state, and touches no other agent. The subtree's guards track exactly that:
`push` — the one that PUBLISHES — is `enforceSystemOwner`. That is the opposite of the DQVPODKW
pattern, where the three agent-MINTING routes got the weak guard while their siblings got the
strong one. There is also no action to authorize WITH: `authorize()`'s vocabulary is
`approve archive change-title create-agent delete-agent edit export-agent manage-team manage-trdd
promote refuse register-agent unblock-prompt` — adding one is a governance-vocabulary change, and
nothing here justifies it.

### But the subtree sweep found a real hole the ledger cannot see

`GET /api/plugin-builder/builds/[id]` had **no guard of any kind** — the only unauthenticated
route in an otherwise-guarded subtree. Its sole protection was the entropy of the build id, minted
by `buildPlugin` as `randomUUID()` and returned only to the authenticated POST caller: a
capability URL, not an authorization decision. `lib/agent-auth`'s own header records the ruling it
contradicted — *"SF-058 CLOSED: No auth headers AND no session cookie → rejected. There is no
'free' system-owner access anymore."*

Fixed with `enforceAuth` (not `enforceSystemOwner`: a build status is not a governance object, so
there is no owner to compare against and no title that should widen or narrow the answer).
Verified safe for the UI BEFORE editing — `components/plugin-builder/BuildAction.tsx:137` polls it
with a plain same-origin fetch and no Bearer header, and `authenticateFromRequest` resolves the
`aim_session` cookie to a system owner, which is already how that same component's POST at :97
passes `enforceAuth`. `enforceAuth`'s write-block is a no-op on GET, so this adds authentication
only. Commit `70f9d67c`; `tests/unit/plugin-builder-build-status-auth.test.ts`, 3 tests, neuter
1 red / 2 green.

**This is the second acceptance box's class, and it was invisible to the first's needle by
construction** — a route that calls NO guard, on a NON-mutating verb, fails both conjuncts of
`MUTATING && CALLS_ENFORCE_AUTH`. The ledger catches authentication standing in for authorization;
it is blind to no-authentication-at-all. One instance found and closed does not sweep the class,
so that box stays open.

## Acceptance

- [x] third parallel root over `app/api/` excluding `agents/`, leaving the other two ledgers intact
- [x] population re-derived rather than taken from this card — and the 73-vs-17 distinction
      settled before seeding, not after
- [x] the 17 seeded as a debt ledger, not shipped as 17 failures
- [x] PROVEN to fire on a seeded route, and to go green when it is removed
- [x] walker control asserts a real scan set (>100 files) and no bleed into `app/api/agents/`
- [x] non-vacuity: the needle must find >0, so a broken regex cannot read as "all decided"
- [ ] the 17 decided one at a time, each real one its own card. **2 of 17 done** — `sessions/create`
      and `plugin-builder/build`, both CLEAR, reasoning under `## Decisions`. 15 remain
- [x] the third root needs a FORWARD-ONLY tier like the `agents/` root has — **done**, commit
      `57560112`. The needle was wrong in BOTH directions: 6 of the 17 were forwarders (the five
      `groups/*` + `sessions/create`), so the authn-only debt is **11**; and **18** mutating
      routes outside `agents/` forward a context while calling nothing stronger, **12 of them in
      no ledger at all** — including `teams/[id]/batch-create-agents` and `trdd/create`, which
      create governed objects. `sessions/create` is additionally pinned BY NAME, because a tier
      that COUNTS cannot see a receiver that authorizes the WRONG action: the neuter changing
      `'create-session'` to `'create-agent'` leaves `authorize(` present, so every count stayed
      green and only the named pin went red
- [ ] the 73-minus-17 remainder — routes with NO authentication at all — is a DIFFERENT question
      this guard deliberately does not ask. Worth its own card if anyone wants it asked.
      **One instance surfaced and was closed** (`GET plugin-builder/builds/[id]`, commit `70f9d67c`)
      while sweeping the subtree above — found by reading siblings, NOT by the needle, which cannot
      see a non-mutating route that calls no guard. One instance is not a sweep, so this stays open.

## Approval log

- 2026-08-22T22:38:35+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
