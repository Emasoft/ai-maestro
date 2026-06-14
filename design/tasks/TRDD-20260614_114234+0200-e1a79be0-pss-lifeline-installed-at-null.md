---
trdd-id: e1a79be0-01d4-4ad1-99ff-b8310bb7cc16
title: PSS lifeline installedAtIso is always null — asOfComponents reads fields the PSS schema does not emit
status: not-started
created: 2026-06-14T11:42:34+0200
updated: 2026-06-14T11:42:34+0200
---

# TRDD-e1a79be0 — Fix the always-null PSS lifeline install timestamp

**Source:** pre-merge correctness review of TRDD-1657a5f4. Report: `reports/chat-history-review/correctness-20260614_110801+0200.md`. Related PSS engine issue: [Emasoft/perfect-skill-suggester#10](https://github.com/Emasoft/perfect-skill-suggester/issues/10).

## Problem
`lib/pss-lifeline.ts` `asOfComponents` / `rowToComponent` (≈ lines 1333-1351) read `installed_at` / `observed_at` from the PSS `as-of` rows, but the verified PSS `as-of` row schema emits NEITHER (it emits `element_id, element_name, element_type, scope, scope_path, path, content_hash, file_size, token_count, enabled, event_type`). Effect: `installedAtIso` is ALWAYS null — the context panel's "installed when" lifeline never shows a date. Not a crash (defaults cleanly; core name/type/scope extraction works), but a silently non-functional feature presenting as available data.

## Proposed change
Either (a) derive a real timestamp from a field the schema DOES emit (e.g. `event_type` + the scan-log timeline, or the `installed-between` / `timeline` PSS verbs), or (b) drop the `installedAtIso` field until the PSS engine emits install timestamps.

## Derived tasks / risks
- **Partly blocked on the PSS engine:** per PSS#10, install dates are currently synthetic (migration date) and history doesn't accrue. Confirm whether the `timeline` / `installed-between` verbs can supply a real per-element install instant; if not, take option (b) until PSS#10 is resolved.
- Whichever path: add a test asserting `installedAtIso` is either a valid ISO date (option a) or absent (option b) — never a silently-null field masquerading as available data.
- The chat-history context panel must keep degrading gracefully when PSS data is stale/absent (already does — don't regress it).

## Acceptance
- The "installed when" lifeline shows a real date OR the field is removed; no silent always-null.
- Behavior documented; `yarn test` + `tsc --noEmit` green.
