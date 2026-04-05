---
number: 9
name: Manager-Driven Team Creation (JSONL Viewer)
version: "1.0"
description: >
  End-to-end governance workflow test. Creates a MANAGER agent, sends it a
  project task (build a JSONL viewer for macOS in Swift), and verifies it
  follows governance protocols step by step: creates a team, auto-COS is
  assigned, team members are created with appropriate titles, kanban tasks
  are set up. Each MANAGER action is verified individually via UI and API.
  Tests governance rules R4.6, R9, R10, R11, communication graph, G03 safety.
subsystems:
  - governance
  - teams
  - agent-registry
  - element-management-service
  - agent-messaging (AMP)
  - role-plugins
  - kanban (team tasks)
ui_sections:
  - Sidebar -> Agents tab -> Agent list
  - Sidebar -> Teams tab -> Team list
  - Agent Profile -> Overview tab -> Governance Title
  - Agent Profile -> Config tab -> Role Plugin
  - Title Assignment Dialog (radio cards, password prompt)
  - Governance Password Dialog
  - Team Dashboard -> Overview
  - Team Dashboard -> Kanban
  - Terminal view (MANAGER agent input/output)
data_produced:
  - 1 MANAGER agent (temporary, created and deleted)
  - 1 team (temporary, created by MANAGER, deleted)
  - 1 auto-COS agent (temporary, created by system, deleted)
  - 2-4 team member agents (temporary, created by MANAGER, deleted)
  - Kanban tasks (temporary, deleted with team)
  - AMP messages (temporary)
  - Agent folders under ~/agents/ (temporary, deleted)
  - Plugin settings modifications (temporary, restored via STATE-WIPE)
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
  - Claude Code CLI available
  - Sufficient API credits for MANAGER agent to run autonomously (~15 min)
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
author: AI Maestro Team
---

# Manager-Driven Team Creation (JSONL Viewer) Scenario

> **Relation to SCEN-005/006:** Those scenarios tested governance by manually
> clicking UI buttons. This scenario tests whether the MANAGER agent itself
> follows governance protocols when given a real task. After setup, each
> MANAGER action is verified individually through the UI and API.

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state with known commit hash
- **Creates:** nothing
- **Modifies:** git history (new commit if needed)
- **Verify:** `git status` shows clean working tree

#### S002: STATE-WIPE Checkpoint — Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/manager-driven-team_<timestamp>/`
- **Goal:** Copies of all governance-relevant config files saved
- **Creates:** Backup directory with config copies
- **Modifies:** nothing
- **Verify:** Backup files exist and match originals (hash comparison)
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
- **Verify:** API returns session list

#### S004: Navigate to dashboard and take baseline screenshot
- **Action:** `navigate_page` to `http://localhost:23000`, `take_screenshot`
- **Goal:** Dashboard loads, baseline captured
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved to `tests/scenarios/screenshots/SCEN-009/S004-baseline.png`

#### S005: Ensure no MANAGER exists
- **Action:** Check `GET /api/governance` for `hasManager: false`. If a MANAGER exists, remove via title dialog before proceeding.
- **Goal:** No MANAGER on the host
- **Creates:** nothing
- **Modifies:** Possibly removes existing MANAGER title
- **Verify:** `GET /api/governance` returns `hasManager: false`

#### S006: Record current agent and team counts
- **Action:** Check `GET /api/agents` and `GET /api/teams` to record pre-test counts
- **Goal:** Baseline counts recorded for cleanup verification
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Record agent count and team count in report

---

## Phase 1: Create and Activate MANAGER Agent

#### S007: Open Agent Creation Wizard
- **Action:** Click "+" button in sidebar header, click "Create Agent"
- **Goal:** Wizard opens at client selection step
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Wizard dialog visible with client options

#### S008: Select Claude Code and enter name
- **Action:** Click "Claude Code" → type `scen-mgr-jsonl` in Persona Name field → click Next
- **Goal:** Client selected, name entered, wizard advances
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Wizard shows team selection step

