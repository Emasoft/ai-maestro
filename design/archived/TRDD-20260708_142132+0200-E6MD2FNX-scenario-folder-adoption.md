---
trdd-id: E6MD2FNX
title: New UI scenario — wizard folder-adoption of a git plugin repo (maintainer path)
column: completed
created: 2026-07-08T14:21:32+0200
updated: 2026-07-13T10:41:29+0000
current-owner: main-session
assignee: main-session
priority: 2
severity: MEDIUM
effort: M
labels: [fleet-readiness, import-system, scenario, derived-eht]
task-type: feature
parent-trdd: TRDD-57EBNB72
derived: true
derived-kind: eht
approval-tier: 0
release-via: none
test-requirements: [dev-browser-headless]
relevant-rules: []
implementation-commits: []
---

# New UI scenario — wizard folder-adoption of a git plugin repo

Derived EHT of TRDD-57EBNB72: no scenario exercises the wizard's "Browse existing project
folder" flow (the exploration confirmed zero coverage), which is exactly how the flow silently
broke at the API boundary without anyone noticing. A scenario makes the regression visible the
next time.

## Scope

Author `tests/scenarios/SCEN-0NN_folder-adoption-wizard.scen.md` per SCENARIOS_TESTS_RULES:

1. `dir-fixtures`: a prepared git-repo fixture under `~/agents/` (scenario-start tag) — Rule 0
   requires import sources inside `~/agents/`.
2. Steps: wizard → MAINTAINER title → folder picker (browse the fixture) → github-repo step
   arrives PREFILLED from the fixture's git origin → create → verify via API: registry entry,
   workingDirectory == fixture path, `.gitignore` managed block present, `git status
   --porcelain` empty, DEP rules seeded.
3. Also cover: AUTONOMOUS adoption (no github-repo step) and delete-with-folder + re-import
   (tombstone regression from the folders route fix).
4. CLEANUP per Rule 1 (delete agent, purge cemetery, restore fixture via scenario-start tag).

## Result — 2026-07-08

Authored as **SCEN-028** (`tests/scenarios/SCEN-028_folder-adoption-wizard.scen.md`,
19 steps, `browser_stack: dev-browser`) plus:

- `tests/scenarios/scripts/setup-SCEN-028.sh` / `cleanup-SCEN-028.sh` — the cleanup
  wrapper additionally scrubs the per-run artifacts adoption seeds INTO the permanent
  fixture (.claude/rules/aimaestro-*.md, settings.local.json, the managed
  `.git/info/exclude` block) since `git reset --hard scenario-start` cannot remove
  untracked/outside-worktree files.
- Permanent dir fixture created at `~/agents/scen028-import-fixture` (git repo,
  `scenario-start` tag, origin `https://github.com/Emasoft/scen028-import-fixture.git`
  — never fetched; the github-repo prefill is a pure fs read).
- `NEXT_SCEN_NUMBER` bumped 28 → 29.

Covers: maintainer adoption with github-repo PREFILL assertion, clean-tree +
exclude-block fs verification, soft-delete → SAME-folder re-adopt as AUTONOMOUS
(tombstone regression), idempotent-seeding re-check, full Rule 1/3/12 cleanup.
First RUN pending (scenario `commit:` field updates after the first successful run,
per SCENARIOS_TESTS_RULES) — the underlying flow was already live-verified via API
in WS1b (TRDD-VT6SSI0T).

## Approval log

- 2026-07-08T18:20:00+0200 — COMPLETED by main-session (tier 0). Scenario + scripts +
  fixture authored; regression coverage for the adoption flow now exists.
