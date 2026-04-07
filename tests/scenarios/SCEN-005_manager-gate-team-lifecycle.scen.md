---
number: 5
name: Manager Gate Team Lifecycle
version: "2.0"
description: >
  Tests the MANAGER-gated team lifecycle end-to-end: LoginGate authentication,
  verifying that teams cannot be created without a MANAGER (R9), assigning
  MANAGER and observing team unblocking (R9.6), creating a team with auto-COS
  (R1.3), adding agents with auto-MEMBER title and plugin install (R10, R11),
  removing agents and title reversion, title-requires-team gate (Gate 9),
  team deletion via DeleteTeam 8-gate pipeline with governance password,
  MANAGER removal blocking cascade (R9.8), RBAC probes (no-self-modification,
  wrong-role agent lifecycle denial), COS immutability probe (R4.7),
  kanban task CRUD, cemetery verification after agent deletion,
  and agent auth (mst_* session secrets).
  Validates governance rules R1, R4, R9, R10, R11, R16.
subsystems:
  - governance
  - teams
  - role-plugins
  - agent-registry
  - element-management-service
  - auth (LoginGate, agent auth, RBAC, no-self-modification)
  - kanban
ui_sections:
  - Login page (governance password login)
  - Sidebar -> Agents tab -> Agent list
  - Sidebar -> Teams tab -> Team list
  - Agent Profile -> Overview tab -> Governance Title
  - Agent Profile -> Config tab -> Role Plugin
  - Title Assignment Dialog (radio cards, password prompt)
  - Governance Password Dialog
  - Team Creation Dialog
  - Agent Creation Wizard
  - Team Dashboard -> Kanban board
  - Settings -> Cemetery tab
data_produced:
  - 3 test agents (temporary, created and deleted)
  - 2 auto-COS agents (temporary, created by system, deleted)
  - 2 test teams (temporary, created and deleted)
  - 1 kanban task (temporary, deleted with team)
  - Plugin settings.local.json modifications (temporary, cleaned up)
  - Agent registry entries (temporary, deleted)
  - Team registry entries (temporary, deleted)
  - Governance state changes (temporary, restored)
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
  - ai-maestro-plugins marketplace registered
  - No MANAGER currently assigned (or willingness to temporarily reassign)
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
author: AI Maestro Team
---

# Manager Gate Team Lifecycle Scenario

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state with known commit hash
- **Creates:** nothing
- **Modifies:** git history (new commit if needed)
- **Verify:** `git status` shows clean working tree. Screenshot: SCEN-005/S001-commit-current-state.png

#### S002: STATE-WIPE Checkpoint -- Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/manager-gate-team-lifecycle_<timestamp>/`
- **Goal:** Copies of all governance-relevant config files saved
- **Creates:** Backup directory with config copies
- **Modifies:** nothing
- **Verify:** Backup files exist and match originals (hash comparison). Screenshot: SCEN-005/S002-statewipe-checkpoint.png
- **Files to backup:**
  - `~/.claude/settings.json`
  - `~/.claude/settings.local.json`
  - `~/.aimaestro/governance.json`
  - `~/.aimaestro/agents/registry.json`
  - `~/.aimaestro/teams/teams.json`
  - `~/.aimaestro/teams/groups.json`

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `GET /api/sessions`
- **Goal:** Server running, returns 200
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API returns session list. Screenshot: SCEN-005/S003-build-and-verify-server.png

#### S004: Navigate to dashboard
- **Action:** `navigate_page` to `http://localhost:23000`
- **Goal:** Login page loads (LoginGate requires authentication)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Login form visible with password field. Screenshot: SCEN-005/S004-login-page.png

---

## Phase 1: LoginGate Authentication

#### S005: Verify unauthenticated session check
- **Action:** Check `GET /api/auth/session` (no cookies set yet)
- **Goal:** API returns 401 or `{ authenticated: false }`
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Not authenticated. Screenshot: SCEN-005/S005-no-session.png

#### S006: Log in with governance password
- **Action:** Fill password field with `mYkri1-xoxrap-gogtan`, click "Login" button
- **Goal:** Login succeeds, dashboard loads with sidebar and agent list
- **Creates:** Session cookie set in browser
- **Modifies:** nothing
- **Verify:** Dashboard visible with agent list. Screenshot: SCEN-005/S006-dashboard-loaded.png

