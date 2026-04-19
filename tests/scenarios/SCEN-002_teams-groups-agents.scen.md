---
number: 2
name: Teams, Groups, and Agent Title Lifecycle
version: "2.0"
description: >
  The user logs in, creates two test agents, then creates a team containing
  both. They verify that joining a team auto-assigns the MEMBER title. They
  promote one agent to COS and another to ORCHESTRATOR, checking that
  role-plugins install automatically. They try to remove the COS (blocked
  by R4.7), remove an agent from the team (title reverts to AUTONOMOUS),
  re-add it, open the kanban board and drag a task, then delete the team
  with the governance password and confirm cemetery entries.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance (title transitions, singleton constraints, RBAC)
  - role-plugins (auto-install, auto-uninstall, plugin swap)
  - agent-registry (team membership, governanceTitle field, cemetery)
  - teams-service (create, edit, add/remove agents, delete pipeline)
  - auth (LoginGate, no-self-modification, RBAC authorize())
  - kanban (team task CRUD, drag between columns)
ui_sections:
  - Login page (governance password login)
  - Sidebar -> Teams tab -> Create Team modal
  - Sidebar -> Teams tab -> Edit Team modal
  - Sidebar -> Agents tab -> Agent list (grouped by team)
  - Agent Profile -> Overview tab -> Governance Title
  - Agent Profile -> Overview tab -> Team field
  - Agent Profile -> Config tab -> Role Plugin
  - Title Assignment Dialog (radio cards, singleton disable)
  - Governance Password Dialog
  - Team Dashboard -> Kanban board
  - Settings -> Cemetery tab
data_produced:
  - 2 test agents (temporary, created and deleted)
  - 1 test team (temporary, created and deleted)
  - 1 auto-COS agent (temporary, created and deleted)
  - 1 kanban task (temporary, deleted with team)
  - Agent registry entries (temporary, cleaned up)
  - Team entries (temporary, cleaned up)
  - Plugin settings.local.json modifications (restored)
  - Cemetery archive entries (temporary, purged)
required_tools:
  - mcp__chrome-devtools__navigate_page
  - mcp__chrome-devtools__take_snapshot
  - mcp__chrome-devtools__take_screenshot
  - mcp__chrome-devtools__click
  - mcp__chrome-devtools__fill
  - mcp__chrome-devtools__wait_for
prerequisites:
  - AI Maestro server running at http://localhost:23000
  - Governance password set
  - Chrome browser open with DevTools accessible via CDP
  - ai-maestro-plugins marketplace registered (Emasoft/ai-maestro-plugins)
governance_password: "mYkri1-xoxrap-gogtan"
rewipe-list:
  - ~/.aimaestro/governance.json
  - ~/.aimaestro/agents/registry.json
  - ~/.aimaestro/teams/teams.json
  - ~/.aimaestro/teams/groups.json
git-fixtures: []
dir-fixtures: []
commit: TBD
author: AI Maestro Team
---

# Teams, Groups, and Agent Title Lifecycle Scenario

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state with known commit hash
- **Creates:** nothing
- **Modifies:** git history (new commit if needed)
- **Verify:** `git status` shows clean working tree. Screenshot: SCEN-002/S001-git-clean.png

#### S002: STATE-WIPE Checkpoint -- Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/teams-groups-agents_<timestamp>/`
- **Goal:** Copies of the following saved: `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.aimaestro/governance.json`, `~/.aimaestro/agents/registry.json`, `~/.aimaestro/teams/teams.json`, `~/.aimaestro/teams/groups.json`
- **Creates:** Backup directory with config copies
- **Modifies:** nothing
- **Verify:** Backup files exist and match originals (hash comparison). Screenshot: SCEN-002/S002-backup-created.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `GET /api/sessions` returns 200
- **Goal:** Server running and healthy
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API returns session list (HTTP 200). Screenshot: SCEN-002/S003-server-healthy.png

#### S004: Navigate to dashboard
- **Action:** `navigate_page` to `http://localhost:23000`
- **Goal:** Login page loads (LoginGate blocks unauthenticated access)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot shows login form. Screenshot: SCEN-002/S004-login-page.png

