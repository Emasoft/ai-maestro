---
trdd-id: 714ACXCM
title: Migrate aim-helpers.sh screenshot root to the Rule 10 canonical reports path
column: proposal
created: 2026-07-07T12:44:38+0200
updated: 2026-07-07T12:44:38+0200
current-owner: scenario-runner
approval-tier: 2
priority: 3
severity: NIT
effort: S
labels: [scenario-improvement, scen-027, batch-backlog-20260707]
task-type: infra
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_027_2026-05-23T00-42-41Z.md"]
---

# TRDD-714ACXCM — Migrate aim-helpers.sh screenshot root to the Rule 10 canonical reports path

## Problem

`tests/scenarios/SCENARIOS_TESTS_RULES.md` Rule 10 (PHOTOSTORY) specifies
the canonical screenshot path as
`reports/scenarios-runner/screenshots/SCEN-NNN_<RUN_ID>/...`. But
`tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh` still points
`AIM_SCREENSHOTS_ROOT` at the legacy `tests/scenarios/screenshots`
location. Confirmed at HEAD (2026-07-07):
```
tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh:27:
AIM_SCREENSHOTS_ROOT="${AIM_SCREENSHOTS_ROOT:-${CLAUDE_PROJECT_DIR:-$(pwd)}/tests/scenarios/screenshots}"
```
(used at line 92: `local out_dir="${AIM_SCREENSHOTS_ROOT}/SCEN-${scen}_${run_id}"`).
As a result, SCEN-027's screenshots landed at
`tests/scenarios/screenshots/SCEN-027_20260523T002735Z/` rather than the
Rule-10-canonical `reports/scenarios-runner/screenshots/SCEN-027_.../`.
(Note: the report this proposal is converted from stated line 6 for this
assignment; at HEAD it is line 27 — the file has grown since then, but
the assignment itself and its wrong default path are unchanged.)

## Root cause

Authoring debt: Rule 10 in `SCENARIOS_TESTS_RULES.md` was updated to point
at `reports/scenarios-runner/screenshots/` (also noting the "Output
directory note: as of 2026-04-19 ... reports/scenarios-runner/ ... is
git-tracked. The prior path tests/scenarios/screenshots/ is deprecated —
do NOT save new screenshots there."), but `aim-helpers.sh`'s
`AIM_SCREENSHOTS_ROOT` default was never updated to match.

## Proposed fix

In `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh:27`, change:
```bash
AIM_SCREENSHOTS_ROOT="${AIM_SCREENSHOTS_ROOT:-${CLAUDE_PROJECT_DIR:-$(pwd)}/tests/scenarios/screenshots}"
```
to:
```bash
AIM_SCREENSHOTS_ROOT="${AIM_SCREENSHOTS_ROOT:-${CLAUDE_PROJECT_DIR:-$(pwd)}/reports/scenarios-runner/screenshots}"
```
Also decide (and note in the commit) whether to migrate the existing
`tests/scenarios/screenshots/*` directories to the new location, or leave
them as a legacy graveyard — either is acceptable per Rule 10's own
wording ("do NOT save new screenshots there" only forbids new writes, not
retention of old ones).

## Verification

Run any scenario (or a smoke test) after the edit; confirm new screenshots
land under `reports/scenarios-runner/screenshots/SCEN-NNN_<RUN_ID>/`, not
`tests/scenarios/screenshots/`.

## Estimated risk

LOW — one-line default-value change in a shell helper script; no
production code touched. Any scenario runner relying on the old default
path via an unset `AIM_SCREENSHOTS_ROOT` env var picks up the new default
automatically; anyone who explicitly sets `AIM_SCREENSHOTS_ROOT` in their
environment is unaffected either way.

## Approval log
