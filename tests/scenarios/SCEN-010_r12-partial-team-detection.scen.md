---
number: 10
name: R12 Partial Team Detection
version: "2.0"
description: >
  The user logs in, creates a MANAGER, and creates a team. They add only an
  ARCHITECT and a MEMBER (plus the auto-assigned COS), leaving the team
  deliberately incomplete -- missing an ORCHESTRATOR and INTEGRATOR. They check
  that the team dashboard shows a "partial" warning. Then they add an
  ORCHESTRATOR and an INTEGRATOR to complete the minimum composition. The warning
  disappears. They open the kanban board, create a task, and drag it through
  columns to Completed. Finally, they delete the team and clean up.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance
  - teams
  - agent-registry
  - element-management-service
  - auth (LoginGate, RBAC, no-self-modification)
  - kanban
ui_sections:
  - Login page (governance password login)
  - Sidebar -> Agents tab -> Agent list
  - Sidebar -> Teams tab -> Team list
  - Agent Profile -> Overview tab -> Governance Title
  - Title Assignment Dialog (radio cards, password prompt)
  - Team Dashboard -> Kanban board
  - Settings -> Cemetery tab
data_produced:
  - 1 MANAGER agent (temporary, created and deleted)
  - 1 test team (temporary, created and deleted)
  - 5 test agents (temporary, created and deleted)
  - 1 auto-COS agent (temporary, deleted with team)
  - 1 kanban task (temporary, deleted with team)
  - Agent folders under ~/agents/ (temporary, deleted)
  - Plugin settings modifications (temporary, restored via STATE-WIPE)
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
  - R12 composition-check API implemented (GET /api/teams/{id}/composition-check)
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

# R12 Partial Team Detection Scenario

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state
- **Creates:** nothing
- **Modifies:** git history
- **Verify:** Clean working tree. Screenshot: SCEN-010/S001-git-clean.png

#### S002: STATE-WIPE Checkpoint -- Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/r12-partial-team_<timestamp>/`
- **Goal:** All config files saved
- **Creates:** Backup directory
- **Modifies:** nothing
- **Verify:** Backups match. Screenshot: SCEN-010/S002-backup.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `GET /api/sessions`
- **Goal:** Server running
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API returns 200. Screenshot: SCEN-010/S003-server-ok.png

#### S004: Navigate to dashboard
- **Action:** `navigate_page` to `http://localhost:23000`
- **Goal:** Login page loads
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Login form visible. Screenshot: SCEN-010/S004-login-page.png

---

## Phase 1: LoginGate Authentication

#### S005: Log in with governance password
- **Action:** Fill password `mYkri1-xoxrap-gogtan`, click Login
- **Goal:** Dashboard loads
- **Creates:** Session cookie
- **Modifies:** nothing
- **Verify:** Dashboard visible. Take baseline screenshot. Screenshot: SCEN-010/S005-dashboard.png

#### S006: Record baseline counts
- **Action:** Check `GET /api/agents`, `GET /api/teams`, `GET /api/governance`
- **Goal:** Baseline: agent count, team count, hasManager=false
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Counts recorded. Screenshot: SCEN-010/S006-baseline-counts.png

---

## Phase 2: Create MANAGER and Test Team

#### S007: Create MANAGER agent via wizard
- **Action:** Wizard: Claude Code -> `scen-r12-mgr` -> No team -> AUTONOMOUS -> Auto-folder -> Create
- **Goal:** Agent created
- **Creates:** Agent, tmux session, folder
- **Modifies:** Registry
- **Verify:** Agent in sidebar. Screenshot: SCEN-010/S007-mgr-created.png