---

## Phase 1: LoginGate Authentication

#### S005: Log in with governance password
- **Action:** Fill password field with `mYkri1-xoxrap-gogtan`, click "Login" button
- **Goal:** Login succeeds, dashboard loads with sidebar and agent list
- **Creates:** Session cookie
- **Modifies:** nothing
- **Verify:** Dashboard visible. Screenshot: SCEN-002/S005-dashboard-loaded.png

#### S006: Take pre-test screenshot (baseline)
- **Action:** `take_screenshot` of full page
- **Goal:** Baseline image for CLEAN-AFTER-YOURSELF verification
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved. Screenshot: SCEN-002/S006-baseline.png

---

## Phase 2: Create Test Agents (0-IMPACT)

#### S007: Open agent creation wizard
- **Action:** Click the "+" button in sidebar header
- **Goal:** Agent creation wizard opens
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Wizard dialog visible with client selection step. Screenshot: SCEN-002/S007-wizard-open.png

#### S008: Create first test agent -- scen-test-agent-alpha
- **Action:** Select "Claude Code" as client, click Next. Enter name `scen-test-agent-alpha`, click Next through remaining steps (no team, default AUTONOMOUS title, no role-plugin). Click Create/Finish.
- **Goal:** Agent `scen-test-agent-alpha` created as AUTONOMOUS with no team
- **Creates:** Agent `scen-test-agent-alpha` in registry
- **Modifies:** Agent registry (new entry)
- **Verify:** Agent appears in sidebar agent list. Screenshot: SCEN-002/S008-alpha-created.png

#### S009: Verify scen-test-agent-alpha in sidebar
- **Action:** Click on `scen-test-agent-alpha` in the agent list
- **Goal:** Profile panel shows agent details, title is AUTONOMOUS, no team
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Profile heading shows `scen-test-agent-alpha`, title badge shows AUTONOMOUS, team shows "No team". Screenshot: SCEN-002/S009-alpha-profile.png

#### S010: Open agent creation wizard again
- **Action:** Click the "+" button in sidebar header
- **Goal:** Agent creation wizard opens
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Wizard dialog visible. Screenshot: SCEN-002/S010-wizard-reopen.png

#### S011: Create second test agent -- scen-test-agent-beta
- **Action:** Select "Claude Code" as client, click Next. Enter name `scen-test-agent-beta`, click Next through remaining steps (no team, default AUTONOMOUS title, no role-plugin). Click Create/Finish.
- **Goal:** Agent `scen-test-agent-beta` created as AUTONOMOUS with no team
- **Creates:** Agent `scen-test-agent-beta` in registry
- **Modifies:** Agent registry (new entry)
- **Verify:** Agent appears in sidebar agent list. Screenshot: SCEN-002/S011-beta-created.png

#### S012: Verify scen-test-agent-beta in sidebar
- **Action:** Click on `scen-test-agent-beta` in the agent list
- **Goal:** Profile panel shows agent details, title is AUTONOMOUS, no team
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Profile heading shows `scen-test-agent-beta`, title badge shows AUTONOMOUS. Screenshot: SCEN-002/S012-beta-profile.png

---

## Phase 3: Team Creation

#### S013: Switch to Teams tab
- **Action:** Click "Teams" tab in sidebar
- **Goal:** Teams view shown with "Create Team" button
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows "Create Team" button visible. Screenshot: SCEN-002/S013-teams-tab.png

#### S014: Open Create Team modal
- **Action:** Click "+ Create Team" button
- **Goal:** Create Team modal opens with Name, Description, and agent multi-select fields
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Modal visible with heading "Create Team", name textbox, description textbox, agent selection list. Screenshot: SCEN-002/S014-create-team-modal.png

#### S015: Fill team name
- **Action:** Type `scen-test-team-alpha` in the Name field
- **Goal:** Name field populated
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Name field shows `scen-test-team-alpha`. Screenshot: SCEN-002/S015-team-name.png

