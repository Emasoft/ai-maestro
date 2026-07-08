---
trdd-id: E6MD2FNX
title: New UI scenario — wizard folder-adoption of a git plugin repo (maintainer path)
column: planned
created: 2026-07-08T14:21:32+0200
updated: 2026-07-08T14:21:32+0200
current-owner: main-session
assignee: main-session
priority: 2
severity: MEDIUM
effort: M
labels: [fleet-readiness, import-system, scenario, derived-eht]
task-type: feature
parent-trdd: TRDD-57EBNB72
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

## Approval log