#### S007: Take pre-test screenshot (baseline)
- **Action:** `take_screenshot` of full page
- **Goal:** Baseline image for CLEAN-AFTER-YOURSELF verification
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved to `tests/scenarios/screenshots/SCEN-005/S007-baseline.png`

#### S008: Ensure no MANAGER exists (precondition)
- **Action:** Check `GET /api/governance` for `hasManager: false`. If a MANAGER exists, remove MANAGER title via title dialog (set to AUTONOMOUS with password) before proceeding.
- **Goal:** No MANAGER on the host -- required for Phase 2 tests
- **Creates:** nothing
- **Modifies:** Possibly removes existing MANAGER title (will be restored in cleanup)
- **Verify:** `GET /api/governance` returns `hasManager: false`. Screenshot: SCEN-005/S008-ensure-no-manager-exists.png

---

## Phase 2: Verify No-Manager Blocking

#### S009: Verify governance API shows no MANAGER
- **Action:** Verify `GET /api/governance` returns `hasManager: false` and all teams have `blocked: true`
- **Goal:** Confirm the no-MANAGER state is reflected in API
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API response shows `hasManager: false`. Screenshot: SCEN-005/S009-verify-governance-api-shows.png

#### S010: Navigate to Teams tab in sidebar
- **Action:** Click the "Teams" tab in the sidebar
- **Goal:** Teams list visible in sidebar
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Teams tab is active, team list visible (may be empty or show blocked teams). Screenshot: SCEN-005/S010-navigate-to-teams-tab.png

#### S011: Attempt to create a team via UI
- **Action:** Click the "Create Team" button (or "+" button in teams section)
- **Goal:** Error message appears indicating teams require a MANAGER first
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** UI shows error message containing "MANAGER" requirement text. No team is created. Screenshot shows the error.

#### S012: Verify existing teams show blocked state (if any exist)
- **Action:** Inspect the teams list for any pre-existing teams
- **Goal:** All existing teams display a "blocked" badge or indicator
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Each team card/row shows a blocked indicator. If no teams exist, note "no teams to verify" and proceed. Screenshot of teams list.

---

## Phase 3: Assign MANAGER

#### S013: Click "Create new agent" button
- **Action:** Click the "+" button in sidebar header to open the Agent Creation Wizard
- **Goal:** Agent creation wizard opens
- **Creates:** nothing (wizard only)
- **Modifies:** nothing
- **Verify:** Wizard dialog visible with client selection step. Screenshot: SCEN-005/S013-click-create-new-agent.png

#### S014: Select Claude Code as client
- **Action:** Click "Claude Code" option in client selector
- **Goal:** Claude Code selected
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Option highlighted/selected. Screenshot: SCEN-005/S014-select-claude-code-as.png

#### S015: Click Next to avatar/name step
- **Action:** Click Next button
- **Goal:** Advances to avatar/name step
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Avatar picker and name input visible. Screenshot: SCEN-005/S015-click-next-to-avatarname.png

#### S016: Enter test agent name `scen-test-manager`
- **Action:** Type `scen-test-manager` in the name field
- **Goal:** Name entered, unique on this host
- **Creates:** nothing (not created yet)
- **Modifies:** nothing
- **Verify:** Name field shows `scen-test-manager`. Screenshot: SCEN-005/S016-enter-test-agent-name.png

#### S017: Complete wizard steps (AUTONOMOUS, no team)
- **Action:** Click Next through remaining steps: team selection (skip/no team), title (AUTONOMOUS is default), role-plugin (select "No plugin" for AUTONOMOUS), finish
- **Goal:** Agent created as AUTONOMOUS with no team
- **Creates:** Agent `scen-test-manager` in registry
- **Modifies:** Agent registry (new entry)
- **Verify:** New agent appears in sidebar agent list. Screenshot: SCEN-005/S017-complete-wizard-steps-autonomous.png

