---
trdd-id: UDFMS3UN
title: Lean tool-output wrappers — filter tsc/eslint/vitest to errors-only (L9)
column: dev
created: 2026-06-23T21:34:06+0200
updated: 2026-06-23T21:34:06+0200
current-owner: claude-opus-session
assignee: claude-opus-session
priority: 2
severity: MEDIUM
effort: M
labels: [scenario-tests, tokens, lint, typecheck, tests]
task-type: infra
parent-trdd: TRDD-N1FYP2AW
relevant-rules: []
release-via: none
test-requirements: [integration]
runtime-targets: [macos]
impacts: [ci-pipeline]
attempts: 0
last-test-result: not-run
implementation-commits: []
---

# TRDD-UDFMS3UN — Lean tool-output wrappers (L9)

## Problem
FIX-AS-YOU-GO runs `yarn build` / `tsc` / `eslint` / `yarn test` (vitest). Their
raw output is mostly NOISE the agent doesn't need — progress bars, per-file
"✓ no issues", passed-test lists, summaries, stack frames. All of it lands in the
transcript as a Bash tool_result and rides forward every turn. The agent needs
only: **how many errors, and one line per error (file:line — message).**

## Solution — one Python wrapper that runs the tool and emits errors-only
A wrapper script that invokes the tool, parses its output, and prints a compact,
greppable summary: total counts + one line per failure, suppressing everything
else. Tools for this project (Next.js/TS):
- **typecheck** — `tsc --noEmit` (and `yarn build`'s tsc phase)
- **lint** — `eslint`
- **tests** — `vitest` (`yarn test`)

Target output shape (≤ ~1 line per real problem):
```
TSC: 3 errors
  services/foo.ts:42:7  TS2322 Type 'X' is not assignable to 'Y'
  components/Bar.tsx:10:3  TS2304 Cannot find name 'baz'
  lib/qux.ts:88:1  TS2554 Expected 2 arguments, but got 1
ESLINT: 1 error, 2 warnings
  app/page.tsx:5:1  no-unused-vars 'foo' is defined but never used
  ...
VITEST: 2 failed / 137 passed
  tests/unit/x.test.ts > "rejects empty token"  expected 401, got 200
  ...
```
Zero passes, zero clean-file lines, zero progress, zero banners. On a fully-clean
run it prints one line: `TSC: 0 errors` etc.

## Implementation
- `tests/scenarios/scripts/lean/leantool.py` — one entry point with subcommands
  `tsc` | `eslint` | `vitest` (each runs the tool with machine-readable output —
  `tsc --pretty false`, `eslint -f json`, `vitest --reporter=json` — and reduces
  it). Falls back to text parsing if JSON unavailable. Exit code mirrors the
  underlying tool (non-zero on any error) so it's CI-safe.
- A "Lean tool output (L9)" rule in `scenario-runner.md` Phase D: invoke the
  wrapper, never the raw tool, when checking build/lint/test during a fix.
- General-purpose (not scenario-only) — portable into the plugin and usable by
  any agent; documented so other agents adopt it.

## Risks / Phase-2 validation
- Parser must handle each tool's actual output format on THIS repo; validate by
  running each wrapper against a known-good and a deliberately-broken file and
  confirming the summary matches the real error set (no dropped errors, no
  false positives). A dropped error would be worse than verbosity — so the
  wrapper must NEVER swallow a real failure; on parse-uncertainty it falls back
  to passing through the tool's own error lines.
- Keep exit codes faithful so the wrapper is safe to also use in CI gates.

## Approval log
- 2026-06-23T21:34:06+0200 — Authored under /go-on-yourself. Tier 0. Child of
  TRDD-N1FYP2AW. Build the wrapper + wire FIX-AS-YOU-GO to use it.
