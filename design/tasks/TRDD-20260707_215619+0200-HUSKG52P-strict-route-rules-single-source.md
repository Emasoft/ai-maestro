---
trdd-id: HUSKG52P
status: tasked
title: Derive strict-route rules from one source instead of 4-way string duplication
column: planned
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-21T21:59:38+0200
created: 2026-07-07T21:56:19+0200
updated: 2026-10-07T09:34:04+0200
current-owner: code-review
assignee: ai-maestro-hub-session
priority: 1
severity: MEDIUM
effort: L
labels: [code-review, review-batch-20260707, altitude, tech-debt]
task-type: refactor
min-approval-requirement: manager
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports/code-review/20260707_175225+0200-finder-CLEAN.json"]
created-by: code-review
implementation-commits: [bc281fdf7]
---

# TRDD-HUSKG52P — Derive strict-route rules from one source instead of 4-way string duplication

## Problem

A route's "this is a strict, sudo-gated operation" fact is currently spelled
out as a literal `'METHOD /path/template'` string in **four** independent
places that must agree by hand:

1. `security-registry.json` — the strict-route classification.
2. `lib/sudo-guard.ts` `STRICT_AGENT_RULES` — the per-title rule map.
3. `lib/sudo-guard.ts` `STRICT_ROUTE_TO_PORTFOLIO_OP` — the op-binding map.
4. The exact `pathTemplate` literal each route handler passes to
   `requireSudoToken(request, method, template)`.

A single typo, or a wildcard-specificity collision between two templates,
403s a legitimate user action with `sudo_operation_mismatch`.

## Root cause

There is no derived source of truth. Every new strict route (this batch alone
added `POST /api/agents/[id]/ensure-core` and `POST /api/teams`) requires a
human to retype the identical template in 3-4 files. The class has already
produced two production-grade bugs that were patched with *more* layering
rather than removing the duplication:

- **TRDD-XTIOLWJH** added `findBestMatch`/`wildcardCount` specificity scoring
  because a token minted for `/api/agents/role-plugins` normalized to the
  wrong `/api/agents/[id]` template.
- **TRDD-HZDD1CUD** added a `SudoRetryRejected` error class + UI toast purely
  to surface the same op-binding mismatch to the user instead of silently
  reverting.

Both are band-aids on the duplication, not fixes for it.

## Proposed fix

Introduce one canonical strict-route table (a single typed array/object, or
derive it from `security-registry.json` at load time) that carries, per route:
`{ method, pathTemplate, portfolioOp, titleRules }`. Then:

- `STRICT_AGENT_RULES` and `STRICT_ROUTE_TO_PORTFOLIO_OP` become *projections*
  of that table (built once at module init), not hand-maintained maps.
- `requireSudoToken` looks the template up from the same table (or the handler
  passes a symbolic route id that the table resolves), so the handler literal
  can never drift from the classification.
- Add a startup assertion (or a unit test) that every route id in the table
  has a matching handler and vice-versa, so an orphaned or missing entry fails
  loudly at build/test time instead of at runtime with a 403.

## Verification

- One place to add a strict route; a deliberately-wrong template in a handler
  fails a unit test rather than 403-ing a user.
- Re-run the TRDD-XTIOLWJH regression test (dispatcher op-binding) — still green.
- `npx vitest run` green; a new test asserts table↔handler bijection.

## Estimated risk

MED. Touches the sudo-gate hot path used by every strict route; must preserve
the XTIOLWJH specificity-scoring semantics (longest/most-specific template
wins) exactly. Dependencies: TRDD-XTIOLWJH, TRDD-HZDD1CUD (their band-aids can
be simplified once the duplication is gone, but need not be removed in the same
change).

## Approval log

- 2026-08-20T22:20:37+0200 — classified min-approval-requirement: manager (was UNSET, which made this proposal unroutable — nobody could know who to send it to). Floor computed from content: the card rewires the SINGLE SOURCE OF TRUTH for which routes are sudo-gated, currently spelled out in four hand-synced places. No literal D3 signal fires (it touches only this project's own source), but a mistake here UN-GATES a strict route, so it is taken as architectural / high-blast-radius and escalated one tier under the conservative principle — better safe than sorry. No approval is granted by this edit; the card is now merely routable.
- 2026-08-21T21:59:38+0200 — APPROVED by ai-maestro-hub-session (min-approval-requirement: manager). Re-measured the premise: security-registry.json, lib/sudo-guard.ts's STRICT_AGENT_RULES and STRICT_ROUTE_TO_PORTFOLIO_OP, and each handler's pathTemplate literal are still four independently hand-synced sources (no canonical table exists); the 4-way duplication this card targets is unchanged since filing.
- 2026-10-07T09:30:38+0200 — first-request cross-check landed in 9aae7b2d6 (local; full suite pending). A disagreement now throws on every guarded request instead of at module load.
- 2026-10-07T09:34:04+0200 — notes on 9aae7b2d6: (a) the owner's words named the password route; the check is one module-level block for all strict routes, so it was deferred for every guarded route — an interpretation, to be confirmed. (b) With a bad table every route that calls the guard throws, strict or not. (c) Nothing is logged at startup for a bad table. (d) An absent registry file is treated as checked and never retried. (e) Call-site audit by script, not by full read: 47 call sites in app routes; of the ones inside a try, none has a catch without return or throw in its first 12 lines. What the framework and the headless forwarder turn the throw into was not read. (f) Three neuters run: no call, remembered failure, check restored at load; each reddens the first-request test. (g) Not live until the server is rebuilt and restarted.

## Acceptance

- [x] The duplication is measured and every disagreement between the strict-route lists is reported
- [x] The portfolio-op map no longer repeats route strings; it is derived from the rule table
- [x] A disagreement between security-registry.json and the code tables is a throw at module load, not a silent default
- [x] Every strict route keeps its classification, agent rule and portfolio op, pinned by an explicit expected table taken from the code before the change
- [ ] The headless router's own copy (DELEGATED_STRICT_ROUTES in services/headless-router.ts) is also derived or checked against the same source
- [ ] Owner decision: the load-time check THROWS on a mismatch, so a security-registry.json edit without the matching declaration in lib/sudo-guard.ts stops the server from loading the guard (fail closed). Confirm that is wanted rather than a logged refusal of only the affected route

## Notes

- 2026-10-07T08:53:40+0200 — OWNER RULING (verbatim): "passord route - on first request". The strict-route cross-check against security-registry.json moves from module load to the first request.
