---
trdd-id: TC8TBJEU
title: Add fixture_github_project_v2 helper to fixture-helpers.sh
column: complete
created: 2026-07-07T12:47:21+0200
updated: 2026-07-07T14:58:53+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: MEDIUM
effort: M
labels: [scenario-improvement, scen-025, batch-backlog-20260707]
task-type: infra
parent-trdd: null
npt: []
eht: []
relevant-rules: [25]
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_025_2026-05-04T12-16-23Z.md"]
implementation-commits: [6e032ab6, 3e203f47]
---

# TRDD-TC8TBJEU — Add fixture_github_project_v2 helper to fixture-helpers.sh

## Problem
`tests/scenarios/scripts/fixture-helpers.sh` (confirmed present at HEAD)
already covers idempotent GitHub repo fixture provisioning
(`fixture_github_repo` at line 44, `fixture_github_repo_delete` at line
97, `fixture_kill_tmux_by_prefix` at line 192, `fixture_delete_agents_by_prefix`
at line 220), but has NO equivalent for GitHub Project v2 boards. `gh
project create` only sets the title — column options on the Status field
require `ProjectV2SingleSelectField` GraphQL mutations, which every
scenario needing a Project fixture (SCEN-025 today, more later as kanban
↔ GitHub Project sync gets more scenario coverage) would otherwise
reimplement from scratch.

## Root cause
The helper library grew organically to cover the repo-fixture pattern
(SCEN-018 and others) but Project-board fixtures are a newer need
(SCEN-025, added in the 2026-04-20 batch) and no shared helper was ever
extracted.

## Proposed fix

**Kanban-alignment constraint (governance-rules branch, 2026-07-07):**
the default column set for this helper MUST be the ratified 17-value
TRDD `column:` vocabulary (`~/.claude/rules/trdd-design-tasks.md` v2;
`docs/GOVERNANCE-RULES.md` R25), not an ad-hoc kanban-style list — this
helper provisions GitHub Project "mirrors" of the TRDD state machine, so
its default option set must be 1:1 with that vocabulary.

Add to `tests/scenarios/scripts/fixture-helpers.sh` (insert between
`fixture_github_repo_delete` at line 97 and `_fixture_apply_buggy_python`
at line 111):

```bash
# Usage: fixture_github_project_v2 <owner> <title> [column1,column2,...]
#
# Idempotent: looks up an existing project with the given title; if absent,
# creates it and configures the Status field options. Returns the project
# number on stdout. Default columns are the ratified TRDD column:
# vocabulary (~/.claude/rules/trdd-design-tasks.md v2 + GOVERNANCE-RULES.md
# R25) so a fixture board is a genuine 1:1 mirror of the TRDD state
# machine, not an ad-hoc kanban list.
fixture_github_project_v2() {
    local owner="${1:?fixture_github_project_v2: missing owner}"
    local title="${2:?fixture_github_project_v2: missing title}"
    local columns="${3:-Backburner,Todo,Design,Dispatch,Dev,Testing,AI Review,Human Review,Complete,Publish,Published,Deploy,Live,Live Auditing,Blocked,Failed,Superseded}"
    need gh

    local existing
    existing=$(gh project list --owner "$owner" --format json \
        | jq -r --arg t "$title" '.projects[] | select(.title==$t) | .number' \
        | head -1)

    if [ -n "$existing" ]; then
        log "project '$title' already exists (number $existing)"
        echo "$existing"
        return 0
    fi

    log "creating project '$title' under $owner"
    local out
    out=$(gh project create --owner "$owner" --title "$title" --format json)
    local num
    num=$(echo "$out" | jq -r '.number')

    # Configure Status field — get its ID
    local status_field_id
    status_field_id=$(gh project field-list "$num" --owner "$owner" --format json \
        | jq -r '.fields[] | select(.name=="Status") | .id')

    local mutation_query='
mutation($input: UpdateProjectV2SingleSelectFieldInput!) {
  updateProjectV2SingleSelectField(input: $input) {
    projectV2Field { ... on ProjectV2SingleSelectField { id } }
  }
}'
    local options_json
    options_json=$(echo "$columns" | tr ',' '\n' | jq -R -s -c '
        split("\n") | map(select(length > 0))
        | map({name: ., color: "GRAY", description: ""})')
    gh api graphql -f query="$mutation_query" \
        --field "input[fieldId]=$status_field_id" \
        --field "input[name]=Status" \
        --raw-field "input[singleSelectOptions]=$options_json" >/dev/null

    log "project $num configured with columns: $columns"
    echo "$num"
}
```

**File to edit:** `tests/scenarios/scripts/fixture-helpers.sh`.

## Verification
```bash
source tests/scenarios/scripts/fixture-helpers.sh
fixture_github_project_v2 Emasoft "SCEN-025 Fixture Board"
# Should print a number on stdout, no errors.
gh project field-list <number> --owner Emasoft --format json \
    | jq '.fields[] | select(.name=="Status") | .options[].name'
# Should print exactly the 17 ratified column labels (Backburner .. Superseded).
```

## Estimated risk
LOW — additive shell function, no existing helper behavior changed.
GitHub Project v2's Status field option limit and `gh` CLI GraphQL
surface should be re-verified against the current `gh` version before
landing (the mutation shape may have changed since 2026-04).

**Risk note CONFIRMED by the first live run (2026-07-07, QB5PWIG3
provisioning):** `updateProjectV2SingleSelectField` no longer exists —
the current mutation is `updateProjectV2Field` (verified by GraphQL
introspection). Three defects fixed post-landing: stale mutation name;
`log` on stdout contaminating the captured project number; a silent
`>/dev/null` swallow reporting false success on mutation failure. The
existing-project branch now also reconciles Status options instead of
skipping configuration.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
- 2026-07-07T13:51:02+0200 — IMPLEMENTED (wave W2): added fixture_github_project_v2() to tests/scenarios/scripts/fixture-helpers.sh (17-value ratified column vocabulary preserved verbatim); bash -n and shellcheck --severity=error clean.
- 2026-07-07T14:58:53+0200 — COMPLETED (implementation-commits recorded); archived per the TRDD lifecycle.
