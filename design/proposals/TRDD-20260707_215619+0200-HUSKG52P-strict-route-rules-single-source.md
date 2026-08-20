---
trdd-id: HUSKG52P
title: Derive strict-route rules from one source instead of 4-way string duplication
column: proposal
created: 2026-07-07T21:56:19+0200
updated: 2026-08-20T22:20:37+0200
current-owner: code-review
assignee: null
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
