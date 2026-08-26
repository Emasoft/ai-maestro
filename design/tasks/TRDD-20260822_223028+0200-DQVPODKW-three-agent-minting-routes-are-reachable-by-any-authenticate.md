---
trdd-id: DQVPODKW
title: Three agent-minting routes are reachable by any authenticated agent — F1SL03CK locked one door of four
column: todo
created: 2026-08-22T22:30:28+0200
updated: 2026-08-26T06:24:17+0200
current-owner: user
created-by: user
task-type: security
implementation-commits: [7e044958, a65e06f9]
external-refs: [TRDD-F1SL03CK, TRDD-CAVCTULL, TRDD-R268J32X]
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T22:30:28+0200
---

# Three agent-minting routes are reachable by any authenticated agent — F1SL03CK locked one door of four

## Problem — F1SL03CK locked the front door and left three side doors open

TRDD-F1SL03CK closed `POST /api/agents`: agent creation now requires
`authorize(auth, 'create-agent')`, MANAGER or CHIEF-OF-STAFF only (R30.1/R30.2). **Three other
routes create agents and are reachable by ANY authenticated agent token of ANY title.**

| route | guard | service | service authz |
|---|---|---|---|
| `create-persona` | `enforceAuth` only | `createPersona` (`role-plugin-service.ts:1182`) | **none** |
| `create-from-toml` | `enforceAuth` only | `createPersona` — same function | **none** |
| `docker/create` | `enforceAuth` only | `createDockerAgent` (`agents-docker-service.ts`) | **none** |

`enforceAuth`'s own docstring states the gap (`lib/route-auth.ts:133-138`):

> Lightweight variant of requireAuth for handlers that don't need the AuthContext downstream. …
> Handy for mutations where authorization is uniform — e.g. **"any authenticated caller can call
> this"**.

It authenticates and returns `null`. No title check, no ownership check.

**`createPersona` cannot authorize even in principle** — its signature takes
`{personaName, tomlContent, pluginName, marketplaceName, agentDescription}` and NO `authContext`
(`services/role-plugin-service.ts:1182-1188`). So the gate has to be at the route.

**Verified end-to-end, with a positive control.** The authorization needle finds
`authorize(auth, 'create-agent')` at `app/api/agents/route.ts:74`, so a zero elsewhere is a
measurement and not a broken search. The two `authorize|isSystemOwner` hits in
`role-plugin-service.ts` are at `:1070` and `:1074`, both inside `syncDefaultRolePlugins`, and
neither is a CHECK — they PASS `{isSystemOwner: …}` into `DeleteMarketplace`. Presence is not
authorization.

## The contrast that shows this was an oversight, not a decision

The same subtree's other three fleet-mutating routes use the RIGHT helper:

| route | guard | reachable by an agent? |
|---|---|---|
| `startup` · `normalize-hosts` · `directory/sync` | `enforceSystemOwner` | **no** — 403 unless `isSystemOwner` |

`enforceSystemOwner`'s docstring: *"Used for routes that MUST NOT be callable by any agent, no
matter how its AID token is scoped."* Both helpers sit in the same file, twenty lines apart. Six
sibling routes, two guards, and the split does not follow blast radius: the three that MINT AGENTS
got the weaker one.

## Two further findings from the same sweep, lower severity

**`role-plugins/inject-skill`** — `enforceAuth` only; `pluginName` comes from the request body
(`:20`), validated for path traversal and existence but not for authority. Any authenticated agent
can inject AI Maestro skills into any local-marketplace plugin, and every agent using that plugin
inherits them. An indirect, fleet-wide capability change.

**`health`** — carries **zero** authentication needles (verified: 0 hits for
`enforceAuth|requireAuth|authenticateFromRequest|enforceSystemOwner|authorize\(`) and proxies an
outbound request to a caller-supplied URL.

⚠ **A sub-agent reported this as an "unauthenticated SSRF-relay proxy". The first half is right and
the second OVERSTATES it** — re-read first-hand, the route carries a deliberate, documented SSRF
denylist (`:23-60`, tagged SF-013 and API2-MIN-16) blocking loopback, `0.0.0.0/8`, RFC1918,
link-local, ULA, `fe80::/10`, `.local`, `.internal`, Tailscale CGNAT `100.64.0.0/10` and `.ts.net`
MagicDNS. Recorded this way deliberately: a padded finding gets the strong ones discounted with it.