#### S009: Select no team and AUTONOMOUS title
- **Action:** Click "No team (Autonomous)" → click "AUTONOMOUS"
- **Goal:** Wizard advances through team and title steps
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Wizard shows folder selection step

#### S010: Select auto-folder and complete wizard
- **Action:** Click "Auto-create agent folder" → click "No plugin (bare agent)" (or accept auto-skip) → click "Create Agent!" → click "Let's Go!"
- **Goal:** Agent created with folder ~/agents/scen-mgr-jsonl/
- **Creates:** Agent `scen-mgr-jsonl` in registry, tmux session, folder ~/agents/scen-mgr-jsonl/
- **Modifies:** Agent registry
- **Verify:** Agent appears in sidebar. Profile shows AUTONOMOUS, program=claude.

#### S011: Assign MANAGER title
- **Action:** Click AUTONOMOUS badge in profile → select MANAGER → click Confirm → enter password `mYkri1-xoxrap-gogtan` → click Confirm
- **Goal:** Title changes to MANAGER, plugin auto-installed
- **Creates:** Plugin entry in agent settings
- **Modifies:** Governance state (hasManager: true), agent title
- **Verify:** Profile shows MANAGER badge and `ai-maestro-assistant-manager-agent` plugin

#### S012: Verify MANAGER via API
- **Action:** Check `GET /api/governance`
- **Goal:** `hasManager: true`, `managerId` matches scen-mgr-jsonl
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API confirms MANAGER exists

#### S013: Launch Claude Code session for MANAGER
- **Action:** If terminal shows only a shell prompt (no Claude running), click "New Session" in the profile panel. Wait for the Claude Code idle prompt to appear.
- **Goal:** MANAGER has a running Claude Code session
- **Creates:** Claude Code process in tmux session
- **Modifies:** nothing
- **Verify:** Terminal shows Claude Code prompt (not just `$` or `%`). Screenshot.

---

## Phase 2: Send Project Task to MANAGER

#### S014: Type task instruction in terminal
- **Action:** In the Prompt Builder textarea, type the following and click Send:
  ```
  Create a team called "jsonl-viewer-swift" to build a JSONL viewer desktop app for macOS in Swift/SwiftUI. The app needs to: (1) open .jsonl files and display each JSON line in a table, (2) filter/search across all lines, (3) pretty-print individual JSON objects when clicked, (4) handle large files 100MB+ with lazy loading. Create the team using the /team-governance skill, then create 2 team members: one ARCHITECT for Swift/SwiftUI design and one MEMBER for implementation. Use governance password "mYkri1-xoxrap-gogtan" when prompted.
  ```
- **Goal:** MANAGER receives the task
- **Creates:** nothing (yet)
- **Modifies:** nothing (yet)
- **Verify:** Terminal shows the MANAGER processing the message. Screenshot.

#### S015: Wait for MANAGER to acknowledge and start planning
- **Action:** Watch terminal output. Wait for text indicating the MANAGER is planning (e.g., mentions "team", "governance", "create", or invokes a skill).
- **Goal:** MANAGER has acknowledged the task and started acting
- **Creates:** nothing (yet)
- **Modifies:** nothing (yet)
- **Verify:** Terminal contains planning output or skill invocation. Screenshot.

---

## Phase 3: Verify Team Was Created

#### S016: Check Teams tab for new team
- **Action:** Click "Teams" tab in sidebar. Look for a team named "jsonl-viewer-swift" (or similar name chosen by MANAGER).
- **Goal:** Team appears in sidebar
- **Creates:** nothing (verifying)
- **Modifies:** nothing
- **Verify:** Team visible in Teams tab. If not visible after 3 minutes, refresh sidebar and check again. Record team name.

#### S017: Verify team exists via API
- **Action:** Check `GET /api/teams` for the new team
- **Goal:** Team exists with `blocked: false`
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Team found in API response. Record team ID.

#### S018: Verify auto-COS was assigned
- **Action:** Check team details — `chiefOfStaffId` should reference a COS agent
- **Goal:** COS agent exists with `governanceTitle: chief-of-staff`
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** COS agent found in registry. COS ID in team's `agentIds`. Record COS name.

