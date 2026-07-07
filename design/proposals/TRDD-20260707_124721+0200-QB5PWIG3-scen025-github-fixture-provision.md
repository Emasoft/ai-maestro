---
trdd-id: QB5PWIG3
title: Provision the SCEN-025 GitHub fixture infrastructure
column: proposal
created: 2026-07-07T12:47:21+0200
updated: 2026-07-07T12:47:21+0200
current-owner: scenario-runner
approval-tier: 2
priority: 0
severity: CRITICAL
effort: M
labels: [scenario-improvement, scen-025, batch-backlog-20260707]
task-type: infra
parent-trdd: null
npt: []
eht: []
relevant-rules: [25]
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_025_2026-05-04T12-16-23Z.md"]
---

# TRDD-QB5PWIG3 — Provision the SCEN-025 GitHub fixture infrastructure

## Problem
`tests/scenarios/SCEN-025_kanban-with-github-project.scen.md` (Kanban ↔
GitHub Project sync scenario) references three resources that have never
existed, confirmed still missing at HEAD (2026-07-07):

1. GitHub repo `Emasoft/scen025-kanban-fixture` — `gh repo view
   Emasoft/scen025-kanban-fixture --json name` returns "Could not resolve
   to a Repository with the name 'Emasoft/scen025-kanban-fixture'."
2. A GitHub Project fixture board for this scenario — `gh project list
   --owner Emasoft --format json` currently shows only ONE project on the
   account (`number: 1`, title `KANBAN-TEST`). No SCEN-025 board exists.
3. Local clone at `tests/scenarios/fixtures/git/scen025-kanban-fixture/`
   with tag `scenario-start` — the directory
   `tests/scenarios/fixtures/git/` does not exist at all.

Without this, SCEN-025 cannot run past setup — every batch run produces
SETUP_FAIL/STUCK for SCEN-025 and the GitHub Project sync feature
(`lib/github-project.ts`, `services/teams-service.ts` `githubProject`
field, the "Link GitHub Project" form in `components/sidebar/
TeamListView.tsx` / `components/teams/TeamCreationWizard.tsx`) has zero
scenario-level integration coverage.

## Root cause
Authoring oversight — the scenario was written assuming the fixture
infrastructure would be created in advance (its own `prerequisites:`
field says "Fixture repo cloned locally... (scenario author prepares this
in advance...)"), but no follow-up task ever did so. Compare SCEN-018:
its `setup-SCEN-018.sh` calls `fixture_github_repo` from
`tests/scenarios/scripts/fixture-helpers.sh`, which idempotently creates
GitHub repo fixtures. SCEN-025's `setup-SCEN-025.sh` is still the generic
6-line wrapper (`exec "$(dirname "$0")/scenario-setup.sh" 025 "$@"`) with
no GitHub-side provisioning at all.

## Proposed fix

**IMPORTANT — Kanban-alignment constraint (governance-rules branch,
2026-07-07):** the TRDD `column:` state machine
(`~/.claude/rules/trdd-design-tasks.md` v2 column enum; ratified as
ecosystem governance in `docs/GOVERNANCE-RULES.md` R25 "Three-Pillars
Task System") is the universal kanban vocabulary for every surface —
including GitHub Project mirrors. The original report's plan used an
ad-hoc 5-value Status list (`Backlog, Pending, In Progress, Review,
Completed`). That is now superseded: **the fixture Project's Status field
options MUST be the ratified 17-value vocabulary** (14 lifecycle columns
+ 3 exceptions), Title-Cased:

`Backburner, Todo, Design, Dispatch, Dev, Testing, AI Review,
Human Review, Complete, Publish, Published, Deploy, Live, Live Auditing,
Blocked, Failed, Superseded`

One-time provisioning (a human with `gh` write access to the `Emasoft`
account runs this once):

```bash
# Step 1 — create the empty repo with a README + LICENSE
gh repo create Emasoft/scen025-kanban-fixture --public \
    --description "SCEN-025 scenario test fixture — safe to ignore" \
    --add-readme

# Step 2 — clone, tag scenario-start at the initial commit
git clone https://github.com/Emasoft/scen025-kanban-fixture.git /tmp/scen025-fix
cd /tmp/scen025-fix
git tag scenario-start
git push origin scenario-start

# Step 3 — copy into the fixture cache the runner expects
mkdir -p /Users/emanuelesabetta/ai-maestro/tests/scenarios/fixtures/git/
cp -r /tmp/scen025-fix /Users/emanuelesabetta/ai-maestro/tests/scenarios/fixtures/git/scen025-kanban-fixture

# Step 4 — create the GitHub Project board
gh project create --owner Emasoft --title "SCEN-025 Fixture Board"
# Note the project number returned (the account currently has only
# project #1 "KANBAN-TEST", so this will likely be #2 — but do NOT
# assume; verify with `gh project list --owner Emasoft`).

# Step 5 — configure the Status field with the ratified 17-value vocabulary
# (see TRDD-TC8TBJEU's fixture_github_project_v2 helper for the exact
# GraphQL mutation — this step should be done via that helper once it
# lands, rather than by hand, to guarantee the vocabulary stays in sync).

# Step 6 — link the project to the repo
gh project link <project-number> --owner Emasoft \
    --url https://github.com/Emasoft/scen025-kanban-fixture
```

**File(s) to create/modify:**
- New GitHub repo `Emasoft/scen025-kanban-fixture` (external resource).
- New GitHub Project under `Emasoft` (external resource).
- New local clone: `tests/scenarios/fixtures/git/scen025-kanban-fixture/`.

This proposal should land AFTER TRDD-TC8TBJEU (the `fixture_github_project_v2`
helper) so the Status-field provisioning goes through the idempotent,
vocabulary-correct helper instead of ad-hoc `gh api graphql` by hand.

## Verification
```bash
gh repo view Emasoft/scen025-kanban-fixture --json name
gh project view <num> --owner Emasoft
git -C tests/scenarios/fixtures/git/scen025-kanban-fixture describe --tags --exact-match
gh project field-list <num> --owner Emasoft --format json \
    | jq -r '.fields[] | select(.name=="Status") | .options[].name'
# The last command must print exactly the 17 ratified column labels.
```
All commands must succeed before SCEN-025 is re-run.

## Estimated risk
LOW — creates new external GitHub resources only, no changes to
production code. Dependency: should land after TRDD-TC8TBJEU (the
provisioning helper) so the Status field is created with the correct
vocabulary from the start rather than needing a follow-up correction.

## Approval log
