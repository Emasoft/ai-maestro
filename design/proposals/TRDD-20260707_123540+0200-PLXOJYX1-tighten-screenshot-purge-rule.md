---
trdd-id: PLXOJYX1
title: Tighten Rule 10 auto-purge to require zero ISSUE entries, not just PASS
column: proposal
created: 2026-07-07T12:35:40+0200
updated: 2026-07-07T12:35:40+0200
current-owner: scenario-runner
approval-tier: 2
priority: 3
severity: NIT
effort: S
labels: [scenario-improvement, scen-024, batch-backlog-20260707]
task-type: docs
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_024_2026-05-04T11-36-31Z.md"]
---

# TRDD-PLXOJYX1 — Tighten Rule 10 auto-purge to require zero ISSUE entries, not just PASS

## Problem
`tests/scenarios/SCENARIOS_TESTS_RULES.md` Rule 10's auto-purge clause currently
reads (verified unchanged on 2026-07-07): "If the verdict is `PASS` AND every bug
found during the run was fixed AND the fix was verified... the runner deletes its own
per-run screenshot directory." This condition is silent on non-blocking ISSUE entries
(WARN/INFO severity, distinct from BUGs). SCEN-024 found 0 bugs but 4 ISSUEs, and its
report was correctly left with `screenshots_purged: false` — but that was runner
judgment, not something the written rule actually required, since the rule as worded
only gates on bugs, not issues. A future run with 0 bugs and unaddressed issues could
legitimately auto-purge under the current wording, discarding evidence a later
P0/P1 promotion of that issue might need.

## Root cause
Rule 10 was drafted with only BUG entries in mind and didn't account for the
ISSUES-NOTICED category (Rule 5's non-blocking WARN/INFO findings) when the auto-purge
clause was added.

## Proposed fix
Amend Rule 10's auto-purge condition in `tests/scenarios/SCENARIOS_TESTS_RULES.md`
from "verdict is PASS AND every bug found was fixed AND verified" to additionally
require zero non-blocking ISSUE entries in the report, i.e.: "verdict is PASS AND
every bug found was fixed and verified AND the report's `## Issues Noticed
(Non-Blocking)` section is empty." Alternatively (lighter-touch, preserves current
default-keep bias while giving an explicit override), add an opt-out escape hatch:
"auto-purge if zero ISSUE entries, OR if the scenario explicitly sets
`keep_screenshots: false` in its report frontmatter" — making the safer zero-issues
behavior the default while still allowing an author to force-purge when they judge
the issues immaterial.

## Verification
Re-read Rule 10 after the edit and confirm a report with `bugs_found: 0` but a
non-empty Issues Noticed section is NOT auto-purged under the new wording. Run a
scenario that produces both 0 bugs and 0 issues and confirm auto-purge still fires
correctly (no regression to the common all-clean case).

## Estimated risk
LOW — documentation-only change to the scenario rules file; no code touched. Minor
tradeoff of retaining slightly more disk usage for screenshots on issue-only runs,
which the report explicitly judges an acceptable default-keep-is-safer tradeoff.
Dependencies: none.

## Approval log