#### S018: Click on `scen-test-manager` in sidebar
- **Action:** Click the agent name in the sidebar
- **Goal:** Profile panel shows the new agent's details
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Profile panel heading shows `scen-test-manager`, title is AUTONOMOUS. Screenshot: SCEN-005/S018-click-on-scentestmanager-in.png

#### S019: Open Title Assignment Dialog
- **Action:** Click the title badge/button showing "AUTONOMOUS" in the profile panel
- **Goal:** Title Assignment Dialog opens with radio cards
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog shows available titles. Since agent has no team, only AUTONOMOUS and MANAGER should be shown. Screenshot: SCEN-005/S019-open-title-assignment-dialog.png

#### S020: Select MANAGER title
- **Action:** Click the MANAGER radio card
- **Goal:** MANAGER selected, Confirm button enabled
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Blue border on MANAGER card, Confirm not disabled. Screenshot: SCEN-005/S020-select-manager-title.png

#### S021: Confirm and enter governance password
- **Action:** Click Confirm, enter governance password `mYkri1-xoxrap-gogtan`, submit
- **Goal:** Title changes to MANAGER, role-plugin installed
- **Creates:** Plugin entry in agent's settings
- **Modifies:** Agent governanceTitle in registry, governance state (hasManager: true), plugin state
- **Verify:** Profile shows MANAGER badge (amber/gold), plugin banner shows `ai-maestro-assistant-manager-agent`. Screenshot: SCEN-005/S021-confirm-and-enter-governance.png

#### S022: Verify MANAGER assignment via API
- **Action:** Check `GET /api/governance` returns `hasManager: true` and `managerId` matches `scen-test-manager`
- **Goal:** Governance state reflects the new MANAGER
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API response confirms MANAGER exists. Screenshot: SCEN-005/S022-verify-manager-assignment-via.png

#### S023: Verify existing teams are unblocked
- **Action:** Check `GET /api/teams` -- all teams should have `blocked: false`
- **Goal:** Teams unblocked now that MANAGER exists (R9.6)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API shows no blocked teams. Screenshot: SCEN-005/S023-verify-existing-teams-are.png

---

## Phase 4: Create Team with Auto-COS

#### S024: Navigate to Teams tab
- **Action:** Click the "Teams" tab in the sidebar
- **Goal:** Teams list visible
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Teams tab is active. Screenshot: SCEN-005/S024-navigate-to-teams-tab.png

#### S025: Click "Create Team" button
- **Action:** Click the "Create Team" button
- **Goal:** Team creation dialog opens (should succeed now that MANAGER exists)
- **Creates:** nothing (dialog only)
- **Modifies:** nothing
- **Verify:** Team creation dialog visible with name input. Screenshot: SCEN-005/S025-click-create-team-button.png

#### S026: Enter team name `scen-test-governance-team`
- **Action:** Type `scen-test-governance-team` in the team name field
- **Goal:** Name entered
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Name field shows `scen-test-governance-team`. Screenshot: SCEN-005/S026-enter-team-name.png

#### S027: Submit team creation (no COS specified)
- **Action:** Leave the COS selection empty (auto-generate), click Create/Submit
- **Goal:** Team created with an auto-generated COS agent
- **Creates:** Team `scen-test-governance-team` in teams registry, auto-COS agent
- **Modifies:** Teams registry, agent registry
- **Verify:** Team appears in teams list. Screenshot: SCEN-005/S027-submit-team-creation.png

#### S028: Verify team created via API
- **Action:** Check `GET /api/teams` for the new team
- **Goal:** Team `scen-test-governance-team` exists with `blocked: false`
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Team exists in API response. Screenshot: SCEN-005/S028-verify-team-created.png

#### S029: Verify auto-COS agent created
- **Action:** Check team details -- `chiefOfStaffId` should reference an agent with a `cos-*` prefixed name
- **Goal:** Auto-COS agent exists with CHIEF-OF-STAFF title
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** COS agent found with `governanceTitle: 'CHIEF-OF-STAFF'`. Screenshot: SCEN-005/S029-verify-autocos.png

#### S030: Verify COS has correct plugin
- **Action:** Check the COS agent's installed plugins via `GET /api/agents/<cosId>`
- **Goal:** COS agent has `ai-maestro-chief-of-staff` role-plugin installed (R11)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin list includes `ai-maestro-chief-of-staff`. Screenshot: SCEN-005/S030-verify-cos-plugin.png

