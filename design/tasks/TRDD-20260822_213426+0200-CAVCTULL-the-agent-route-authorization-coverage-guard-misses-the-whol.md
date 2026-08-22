---
trdd-id: CAVCTULL
title: The agent-route authorization coverage guard misses the whole collection subtree
column: todo
created: 2026-08-22T21:34:26+0200
updated: 2026-08-22T22:13:49+0200
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

## GUARD LANDED — 2026-08-22T21:47:44+0200

**⚠ CORRECTION to the Problem section above: the count is 19, not 18.** Re-derived with an exact
enumeration (both tiers separated) rather than the two-field grep the first pass used. The card,
and the commit message that filed it, both said 18. The 19th is `creation-helper/session/route.ts`.
Numbers published from a quick grep get re-derived before anyone builds on them; this one was.

Measured, both subtrees, mutating routes only:

| subtree | STRONG (`authorize`/`requireSudoToken`/`canIssue`) | FORWARD-ONLY (`buildAuthContext`) | NONE |
|---|---|---|---|
| `[id]/` | 21 | 10 | **0** (its ledger is empty and stays so) |
| collection | 5 | 2 | **19** |

**A SEPARATE root and ledger, not one widened walk.** The `[id]` ledger is EMPTY, and that
emptiness is hard-won — eight entries closed, every one worse than the ledger's own "several are
probably fine". Folding 19 collection entries into it would destroy that signal.

**The forward-only tier is now PINNED at 12** (10 + 2) rather than counted as covered. It does not
fail the suite — verifying an entry means reading its pipeline's Gate 0, one at a time — but it
cannot grow silently, and it is named UNVERIFIED instead of passing as authorized.

**The proof that matters, because a widened root that still matches nothing looks identical to a
clean one:** seeding an unauthorized collection route makes the suite RED and NAMES the route
(`zz-probe-unauthorized/route.ts`, 2 tests red). The probe was then moved to `scripts_dev/probes/`
rather than deleted (RULE 0), and the app tree verified clean. A positive control also asserts the
walker reaches ≥26 collection routes and contains `route.ts` by name, so a mis-joined path fails
loudly instead of reporting clean.

## Acceptance

- [x] scan root widened to the collection subtree, as a parallel block that leaves the `[id]`
      ledger provably empty
- [x] the 19 seeded as a debt ledger rather than shipped as 19 failures — a wall of red is how a
      linter gets routed around
- [x] `buildAuthContext(` split into a FORWARD-ONLY tier, pinned at 12 and named unverified
- [x] positive control: the walker reaches ≥26 routes and names `route.ts`; a broken root fails
- [x] the widened guard PROVEN to fire on a seeded unauthorized route, not merely observed green
- [x] `POST /api/agents` pinned BY NAME to `authorize(auth, 'create-agent')` — the one route whose
      missing authorization was a live hole should regress loudly, not as a ledger diff
- [ ] the 19 decided one at a time, shrinking the ledger (each its own card if it turns out real)
- [ ] the 12 forward-only routes verified against their pipelines' Gate 0

## 1 of the 12 forward-only routes VERIFIED — and it was a hole (TRDD-JWE3CFLV)

`[id]/remove-element/route.ts` was the first of the 12 taken through the verification this card's
last open box asks for. Its comment states the forward theory verbatim — *"The Change\* pipelines
run their own Gate 0 authorization on the resolved authContext"* — and it forwards into SIX
pipelines. Measured by attributing every `gate0Auth` call site in
`services/element-management-service.ts` to its enclosing exported function:

| forwarded pipeline | authorizes at Gate 0? |
|---|---|
| `ChangeSkill` | yes — `gate0Auth` at 6020 |
| `ChangeMCP` | yes — `gate0Auth` at 6404 |
| `ChangeAgentDef` · `ChangeCommand` · `ChangeRule` · `ChangeOutputStyle` | **NO** — all four are one-line delegators to `changeSimpleElement`, which had **zero** authorization needles in its whole 150-line body |

So the theory held for 2 of 6 and failed for 4, and the failure was a live hole: any authenticated
agent of any title could delete another agent's rules, commands, agent-definitions and
output-styles. Fixed and pinned under **TRDD-JWE3CFLV** (`6d66db22`).

**The count stays 12 and neither box is ticked.** The fix landed in the SERVICE, so the route still
carries no STRONG needle of its own and remains forward-only — correctly. What changed is that ONE
of the twelve is now VERIFIED. **11 remain**, and the first one checked was a defect, so the
remaining eleven should not be assumed clean.

## Approval log

- 2026-08-22T21:47:44+0200 — Guard landed by main. Ledger seeded, not enforced-from-empty; the two
  open boxes are per-route review work and are deliberately NOT swept.
- 2026-08-22T21:34:26+0200 — MANDATE issued by main (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