#### S016: Fill team description
- **Action:** Type `Scenario 002 integration testing team` in the Description field
- **Goal:** Description field populated
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Description field shows entered text. Screenshot: SCEN-002/S016-team-desc.png

#### S017: Select scen-test-agent-alpha
- **Action:** Click `scen-test-agent-alpha` in the agents multi-select list
- **Goal:** Agent highlighted, selected count = 1
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Agent button highlighted, count text shows "1 selected". Screenshot: SCEN-002/S017-alpha-selected.png

#### S018: Select scen-test-agent-beta
- **Action:** Click `scen-test-agent-beta` in the agents multi-select list
- **Goal:** Agent highlighted, selected count = 2
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Agent button highlighted, count text shows "2 selected". Screenshot: SCEN-002/S018-beta-selected.png

#### S019: Submit Create Team
- **Action:** Click "Create Team" submit button
- **Goal:** Modal closes, team created via `POST /api/teams`, team card appears in sidebar. Auto-COS agent created (cos-scen-test-team-alpha with robot avatar).
- **Creates:** Team `scen-test-team-alpha` in teams registry, auto-COS agent `cos-scen-test-team-alpha`
- **Modifies:** Teams registry (new entry), agents registry (COS + members), both test agents get MEMBER title + programmer plugin
- **Verify:** Wait 2s, team card visible in sidebar showing name `scen-test-team-alpha` and count "3" (2 test agents + 1 auto-COS). Screenshot: SCEN-002/S019-team-created.png

#### S020: Verify team card shows description
- **Action:** Inspect the `scen-test-team-alpha` team card in sidebar
- **Goal:** Description text visible on team card
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows "Scenario 002 integration testing team" on the card. Screenshot: SCEN-002/S020-team-description.png

---

## Phase 4: Agent Title Auto-Assignment on Team Join

#### S021: Switch to Agents tab
- **Action:** Click "Agents" tab in sidebar
- **Goal:** Agent list shown, grouped by team
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows "Agents" tab active. Screenshot: SCEN-002/S021-agents-tab.png

#### S022: Verify team group header
- **Action:** Look for `SCEN-TEST-TEAM-ALPHA` group header in agent list
- **Goal:** Both test agents grouped under the team heading with count 2
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows team name header with count "2". Screenshot: SCEN-002/S022-team-group.png

#### S023: Check scen-test-agent-alpha title and plugin
- **Action:** Click on `scen-test-agent-alpha` in the agent list
- **Goal:** Profile panel opens, title auto-transitioned to MEMBER with programmer plugin
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title badge shows "MEMBER" (was AUTONOMOUS before joining team). Plugin banner shows `ai-maestro-programmer-agent`. Screenshot: SCEN-002/S023-alpha-member.png

#### S024: Verify team membership in profile
- **Action:** Scroll to "Team" section in profile Overview tab
- **Goal:** Team shows `scen-test-team-alpha`
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Team field displays `scen-test-team-alpha` (not "No team"). Screenshot: SCEN-002/S024-team-membership.png

---

## Phase 5: COS Assignment

#### S025: Check team auto-COS was created
- **Action:** Verify team data (via team card or API check) for chiefOfStaffId
- **Goal:** Confirm a COS agent was auto-created (every team must have a COS)
- **Creates:** nothing (COS was auto-created during team creation at S019)
- **Modifies:** nothing
- **Verify:** chiefOfStaffId is NOT null. A `cos-scen-test-team-alpha` agent exists with CHIEF-OF-STAFF title and robot avatar. Screenshot: SCEN-002/S025-auto-cos.png

#### S026: Click on scen-test-agent-beta
- **Action:** Click `scen-test-agent-beta` in the agent list
- **Goal:** Profile panel opens for scen-test-agent-beta
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Profile heading shows `scen-test-agent-beta`. Screenshot: SCEN-002/S026-beta-profile.png

#### S027: Open Title Assignment Dialog
- **Action:** Click the Governance Title badge/button (showing MEMBER)
- **Goal:** Title Assignment Dialog opens with team-specific titles
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog shows MEMBER, CHIEF-OF-STAFF, ORCHESTRATOR, ARCHITECT, INTEGRATOR options. Screenshot: SCEN-002/S027-title-dialog.png