#### S031: Verify COS is in team's agentIds
- **Action:** Check team's `agentIds` array includes the COS agent's ID
- **Goal:** COS is a member of the team (R4.6 invariant)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `agentIds` contains `chiefOfStaffId`. Screenshot: SCEN-005/S031-verify-cos-in-agentids.png

---

## Phase 5: COS Immutability Probe (R4.7)

#### S032: Attempt to remove COS from team agentIds via API
- **Action:** Get the COS agent's ID and team ID. Attempt `PUT /api/teams/<teamId>` with body that has `agentIds` array excluding the COS agent's ID.
- **Goal:** API returns 400 -- COS cannot be removed from agentIds while they remain chiefOfStaffId (R4.7)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response status 400. Error mentions COS immutability. COS remains in team. Screenshot: SCEN-005/S032-cos-immutability.png

---

## Phase 6: Add Agent to Team -- MEMBER + Plugin

#### S033: Click "Create new agent" button
- **Action:** Click the "+" button in sidebar header
- **Goal:** Agent creation wizard opens
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Wizard dialog visible. Screenshot: SCEN-005/S033-click-create-new-agent.png

#### S034: Create agent `scen-test-team-member`
- **Action:** Select Claude Code, enter name `scen-test-team-member`, proceed through wizard as AUTONOMOUS with no team, finish
- **Goal:** Agent created as AUTONOMOUS
- **Creates:** Agent `scen-test-team-member` in registry
- **Modifies:** Agent registry
- **Verify:** New agent appears in sidebar, title is AUTONOMOUS. Screenshot: SCEN-005/S034-create-agent-scentestteammember.png

#### S035: Click on `scen-test-team-member` in sidebar
- **Action:** Click the agent in the sidebar
- **Goal:** Profile panel shows agent details
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Profile shows `scen-test-team-member`, title AUTONOMOUS, no team. Screenshot: SCEN-005/S035-click-on-scentestteammember.png

#### S036: Add agent to test team via profile
- **Action:** Click "Assign to Team" (or "Reassign" next to Team field), select `scen-test-governance-team` from the dropdown
- **Goal:** Agent joins the team
- **Creates:** nothing
- **Modifies:** Team agentIds (agent added), agent title (auto-transition to MEMBER via R4.4)
- **Verify:** Wait for operation to complete. Screenshot: SCEN-005/S036-add-agent-to-team.png

#### S037: Verify title auto-transitioned to MEMBER
- **Action:** Check the profile panel -- title badge should now show MEMBER
- **Goal:** Agent is MEMBER after joining team (R4.4, R11.4)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title badge shows MEMBER. Screenshot: SCEN-005/S037-verify-title-member.png

#### S038: Verify programmer plugin installed
- **Action:** Check Config tab or API for installed role-plugin
- **Goal:** `ai-maestro-programmer-agent` plugin is installed (R11.2)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin list shows `ai-maestro-programmer-agent`. Screenshot: SCEN-005/S038-verify-programmer-plugin.png

#### S039: Verify agent is in team's agentIds
- **Action:** Check `GET /api/teams/<teamId>` -- `agentIds` should include the test member
- **Goal:** Agent is a member of the team
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `agentIds` includes `scen-test-team-member`'s ID. Screenshot: SCEN-005/S039-verify-agent-in-team.png

---

## Phase 7: Kanban Task Usage

#### S040: Open team kanban board
- **Action:** Click on `scen-test-governance-team` in Teams tab, then click "Kanban" tab
- **Goal:** Kanban board visible with 5 columns (backlog, pending, in_progress, review, completed)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Kanban board rendered. Screenshot: SCEN-005/S040-kanban-board.png

#### S041: Create a kanban task via quick-add
- **Action:** Click "+" or "Quick Add" on Backlog column. Enter title "SCEN-005 governance test task". Click Create.
- **Goal:** Task appears in Backlog
- **Creates:** Task in team tasks file
- **Modifies:** nothing
- **Verify:** Task visible in Backlog. Screenshot: SCEN-005/S041-task-created.png

