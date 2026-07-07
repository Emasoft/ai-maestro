---
trdd-id: RF122HBJ
title: Build-time guard that every requireSudoToken template is a reachable strict-registry entry
column: proposal
created: 2026-07-07T03:43:13+0200
updated: 2026-07-07T03:43:13+0200
current-owner: scenario-runner
approval-tier: 2
priority: 0
severity: HIGH
effort: M
labels: [scenario-improvement, scen-016, batch-backlog-20260707]
task-type: security
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_016_2026-06-23T13-18-05Z.md"]
---

# TRDD-RF122HBJ — Guard that sudo templates match reachable strict-registry entries

## Problem

The SCEN-016 BUG-001 class is "the path template passed to `requireSudoToken` does not
correspond to a strict-registry entry that matches the route's own request URL". Nothing
detects a registered-but-unreachable template today (the `/api/agents/[id]/title` tag was
strict in security-registry.json, but no request URL can ever match it — there is no such
route). Verified 2026-07-07: no `tests/security/` scanner exists.

## Root cause

Two truths must hold for op-binding to work and neither is enforced: (1) the template a
route passes MUST be a strict registry entry (else `requiresSudo` returns false and the
guard silently no-ops — an auth hole); (2) that template's regex MUST match the route's own
URL pattern (else the client's derived operation can never normalize to it — the BUG-001
dead-end).

## Proposed fix

Add `tests/security/sudo-template-coverage.test.ts`: scan every
`requireSudoToken(request, '<METHOD>', '<template>')` call site under `app/api/`, derive
each route's URL template from its `route.ts` directory path, and assert (a)
`<METHOD>_<template>` exists in security-registry.json at level `strict`, and (b) the
route's directory-derived template equals `<template>` (or the compiled registry regex
matches a representative literal of the route's URL). Any mismatch = failing test.

## Verification

`yarn test tests/security/sudo-template-coverage.test.ts` passes at HEAD; re-introducing a
logical-tag template (or registering a strict entry no route serves) fails CI.

## Estimated risk

LOW — test/lint-only. Broader companion of TRDD-XTIOLWJH; guards the whole strict-route
surface, not just the dispatcher.

## Approval log