What remains true for `health` is (a) it is unauthenticated, and (b) it is a DENYLIST, so it
carries that shape's standard gaps — decimal/octal-encoded IPv4 (`http://2130706433/` parses to
hostname `2130706433`, which no prefix rule matches), IPv4-mapped IPv6, DNS rebinding, and a
redirect to a private host AFTER the check, since validation happens before `proxyHealthCheck`.
Each is a hypothesis from the shape, NOT measured here — measure before fixing.

## Proposed fix

1. **The three minting routes**: `authorize(auth, 'create-agent')`, exactly as
   `app/api/agents/route.ts:74`. They need `requireAuth` (for the context) rather than
   `enforceAuth` — that is the whole reason the weak helper was reachable.
2. **`inject-skill`**: decide the authority. `'manage-skills'` is the vocabulary the element
   pipelines use for "install/remove an element", which is what this is.
3. **`health`**: decide whether it should authenticate at all. If the dashboard calls it
   pre-login, that is a real constraint — establish it before adding a gate. The denylist gaps are
   a separate, smaller card.
4. **Audit `enforceAuth`'s other callers.** This card found 4 in one subtree. The helper is not
   wrong — "any authenticated caller" is a legitimate policy — but every use is an ASSERTION that
   the policy is intended, and nothing checks it.

## Verification

- A MEMBER-title token is refused by each of the three minting routes; a MANAGER is allowed
  (positive control). Pin the REASON, not just `success === false`.
- NEUTER each added `authorize` call, line-anchored, and record the observed red set.
- The coverage-guard ledger in `tests/unit/agent-route-authorization-coverage.test.ts` SHRINKS by
  each route fixed — the ledger's own contract says it may shrink but must never grow silently.

## Estimated risk

**Priority 0 for the three minting routes.** Same capability, same fleet, same class as F1SL03CK —
which was rated priority 0 and is the reason this sweep happened. LOW risk to fix: one authorize
call per route, following a landed pattern.

## The `creation-helper/*` cluster — all 10 measured

**There is NO shared authorization guard in the subsystem.** Only `chat` checks `isSystemOwner`
(verified separately: its `sendMessage` path gates on it). The other nine each decide for
themselves, and none authorizes.

Verified first-hand, the three with the largest blast radius:

| route | guard | note |
|---|---|---|
| `publish-plugin` | `enforceAuth` only (`:233`) | writes the LOCAL marketplace |
| `session` | `authenticateFromRequest` only (`:20`, `:41`, `:62` — three verbs) | spawns a session process |
| `kill` | `enforceAuth` only (`:23`) | terminates a process |

⚠ **I primed the sub-agent to look hardest at `publish-plugin` on the theory that an outward-facing
publish reachable without authorization would be the worst thing in the set. It is NOT
outward-facing.** My own needle (`gh |git push|api\.github|https://github`) returned 2 hits and
BOTH are comments — `gh ` matched inside the word "throu**gh** " at `:321`, and `:363` mentions
`claude plugin` in prose. The route's only marketplace call is
`UpdateMarketplace({name: LOCAL_MARKETPLACE_NAME}, {isSystemOwner: true})` at `:371`, and that
`isSystemOwner` is a PASSED value, not a check — the same shape as `role-plugin-service:1070`.
Use-vs-mention, in my own grep, for the third time in one session. Recorded because the
de-escalation is the finding: severity here is local, not public.

Reported by the sub-agent and NOT yet verified by me — treat as candidates, not facts:
`cleanup`, `file-picker`, `raw-materials` (HOLE-CANDIDATE); `clear-banner`,
`element-descriptions`, `ensure-persona`, `heartbeat` (NEEDS-DECISION).

## Scope note

All 19 ledger entries are now measured. **3 are priority-0 (the minting routes above), 3 are
correctly gated, and the rest are authenticated-only mutations whose intended policy nobody has
stated.** `role-plugins/sync-defaults` is NEEDS-DECISION: a fleet-wide settings rewrite with no
authz but a deterministic payload, so the question is whether "any authenticated caller may
re-assert defaults" is intended.

## PRIORITY-0 HALF LANDED — 2026-08-22T22:37:10+0200 (`7e044958`, `a65e06f9`)

All three minting routes now run `authorize(auth, 'create-agent')`, matching
`app/api/agents/route.ts:61-74`. The coverage ledger shrinks **19 → 16**, which is its own
contract working ("may SHRINK as each is decided; must never grow without a deliberate edit").
`tsc --noEmit` 0 lines; **63/63** across the four affected suites.

