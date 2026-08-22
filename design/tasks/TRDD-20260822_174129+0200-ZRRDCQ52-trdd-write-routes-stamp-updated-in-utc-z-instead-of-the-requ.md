---
trdd-id: ZRRDCQ52
title: TRDD write routes stamp updated in UTC-Z instead of the required local offset
column: todo
created: 2026-08-22T17:41:29+0200
updated: 2026-08-22T17:41:29+0200
current-owner: user
created-by: user
task-type: bugfix
min-approval-requirement: manager
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-22T17:41:29+0200
---

# TRDD write routes stamp updated in UTC-Z instead of the required local offset

## Problem
The TRDD spec requires ISO 8601 dates **with the local offset** (`%Y-%m-%dT%H:%M:%S%z`). The API
write path stamps `updated:` as UTC with milliseconds and a `Z` suffix instead.

Measured 2026-08-22, and the evidence is unusually clean: across `design/tasks/`, **148 cards carry
the local-offset form and exactly 2 carry UTC-Z** — and those 2 are precisely the two cards written
through the API that day, `K2WJH7RF` (via `promote`) and `8I0JUCK9` (via `approve`):

    updated: 2026-08-22T15:40:16.145Z
    updated: 2026-08-22T15:31:24.411Z

The repo already contains BOTH formatters, and the write path picked the wrong one:

- `lib/trdd-create.ts:67` — `const offMin = -d.getTimezoneOffset()`, the CONFORMANT local-offset
  stamp. This is why `create` produces correct filenames and timestamps.
- `lib/trdd-store.ts:110` — `if (v instanceof Date) return v.toISOString()`, which emits UTC-Z and
  is what the mutating verbs serialize through.
- `lib/trdd-doctor.ts:1141` is a THIRD variant, `.replace(/\.\d+Z$/, '+0000')` — UTC hacked into
  offset shape.

`trddgrep validate` does not flag it, so the drift is silent: the board sorts on `updated:`, and a
format the tooling does not police is a format that will keep drifting.

## Proposed fix
One formatter, used by every writer. Promote the `trdd-create.ts` local-offset helper to the shared
serializer in `trdd-store.ts` and delete the two rival spellings, so a rename or a new verb cannot
reintroduce a third.

## Verification
- Drive `promote`/`approve`/`archive` and assert the resulting `updated:` matches
  `^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$`.
- A conformance test asserting exactly ONE timestamp formatter exists, so the count cannot grow
  back to three.
- Add the format check to `trddgrep validate` so future drift is caught rather than counted later.

## Approval log

## Approval log

- 2026-08-22T17:41:29+0200 — MANDATE issued by user (min-approval-requirement: manager). Pre-approved: issuer authority >= required approver. No approval request was sent.
