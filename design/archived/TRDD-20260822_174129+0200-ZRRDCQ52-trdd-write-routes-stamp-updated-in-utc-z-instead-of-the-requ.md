---
trdd-id: ZRRDCQ52
title: TRDD write routes stamp updated in UTC-Z instead of the required local offset
column: superseded
superseded-by: [S13L6R9R]
created: 2026-08-22T17:41:29+0200
updated: 2026-08-22T21:09:35+0200
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
- 2026-08-22T21:09:35+0200 — SUPERSEDED by `TRDD-S13L6R9R`, set by main under the owner's standing
  delegation to decide on their behalf on verified facts (recorded here rather than implied, because
  the supersede-authority check expects the editor to be the replacement's `created-by`).

## SUPERSEDED — 2026-08-22T21:09:35+0200 — by TRDD-S13L6R9R

Two cards were minted for the SAME defect 36 minutes apart (`ZRRDCQ52` 17:41, `S13L6R9R` 18:17) and
neither referenced the other. `S13L6R9R` is the one that was worked — 292 lines of findings against
this card's 59 — so this one is superseded rather than duplicated forward.

**This card was NOT a pure duplicate, and that mattered.** Read before superseding, it carried two
asks `S13L6R9R` did not:

1. *"One formatter, used by every writer... so a rename or a new verb cannot reintroduce a third."*
   **DELIVERED** in `62782420`. Building it surfaced why it had to be a CALL-SITE test: every store
   verb (`editTrdd`, `promoteTrdd`, `refuseTrdd`, `archiveTrdd`, `advanceColumn`) takes `iso` as a
   REQUIRED PARAMETER, so the store never chooses a format — a conformance test driving those verbs
   would assert the value the test itself passed in. The 5 routes are the whole decision surface.
   Neuter recorded: breaking one route's `isoLocal` reddens the guard and NAMES that route.
2. *"Add the format check to `trddgrep validate` so future drift is caught rather than counted."*
   **NOT DELIVERED, and the reason is its own finding:** the `trddgrep` on PATH is dated
   `Jul 30 07:51` and DIFFERS from `scripts/trddgrep.mjs`, so it cannot see a rule added today
   (0 hits). Filed as **`TRDD-2P25M6AS`**. The rule itself IS live in `lintCorpus` and is pinned by
   a corpus test, so the drift is gated — just not through that binary yet.

Its third verification bullet (drive a live `promote`/`approve` and assert the resulting `updated:`)
is descoped to **`TRDD-8I0JUCK9`**, which owns the live-write-verb smoke and needs a running server.

Its measurement was also correct and is worth preserving: it caught the drift at **2 cards** the day
it was filed. By the time `S13L6R9R` closed it was **24 cards / 25 sites** — the cost of the hours
between filing and fixing, and the argument for the gate that now exists.