**THE POSITIVE CONTROL CAUGHT A REAL DEFECT IN THE FIX ITSELF.** My first cut used `requireAuth`,
which returns `{ok, context, agentId}` — but `authorize()` reads `auth.governanceTitle` off an
`AgentAuthResult`, and that field is `undefined` on `requireAuth`'s shape. **The gate denied EVERY
caller, including a MANAGER.** All three MEMBER-denial tests passed anyway, because a gate that
refuses everyone refuses a MEMBER too. Only the "a MANAGER is NOT refused" control failed — the
one case a denial-only suite cannot see by construction. Corrected to `authenticateFromRequest`,
the shape the landed route already uses.

**NEUTER (observed, `scripts/dev/neuter`, restore blob-verified):**
`s/if \(!authz.allowed\)/if (false)/ if $. == 41` on `create-persona/route.ts` → **1 red / 3
green**, predicted 1. Only that route's denial reddens; the other two stay green, which is what
proves these are three INDEPENDENT gates rather than one shared guard exercised three times.

The FIRST neuter attempt reddened nothing and looked correct:
`s/const authz = authorize/const authz = {allowed:true} && authorize/`. `{allowed:true}` is
truthy, so `&&` returns its RIGHT operand — the line changed and the behaviour did not. A textual
diff plus a green suite is indistinguishable from an unpinned guard. Mutate the CHECK, not the
call.

## Acceptance

This card was filed with **zero checkboxes** — a `security` card with a vacuous completion gate,
which is the exact defect repaired on TRDD-JWE3CFLV two hours earlier and then repeated here.
Adding it:

- [x] `create-persona` · `create-from-toml` · `docker/create` each run
      `authorize(auth, 'create-agent')` before any mutation
- [x] each uses `authenticateFromRequest` (not `requireAuth`) so `authorize()` receives an
      `AgentAuthResult` and can read `governanceTitle` — the bug the positive control caught
- [x] a MEMBER-title denial test per route, pinning the REASON and asserting the service was
      never called (a 403 over a completed side effect is not a refusal)
- [x] a MANAGER positive control, without which a deny-everyone gate passes every other test
- [x] neuter observed and recorded with its predicted-vs-observed count, line-anchored
- [x] the coverage ledger shrunk 19 → 16 rather than the guard being loosened
- [x] `role-plugins/inject-skill` — DONE 2026-08-26 (`da061b32` + the ledger-shrink commit).
      Authority decided as `authorize(auth, 'manage-skills')` with NO target agent: MANAGER +
      system owner only (a plugin mutation is fleet-wide, not team-scoped, so COS is refused by
      authorize()'s no-target branch — that is the general rule doing the right thing, not a
      special case). Same `authenticateFromRequest` shape as the minting siblings. Pinned by
      tests/unit/inject-skill-route-authorization.test.ts: MEMBER 403 pinning the reason +
      service-not-called, MANAGER positive control, neuter OBSERVED 1 red / 1 green exactly as
      predicted. Coverage ledger shrunk 16 → 15.
- [x] `health` — DONE 2026-08-26 (`1a88fe48`). The pre-login constraint was MEASURED and does
      not exist: the route has NO callers anywhere — app/components/hooks use
      `/api/hosts/health`, headless *.mjs, scripts/ and the fleet plugin repos carry zero hits
      (the AMAMA report-formats reference even asserts "There is no separate /api/agents/health
      endpoint"). So unauthenticated was an omission. Decided: `enforceAuth` (any authenticated
      caller may probe); the SSRF denylist stays as the independent second layer. Pinned by
      tests/unit/agents-health-route-authentication.test.ts (unauthenticated 401 +
      proxy-never-called, authenticated positive control; neuter OBSERVED 1 red / 1 green).
      The route stays in the collection ledger — it authenticates but does not AUTHORIZE, and
      "any authenticated caller" is now its recorded, decided policy rather than an unreviewed
      default. Zero-caller note: deleting the route outright would be a public-API removal
      (Tier-3 floor) — flagged here rather than done.
- [ ] the 7 sub-agent-reported `creation-helper` routes VERIFIED first-hand, not relayed
- [ ] `role-plugins/sync-defaults` — a ruling on whether "any authenticated caller may re-assert
      defaults" is intended
- [x] audit `enforceAuth`'s callers outside this subtree — DONE, and it found the guard's next
      blind spot: **26 mutating routes call `enforceAuth` with no authorization, and 17 of them
      are OUTSIDE `app/api/agents/`**, so no guard can see them. Filed as **TRDD-R268J32X**.
      This card's own sample is why that matters: of the first four such assertions examined,
      three were wrong.

## Approval log

- 2026-08-22T22:30:28+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
