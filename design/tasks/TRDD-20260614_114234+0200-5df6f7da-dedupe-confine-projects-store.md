---
trdd-id: 5df6f7da-138f-4486-b716-b33e4adf54ed
title: Extract the triplicated confineToProjectsStore path-traversal guard into one shared helper
status: not-started
created: 2026-06-14T11:42:34+0200
updated: 2026-06-14T11:42:34+0200
---

# TRDD-5df6f7da — De-duplicate the confineToProjectsStore path-traversal guard

**Source:** pre-merge security review of TRDD-1657a5f4, finding **NIT-1**. Report: `reports/chat-history-review/security-20260614_110626+0200.md`.

## Problem
The path-traversal guard `confineToProjectsStore()` (resolve → must end `.jsonl` → must be under `~/.claude/projects/` + `path.sep`) is copy-pasted VERBATIM into three route files:
- `app/api/sessions-browser/sessions/[sid]/range/route.ts:33`
- `app/api/sessions-browser/sessions/[sid]/search/route.ts:33`
- `app/api/sessions-browser/sessions/[sid]/context-breakdown/route.ts:36`

A security control living in triplicate means any future hardening (e.g. adding `fs.realpath` symlink resolution — the lexical-only trade-off noted as MINOR-1 in the same review) must be kept in sync across three files, and the three can silently diverge.

## Proposed change
Extract `confineToProjectsStore()` into one shared module — `services/sessions-browser-service.ts`, next to `resolveSessionPath()` — and import it in all three routes. No behavior change.

## Derived tasks / risks
- The traversal tests in `tests/unit/route-isolation.test.ts` already cover all three routes × 4 vectors and call the routes (not the helper), so they validate the shared helper through each route — they must stay green after extraction.
- Grep for any 4th copy of the guard; fold it in.
- **Coordinate** with TRDD-9e1e4b29 (session-cookie gate) — both want to centralize per-route guards in the same files; do them together to avoid two refactors of the same routes.

## Acceptance
- One definition of `confineToProjectsStore`; three routes import it; zero behavioral change.
- `tests/unit/route-isolation.test.ts` (19 tests) still green; `tsc --noEmit` + `yarn test` green.
