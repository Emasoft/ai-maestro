---
trdd-id: 8W16AN6X
title: SCEN-025 hardcodes project number 1 and describes a stale 3-field UI
column: planned
created: 2026-07-07T12:47:21+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 0
severity: HIGH
effort: M
labels: [scenario-improvement, scen-025, batch-backlog-20260707]
task-type: docs
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_025_2026-05-04T12-16-23Z.md"]
---

# TRDD-8W16AN6X — SCEN-025 hardcodes project number 1 and describes a stale 3-field UI

## Problem
`tests/scenarios/SCEN-025_kanban-with-github-project.scen.md` step S011
reads:

> **Action:** Type owner `Emasoft`, repo `scen025-kanban-fixture`, project
> number `1`. Click "Link GitHub Project".

Two problems, confirmed at HEAD (2026-07-07):

1. **Hardcoded project number.** The `Emasoft` GitHub account currently
   has exactly one project (`number: 1`, title `KANBAN-TEST`). Once
   TRDD-QB5PWIG3 provisions the SCEN-025 fixture board, it will almost
   certainly become project `#2`. S011's literal `1` would then silently
   link the WRONG board (`KANBAN-TEST`, a real/other project) instead of
   the fixture.
2. **Stale UI description.** S010/S011 describe a 3-separate-field form
   (owner text box, repo text box, project-number text box). That UI no
   longer exists. `components/sidebar/TeamListView.tsx` (`TeamFormModal`,
   comment "SCEN-005.03 + SCEN-010.02 (second option, 2026-04-30)") and
   `components/teams/TeamCreationWizard.tsx` both now take a **single
   GitHub Project URL field** (`githubProjectUrl` state), parsed by
   `parseGitHubProjectUrl()` which accepts:
   - `https://github.com/orgs/<owner>/projects/<n>`
   - `https://github.com/users/<owner>/projects/<n>`
   - `https://github.com/<owner>/<repo>/projects/<n>`

   There is no longer an "owner box / repo box / project-number box" to
   fill in — the user pastes one URL. S010/S011 as written describe UI
   that would fail to locate matching form fields when driven via
   `dev-browser`.

## Root cause
S011 predates the 2026-04-30 UI change (SCEN-005.03 + SCEN-010.02,
"second option") that consolidated the 3-field form into a single
URL-paste field. The scenario was never updated to track that UI change,
and separately never made the project number configurable.

## Proposed fix
1. Add a frontmatter field recording the real fixture project number
   once TRDD-QB5PWIG3 provisions it:
   ```yaml
   github_project_number: 1   # placeholder — set to the REAL number after
                               # TRDD-QB5PWIG3 fixture provisioning; verify
                               # via `gh project list --owner Emasoft`
   ```
2. Rewrite S010/S011 to match the current single-URL-field UI:
   - S010: "Click the team name in MeetingHeader to open team settings.
     Scroll to the 'GitHub Project' field."
   - S011: "Paste the URL
     `https://github.com/orgs/Emasoft/projects/<github_project_number>`
     into the GitHub Project field. Click Save." (using the frontmatter
     variable, not a literal number)
3. Update the step's `Verify:` line — `GET /api/teams/<id>` still returns
   `githubProject: { owner: 'Emasoft', repo: 'Emasoft', projectNumber:
   <github_project_number> }` (note: `parseGitHubProjectUrl()` sets
   `repo = owner` for org/user-scoped URLs — the scenario's expected
   response shape needs the same fallback, not
   `repo: 'scen025-kanban-fixture'` as originally written).

**File to edit:** `tests/scenarios/SCEN-025_kanban-with-github-project.scen.md`
(frontmatter + S010 + S011).

## Verification
Re-running SCEN-025's setup + S010/S011 after TRDD-QB5PWIG3 provisioning
should require editing only the `github_project_number` frontmatter
field (never the step prose), and the `dev-browser` script should
locate a single URL input rather than three separate fields.

## Estimated risk
LOW — scenario-file-only change, no production code touched. Depends on
TRDD-QB5PWIG3 landing first so the real project number is known.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
