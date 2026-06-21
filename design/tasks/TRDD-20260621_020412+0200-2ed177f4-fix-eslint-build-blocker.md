---
trdd-id: 2ed177f4-3def-48e3-8ba8-857026078d0b
title: yarn build broken by stale eslint-disable for an unloaded typescript-eslint rule
column: complete
created: 2026-06-21T02:04:12+0200
updated: 2026-06-21T02:04:12+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
task-type: bugfix
severity: HIGH
release-via: none
parent-trdd: TRDD-903b7a20
relevant-rules: []
test-requirements: [lint, typecheck]
labels: [build, eslint, ci, pre-existing]
---

# TRDD-2ed177f4 — yarn build blocked by a stale eslint-disable rule

**Source:** the overnight campaign's deployability verification (TRDD-903b7a20) —
ran `yarn build` to confirm the 8 governance/security fixes produce a deployable
bundle, and discovered the build was **already broken** (pre-existing, unrelated to
the campaign).

## Problem
`yarn build` (→ `next build` → eslint) failed:
```
./lib/portfolio-check.ts:63  Error: Definition for rule '@typescript-eslint/no-var-requires' was not found.
./lib/portfolio-issue-guard.ts:109  Error: Definition for rule '@typescript-eslint/no-var-requires' was not found.
```
Both files have a lazy CommonJS `require()` (sync, inside a sync guard, to avoid a
circular import) preceded by `// eslint-disable-next-line @typescript-eslint/no-var-requires`.
ESLint errors when an `eslint-disable` names a rule it doesn't know — and the
`@typescript-eslint` plugin is **no longer loaded** by the current
`next/core-web-vitals` config (a dependency-drift artifact). Confirmed empirically:
renaming to the modern `@typescript-eslint/no-require-imports` ALSO errored
"rule not found" → the whole `@typescript-eslint/` prefix is unregistered in this
eslint run, so NO rule name under it resolves.

**Pre-existing, not a campaign regression:** `git diff fork/governance-rules..HEAD`
shows none of the 21 campaign commits touched these files, `.eslintrc.json`, or
`package.json`.

## Fix
Removed the stale `eslint-disable` comments from both files (the only safe fix —
any `@typescript-eslint/*` disable errors as unknown). Since the plugin's rules are
not active, the `require()` is not flagged, so no suppression is needed. Replaced
each comment with a plain explanatory comment (why the lazy `require` is used + why
no disable is needed). The `require()` stays `require` (the functions are SYNC and
return booleans — a dynamic `await import()` would not work).

## Bug autopsy (why + guardrail)
An inline `eslint-disable` is coupled to the active plugin set. When a dependency
update changed which plugins `next/core-web-vitals` loads, the `@typescript-eslint`
rules stopped resolving and every disable naming one became a **build error** — even
though tsc and the unit suite stayed green (they don't run the next/eslint step).
Guardrail: run `yarn build` (not just `tsc --noEmit`) after dependency updates and
in CI — it is the only gate that exercises `next lint`. (tsc + vitest passing is
NOT sufficient to prove the branch builds.)

## Verification
- `npx next lint` → no errors (the rule-not-found errors are gone; `<img>` warnings
  are pre-existing/expected).
- **`yarn build` → SUCCESS** ("Done in 49.78s", full route table emitted).
- Lint-comment-only change → zero type/runtime impact (tsc already clean; the unit
  suite is unaffected — these files have no logic change).

## Implementation (2026-06-21)
`lib/portfolio-check.ts` + `lib/portfolio-issue-guard.ts`. Landed in the overnight
campaign (TRDD-903b7a20). Not pushed. Unblocks `yarn build` for the eventual
governance PR carrying all 8 campaign fixes.
