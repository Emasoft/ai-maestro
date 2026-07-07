---
trdd-id: 9QDQAU2C
title: SCEN-025 cleanup should close and archive GitHub issues, not delete them
column: proposal
created: 2026-07-07T12:47:21+0200
updated: 2026-07-07T12:47:21+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: LOW
effort: S
labels: [scenario-improvement, scen-025, batch-backlog-20260707]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_025_2026-05-04T12-16-23Z.md"]
---

# TRDD-9QDQAU2C — SCEN-025 cleanup should close and archive GitHub issues, not delete them

## Problem
Confirmed at HEAD (2026-07-07), `tests/scenarios/SCEN-025_kanban-with-github-project.scen.md`
step S020 ("Reset the GitHub Project fixture board") runs:

```bash
gh project item-list 1 --owner Emasoft --format json \
    | jq -r '.items[] | select(.content.title | test("SCEN-025")) | .id' \
    | xargs -I {} gh project item-delete 1 --owner Emasoft --id {}
gh issue list --repo Emasoft/scen025-kanban-fixture --state all --search "SCEN-025" --json number --jq '.[].number' \
    | xargs -I {} gh issue delete {} --repo Emasoft/scen025-kanban-fixture --yes
```

`gh issue delete --yes` permanently deletes issues; GitHub issue numbers
are never reused. Every SCEN-025 run creates at least 1 issue and this
cleanup step deletes it, so after N runs the fixture repo's issue numbers
have jumped from 1 to N — with no history of what those issues were,
since deleted issues cannot be viewed at all (unlike closed issues, which
remain visible with `--state all`).

## Root cause
The cleanup step was authored to prioritize "leave the fixture
completely clean" over "preserve an audit trail of prior runs" — a
reasonable-sounding goal that has the side effect of destroying
information that would otherwise help diagnose a prior run's behavior
(e.g. "did last night's SCEN-025 actually create the issue with the
right title/body?").

## Proposed fix
Replace S020's `Action:` with close + archive instead of delete:

```bash
gh issue list --state open --repo Emasoft/scen025-kanban-fixture \
    --search "SCEN-025" --json number --jq '.[].number' \
    | xargs -I {} gh issue close {} --repo Emasoft/scen025-kanban-fixture
gh project item-list 1 --owner Emasoft --format json \
    | jq -r '.items[] | select(.content.title | test("SCEN-025")) | .id' \
    | xargs -I {} gh project item-archive 1 --owner Emasoft --id {}
```

(Note: the project number `1` in this snippet is the placeholder the
original report used — TRDD-8W16AN6X makes the project number a
frontmatter variable; this fix should use that same variable rather than
a literal `1`.)

**File to edit:** `tests/scenarios/SCEN-025_kanban-with-github-project.scen.md`
S020 action prose.

## Verification
Re-running SCEN-025 repeatedly does not produce ever-growing gaps in the
fixture repo's issue numbering. The fixture board's Project item history
shows archived (not deleted) items, and the repo's issue list
(`--state all`) shows closed (not deleted) issues from prior runs,
inspectable for debugging.

## Estimated risk
LOW — cleanup-script-only change. `gh project item-archive` and
`gh issue close` are both non-destructive, reversible operations, safer
than the delete they replace.

## Approval log
