---
number: 25
name: Kanban With GitHub Project Sync
version: "1.0"
description: >
  The user creates a test team with a COS + MEMBER + ORCHESTRATOR, opens the
  team meeting view, opens the Kanban board, links the board to a GitHub
  Project (fixture repo), and verifies the round-trip: (a) adding a task in
  the Kanban board creates a matching card in the linked GitHub Project,
  (b) dragging a task between columns in Kanban updates the GitHub Project
  status field, (c) closing a task in Kanban closes the GitHub issue, and
  (d) the R12 BLOCKED badge appears on the team card when the kanban config
  declares a required column that is missing in the target GitHub Project.
  This scenario lives alongside SCEN-010 (Kanban base flow) but focuses
  specifically on the GitHub Project integration that was proposed and
  approved for this batch.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance
  - teams
  - kanban
  - element-management-service
  - agent-registry
ui_sections:
  - Sidebar -> Agents tab -> Create new agent
  - Agent Creation Wizard (steps 1-7, MEMBER/ORCHESTRATOR/COS)
  - Sidebar -> Teams tab -> Create team
  - Sidebar -> Teams tab -> Click team card -> Open meeting
  - Team Meeting header -> Kanban toggle
  - TaskKanbanBoard (5 columns) + TaskCreateForm + KanbanCard drag-and-drop
  - Team settings -> Link GitHub Project (owner/repo + project number)
  - Team card -> R12 BLOCKED badge (when kanban config is invalid)
  - Agent Profile -> Advanced tab -> Danger Zone -> Delete Agent (cleanup)
  - Sudo password modal (Rule 12)
data_produced:
  - 3 test agents "scen025-mgr-01", "scen025-cos-01", "scen025-mbr-01", and 1 orchestrator "scen025-orch-01" (temporary)
  - 1 test team "scen025-team" linked to a fixture GitHub Project (temporary)
  - GitHub issues created/closed in the fixture repo (cleaned up after the
    scenario by deleting the fixture's `scenario-start` branch + resetting
    the fixture Project board via `gh project item-delete` in cleanup)
  - Team kanban config with GitHub Project fields (temporary, removed)
  - Plugin settings.local.json modifications (temporary, restored via STATE-WIPE)
  - Cemetery archive entries (temporary, purged)
git-fixtures:
  - https://github.com/Emasoft/scen025-kanban-fixture
dir-fixtures: []
browser_stack: dev-browser
prerequisites:
  - AI Maestro server running at http://localhost:23000
  - Governance password set
  - Tailscale-optional (this scenario only uses localhost)
  - ai-maestro-plugins marketplace registered
  - "ai-maestro-local-roles-marketplace registered (per R20)"
  - "GitHub CLI authenticated ('gh auth status' must succeed)"
  - "'gh api user --jq .login' must return a user with write access to the fixture repo Emasoft/scen025-kanban-fixture (scenario author's fork)"
  - "Fixture repo cloned locally to tests/scenarios/fixtures/git/scen025-kanban-fixture/ with tag 'scenario-start' (scenario author prepares this in advance — scenario-setup.sh resets to tag, never clones)"
  - 'Fixture GitHub Project "SCEN-025 Fixture Board" exists and has columns: Backlog, Pending, In Progress, Review, Completed'
  - No pre-existing agents matching "scen025-*"
  - No pre-existing team named "scen025-team"
governance_password: "mYkri1-xoxrap-gogtan"
rewipe-list:
  - ~/.aimaestro/governance.json
  - ~/.aimaestro/agents/registry.json
  - ~/.aimaestro/teams/teams.json
  - ~/.aimaestro/teams/groups.json
commit: TBD
author: SCEN-025 proposal 12 (2026-04-20 batch)
---

## Phase 0: SAFE-SETUP

#### S001: Capture baseline UI screenshot
- **Action:** Navigate to http://localhost:23000/, ensure logged in (governance password session cookie), take a full-page screenshot.
- **Goal:** Baseline captured for later comparison in cleanup.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved at SCEN-025/S001_<RUN_ID>_baseline-dashboard.jpg.

> **Note:** The shared `scenario-setup.sh` already ran before this step, so
> the fixture repo is at the `scenario-start` tag and `rewipe-list` files
> are backed up.