#### S028: Select CHIEF-OF-STAFF
- **Action:** Click CHIEF-OF-STAFF radio card
- **Goal:** COS selected, Confirm button enabled
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Blue border on CHIEF-OF-STAFF card. Screenshot: SCEN-002/S028-cos-selected.png

#### S029: Enter governance password and confirm
- **Action:** Click Confirm, password dialog appears. Type `mYkri1-xoxrap-gogtan`, click Confirm. When the sudo password modal appears (strict route `PATCH /api/agents/[id]/title` per Rule 12), enter governance password `mYkri1-xoxrap-gogtan` again and click Confirm.
- **Goal:** Title changes to CHIEF-OF-STAFF, COS role-plugin auto-installed
- **Creates:** Plugin entry in agent's settings.local.json
- **Modifies:** Agent governanceTitle (MEMBER -> CHIEF-OF-STAFF), team chiefOfStaffId, plugin state
- **Verify:** Profile shows CHIEF-OF-STAFF badge. Screenshot: SCEN-002/S029-cos-assigned.png

#### S030: Verify COS role-plugin installed
- **Action:** Click "Config" tab in profile panel
- **Goal:** Role Plugin section shows `ai-maestro-chief-of-staff` with lock indicator
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin name `ai-maestro-chief-of-staff` displayed, "Locked by CHIEF-OF-STAFF" text visible. Screenshot: SCEN-002/S030-cos-plugin.png

---

## Phase 6: COS Immutability Probe (R4.7)

> **Context:** R4.7 says COS cannot be removed from a team's agentIds while they
> remain chiefOfStaffId. COS title can only be removed by deleting the team.

#### S031: Attempt to remove COS from team agentIds via API
- **Action:** Get scen-test-agent-beta's ID (the COS). Attempt `PUT /api/teams/<teamId>` with body that has `agentIds` array excluding the COS agent's ID.
- **Goal:** API returns 400 or 403 with error indicating COS cannot be removed from agentIds
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response status 400. Error message mentions COS immutability or "Cannot remove Chief-of-Staff from team members". COS agent remains in team. Screenshot: SCEN-002/S031-cos-immutability.png

---

## Phase 7: Assign ORCHESTRATOR Title

#### S032: Click on scen-test-agent-alpha
- **Action:** Click `scen-test-agent-alpha` in the agent list
- **Goal:** Profile panel opens for scen-test-agent-alpha
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Profile heading shows `scen-test-agent-alpha`. Screenshot: SCEN-002/S032-alpha-profile.png

#### S033: Open Title Assignment Dialog
- **Action:** Click the Governance Title badge (showing MEMBER)
- **Goal:** Title Assignment Dialog opens
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog visible with title options. Screenshot: SCEN-002/S033-title-dialog.png

#### S034: Verify ORCHESTRATOR is available
- **Action:** Inspect ORCHESTRATOR radio card
- **Goal:** ORCHESTRATOR option is visible and ENABLED (no one has it yet)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** ORCHESTRATOR card is not grayed out, is clickable. Screenshot: SCEN-002/S034-orchestrator-available.png

#### S035: Select ORCHESTRATOR and confirm with password
- **Action:** Click ORCHESTRATOR, click Confirm. Enter `mYkri1-xoxrap-gogtan` in password dialog, submit. When the sudo password modal appears (strict route `PATCH /api/agents/[id]/title` per Rule 12), enter governance password `mYkri1-xoxrap-gogtan` again and click Confirm.
- **Goal:** Title changes to ORCHESTRATOR, orchestrator role-plugin auto-installed
- **Creates:** Plugin entry in agent's settings.local.json
- **Modifies:** Agent governanceTitle (MEMBER -> ORCHESTRATOR), plugin state
- **Verify:** Profile shows ORCHESTRATOR badge. Screenshot: SCEN-002/S035-orchestrator-assigned.png