#### S042: Drag task from Backlog to In Progress
- **Action:** Drag task to In Progress column
- **Goal:** Task status changes
- **Creates:** nothing
- **Modifies:** Task status
- **Verify:** Task in In Progress. Screenshot: SCEN-005/S042-task-in-progress.png

---

## Phase 8: RBAC Probes

#### S043: Attempt agent self-modification via API
- **Action:** Get `scen-test-team-member`'s ID. Attempt `PATCH /api/agents/<id>` with header `X-Agent-Id: <id>` and body `{"label": "self-hack"}`.
- **Goal:** API returns 403 -- no agent can modify itself
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 403. Agent unchanged. Screenshot: SCEN-005/S043-no-self-mod.png

#### S044: Attempt agent lifecycle operation as wrong role
- **Action:** Get MEMBER agent's ID. Attempt `POST /api/agents/<managerId>/hibernate` with header `X-Agent-Id: <memberId>`.
- **Goal:** API returns 403 -- MEMBER cannot hibernate other agents (R10.4)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 403. Screenshot: SCEN-005/S044-rbac-lifecycle-denied.png

---

## Phase 9: Remove Agent from Team -- AUTONOMOUS

#### S045: Click "Leave team" on test member agent
- **Action:** In the profile panel for `scen-test-team-member`, click the "Leave team" button
- **Goal:** Agent removed from team
- **Creates:** nothing
- **Modifies:** Team agentIds (agent removed), agent title (reverts to AUTONOMOUS via R11.5)
- **Verify:** Wait for operation to complete. Screenshot: SCEN-005/S045-click-leave-team.png

#### S046: Verify title reverted to AUTONOMOUS
- **Action:** Check the profile panel -- title badge should show AUTONOMOUS
- **Goal:** Agent reverted to AUTONOMOUS after leaving team (R11.5)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title badge shows AUTONOMOUS. Screenshot: SCEN-005/S046-verify-title-autonomous.png

#### S047: Verify no role-plugin installed
- **Action:** Check Config tab or API -- no role-plugin should be present
- **Goal:** Plugin removed when title reverted to AUTONOMOUS (R11.3)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** No role-plugin. Screenshot: SCEN-005/S047-verify-no-plugin.png

#### S048: Verify agent removed from team's agentIds
- **Action:** Check `GET /api/teams/<teamId>` -- `agentIds` should NOT include the test member
- **Goal:** Agent is no longer in the team
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `agentIds` does not contain `scen-test-team-member`'s ID. Screenshot: SCEN-005/S048-verify-agent-removed.png

---

## Phase 10: Title Requires Team (Gate 9)

#### S049: Click on `scen-test-team-member` in sidebar (should be AUTONOMOUS)
- **Action:** Click the agent in sidebar
- **Goal:** Profile panel shows AUTONOMOUS agent not in any team
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title is AUTONOMOUS, no team shown. Screenshot: SCEN-005/S049-agent-autonomous.png

#### S050: Open Title Assignment Dialog
- **Action:** Click the AUTONOMOUS title badge
- **Goal:** Title dialog opens
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog visible with title options. Screenshot: SCEN-005/S050-open-title-dialog.png

#### S051: Verify only standalone titles are shown
- **Action:** Inspect the dialog options
- **Goal:** Only AUTONOMOUS and MANAGER visible. Team titles must NOT appear.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Exactly 2 options. Screenshot: SCEN-005/S051-standalone-titles.png

#### S052: Close the dialog
- **Action:** Click Cancel or press Escape
- **Goal:** Dialog dismissed
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog gone. Screenshot: SCEN-005/S052-close-dialog.png

---

## Phase 11: Delete Team via DeleteTeam 8-Gate Pipeline

#### S053: Navigate to team details for `scen-test-governance-team`
- **Action:** Click on the team in the Teams tab to view its details
- **Goal:** Team details visible, showing COS and any remaining members
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Team details panel open. Screenshot: SCEN-005/S053-team-details.png

#### S054: Note COS agent name for later verification
- **Action:** Record the auto-COS agent's name/ID from the team details
- **Goal:** Have the COS agent identifier for post-deletion verification
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** COS agent name recorded. Screenshot: SCEN-005/S054-note-cos-name.png

