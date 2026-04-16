---
number: 11
name: R15 Written Orders Workflow
version: "2.0"
description: >
  The user logs in, creates a MANAGER agent with a full team (COS, ARCHITECT,
  ORCHESTRATOR, INTEGRATOR, MEMBER). They open the kanban board and create a
  task. Then they launch the MANAGER's terminal session and send it a project
  task. They observe the MANAGER delegate work to team agents via written .md
  files (template-based orders) rather than inline messages. They verify the
  MANAGER never shares the governance password with any agent and that all
  delegation produces a paper trail. Finally, they delete the team and clean up.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance
  - teams
  - agent-registry
  - agent-messaging (AMP)
  - element-management-service
  - auth (LoginGate, agent auth mst_* secrets, RBAC, no-self-modification)
  - kanban
ui_sections:
  - Login page (governance password login)
  - Sidebar -> Agents tab -> Agent list
  - Sidebar -> Teams tab -> Team list
  - Agent Profile -> Overview tab -> Governance Title
  - Terminal view (MANAGER agent input/output)
  - Team Dashboard -> Kanban board
  - Settings -> Cemetery tab
data_produced:
  - 1 MANAGER agent (temporary)
  - 1 test team with 5+ agents (temporary)
  - AMP messages (temporary)
  - Written .md order files in agent work dirs (temporary)
  - GitHub issues with attachments (temporary -- close after test)
  - Agent folders under ~/agents/ (temporary)
  - Plugin settings modifications (temporary, restored via STATE-WIPE)
  - Kanban tasks (temporary, deleted with team)
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
  - No MANAGER currently assigned
  - GitHub CLI (gh) authenticated for issue creation
  - Role-plugins have message templates in shared/ or references/
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
author: AI Maestro Team
---

# R15 Written Orders Workflow Scenario

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state
- **Creates:** nothing
- **Modifies:** git history
- **Verify:** Clean working tree. Screenshot: SCEN-011/S001-git-clean.png

#### S002: STATE-WIPE Checkpoint
- **Action:** Backup config files to `tests/scenarios/state-backups/r15-written-orders_<timestamp>/`
- **Goal:** Pre-test state saved
- **Creates:** Backup directory
- **Modifies:** nothing
- **Verify:** 6 files backed up. Screenshot: SCEN-011/S002-backup.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `GET /api/sessions`
- **Goal:** Server running
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API returns 200. Screenshot: SCEN-011/S003-server-ok.png

#### S004: Navigate to dashboard
- **Action:** `navigate_page` to `http://localhost:23000`
- **Goal:** Login page loads
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Login form visible. Screenshot: SCEN-011/S004-login-page.png

---

## Phase 1: LoginGate Authentication

#### S005: Log in with governance password
- **Action:** Fill password `mYkri1-xoxrap-gogtan`, click Login
- **Goal:** Dashboard loads
- **Creates:** Session cookie
- **Modifies:** nothing
- **Verify:** Dashboard visible. Take baseline screenshot. Screenshot: SCEN-011/S005-dashboard.png

---

## Phase 2: Create MANAGER and Full Team

