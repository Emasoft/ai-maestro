---
trdd-id: F5DEUXJG
title: Add a Fixture Prep subsection to SCEN-025 documenting its GitHub prereqs
column: proposal
created: 2026-07-07T12:47:21+0200
updated: 2026-07-07T12:47:21+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: LOW
effort: S
labels: [scenario-improvement, scen-025, batch-backlog-20260707]
task-type: docs
parent-trdd: null
npt: []
eht: []
relevant-rules: [25]
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_025_2026-05-04T12-16-23Z.md"]
---

# TRDD-F5DEUXJG — Add a Fixture Prep subsection to SCEN-025 documenting its GitHub prereqs

## Problem
`tests/scenarios/SCENARIOS_TESTS_RULES.md` says fixture preparation is
the scenario author's job (Rule 3's fixture-fields subsection: "Fixture
creation is NOT automated — the scenario author must... document the
fork URL"), but provides no per-scenario recipe. A reader who hits
SETUP_FAIL on SCEN-025 today has to read `scenario-setup.sh` to find the
rule, then read `fixture-helpers.sh` to find available helpers, then
write missing helpers themselves — exactly what happened with SCEN-025
(no such recipe was ever written down, hence TRDD-QB5PWIG3).
`tests/scenarios/SCEN-025_kanban-with-github-project.scen.md` currently
has no such section (confirmed: no "Fixture Prep" heading exists between
its frontmatter and `## Phase 0: SAFE-SETUP` at line 72).

## Root cause
The scenario file structure has phases and steps but no dedicated
"how do I provision this scenario's external fixtures" section, so the
recipe lived only in a report file (now converted into TRDD-QB5PWIG3)
instead of the scenario itself.

## Proposed fix
After TRDD-QB5PWIG3's fixture provisioning lands (so the recipe below can
cite the real, verified project number instead of a placeholder), insert
a new section into `tests/scenarios/SCEN-025_kanban-with-github-project.scen.md`
between the frontmatter close (line 70) and `## Phase 0: SAFE-SETUP`
(line 72):

```markdown
## Fixture Prep (one-time, before first run)

This scenario depends on the following GitHub fixtures. They are NOT
auto-created by the runner; a maintainer prepares them once via
`fixture_github_repo` + `fixture_github_project_v2`
(`tests/scenarios/scripts/fixture-helpers.sh`), and
`setup-SCEN-025.sh` refreshes them on every run.

### Prereq 1 — GitHub repo
- Name: `Emasoft/scen025-kanban-fixture`
- Visibility: public
- Description: "SCEN-025 scenario test fixture — safe to ignore"
- Initial state: README + LICENSE only
- Tag: `scenario-start` at the initial commit

### Prereq 2 — GitHub Project
- Owner: `Emasoft`
- Title: `SCEN-025 Fixture Board`
- Status field options: the ratified TRDD `column:` vocabulary — see
  `~/.claude/rules/trdd-design-tasks.md` v2 and `docs/GOVERNANCE-RULES.md`
  R25 (Three-Pillars Task System). This board is a GitHub-Project MIRROR
  of the TRDD state machine, not an ad-hoc kanban list.
- Linked to Prereq 1

### One-time provisioning
See TRDD-QB5PWIG3 for the exact commands, or run:
\`\`\`bash
source tests/scenarios/scripts/fixture-helpers.sh
fixture_github_repo "Emasoft/scen025-kanban-fixture" empty
fixture_github_project_v2 Emasoft "SCEN-025 Fixture Board"
\`\`\`
```

**File to edit:** `tests/scenarios/SCEN-025_kanban-with-github-project.scen.md`
(insert between line 70 and the `## Phase 0` heading).

## Verification
A new author who reads SCEN-025 top-down should be able to provision and
run it without grepping `scripts/`.

## Estimated risk
LOW — additive documentation only. Should land after TRDD-QB5PWIG3 and
TRDD-TC8TBJEU so it documents the actual (not placeholder) provisioning
recipe and the ratified column vocabulary.

## Approval log