#### S002: Verify fixture repo is at scenario-start tag
- **Action:** `bash: cd tests/scenarios/fixtures/git/scen025-kanban-fixture && git describe --tags --exact-match` (read-only verification, Rule 6-allowed monitoring).
- **Goal:** Fixture repo is pinned to `scenario-start` tag.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Command stdout equals `scenario-start`.

---

## Phase 1: Create MANAGER + Team Staff

#### S003: Create scen025-mgr-01 via Wizard -> MANAGER
- **Action:** Sidebar → Agents → + (Create new agent). Fill Wizard steps 1-7: name `scen025-mgr-01`, persona `Mgr-25`, title MANAGER, Claude client, no team, programmer role-plugin, then "Let's Go!". When sudo modal appears for title assignment, enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** MANAGER agent scen025-mgr-01 exists in the registry with governanceTitle=manager.
- **Creates:** 1 agent (scen025-mgr-01), 1 ~/agents/scen025-mgr-01/ workdir.
- **Modifies:** governance.json (managerId).
- **Verify:** `GET /api/agents/<id>` returns `{ agent: { governanceTitle: 'manager' } }`. Screenshot: SCEN-025/S003_<RUN_ID>_mgr-created.jpg.

#### S004: Create scen025-cos-01 → CHIEF-OF-STAFF
- **Action:** Wizard: name `scen025-cos-01`, persona `Cos-25`, title CHIEF-OF-STAFF, Claude, COS role-plugin, then "Let's Go!" with sudo.
- **Goal:** COS agent exists with governanceTitle=chief-of-staff, no team yet.
- **Creates:** 1 agent.
- **Modifies:** nothing else.
- **Verify:** Profile panel shows COS badge. Screenshot: SCEN-025/S004_<RUN_ID>_cos-created.jpg.

#### S005: Create scen025-mbr-01 → MEMBER
- **Action:** Wizard: name `scen025-mbr-01`, persona `Mbr-25`, title MEMBER (auto-assigned when joining a team below), Claude, programmer role-plugin, then "Let's Go!".
- **Goal:** MEMBER agent exists.
- **Creates:** 1 agent.
- **Modifies:** nothing.
- **Verify:** Screenshot: SCEN-025/S005_<RUN_ID>_mbr-created.jpg.

#### S006: Create scen025-orch-01 → ORCHESTRATOR
- **Action:** Wizard: name `scen025-orch-01`, persona `Orch-25`, title ORCHESTRATOR, Claude, orchestrator role-plugin, then "Let's Go!" with sudo.
- **Goal:** ORCHESTRATOR agent exists.
- **Creates:** 1 agent.
- **Modifies:** nothing.
- **Verify:** Screenshot: SCEN-025/S006_<RUN_ID>_orch-created.jpg.

#### S007: Create team scen025-team via sidebar
- **Action:** Sidebar → Teams tab → + (Create Team). Fill: name `scen025-team`, description "SCEN-025 kanban fixture", COS=scen025-cos-01, members=[scen025-cos-01, scen025-mbr-01, scen025-orch-01]. Click Create.
- **Goal:** Team exists, COS+MEMBER+ORCH attached, orchestratorId set.
- **Creates:** 1 team.
- **Modifies:** COS agent's governanceTitle stays chief-of-staff, MEMBER and ORCHESTRATOR bound to team.
- **Verify:** Team card appears in sidebar. `GET /api/teams/<id>` returns 3 agentIds, chiefOfStaffId, orchestratorId. Screenshot: SCEN-025/S007_<RUN_ID>_team-created.jpg.

---

## Phase 2: Open Kanban Board

#### S008: Click team card → Open meeting view
- **Action:** Click the "scen025-team" card in the Teams sidebar. Team meeting view opens.
- **Goal:** Meeting view rendered, all 3 team agents visible in meeting sidebar.
- **Creates:** nothing.
- **Modifies:** nothing.
- **Verify:** MeetingHeader shows team name. Screenshot: SCEN-025/S008_<RUN_ID>_meeting-open.jpg.