#### S055: Click Delete Team button
- **Action:** Click "Delete Team" button on the team card/details
- **Goal:** First confirmation dialog appears
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog visible with Cancel and Delete buttons. Screenshot: SCEN-005/S055-delete-dialog-1.png

#### S056: Confirm first dialog (are you sure?)
- **Action:** Click "Delete" in the first confirmation dialog
- **Goal:** Second dialog appears asking about agents and requesting governance password
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Second dialog with Keep Agents and Delete Agents Too buttons. Screenshot: SCEN-005/S056-delete-dialog-2.png

#### S057: Enter governance password and choose "Keep Agents"
- **Action:** Enter governance password `mYkri1-xoxrap-gogtan` if prompted, click "Keep Agents"
- **Goal:** Team deleted via DeleteTeam 8-gate pipeline (governance password verified, agents revert to AUTONOMOUS, transfers cancelled, team data files deleted)
- **Creates:** nothing
- **Modifies:** Teams registry (team removed), agent titles (all -> AUTONOMOUS), plugins stripped
- **Verify:** Dialog closes, team gone from sidebar. Screenshot: SCEN-005/S057-team-deleted.png

#### S058: Verify team no longer exists
- **Action:** Check `GET /api/teams` -- `scen-test-governance-team` should be gone
- **Goal:** Team fully removed from registry
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API does not include the deleted team. Screenshot: SCEN-005/S058-verify-team-gone.png

#### S059: Verify auto-COS agent reverted to AUTONOMOUS
- **Action:** Check the COS agent's profile (by name recorded in S054)
- **Goal:** Former COS agent now has AUTONOMOUS title and no role-plugin
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Agent's `governanceTitle` is AUTONOMOUS, no role-plugin installed. Screenshot: SCEN-005/S059-cos-autonomous.png

#### S060: Verify no former team agents retain team titles
- **Action:** Check all agents that were in the deleted team via API
- **Goal:** None have team-specific titles
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** All former team agents are AUTONOMOUS. Screenshot: SCEN-005/S060-all-autonomous.png

---

## Phase 12: Remove MANAGER -- Team Blocking Cascade

#### S061: Create a new team for blocking test
- **Action:** Open team creation dialog, enter name `scen-test-blocking-team`, submit
- **Goal:** New team created (MANAGER still exists)
- **Creates:** Team `scen-test-blocking-team` with auto-COS
- **Modifies:** Teams registry, agent registry
- **Verify:** Team appears, not blocked. Screenshot: SCEN-005/S061-blocking-team-created.png

#### S062: Record blocking team COS name
- **Action:** Note the auto-COS agent name for this team
- **Goal:** Have the agent name for cleanup
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** COS agent name recorded. Screenshot: SCEN-005/S062-record-cos-name.png

#### S063: Click on `scen-test-manager` in sidebar
- **Action:** Click the MANAGER agent
- **Goal:** Profile panel shows MANAGER agent
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title badge shows MANAGER. Screenshot: SCEN-005/S063-manager-profile.png

#### S064: Open Title Assignment Dialog for MANAGER agent
- **Action:** Click the MANAGER title badge
- **Goal:** Title dialog opens
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog visible. Screenshot: SCEN-005/S064-title-dialog.png

#### S065: Change title to AUTONOMOUS (remove MANAGER)
- **Action:** Select AUTONOMOUS, click Confirm, enter governance password `mYkri1-xoxrap-gogtan`, submit
- **Goal:** MANAGER title removed, agent becomes AUTONOMOUS. Blocking cascade triggers (R9.8).
- **Creates:** nothing
- **Modifies:** Agent title (-> AUTONOMOUS), governance state (hasManager: false), all teams blocked, team agents hibernated
- **Verify:** Title badge shows AUTONOMOUS, role-plugin removed. Screenshot: SCEN-005/S065-manager-removed.png

#### S066: Verify governance shows no MANAGER
- **Action:** Check `GET /api/governance`
- **Goal:** `hasManager: false`
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API confirms. Screenshot: SCEN-005/S066-no-manager.png

