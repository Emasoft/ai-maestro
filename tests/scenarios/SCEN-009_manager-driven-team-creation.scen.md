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
  - 5+ team member agents (temporary, created by MANAGER, deleted: COS + ARCHITECT + ORCHESTRATOR + INTEGRATOR + MEMBER minimum)
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
- **Verify:** `git status` shows clean working tree. Screenshot: SCEN-009/S001-git-clean.png

#### S002: STATE-WIPE Checkpoint — Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/manager-driven-team_<timestamp>/`
- **Goal:** Copies of all governance-relevant config files saved
- **Creates:** Backup directory with config copies
- **Modifies:** nothing
- **Verify:** Backup files exist and match originals (hash comparison). Screenshot: SCEN-009/S002-backup-created.png
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
- **Verify:** API returns session list. Screenshot: SCEN-009/S003-server-healthy.png

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
- **Verify:** `GET /api/governance` returns `hasManager: false`. Screenshot: SCEN-009/S005-no-manager.png

#### S006: Record current agent and team counts
- **Action:** Check `GET /api/agents` and `GET /api/teams` to record pre-test counts
- **Goal:** Baseline counts recorded for cleanup verification
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Record agent count and team count in report. Screenshot: SCEN-009/S006-baseline-counts.png

---

## Phase 1: Create and Activate MANAGER Agent

#### S007: Open Agent Creation Wizard
- **Action:** Click "+" button in sidebar header, click "Create Agent"
- **Goal:** Wizard opens at client selection step
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Wizard dialog visible with client options. Screenshot: SCEN-009/S007-wizard-open.png

#### S008: Select Claude Code and enter name
- **Action:** Click "Claude Code" → type `scen-mgr-jsonl` in Persona Name field → click Next
- **Goal:** Client selected, name entered, wizard advances
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Wizard shows team selection step. Screenshot: SCEN-009/S008-client-name.png

#### S009: Select no team and AUTONOMOUS title
- **Action:** Click "No team (Autonomous)" → click "AUTONOMOUS"
- **Goal:** Wizard advances through team and title steps
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Wizard shows folder selection step. Screenshot: SCEN-009/S009-team-title.png

#### S010: Select auto-folder and complete wizard
- **Action:** Click "Auto-create agent folder" → click "No plugin (bare agent)" (or accept auto-skip) → click "Create Agent!" → click "Let's Go!"
- **Goal:** Agent created with folder ~/agents/scen-mgr-jsonl/
- **Creates:** Agent `scen-mgr-jsonl` in registry, tmux session, folder ~/agents/scen-mgr-jsonl/
- **Modifies:** Agent registry
- **Verify:** Agent appears in sidebar. Profile shows AUTONOMOUS, program=claude. Screenshot: SCEN-009/S010-agent-created.png

#### S011: Assign MANAGER title
- **Action:** Click AUTONOMOUS badge in profile → select MANAGER → click Confirm → enter password `mYkri1-xoxrap-gogtan` → click Confirm
- **Goal:** Title changes to MANAGER, plugin auto-installed
- **Creates:** Plugin entry in agent settings
- **Modifies:** Governance state (hasManager: true), agent title
- **Verify:** Profile shows MANAGER badge and `ai-maestro-assistant-manager-agent` plugin. Screenshot: SCEN-009/S011-manager-assigned.png

#### S012: Verify MANAGER via API
- **Action:** Check `GET /api/governance`
- **Goal:** `hasManager: true`, `managerId` matches scen-mgr-jsonl
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API confirms MANAGER exists. Screenshot: SCEN-009/S012-governance-api.png

#### S013: Launch Claude Code session for MANAGER
- **Action:** If terminal shows only a shell prompt (no Claude running), click "New Session" in the profile panel. Wait for the Claude Code idle prompt to appear.
- **Goal:** MANAGER has a running Claude Code session
- **Creates:** Claude Code process in tmux session
- **Modifies:** nothing
- **Verify:** Terminal shows Claude Code prompt (not just `$` or `%`). Screenshot: SCEN-009/S013-session-running.png