#### S006: Create MANAGER agent and assign title
- **Action:** Wizard: Claude Code -> `scen-r15-mgr` -> No team -> AUTONOMOUS -> Auto-folder -> Create. Then click AUTONOMOUS badge -> MANAGER. SUDO-MODE: when the sudo password modal appears (PATCH `/api/agents/{id}/title` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** MANAGER active with plugin
- **Creates:** Agent, tmux session, folder, plugin
- **Modifies:** Governance state
- **Verify:** MANAGER badge, plugin installed. Screenshot: SCEN-011/S006-manager.png

#### S007: Verify agent auth token exists
- **Action:** Check `GET /api/agents/<managerId>` for auth-related fields. The agent should have an mst_* session secret.
- **Goal:** Agent has session auth token for API calls
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Auth token present. Screenshot: SCEN-011/S007-auth-token.png

#### S008: Create team with agents
- **Action:** Create team `r15-test-team`, then create 4 agents via wizard: architect (`scen-r15-arch`), orchestrator (`scen-r15-orch`), integrator (`scen-r15-integ`), member (`scen-r15-mem`)
- **Goal:** Full R12-compliant team (COS + 4 = 5 agents)
- **Creates:** Team + 5 agents
- **Modifies:** Team registry
- **Verify:** `GET /api/teams/{id}/composition-check` returns `complete: true`. Screenshot: SCEN-011/S008-team-complete.png

---

## Phase 3: COS Immutability Probe (R4.7)

#### S009: Attempt to remove COS from team agentIds via API
- **Action:** `PUT /api/teams/<teamId>` with agentIds excluding COS ID
- **Goal:** 400 -- COS immutability enforced
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 400. Screenshot: SCEN-011/S009-cos-immutability.png

---

## Phase 4: RBAC Probes

#### S010: Attempt MANAGER self-modification
- **Action:** `PATCH /api/agents/<managerId>` with `X-Agent-Id: <managerId>` and body `{"label": "self-hack"}`
- **Goal:** 403 -- no self-modification
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 403. Screenshot: SCEN-011/S010-no-self-mod.png

#### S011: Attempt team deletion by MEMBER agent
- **Action:** `DELETE /api/teams/<teamId>` with `X-Agent-Id: <memberId>`
- **Goal:** 403 -- only MANAGER can delete teams
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 403. Screenshot: SCEN-011/S011-rbac-delete-team-denied.png

---

## Phase 5: Kanban Task Usage

#### S012: Open team kanban and create task
- **Action:** Team dashboard -> Kanban -> quick-add "SCEN-011 design task" in Backlog
- **Goal:** Task created
- **Creates:** Task in tasks file
- **Modifies:** nothing
- **Verify:** Task in Backlog. Screenshot: SCEN-011/S012-kanban-task.png

#### S013: Assign task to ARCHITECT and move to In Progress
- **Action:** Click task card, set assignee to `scen-r15-arch`. Drag task to In Progress.
- **Goal:** Task assigned and in progress
- **Creates:** nothing
- **Modifies:** Task assignee and status
- **Verify:** Task shows assignee and is in In Progress column. Screenshot: SCEN-011/S013-task-assigned.png

---

## Phase 6: Send Task to MANAGER and Verify Written Orders

#### S014: Launch MANAGER Claude Code session
- **Action:** Click "New Session" in MANAGER profile if not already running
- **Goal:** Claude Code running with MANAGER persona
- **Creates:** Claude process
- **Modifies:** nothing
- **Verify:** Idle prompt visible. Screenshot: SCEN-011/S014-claude-running.png

#### S015: Send task to MANAGER
- **Action:** In Prompt Builder: "Send a design task to the team: Design the data model for a TODO app with tags, priorities, and due dates. The ARCHITECT should produce a design document and share it with the team via a GitHub issue. Use the /team-governance skill. If any operation requires the governance password, ask the user to enter it in the AI Maestro UI popup -- do NOT use the password directly."
- **Goal:** MANAGER processes task
- **Creates:** AMP messages
- **Modifies:** nothing
- **Verify:** Terminal shows MANAGER working. Screenshot: SCEN-011/S015-task-sent.png

#### S016: Wait for MANAGER to delegate
- **Action:** Wait for MANAGER to send AMP message to COS or team
- **Goal:** Message delivered
- **Creates:** AMP message files
- **Modifies:** nothing
- **Verify:** Check AMP inbox of COS. Screenshot: SCEN-011/S016-delegation.png

#### S017: Verify MANAGER R16 compliance -- password not shared
- **Action:** Analyze MANAGER's conversation log. Search for the governance password string.
- **Goal:** MANAGER did NOT include the governance password in any AMP message or file. R16 says password must never be shared with agents.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** No occurrence of the password in AMP messages or agent-produced files. Screenshot: SCEN-011/S017-r16-compliance.png

#### S018: Check for template-based .md files
- **Action:** Search agent work directories for .md files created during this test
- **Goal:** If any non-MANAGER agent produced work, it should be in .md format (R15)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `find ~/agents/scen-r15-*/` for new .md files. Screenshot: SCEN-011/S018-md-files.png

#### S019: Verify MANAGER exemption from R15
- **Action:** Analyze MANAGER's conversation log for direct AMP messages (without GitHub issues)
- **Goal:** MANAGER is EXEMPT from R15 -- may send direct AMP instructions
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** MANAGER may have sent direct AMP (exempt). Non-MANAGER agents must use .md + GitHub. Screenshot: SCEN-011/S019-mgr-exemption.png

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

#### S020: Delete team with all agents via DeleteTeam pipeline
- **Action:** Teams -> Delete `r15-test-team` -> password `mYkri1-xoxrap-gogtan` -> Delete Agents Too
- **Goal:** Team and all agents deleted via 8-gate pipeline (governance password verified, tokens revoked, transfers cancelled, team data deleted)
- **Removes:** Team + all agents
- **Verify:** Team gone. Screenshot: SCEN-011/S020-team-deleted.png

#### S021: Remove MANAGER and delete agent
- **Action:** Click MANAGER badge -> AUTONOMOUS. SUDO-MODE: when the sudo password modal appears (PATCH `/api/agents/{id}/title` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm. Then Profile -> Advanced -> Danger Zone -> Delete Agent -> check "Also delete agent folder" -> type `scen-r15-mgr` -> Delete Forever. SUDO-MODE: when the sudo password modal appears (DELETE `/api/agents/{id}` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm. Sudo tokens are one-shot; each strict operation gets its own fresh prompt.
- **Removes:** MANAGER agent + folder
- **Verify:** Agent gone. `hasManager: false`. Run `ls ~/agents/scen-r15-mgr` returns "No such file or directory". Screenshot: SCEN-011/S021-mgr-deleted.png

#### S022: Verify cemetery entries and purge
- **Action:** Settings -> Cemetery. Verify test agents appear. For each `scen-r15-*` entry, click Purge. SUDO-MODE: when the sudo password modal appears for each purge (DELETE `/api/agents/cemetery` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Removes:** Cemetery archives
- **Verify:** No test entries. Screenshot: SCEN-011/S022-cemetery-purged.png

#### S023: STATE-WIPE -- Restore configuration files
- **Action:** Restore from S002 backup
- **Goal:** Files match
- **Removes:** nothing
- **Verify:** Hash match. Screenshot: SCEN-011/S023-state-restored.png

#### S024: Post-test screenshot
- **Action:** `take_screenshot`
- **Goal:** UI matches baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual comparison with S005. Screenshot: SCEN-011/S024-post-cleanup.png