#### S067: Verify teams are blocked
- **Action:** Check `GET /api/teams`
- **Goal:** All teams have `blocked: true` (R9.2)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Every team blocked. Screenshot: SCEN-005/S067-teams-blocked.png

#### S068: Verify team agents are hibernated
- **Action:** Check the COS agent of `scen-test-blocking-team` via API or UI
- **Goal:** Agent is hibernated (no active tmux session) (R9.4)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Agent status offline/hibernated. Screenshot: SCEN-005/S068-agents-hibernated.png

#### S069: Attempt to wake a team agent
- **Action:** Try to wake the COS agent of the blocked team via UI
- **Goal:** Wake attempt fails because no MANAGER exists (R10.5)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Error message indicating MANAGER required. Agent remains hibernated. Screenshot: SCEN-005/S069-wake-denied.png

---

## Phase CLEANUP: Restore Original State

#### S070: Re-assign MANAGER to unblock teams for cleanup
- **Action:** Open title dialog for `scen-test-manager`, select MANAGER, enter governance password `mYkri1-xoxrap-gogtan`, confirm
- **Goal:** MANAGER restored so teams can be deleted
- **Removes:** nothing
- **Verify:** `GET /api/governance` shows `hasManager: true`. Screenshot: SCEN-005/S070-manager-restored.png

#### S071: Delete team `scen-test-blocking-team` with "Delete Agents Too"
- **Action:** Navigate to Teams tab, click delete on `scen-test-blocking-team`. Delete -> password `mYkri1-xoxrap-gogtan` -> "Delete Agents Too".
- **Goal:** Team AND all its agents deleted
- **Removes:** Team, auto-COS, any members
- **Verify:** Team gone from `GET /api/teams`. Screenshot: SCEN-005/S071-blocking-team-deleted.png

#### S072: Remove MANAGER title from `scen-test-manager`
- **Action:** Open title dialog, select AUTONOMOUS, enter governance password `mYkri1-xoxrap-gogtan`, confirm
- **Goal:** No MANAGER on host
- **Removes:** MANAGER title
- **Verify:** `GET /api/governance` shows `hasManager: false`. Screenshot: SCEN-005/S072-no-manager.png

#### S073: Delete test agent `scen-test-manager` via Danger Zone
- **Action:** Profile -> Danger Zone -> "Delete Agent" -> check "Also delete agent folder" -> type `scen-test-manager` -> Delete Forever
- **Goal:** Test agent fully removed
- **Removes:** Agent, folder, tmux session
- **Verify:** Agent no longer in sidebar. Screenshot: SCEN-005/S073-manager-deleted.png

#### S074: Delete test agent `scen-test-team-member`
- **Action:** Click delete button in profile panel, confirm
- **Goal:** Test agent fully removed
- **Removes:** Agent
- **Verify:** Agent gone. Screenshot: SCEN-005/S074-member-deleted.png

#### S075: Delete any remaining auto-COS agents (cos-* prefix)
- **Action:** Check agent list for `cos-` prefix agents from this test. Delete each.
- **Goal:** All auto-COS agents removed
- **Removes:** Auto-COS agents
- **Verify:** None remain. Screenshot: SCEN-005/S075-cos-deleted.png

#### S076: Verify cemetery entries and purge
- **Action:** Navigate to Settings -> Cemetery tab. Verify deleted test agents appear in cemetery with download/revive/purge options. Click "Purge" for each test entry.
- **Goal:** Cemetery entries verified, then purged (no test artifacts remain)
- **Removes:** Cemetery zip archives for test agents
- **Verify:** No scen-test entries remain in cemetery. Screenshot: SCEN-005/S076-cemetery-purged.png

#### S077: STATE-WIPE -- Restore configuration files
- **Action:** Compare current config files with backups from S002. If any differ, restore from backup.
- **Goal:** All config files match pre-test state
- **Creates:** nothing
- **Modifies:** Config files (restored to backup state)
- **Verify:** File hash comparison -- all 6 files match. Screenshot: SCEN-005/S077-state-restored.png

#### S078: Take post-test screenshot and compare with S007
- **Action:** `take_screenshot` of full page
- **Goal:** UI looks identical to pre-test baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual comparison with S007 screenshot. Screenshot: SCEN-005/S078-post-cleanup.png