---

## Phase 2: Send Project Task to MANAGER

#### S014: Type task instruction in terminal
- **Action:** In the Prompt Builder textarea, type the following and click Send:
  ```
  Create a team called "jsonl-viewer-swift" to build a JSONL viewer desktop app for macOS in Swift/SwiftUI. The app needs to: (1) open .jsonl files and display each JSON line in a table, (2) filter/search across all lines, (3) pretty-print individual JSON objects when clicked, (4) handle large files 100MB+ with lazy loading. Create the team using the /team-governance skill, then create a full 5-agent team with ALL required titles: one ARCHITECT for Swift/SwiftUI design, one ORCHESTRATOR to coordinate the build pipeline, one INTEGRATOR for CI/CD and packaging, and two MEMBERs for implementation (one for the UI layer, one for the data/parsing layer). The team must have a minimum of 5 agents (COS is auto-created, plus the 4 you create plus a second MEMBER). If any operation requires the governance password, ask the user to enter it in the AI Maestro UI popup — do NOT use the password directly.
  ```
- **Goal:** MANAGER receives the task and will create a full 5-agent team (R12 minimum composition)
- **Creates:** nothing (yet)
- **Modifies:** nothing (yet)
- **Verify:** Terminal shows the MANAGER processing the message. Screenshot: SCEN-009/S014-task-sent.png

#### S015: Wait for MANAGER to acknowledge and start planning
- **Action:** Watch terminal output. Wait for text indicating the MANAGER is planning (e.g., mentions "team", "governance", "create", or invokes a skill).
- **Goal:** MANAGER has acknowledged the task and started acting
- **Creates:** nothing (yet)
- **Modifies:** nothing (yet)
- **Verify:** Terminal contains planning output or skill invocation. Screenshot: SCEN-009/S015-manager-planning.png

---

## Phase 3: Verify Team Was Created

#### S016: Check Teams tab for new team
- **Action:** Click "Teams" tab in sidebar. Look for a team named "jsonl-viewer-swift" (or similar name chosen by MANAGER).
- **Goal:** Team appears in sidebar
- **Creates:** nothing (verifying)
- **Modifies:** nothing
- **Verify:** Team visible in Teams tab. If not visible after 3 minutes, refresh sidebar and check again. Record team name. Screenshot: SCEN-009/S016-team-in-sidebar.png

#### S017: Verify team exists via API
- **Action:** Check `GET /api/teams` for the new team
- **Goal:** Team exists with `blocked: false`
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Team found in API response. Record team ID. Screenshot: SCEN-009/S017-team-api.png

#### S018: Verify auto-COS was assigned
- **Action:** Check team details — `chiefOfStaffId` should reference a COS agent
- **Goal:** COS agent exists with `governanceTitle: chief-of-staff`
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** COS agent found in registry. COS ID in team's `agentIds`. Record COS name. Screenshot: SCEN-009/S018-cos-verified.png

#### S019: Screenshot team in sidebar
- **Action:** `take_screenshot` showing Teams tab with the new team
- **Goal:** Visual record of team creation
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved to `tests/scenarios/screenshots/SCEN-009/S019-team-created.png`

---

## Phase 4: Verify MANAGER Created Full 5-Agent Team (R12 Minimum Composition)

#### S020: Check sidebar for new agents created by MANAGER
- **Action:** Click "Agents" tab. Look for new agents created by the MANAGER (names chosen by MANAGER, likely related to "architect", "swift", "orchestrator", "integrator", "ui", "data").
- **Goal:** At least 4 new agents visible in sidebar (ARCHITECT + ORCHESTRATOR + INTEGRATOR + 2 MEMBERs; COS was auto-created)
- **Creates:** nothing (verifying)
- **Modifies:** nothing
- **Verify:** Multiple new agents visible. If not visible after 5 minutes, take terminal screenshot and check if MANAGER is still working. Record all agent names. Screenshot: SCEN-009/S020-agents-in-sidebar.png