#### S009: Toggle Kanban board
- **Action:** Click the Kanban icon in MeetingHeader. TaskKanbanBoard full-screen overlay opens with 5 columns (Backlog, Pending, In Progress, Review, Completed).
- **Goal:** Kanban board visible, all 5 columns empty.
- **Creates:** nothing.
- **Modifies:** nothing.
- **Verify:** 5 columns rendered, each with 0 cards. Screenshot: SCEN-025/S009_<RUN_ID>_kanban-empty.jpg.

---

## Phase 3: Link to GitHub Project

#### S010: Open team settings → GitHub Project section
- **Action:** Close kanban overlay (Escape). Click the team name in MeetingHeader to open team settings. Scroll to "GitHub Project" section.
- **Goal:** GitHub Project form visible, currently unlinked.
- **Creates:** nothing.
- **Modifies:** nothing.
- **Verify:** "Link GitHub Project" button is present. Screenshot: SCEN-025/S010_<RUN_ID>_gh-project-form.jpg.

#### S011: Fill GitHub Project owner/repo + number + link
- **Action:** Type owner `Emasoft`, repo `scen025-kanban-fixture`, project number `1`. Click "Link GitHub Project". Authenticated call to `/api/teams/<id>/github-project` succeeds.
- **Goal:** Team.githubProject is set. `GET /api/teams/<id>` returns `githubProject: { owner: 'Emasoft', repo: 'scen025-kanban-fixture', projectNumber: 1 }`.
- **Creates:** nothing on disk beyond teams.json mutation.
- **Modifies:** teams.json team's githubProject field.
- **Verify:** API returns updated team. Screenshot: SCEN-025/S011_<RUN_ID>_gh-project-linked.jpg.

---

## Phase 4: Round-trip — Kanban → GitHub

#### S012: Create task in Kanban board
- **Action:** Re-open Kanban (Kanban toggle). Click + on Backlog column. Fill task: title `SCEN-025 round-trip-test`, description `Verify GitHub sync creates matching issue`, assignee=scen025-mbr-01, priority=medium. Click Create.
- **Goal:** Task created in Kanban, assigned to MEMBER. GitHub sync called synchronously. The GitHub Project "SCEN-025 Fixture Board" has a new card with the same title in Backlog column.
- **Creates:** 1 kanban task (~/.aimaestro/teams/tasks-<teamId>.json), 1 GitHub issue in the fixture repo, 1 GitHub Project card.
- **Modifies:** nothing else.
- **Verify:** `bash: gh issue list --repo Emasoft/scen025-kanban-fixture --search 'SCEN-025 round-trip-test'` returns 1 match. Screenshot: SCEN-025/S012_<RUN_ID>_task-created.jpg.

#### S013: Drag task from Backlog → In Progress
- **Action:** Drag the task card from Backlog to In Progress column. Drop. Native HTML5 drag-and-drop fires the status update.
- **Goal:** Task status=in_progress. GitHub Project card's Status field moves to "In Progress". GitHub issue remains open.
- **Creates:** nothing.
- **Modifies:** task status, GitHub Project card status.
- **Verify:** `bash: gh project item-list 1 --owner Emasoft --format json | jq '.items[] | select(.content.title == "SCEN-025 round-trip-test") | .status'` returns `"In Progress"`. Screenshot: SCEN-025/S013_<RUN_ID>_task-in-progress.jpg.

#### S014: Drag task → Completed
- **Action:** Drag the task from In Progress to Completed. Drop.
- **Goal:** Task status=completed. GitHub issue CLOSED via the sync. GitHub Project card moves to Completed.
- **Creates:** nothing.
- **Modifies:** task status, GitHub Project card status, GitHub issue state.
- **Verify:** `bash: gh issue view <issue-number> --repo Emasoft/scen025-kanban-fixture --json state --jq .state` returns `"CLOSED"`. Screenshot: SCEN-025/S014_<RUN_ID>_task-completed.jpg.

---

## Phase 5: R12 BLOCKED Badge Regression

#### S015: Break the kanban config by removing a required column
- **Action:** Navigate to team settings → Kanban config. Remove the "Review" column from the config JSON (via UI or PATCH /api/teams/<id>). Save.
- **Goal:** Team.kanbanConfig is missing a required column. R12 invariant trips.
- **Creates:** nothing.
- **Modifies:** team.kanbanConfig.
- **Verify:** Team.blocked=true (R12 enforcement), team card in sidebar shows the red BLOCKED pill (proposal 38 from previous batch). Screenshot: SCEN-025/S015_<RUN_ID>_r12-blocked.jpg.

