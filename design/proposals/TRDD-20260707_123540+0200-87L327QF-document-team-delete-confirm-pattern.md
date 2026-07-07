---
trdd-id: 87L327QF
title: Document Delete-Team inline confirm pattern in scenario rules + add a helper
column: proposal
created: 2026-07-07T12:35:40+0200
updated: 2026-07-07T12:35:40+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: LOW
effort: S
labels: [scenario-improvement, scen-024, batch-backlog-20260707]
task-type: docs
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_024_2026-05-04T11-36-31Z.md"]
---

# TRDD-87L327QF — Document Delete-Team inline confirm pattern in scenario rules + add a helper

## Problem
The Delete Team sidebar 2-click confirm pattern (Trash icon → "Confirm" button, with
an `onMouseLeave` state reset — see `components/sidebar/TeamCard.tsx:128-138`) is not
documented anywhere in `tests/scenarios/SCENARIOS_TESTS_RULES.md`. Verified on
2026-07-07: `grep -n "optimistic\|onMouseLeave\|aim_team_delete"
tests/scenarios/SCENARIOS_TESTS_RULES.md` returns nothing — no such section exists,
and `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh` has no
`aim_team_delete` helper. New scenario authors writing a team-delete step have to
independently discover (via source-code reading, as SCEN-024 did) that the standard
`page.mouse.click(x, y)` approach fails against this button because the intervening
mouse movement triggers `onMouseLeave` before the click lands, requiring a same-JS-turn
DOM `.click()` instead.

## Root cause
The pattern was implemented without an accompanying rules-file update or reusable test
helper, so each new scenario touching team deletion has re-discovered the same trap.

## Proposed fix
1. Add a "Common UI patterns" subsection to `tests/scenarios/SCENARIOS_TESTS_RULES.md`
   (near Rule 12 SUDO-MODE, since it's another UI-quirk-affecting-automation section)
   documenting: "Delete Team uses an optimistic 2-step inline confirm (Trash icon →
   Confirm button) with an `onMouseLeave` reset. Automated tests must click the Trash
   button then immediately (same JS turn, no intervening `page.mouse.move`) invoke a
   direct DOM `.click()` on the Confirm button — the standard `page.mouse.click(x, y)`
   pattern fails because it moves the cursor through/near the button first."
2. Implement `aim_team_delete <name> <password>` in
   `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh`, encapsulating the
   two-click-same-turn sequence (and the sudo password modal per Rule 12) so future
   scenario authors call one helper instead of re-deriving the DOM-click workaround.
3. Note in the same section that TRDD-RR883ETW proposes eliminating this pattern
   entirely (modal-based delete) — if that lands first, this documentation +
   helper become obsolete and should be removed/updated instead of layered on top.

## Verification
A new scenario author can grep `SCENARIOS_TESTS_RULES.md` for "Delete Team" and find
the pattern + the helper name without reading `TeamCard.tsx` source. Calling
`aim_team_delete <name> <password>` from a fresh scenario script successfully deletes
a test team end-to-end.

## Estimated risk
LOW — documentation + one new shell helper function; no production code touched.
Dependencies: supersede/update if TRDD-RR883ETW (modal-based Delete Team) lands —
check that TRDD's status before implementing this one, since the fix may make the
workaround-documentation moot.

## Approval log