#### S021: Verify an ARCHITECT agent exists in the team
- **Action:** Check `GET /api/teams/<teamId>` agentIds, then for each agent check `GET /api/agents/<id>`. Find one with `governanceTitle: 'architect'`.
- **Goal:** Team has an ARCHITECT agent (R12 minimum composition)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Agent with ARCHITECT title found in team. Record name. Screenshot: SCEN-009/S021-architect-found.png

#### S022: Verify an ORCHESTRATOR agent exists in the team
- **Action:** Check team agent list for an agent with `governanceTitle: 'orchestrator'`.
- **Goal:** Team has an ORCHESTRATOR agent (R12 minimum composition)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Agent with ORCHESTRATOR title found in team. Record name. Screenshot: SCEN-009/S022-orchestrator-found.png

#### S023: Verify an INTEGRATOR agent exists in the team
- **Action:** Check team agent list for an agent with `governanceTitle: 'integrator'`.
- **Goal:** Team has an INTEGRATOR agent (R12 minimum composition)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Agent with INTEGRATOR title found in team. Record name. Screenshot: SCEN-009/S023-integrator-found.png

#### S024: Verify at least one MEMBER agent exists in the team
- **Action:** Check team agent list for agents with `governanceTitle: 'member'`.
- **Goal:** Team has at least one MEMBER agent (R12 minimum composition)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** At least one agent with MEMBER title found in team. Record name(s). Screenshot: SCEN-009/S024-member-found.png

#### S025: Verify all agents are in the team's agentIds
- **Action:** Check `GET /api/teams/<teamId>` — `agentIds` should include COS + all created agents. Count must be >= 5.
- **Goal:** Full R12 composition: COS + ARCHITECT + ORCHESTRATOR + INTEGRATOR + at least 1 MEMBER
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `agentIds` count >= 5. All discovered agent IDs present. Screenshot: SCEN-009/S025-team-agent-ids.png

#### S025b: Verify all agents have working directories under ~/agents/
- **Action:** For each team agent, check profile — working directory should be under ~/agents/
- **Goal:** Agent folders are safe (not in source dir, not in forbidden paths, G03-OVERLAP)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** All working directories start with ~/agents/ or /Users/<user>/agents/. Screenshot: SCEN-009/S025b-working-dirs.png

#### S026: Screenshot of full team composition
- **Action:** Navigate to team dashboard (click team name or go to /teams/<id>). `take_screenshot`.
- **Goal:** Visual record of MANAGER's team decisions — must show all 5 required titles
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved showing team name, COS, ARCHITECT, ORCHESTRATOR, INTEGRATOR, MEMBER(s), agent count >= 5. Screenshot: SCEN-009/S026-team-composition.png

---

## Phase 5: Governance Compliance Checks

#### S027: MANAGER is not in the team
- **Action:** Check team's `agentIds` via API — scen-mgr-jsonl's ID should NOT be present
- **Goal:** MANAGER is host-level, not team-level (R9.1)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** MANAGER agent ID not in team's `agentIds`. Screenshot: SCEN-009/S027-manager-not-in-team.png

#### S028: No team agent has AUTONOMOUS or MANAGER title
- **Action:** For each agent in the team's `agentIds`, check `governanceTitle` via API
- **Goal:** All team agents have team titles (R10)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Every agent has one of: member, chief-of-staff, orchestrator, architect, integrator. Screenshot: SCEN-009/S028-all-team-titles.png

#### S029: No duplicate or nested working directories
- **Action:** Collect `workingDirectory` for all agents created during this test. Check no two are the same or parent/child of each other.
- **Goal:** G03-OVERLAP enforced
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** All working directories are unique and non-nested. Screenshot: SCEN-009/S029-no-overlap.png

#### S030: No orphan duplicate agents (BUG-018 regression)
- **Action:** Check `GET /api/agents` for agents with `metadata.autoRegistered: true` that have UUID-based names matching any test agent's ID
- **Goal:** No orphan duplicates created by auto-discovery
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** No UUID-named orphans matching test agent IDs. Screenshot: SCEN-009/S030-no-orphans.png