#### S036: Verify ORCHESTRATOR role-plugin
- **Action:** Click "Config" tab in profile panel
- **Goal:** Role Plugin section shows `ai-maestro-orchestrator-agent` locked by ORCHESTRATOR
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin name `ai-maestro-orchestrator-agent` displayed with lock indicator. Screenshot: SCEN-002/S036-orchestrator-plugin.png

---

## Phase 8: Kanban Task Usage

> **Context:** For scenarios involving teams, the kanban board should be tested.
> Create a task, assign it to a team member, and drag it through columns.

#### S037: Navigate to team dashboard kanban
- **Action:** Click on `scen-test-team-alpha` in Teams tab, then click "Kanban" tab in team view
- **Goal:** Kanban board opens showing 5 columns (backlog, pending, in_progress, review, completed)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Kanban board visible with column headers. Screenshot: SCEN-002/S037-kanban-board.png

#### S038: Create a kanban task via quick-add
- **Action:** Click "+" or "Quick Add" button on the Backlog column. Enter title "SCEN-002 test task" and description "Integration test task for kanban validation". Click Create.
- **Goal:** New task appears in Backlog column
- **Creates:** Task in team tasks file (`~/.aimaestro/teams/tasks-<teamId>.json`)
- **Modifies:** nothing
- **Verify:** Task card visible in Backlog column with title "SCEN-002 test task". Screenshot: SCEN-002/S038-task-created.png

#### S039: Drag task from Backlog to In Progress
- **Action:** Drag the "SCEN-002 test task" card from Backlog column to In Progress column
- **Goal:** Task status changes to in_progress
- **Creates:** nothing
- **Modifies:** Task status in tasks file
- **Verify:** Task card now appears in In Progress column. Screenshot: SCEN-002/S039-task-in-progress.png

---

## Phase 9: Remove Agent from Team

#### S040: Switch to Agents tab
- **Action:** Click "Agents" tab in sidebar
- **Goal:** Agents view shown
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows agents list. Screenshot: SCEN-002/S040-agents-tab.png

#### S041: Switch to Teams tab and open Edit Team modal
- **Action:** Click "Teams" tab. Hover over `scen-test-team-alpha` team card, click edit (pencil) icon
- **Goal:** Edit team modal opens with both test agents pre-selected
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Modal shows `scen-test-agent-alpha` and `scen-test-agent-beta` selected. Screenshot: SCEN-002/S041-edit-team.png

#### S042: Remove scen-test-agent-alpha from team
- **Action:** Click `scen-test-agent-alpha` to deselect
- **Goal:** Agent unhighlighted, count decreases to 1
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows count "1 selected". Screenshot: SCEN-002/S042-alpha-deselected.png

#### S043: Save team changes
- **Action:** Click "Save" / "Update Team" button
- **Goal:** Modal closes, team updated with only scen-test-agent-beta
- **Creates:** nothing
- **Modifies:** Team agentIds (alpha removed), alpha's team membership, alpha's title (-> AUTONOMOUS), alpha's plugin (uninstalled)
- **Verify:** Wait 2s, team card shows count 1. Screenshot: SCEN-002/S043-team-updated.png

#### S044: Verify scen-test-agent-alpha reverted to AUTONOMOUS
- **Action:** Switch to "Agents" tab, click on `scen-test-agent-alpha`
- **Goal:** Agent's title reverted to AUTONOMOUS, no team, no role-plugin
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title badge shows "AUTONOMOUS", team shows "No team". Screenshot: SCEN-002/S044-alpha-autonomous.png

#### S045: Verify role-plugin removed
- **Action:** Click "Config" tab in profile panel
- **Goal:** No locked role-plugin
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Role Plugin section shows "None" or is empty. Screenshot: SCEN-002/S045-no-plugin.png

---

## Phase 10: Re-add Agent and Re-assign ORCHESTRATOR