#### S008: Assign MANAGER title
- **Action:** AUTONOMOUS badge -> MANAGER. SUDO-MODE: when the sudo password modal appears (PATCH `/api/agents/{id}/title` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** MANAGER assigned
- **Creates:** Plugin entry
- **Modifies:** Governance (hasManager: true)
- **Verify:** MANAGER badge. Screenshot: SCEN-010/S008-manager-assigned.png

#### S009: Create test team via Teams tab
- **Action:** Teams tab -> Create Team -> `scen-r12-incomplete` -> submit
- **Goal:** Team created with auto-COS
- **Creates:** Team + auto-COS agent
- **Modifies:** Registries
- **Verify:** Team in sidebar. Record team ID and COS ID. Screenshot: SCEN-010/S009-team-created.png

---

## Phase 3: COS Immutability Probe (R4.7)

#### S010: Attempt to remove COS from team agentIds via API
- **Action:** `PUT /api/teams/<teamId>` with agentIds excluding COS ID
- **Goal:** 400 -- COS immutability
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 400. Screenshot: SCEN-010/S010-cos-immutability.png

---

## Phase 4: Build Incomplete Team (Missing Titles)

#### S011: Create ARCHITECT agent in team
- **Action:** Wizard: Claude Code -> `scen-r12-architect` -> select team -> ARCHITECT -> finish
- **Goal:** ARCHITECT created in team
- **Creates:** Agent
- **Modifies:** Team agentIds
- **Verify:** Agent with ARCHITECT title. Screenshot: SCEN-010/S011-architect.png

#### S012: Create MEMBER agent in team
- **Action:** Wizard: Claude Code -> `scen-r12-member` -> select team -> MEMBER -> finish
- **Goal:** MEMBER created in team
- **Creates:** Agent
- **Modifies:** Team agentIds
- **Verify:** Agent with MEMBER title. Screenshot: SCEN-010/S012-member.png

---

## Phase 5: Verify R12 Non-Functional Team Detection

> **Team now has 3 agents: COS + ARCHITECT + MEMBER. Missing: ORCHESTRATOR and INTEGRATOR.**

#### S013: Check composition via API
- **Action:** `GET /api/teams/{id}/composition-check`
- **Goal:** API reports missing: orchestrator, integrator
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `{ complete: false, missing: ["orchestrator", "integrator"] }`. Screenshot: SCEN-010/S013-missing-titles.png

#### S014: Verify team shows warning in UI
- **Action:** Look for warning badge on incomplete team in Teams tab
- **Goal:** Non-functional indicator visible
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Team card shows incomplete status. Screenshot: SCEN-010/S014-team-warning.png

---

## Phase 6: RBAC Probes

#### S015: Attempt agent self-modification
- **Action:** `PATCH /api/agents/<architectId>` with `X-Agent-Id: <architectId>` and body `{"label": "self-hack"}`
- **Goal:** 403 -- no self-modification
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 403. Screenshot: SCEN-010/S015-no-self-mod.png

#### S016: Attempt agent deletion by MEMBER
- **Action:** `DELETE /api/agents/<architectId>` with `X-Agent-Id: <memberId>`
- **Goal:** 403 -- only MANAGER can delete agents
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 403. Screenshot: SCEN-010/S016-rbac-delete-denied.png

---

## Phase 7: Complete the Team

#### S017: Create ORCHESTRATOR agent
- **Action:** Wizard: Claude Code -> `scen-r12-orch` -> select team -> ORCHESTRATOR -> finish
- **Goal:** ORCHESTRATOR in team
- **Creates:** Agent
- **Modifies:** Team agentIds
- **Verify:** Agent with ORCHESTRATOR title. Screenshot: SCEN-010/S017-orchestrator.png

#### S018: Create INTEGRATOR agent
- **Action:** Wizard: Claude Code -> `scen-r12-integ` -> select team -> INTEGRATOR -> finish
- **Goal:** INTEGRATOR in team
- **Creates:** Agent
- **Modifies:** Team agentIds
- **Verify:** Agent with INTEGRATOR title. Screenshot: SCEN-010/S018-integrator.png

#### S019: Verify team is now R12-complete
- **Action:** `GET /api/teams/{id}/composition-check`
- **Goal:** Team complete
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `{ complete: true, missing: [] }`. Screenshot: SCEN-010/S019-complete.png

---

## Phase 8: Kanban Task Usage on Complete Team

#### S020: Open team kanban and create task
- **Action:** Team dashboard -> Kanban -> quick-add "SCEN-010 composition test task" in Backlog
- **Goal:** Task created
- **Creates:** Task in tasks file
- **Modifies:** nothing
- **Verify:** Task in Backlog. Screenshot: SCEN-010/S020-kanban-task.png

#### S021: Drag task to Completed
- **Action:** Drag task from Backlog to Completed
- **Goal:** Status changes
- **Creates:** nothing
- **Modifies:** Task status
- **Verify:** Task in Completed. Screenshot: SCEN-010/S021-task-completed.png

---

## Phase 9: Test R14 -- Agent Deletion Recovery Detection

#### S022: Delete the ORCHESTRATOR agent
- **Action:** Profile -> Advanced -> Danger Zone -> Delete Agent (scen-r12-orch) -> check "Also delete agent folder" -> type `scen-r12-orch` -> Delete Forever. SUDO-MODE: when the sudo password modal appears (DELETE `/api/agents/{id}` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** ORCHESTRATOR removed from team
- **Removes:** Agent, folder, tmux
- **Verify:** Agent gone. Run `ls ~/agents/scen-r12-orch` returns "No such file or directory". Screenshot: SCEN-010/S022-orch-deleted.png

#### S023: Verify cemetery shows deleted ORCHESTRATOR
- **Action:** Settings -> Cemetery tab
- **Goal:** `scen-r12-orch` appears in cemetery
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Cemetery entry visible with archive date. Screenshot: SCEN-010/S023-cemetery-entry.png

#### S024: Verify team is non-functional again
- **Action:** `GET /api/teams/{id}/composition-check`
- **Goal:** Missing ORCHESTRATOR
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `{ complete: false, missing: ["orchestrator"] }`. Screenshot: SCEN-010/S024-missing-orch.png

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

#### S025: Delete test team with all agents
- **Action:** Teams -> Delete team -> password `mYkri1-xoxrap-gogtan` -> Delete Agents Too
- **Goal:** Team and all agents deleted via DeleteTeam 8-gate pipeline
- **Removes:** Team, COS, all test agents
- **Verify:** Team gone. Screenshot: SCEN-010/S025-team-deleted.png

#### S026: Remove MANAGER title
- **Action:** MANAGER badge -> AUTONOMOUS. SUDO-MODE: when the sudo password modal appears (PATCH `/api/agents/{id}/title` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Removes:** MANAGER title
- **Verify:** `hasManager: false`. Screenshot: SCEN-010/S026-mgr-removed.png

#### S027: Delete MANAGER agent with folder
- **Action:** Profile -> Advanced -> Danger Zone -> Delete Agent -> check "Also delete agent folder" -> type `scen-r12-mgr` -> Delete Forever. SUDO-MODE: when the sudo password modal appears (DELETE `/api/agents/{id}` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Removes:** Agent, folder
- **Verify:** Agent gone. Run `ls ~/agents/scen-r12-mgr` returns "No such file or directory". Screenshot: SCEN-010/S027-mgr-deleted.png

#### S028: Purge all test cemetery entries
- **Action:** Settings -> Cemetery. For each `scen-r12-*` entry, click Purge. SUDO-MODE: when the sudo password modal appears for each purge (DELETE `/api/agents/cemetery` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm. Each purge requires a fresh sudo token (tokens are one-shot).
- **Removes:** Cemetery archives
- **Verify:** No test entries. Screenshot: SCEN-010/S028-cemetery-purged.png

#### S029: STATE-WIPE -- Restore configuration files
- **Action:** Restore from S002 backup
- **Goal:** All files match
- **Verify:** Hash match. Screenshot: SCEN-010/S029-state-restored.png

#### S030: Post-test screenshot
- **Action:** `take_screenshot`
- **Goal:** UI identical to S005 baseline
- **Verify:** Visual comparison. Screenshot: SCEN-010/S030-post-cleanup.png
