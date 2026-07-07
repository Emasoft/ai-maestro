---
trdd-id: XTIOLWJH
title: Regression test for op-bound sudo tokens on the dispatcher PATCH route
column: proposal
created: 2026-07-07T03:43:13+0200
updated: 2026-07-07T03:43:13+0200
current-owner: scenario-runner
approval-tier: 2
priority: 0
severity: HIGH
effort: S
labels: [scenario-improvement, scen-016, batch-backlog-20260707]
task-type: security
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_016_2026-06-23T13-18-05Z.md"]
---

# TRDD-XTIOLWJH — Regression test for op-bound sudo on the dispatcher PATCH route

## Problem

SCEN-016 (2026-06-23) found and fixed BUG-001: SUDO-01/R32 op-bound sudo tokens
permanently 403'd `PATCH /api/agents/[id]` — bricking ChangeClient, ChangeTitle-via-
dispatcher, ChangeName, ChangeFolder, ChangeCLIArgs and ChangeAvatar in the UI. The fix
landed in place, but NO regression test exists (verified 2026-07-07: no
`tests/services/sudo*` and no `tests/security/` directory), so the same class of failure
can silently return.

## Root cause

Op-binding's invariant is `mint-time-normalized-template === verify-time-checked-template`.
The dispatcher route violated it by passing a "logical tag" (`/api/agents/[id]/title`)
different from the URL the client's `sudoFetch.deriveOperation` derives
(`/api/agents/[id]`). Unbound tokens skip the op-check, so pre-existing tests passed; no
test exercised the op-bound mint→verify round-trip against this route.

## Proposed fix

Add `tests/services/sudo-op-binding.test.ts`: for every strict route reached via
`sudoFetch`, mint an op-bound token for the literal browser URL (e.g.
`PATCH /api/agents/abc123`), then assert (1) the registry `matchedEntryKey` resolves to an
entry whose stripped template equals the template the route passes `requireSudoToken`,
and (2) consuming the minted token against that guard template does NOT yield
`sudo_operation_mismatch`. Parametrize over the real (method, guardTemplate) pairs used in
`app/api/agents/[id]/route.ts`, `.../session/route.ts`, `.../transfer/route.ts`,
`app/api/teams/[id]/route.ts`, and the other strict callers.

## Verification

`yarn test tests/services/sudo-op-binding.test.ts` fails when any route's guard template
is re-broken (e.g. re-introducing the `/title` logical tag) and passes at HEAD.

## Estimated risk

LOW — test-only. Companion of TRDD-RF122HBJ (the template-coverage guard, which covers the
whole route surface mechanically); implement together.

## Approval log