#### S016: Restore the kanban config
- **Action:** Re-add the "Review" column. Save.
- **Goal:** R12 invariant restored, team.blocked=false.
- **Creates:** nothing.
- **Modifies:** team.kanbanConfig.
- **Verify:** BLOCKED pill disappears. Screenshot: SCEN-025/S016_<RUN_ID>_r12-unblocked.jpg.

---

## Phase CLEANUP: Restore Original State

#### S017: Delete scen025-team via sidebar with cascade=on
- **Action:** Sidebar → Teams → scen025-team card → Delete (trash icon). In the Delete Team dialog, enter governance password, CHECK "Delete member agents too" (proposal 7). Click "Delete Team + Agents". Wait for success.
- **Goal:** Team deleted, and ALL 3 team agents (COS, MEMBER, ORCH) deleted via DeleteAgent pipeline with hard=true and deleteFolder=true. MANAGER scen025-mgr-01 remains (not a team member).
- **Removes:** 1 team, 3 agents, 3 ~/agents/scen025-*/ workdirs.
- **Verify:** `GET /api/teams` excludes scen025-team. `GET /api/agents` excludes the 3 deleted agents but still includes scen025-mgr-01. Screenshot: SCEN-025/S017_<RUN_ID>_team-cascade-deleted.jpg.

#### S018: Delete MANAGER scen025-mgr-01 via Profile Danger Zone
- **Action:** Click scen025-mgr-01 sidebar card → Agent Actions menu → Delete Agent… → opens Advanced → Danger Zone → Delete Agent → check "Also delete agent folder" → type `scen025-mgr-01` → Delete Forever. Enter sudo password.
- **Goal:** MANAGER deleted, ~/agents/scen025-mgr-01/ wiped.
- **Removes:** 1 agent, 1 workdir.
- **Verify:** `GET /api/agents?includeDeleted=false` returns no scen025-* agents. Screenshot: SCEN-025/S018_<RUN_ID>_mgr-deleted.jpg.

#### S019: Purge cemetery entries for all scen025-* agents
- **Action:** Settings → Cemetery tab. For each scen025-* entry, click Purge.
- **Goal:** Cemetery clean of this scenario's artifacts.
- **Removes:** 4 cemetery entries.
- **Verify:** `GET /api/agents/cemetery` excludes scen025-*. Screenshot: SCEN-025/S019_<RUN_ID>_cemetery-purged.jpg.

#### S020: Reset the GitHub Project fixture board
- **Action:** `bash: gh project item-list 1 --owner Emasoft --format json | jq -r '.items[] | select(.content.title | test("SCEN-025")) | .id' | xargs -I {} gh project item-delete 1 --owner Emasoft --id {}`. Then `bash: gh issue list --repo Emasoft/scen025-kanban-fixture --state all --search "SCEN-025" --json number --jq '.[].number' | xargs -I {} gh issue delete {} --repo Emasoft/scen025-kanban-fixture --yes`.
- **Goal:** The fixture GitHub Project has no scen025-* cards and no scen025-* issues — back to its `scenario-start` state.
- **Removes:** N GitHub cards + N GitHub issues (typically 1 each).
- **Verify:** Fixture board shows 0 cards. Screenshot: SCEN-025/S020_<RUN_ID>_gh-reset.jpg.

#### S021: STATE-WIPE — Restore configuration files
- **Action:** The `scenario-restore.sh` script runs and compares all files in `rewipe-list` against the backup MANIFEST. Any drift is restored byte-for-byte.
- **Goal:** All 4 rewipe-list files match pre-test state via SHA256.
- **Removes:** nothing.
- **Verify:** Restore script exits 0 with "All files verified".

#### S022: Post-test screenshot
- **Action:** Navigate to dashboard. Take full-page screenshot.
- **Goal:** UI identical to Phase 0 baseline (S001).
- **Creates:** nothing.
- **Modifies:** nothing.
- **Verify:** Screenshot saved at SCEN-025/S022_<RUN_ID>_post-test-baseline.jpg. Diff against S001 shows no scen025 artifacts.