#### S046: Edit team to re-add scen-test-agent-alpha
- **Action:** Switch to "Teams" tab, click edit on `scen-test-team-alpha`, select `scen-test-agent-alpha`, save
- **Goal:** Alpha re-added to team, title auto-transitions to MEMBER
- **Creates:** nothing
- **Modifies:** Team agentIds (alpha added back), alpha's team membership, alpha's title (-> MEMBER)
- **Verify:** Team card shows count 2. Screenshot: SCEN-002/S046-team-readded.png

#### S047: Verify scen-test-agent-alpha is MEMBER again
- **Action:** Switch to "Agents" tab, click on `scen-test-agent-alpha`
- **Goal:** Title shows MEMBER (auto-assigned on team rejoin)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title badge shows "MEMBER". Screenshot: SCEN-002/S047-alpha-member-again.png

#### S048: Re-assign ORCHESTRATOR title
- **Action:** Click title badge, select ORCHESTRATOR, confirm with `mYkri1-xoxrap-gogtan`. When the sudo password modal appears (strict route `PATCH /api/agents/[id]/title` per Rule 12), enter governance password `mYkri1-xoxrap-gogtan` again and click Confirm.
- **Goal:** Title changes back to ORCHESTRATOR, plugin re-installed
- **Creates:** Plugin entry in settings.local.json
- **Modifies:** Agent governanceTitle (MEMBER -> ORCHESTRATOR), plugin state
- **Verify:** Title badge shows "ORCHESTRATOR". Screenshot: SCEN-002/S048-orchestrator-reassigned.png

#### S049: Verify role-plugin restored
- **Action:** Click "Config" tab
- **Goal:** Role Plugin shows `ai-maestro-orchestrator-agent` locked by ORCHESTRATOR
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin name and lock indicator visible. Screenshot: SCEN-002/S049-plugin-restored.png

---

## Phase 11: Singleton Constraint Checks

#### S050: Open title dialog for scen-test-agent-beta (COS agent)
- **Action:** Click on `scen-test-agent-beta` in agent list, click Governance Title badge
- **Goal:** Title Assignment Dialog opens
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog visible with title options. Screenshot: SCEN-002/S050-singleton-dialog.png

#### S051: Verify ORCHESTRATOR option is DISABLED
- **Action:** Inspect ORCHESTRATOR radio card
- **Goal:** ORCHESTRATOR is grayed out / not selectable because scen-test-agent-alpha holds the slot
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** ORCHESTRATOR card shows disabled state with explanation text (e.g. "Already assigned" or "Only one ORCHESTRATOR per team"). Screenshot: SCEN-002/S051-orchestrator-disabled.png

#### S052: Verify CHIEF-OF-STAFF shows as current
- **Action:** Inspect CHIEF-OF-STAFF radio card
- **Goal:** COS is shown as the current/active selection (scen-test-agent-beta IS the COS)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** CHIEF-OF-STAFF card shown as active/selected. Screenshot: SCEN-002/S052-cos-current.png

#### S053: Close title dialog
- **Action:** Click Cancel or close button
- **Goal:** Dialog dismissed
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog gone, profile panel visible. Screenshot: SCEN-002/S053-dialog-closed.png

---

## Phase 12: RBAC Probe -- No Self-Modification

#### S054: Attempt agent self-modification via API
- **Action:** Get scen-test-agent-alpha's ID. Attempt `PATCH /api/agents/<alphaId>` with header `X-Agent-Id: <alphaId>` and body `{"label": "self-hacked"}`.
- **Goal:** API returns 403 -- no agent can modify itself
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response status 403. Error mentions self-modification forbidden. Agent label unchanged. Screenshot: SCEN-002/S054-no-self-mod.png

---

## Phase CLEANUP: Restore Original State

> **MANDATORY CLEANUP ORDER (see SCENARIOS_TESTS_RULES.md WARNING section):**
> 1. Delete test agents via UI (Profile → Danger Zone → Delete Agent → check "Also delete agent folder")
> 2. Delete test teams via UI (Teams tab → Delete team → governance password → "Delete Agents Too")
> 3. Purge cemetery entries via UI (Settings → Cemetery → Purge)
> 4. Verify via API (no test artifacts remain)
> 5. THEN STATE-WIPE restore config files from backup
> 6. Post-test screenshot
>
> **NEVER use bash to delete agent folders or kill tmux sessions. That is a Rule 6 violation.**

