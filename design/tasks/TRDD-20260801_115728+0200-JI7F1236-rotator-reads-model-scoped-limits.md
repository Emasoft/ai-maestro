---
trdd-id: JI7F1236
title: Rotator reads limits[] — model-scoped windows, reset times, and server severity
column: backburner
created: 2026-08-01T11:57:28+0200
updated: 2026-08-01T11:57:28+0200
current-owner: ai-maestro-dev
task-type: bugfix
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-dev
approval-datetime: 2026-08-01T11:57:28+0200
severity: medium
effort: small
release-via: none
npt: []
eht: []
external-refs: [reports/claude-multi-usage-analysis/20260801_115728+0200-verified-diff-vs-our-rotator.md]
---

# Rotator reads limits[] — model-scoped windows, reset times, and server severity

## Problem

`isNearLimit()` and `isSafeAlternate()` (`lib/oauth-rotator/tick.ts:146,151-153`) decide every
rotation from **only** `five_hour` and `seven_day`. A grep for `resets_at|limits\[|display_name`
across `lib/oauth-rotator/**` returns nothing — we never read the `limits[]` array the usage
endpoint already sends us in the same response.

Verified against the live API (probe recorded in the report under `external-refs`), the response
carries three `limits[]` entries: `session` and `weekly_all`, which **duplicate** the two top-level
buckets, and **`weekly_scoped`**, a per-model weekly limit that appears in **no** top-level field.
The flat `seven_day_opus` / `_sonnet` / `_cowork` / `_omelette` keys exist but are **NULL** — the
model-scoped number is reachable only through `limits[]`.

So an account whose model-scoped weekly window is exhausted, while 5h/7d sit low:

- is not "near a limit", so we do not rotate **away** from it; and
- passes `isSafeAlternate`, so we may rotate **onto** it.

Every call on that model then fails. Not biting today (the scoped window read 5%), but it is a
blind spot in the one function whose whole job is to know whether an account can still work.

Two smaller misses in the same already-fetched payload:

- **`resets_at`** — never read. `tick.ts:516` logs *"all paid accounts maxed; waiting for a window
  to reset"* without knowing when, so it can only keep polling blindly.
- **`severity`** and **`is_active`** — the server's own classification of each window, against
  which our three hardcoded thresholds are a guess.

## Root cause

`util(usage, window)` (`lib/oauth-rotator/network.ts`) extracts exactly one scalar —
`usage[window].utilization` — and that shape silently cannot express a per-model window, a reset
time, or a severity. Every caller inherited the limitation. Not a regression: the flat
`seven_day_opus`-style fields were the whole story when the rotator was written, and the API moved
model-scoped limits into `limits[]` afterwards.

## Proposed fix

1. **Parse `limits[]`** in `network.ts` beside `util()` — a function returning the scoped entries
   (`kind`, `group`, `percent`, `severity`, `is_active`, `resets_at`, `scope.model.display_name`).
   Ignore `session` / `weekly_all`: verified to duplicate the top-level buckets.
   ⚠ The entries use **`percent`**, not `utilization` — a different field name from the buckets.
2. **Widen `isNearLimit` / `isSafeAlternate`** to take the worst of {5h, 7d, every scoped window},
   the way the reference app's `peakFraction` does. Keep the existing thresholds; a scoped window
   with no data must never trip a rotation (same null-discipline the current code has: only a
   positive over-threshold signal rotates).
3. **Surface `resets_at`** so the "all accounts maxed" path can say when the earliest window
   returns, and so a future tick can be scheduled at that instant instead of polling.
4. **Consider `severity`/`is_active`** as a cross-check on our constants — read and log first,
   act on it only once we have seen how it behaves.

Explicitly out of scope: `limit_dollars`/`used_dollars`/`remaining_dollars` (probed NULL on a
subscription plan — a metered concept, not usable here), and the six null codenamed fields.

`selectDrainFirst` is **unchanged**: picking the candidate closest to its own limit is deliberate,
so "most headroom" is not the goal.

## Verification

- A unit test on the new parser against the **real recorded response shape** (3 entries, scoped one
  carrying a `display_name`), plus one with `limits: []` and one with `limits` absent.
- A test proving the widened predicate: 5h/7d low + a scoped window over threshold ⇒
  `isNearLimit` true and `isSafeAlternate` false. **Neuter check:** reverting the predicate to the
  two-bucket form must redden exactly that test — if it reddens nothing, the fixture never carried
  a scoped window and the test is vacuous.
- The null-discipline test: a scoped window with `percent: null` must not trip a rotation.

## Estimated risk

LOW. Additive parsing of a payload we already fetch; no new endpoint, header, credential, or write.
The predicate change can only make the rotator *more* conservative (more windows can say "not
safe"), so the failure mode is an unnecessary rotation, not a rotation onto a dead account.
Dependencies: none. Does not touch TRDD-RYFP030K.

## Acceptance

- [ ] `limits[]` parsed, `session`/`weekly_all` ignored as duplicates, `percent` (not
      `utilization`) read
- [ ] `isNearLimit` / `isSafeAlternate` account for every scoped window
- [ ] `resets_at` surfaced on the "all accounts maxed" path
- [ ] tests above land green, and the neuter reddens exactly the named test
- [ ] `selectDrainFirst` behaviour unchanged

## Approval log

- 2026-08-01T11:57:28+0200 — MANDATE (self) at `min-approval-requirement: none`: in-scope bugfix in
  ai-maestro's own rotator; no governance, release, cross-team, or baseline surface. Authored
  directly in `design/tasks/`; no approval request sent.