---

## Phase 6: Verify Kanban Tasks (if created)

#### S031: Open team kanban board
- **Action:** Navigate to team dashboard → click "Kanban" tab
- **Goal:** Kanban board visible
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Kanban board rendered (may be empty or have tasks). Screenshot: SCEN-009/S031-kanban-board.png

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
- **Verify:** Profile shows AUTONOMOUS. `GET /api/governance` returns `hasManager: false`. `GET /api/teams/<id>` returns `blocked: true`. Screenshot: SCEN-009/S033-manager-removed.png

#### S034: Re-assign MANAGER title
- **Action:** Click AUTONOMOUS badge → select MANAGER → click Confirm → enter password `mYkri1-xoxrap-gogtan` → click Confirm
- **Goal:** MANAGER restored, team unblocked (R9.6)
- **Creates:** nothing
- **Modifies:** Governance state (hasManager: true), team unblocked
- **Verify:** Profile shows MANAGER. `GET /api/governance` returns `hasManager: true`. `GET /api/teams/<id>` returns `blocked: false`. Screenshot: SCEN-009/S034-manager-restored.png

---

## Phase CLEANUP: Restore Original State

#### S035: Delete the team with all agents
- **Action:** Navigate to /teams. Click Delete on the test team. First dialog: click Delete. Second dialog: enter governance password `mYkri1-xoxrap-gogtan`, click "Delete Agents Too".
- **Goal:** Team and all team agents deleted
- **Removes:** Team, COS agent, all team member agents and their folders
- **Verify:** Team not in `GET /api/teams`. No team agent IDs in `GET /api/agents`. Screenshot: SCEN-009/S035-team-deleted.png

#### S036: Remove MANAGER title from scen-mgr-jsonl
- **Action:** Click on `scen-mgr-jsonl` → click MANAGER badge → select AUTONOMOUS → click Confirm → enter password `mYkri1-xoxrap-gogtan` → click Confirm
- **Goal:** No MANAGER on host
- **Removes:** MANAGER title
- **Verify:** `GET /api/governance` returns `hasManager: false`. Screenshot: SCEN-009/S036-no-manager.png

#### S037: Delete scen-mgr-jsonl agent with folder
- **Action:** Profile → expand Danger Zone → click "Delete Agent" → check "Also delete agent folder" → type `scen-mgr-jsonl` → click "Delete Forever"
- **Goal:** Agent and folder fully removed
- **Removes:** Agent `scen-mgr-jsonl`, tmux session, folder ~/agents/scen-mgr-jsonl/
- **Verify:** Agent not in sidebar. `GET /api/agents/<id>` returns 404. Folder ~/agents/scen-mgr-jsonl/ does not exist. Screenshot: SCEN-009/S037-agent-deleted.png

#### S038: Delete any remaining test agents and tmux sessions
- **Action:** Check agent list for any agents created during this test (names containing "jsonl", "swift", "scen-mgr"). Delete each via Danger Zone with "Also delete agent folder" checked. Kill matching tmux sessions.
- **Goal:** No test artifacts remain
- **Removes:** Stray agents, tmux sessions, folders
- **Verify:** Agent count matches S006 baseline. No matching tmux sessions in `tmux ls`. Screenshot: SCEN-009/S038-cleanup-complete.png

#### S039: STATE-WIPE — Restore configuration files
- **Action:** Compare current config files with backups from S002. Restore any that differ.
- **Goal:** All config files match pre-test state
- **Removes:** nothing
- **Verify:** File hash comparison — all 6 files match. Screenshot: SCEN-009/S039-state-restored.png

#### S040: Post-test screenshot
- **Action:** `take_screenshot` of full page
- **Goal:** UI identical to S004 baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved to `tests/scenarios/screenshots/SCEN-009/S040-post-cleanup.png`. Visual comparison with S004 baseline.