#### S019: Screenshot team in sidebar
- **Action:** `take_screenshot` showing Teams tab with the new team
- **Goal:** Visual record of team creation
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved to `tests/scenarios/screenshots/SCEN-009/S019-team-created.png`

---

## Phase 4: Verify MANAGER Created Team Members

#### S020: Check sidebar for first new agent
- **Action:** Click "Agents" tab. Look for a new agent created by the MANAGER (name will be chosen by MANAGER, likely related to "architect" or "swift").
- **Goal:** At least one new agent visible in sidebar
- **Creates:** nothing (verifying)
- **Modifies:** nothing
- **Verify:** New agent visible. If not visible after 5 minutes, take terminal screenshot and check if MANAGER is still working. Record agent name.

#### S021: Verify first agent's title is a team title
- **Action:** Click on the new agent in sidebar. Check the Governance Title in profile.
- **Goal:** Agent has a team title (ARCHITECT, MEMBER, ORCHESTRATOR, or INTEGRATOR)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title badge shows a team title, not AUTONOMOUS or MANAGER

#### S022: Verify first agent is in the team
- **Action:** Check `GET /api/teams/<teamId>` — `agentIds` should include this agent
- **Goal:** Agent is a member of the team
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Agent ID in team's `agentIds`

#### S023: Verify first agent's working directory
- **Action:** Check agent profile — working directory should be under ~/agents/
- **Goal:** Agent folder is safe (not in source dir, not in forbidden paths)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Working directory starts with ~/agents/ or /Users/<user>/agents/

#### S024: Check sidebar for second new agent
- **Action:** Look for a second new agent in sidebar (the MEMBER programmer)
- **Goal:** Second agent visible
- **Creates:** nothing (verifying)
- **Modifies:** nothing
- **Verify:** Second agent visible. Record agent name. If MANAGER only created one agent, note in report and proceed.

#### S025: Verify second agent's title and team membership
- **Action:** Click on second agent. Check title and team membership via profile and API.
- **Goal:** Agent has a team title and is in the team's agentIds
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Team title shown, agent ID in team's `agentIds`, working directory under ~/agents/

#### S026: Screenshot of full team composition
- **Action:** Navigate to team dashboard (click team name or go to /teams/<id>). `take_screenshot`.
- **Goal:** Visual record of MANAGER's team decisions
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved showing team name, COS, member agents, agent count. `tests/scenarios/screenshots/SCEN-009/S026-team-composition.png`

---

## Phase 5: Governance Compliance Checks

#### S027: MANAGER is not in the team
- **Action:** Check team's `agentIds` via API — scen-mgr-jsonl's ID should NOT be present
- **Goal:** MANAGER is host-level, not team-level (R9.1)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** MANAGER agent ID not in team's `agentIds`

#### S028: No team agent has AUTONOMOUS or MANAGER title
- **Action:** For each agent in the team's `agentIds`, check `governanceTitle` via API
- **Goal:** All team agents have team titles (R10)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Every agent has one of: member, chief-of-staff, orchestrator, architect, integrator

#### S029: No duplicate or nested working directories
- **Action:** Collect `workingDirectory` for all agents created during this test. Check no two are the same or parent/child of each other.
- **Goal:** G03-OVERLAP enforced
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** All working directories are unique and non-nested

#### S030: No orphan duplicate agents (BUG-018 regression)
- **Action:** Check `GET /api/agents` for agents with `metadata.autoRegistered: true` that have UUID-based names matching any test agent's ID
- **Goal:** No orphan duplicates created by auto-discovery
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** No UUID-named orphans matching test agent IDs

---

## Phase 6: Verify Kanban Tasks (if created)

#### S031: Open team kanban board
- **Action:** Navigate to team dashboard → click "Kanban" tab
- **Goal:** Kanban board visible
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Kanban board rendered (may be empty or have tasks). Screenshot.

