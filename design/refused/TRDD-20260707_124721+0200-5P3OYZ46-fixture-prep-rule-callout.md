---
trdd-id: 5P3OYZ46
title: Add a top-of-file callout requiring fixture-prep for scenarios with git-fixtures
column: refused
created: 2026-07-07T12:47:21+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 3
severity: NIT
effort: S
labels: [scenario-improvement, scen-025, batch-backlog-20260707]
task-type: docs
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_025_2026-05-04T12-16-23Z.md"]
---

# TRDD-5P3OYZ46 — Add a top-of-file callout requiring fixture-prep for scenarios with git-fixtures

## Problem
`tests/scenarios/SCENARIOS_TESTS_RULES.md`'s fixture-fields subsection
(under Rule 3 / STATE-WIPE, "Fixture fields (git-fixtures, dir-fixtures)")
already states "Fixture creation is NOT automated — the scenario author
must: 1. Fork the upstream repo... 2. Commit the baseline state and tag
it `scenario-start`... 3. Document the fork URL." — but this is buried
several hundred lines into the rules file (confirmed: no dedicated
top-of-file callout currently exists — `grep -n "fixture provisioning|
fixture-prep|Fixture Prep section"` against the file returns no matches).
A new author writing a `SCEN-NNN` with a `git-fixtures:` frontmatter
field may not notice the requirement is there at all, exactly as
happened with SCEN-025 (see TRDD-QB5PWIG3).

## Root cause
The requirement exists but has no discoverability — it's stated once, in
the middle of Rule 3's subsection, with no forward-pointer from the top
of the document where a new author would start reading.

## Proposed fix
Add a callout near the top of `tests/scenarios/SCENARIOS_TESTS_RULES.md`
(after the title, before the Table of Contents):

```markdown
> **CRITICAL — Read before authoring any new scenario:** if your scenario
> needs git fixtures (`git-fixtures` frontmatter field), directory
> fixtures (`dir-fixtures`), or a GitHub Project fixture, you MUST commit
> the provisioning recipe — either in a "Fixture Prep" subsection in the
> scenario file itself (see TRDD-F5DEUXJG for an example), or in a
> per-scenario setup script that calls the shared helpers in
> `fixture-helpers.sh` (e.g. `fixture_github_repo`,
> `fixture_github_project_v2`). The generic `setup-SCEN-NNN.sh` wrapper
> (`exec .../scenario-setup.sh NNN "$@"`) is NOT a provisioner by itself.
> Skipping this step results in SETUP_FAIL on every batch run, exactly
> like SCEN-025 (2026-05-04 — see TRDD-QB5PWIG3, TRDD-TC8TBJEU).
```

**File to edit:** `tests/scenarios/SCENARIOS_TESTS_RULES.md` (top, after
the title, before the "## Table of Contents" section).

## Verification
A new scenario author who reads only the top of
`SCENARIOS_TESTS_RULES.md` should encounter the fixture-prep requirement
before writing a `git-fixtures:` field, without needing to find Rule 3's
buried subsection first.

## Estimated risk
LOW — documentation-only addition to a rules file. No code or test
behavior changes.

## Approval log

- 2026-07-07T13:24:46+0200 — REFUSED by USER-delegated batch screening (tier 2). Covered by approved TRDD-QE1J5C91 + TRDD-F5DEUXJG.