#### S055: Delete scen-test-agent-alpha
- **Action:** Click on `scen-test-agent-alpha` in sidebar, click delete button in profile panel -> Danger Zone -> "Delete Agent" -> confirm. When the sudo password modal appears (`DELETE /api/agents/[id]` is a strict route per Rule 12), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Test agent fully removed from registry and team
- **Creates:** Cemetery archive entry
- **Modifies:** Agent registry (entry removed), team agentIds (alpha removed)
- **Verify:** Agent no longer appears in sidebar. Screenshot: SCEN-002/S055-alpha-deleted.png

#### S056: Delete scen-test-agent-beta
- **Action:** Click on `scen-test-agent-beta` in sidebar, click delete button in profile panel, confirm deletion. When the sudo password modal appears (strict route `DELETE /api/agents/[id]` per Rule 12), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Test agent fully removed from registry and team
- **Creates:** Cemetery archive entry
- **Modifies:** Agent registry (entry removed), team agentIds (beta removed), team chiefOfStaffId (cleared)
- **Verify:** Agent no longer appears in sidebar. Screenshot: SCEN-002/S056-beta-deleted.png

#### S057: Delete scen-test-team-alpha via DeleteTeam pipeline
- **Action:** Switch to "Teams" tab, find `scen-test-team-alpha` team card, click delete icon. First dialog: click Delete. Second dialog: enter governance password `mYkri1-xoxrap-gogtan`, click "Delete Agents Too".
- **Goal:** Test team fully removed via DeleteTeam 8-gate pipeline. All agents (including auto-COS) reverted to AUTONOMOUS with no role-plugin, then deleted. Pending transfers cancelled. Team task files deleted.
- **Creates:** nothing
- **Modifies:** Teams registry (entry removed), all team agents deleted
- **Verify:** Team card no longer appears in sidebar. Screenshot: SCEN-002/S057-team-deleted.png

#### S058: Delete auto-COS agent (cos-scen-test-team-alpha)
- **Action:** Find `cos-scen-test-team-alpha` in agent list (ALL tab). If still present (not deleted by "Delete Agents Too"), click delete button, confirm. When the sudo password modal appears (strict route `DELETE /api/agents/[id]` per Rule 12), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Auto-created COS agent removed from registry
- **Creates:** nothing
- **Modifies:** Agent registry (entry removed)
- **Verify:** Agent no longer appears in sidebar. Screenshot: SCEN-002/S058-cos-deleted.png

#### S059: Verify cemetery entries exist
- **Action:** Navigate to Settings page -> click "Cemetery" tab
- **Goal:** Deleted test agents appear in cemetery as archived zips
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Cemetery list shows entries for the deleted test agents. Screenshot: SCEN-002/S059-cemetery-entries.png

#### S060: Purge all test cemetery entries
- **Action:** For each test agent in cemetery (scen-test-agent-alpha, scen-test-agent-beta, cos-scen-test-team-alpha), click "Purge" and confirm. When the sudo password modal appears each time (`DELETE /api/agents/cemetery` is a strict route per Rule 12, and sudo tokens are one-shot), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** All test cemetery entries removed
- **Removes:** Cemetery zip archives for test agents
- **Verify:** No test agent entries remain in cemetery. Screenshot: SCEN-002/S060-cemetery-purged.png

#### S061: STATE-WIPE -- Restore configuration files
- **Action:** Compare current config files with backups from S002. If any differ, restore from backup.
- **Goal:** All config files match pre-test state
- **Creates:** nothing
- **Modifies:** Config files (restored to backup state if changed)
- **Verify:** File hash comparison -- all match. Screenshot: SCEN-002/S061-state-restored.png

#### S062: Take post-test screenshot and compare with S006
- **Action:** `take_screenshot` of full page
- **Goal:** UI looks identical to pre-test baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual comparison with S006 screenshot -- sidebar, agent list, team list unchanged. Screenshot: SCEN-002/S062-post-cleanup.png