#### S032: Count and inspect tasks
- **Action:** Count tasks on the kanban board. For each task, note: title, status column, assignee.
- **Goal:** If MANAGER created tasks, they are well-formed and assigned to team members (not MANAGER)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Tasks (if any) have titles, are in backlog/pending columns, assigned to team agents. Screenshot saved to `tests/scenarios/screenshots/SCEN-009/S032-kanban.png`. If no tasks exist, note "MANAGER did not create kanban tasks" in report.

---

## Phase 7: Stress Test — Remove and Re-add MANAGER

#### S033: Remove MANAGER title
- **Action:** Navigate to dashboard. Click on `scen-mgr-jsonl` in sidebar → click MANAGER badge → select AUTONOMOUS → click Confirm → enter password `mYkri1-xoxrap-gogtan` → click Confirm
- **Goal:** MANAGER removed, team blocked (R9.5)
- **Creates:** nothing
- **Modifies:** Governance state (hasManager: false), team blocked
- **Verify:** Profile shows AUTONOMOUS. `GET /api/governance` returns `hasManager: false`. `GET /api/teams/<id>` returns `blocked: true`.

#### S034: Re-assign MANAGER title
- **Action:** Click AUTONOMOUS badge → select MANAGER → click Confirm → enter password `mYkri1-xoxrap-gogtan` → click Confirm
- **Goal:** MANAGER restored, team unblocked (R9.6)
- **Creates:** nothing
- **Modifies:** Governance state (hasManager: true), team unblocked
- **Verify:** Profile shows MANAGER. `GET /api/governance` returns `hasManager: true`. `GET /api/teams/<id>` returns `blocked: false`.

---

## Phase CLEANUP: Restore Original State

#### S035: Delete the team with all agents
- **Action:** Navigate to /teams. Click Delete on the test team. First dialog: click Delete. Second dialog: enter governance password `mYkri1-xoxrap-gogtan`, click "Delete Agents Too".
- **Goal:** Team and all team agents deleted
- **Removes:** Team, COS agent, all team member agents and their folders
- **Verify:** Team not in `GET /api/teams`. No team agent IDs in `GET /api/agents`.

#### S036: Remove MANAGER title from scen-mgr-jsonl
- **Action:** Click on `scen-mgr-jsonl` → click MANAGER badge → select AUTONOMOUS → click Confirm → enter password `mYkri1-xoxrap-gogtan` → click Confirm
- **Goal:** No MANAGER on host
- **Removes:** MANAGER title
- **Verify:** `GET /api/governance` returns `hasManager: false`

#### S037: Delete scen-mgr-jsonl agent with folder
- **Action:** Profile → expand Danger Zone → click "Delete Agent" → check "Also delete agent folder" → type `scen-mgr-jsonl` → click "Delete Forever"
- **Goal:** Agent and folder fully removed
- **Removes:** Agent `scen-mgr-jsonl`, tmux session, folder ~/agents/scen-mgr-jsonl/
- **Verify:** Agent not in sidebar. `GET /api/agents/<id>` returns 404. Folder ~/agents/scen-mgr-jsonl/ does not exist.

#### S038: Delete any remaining test agents and tmux sessions
- **Action:** Check agent list for any agents created during this test (names containing "jsonl", "swift", "scen-mgr"). Delete each via Danger Zone with "Also delete agent folder" checked. Kill matching tmux sessions.
- **Goal:** No test artifacts remain
- **Removes:** Stray agents, tmux sessions, folders
- **Verify:** Agent count matches S006 baseline. No matching tmux sessions in `tmux ls`.

#### S039: STATE-WIPE — Restore configuration files
- **Action:** Compare current config files with backups from S002. Restore any that differ.
- **Goal:** All config files match pre-test state
- **Removes:** nothing
- **Verify:** File hash comparison — all 6 files match

#### S040: Post-test screenshot
- **Action:** `take_screenshot` of full page
- **Goal:** UI identical to S004 baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved to `tests/scenarios/screenshots/SCEN-009/S040-post-cleanup.png`. Visual comparison with S004 baseline.
