---
number: 7
name: Manager Gate Team Lifecycle (Mixed Clients)
version: "2.0"
description: >
  The user logs in, creates a Claude agent as MANAGER, and creates a team. They
  add both a Claude agent and a Codex agent as MEMBERs. They swap titles --
  ORCHESTRATOR for the Claude agent, ARCHITECT for the Codex agent -- and verify
  each receives the correct client-specific plugin format (native for Claude,
  converted for Codex). They open the kanban board and create a task. Finally,
  they delete the team with the governance password and clean up all test agents.
client: [claude, codex]
interhosts: false
device: desktop
subsystems:
  - governance
  - teams
  - role-plugins
  - agent-registry
  - element-management-service
  - cross-client-conversion
  - auth (LoginGate, RBAC, no-self-modification)
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
  - Agent Creation Wizard (client selection step)
  - Team Dashboard -> Kanban board
  - Settings -> Cemetery tab
data_produced:
  - 3 test agents (temporary, created and deleted)
  - 1 auto-COS agent (temporary, created by system, deleted)
  - 1 test team (temporary, created and deleted)
  - 1 kanban task (temporary, deleted with team)
  - Plugin settings.local.json modifications (temporary, cleaned up)
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
  - Codex CLI installed and available
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
author: AI Maestro Team
---

# Manager Gate Team Lifecycle (Mixed Clients) Scenario

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state
- **Creates:** nothing
- **Modifies:** git history
- **Verify:** Clean working tree. Screenshot: SCEN-007/S001-commit.png

#### S002: STATE-WIPE Checkpoint -- Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/manager-gate-mixed-clients_<timestamp>/`
- **Goal:** All config files saved
- **Creates:** Backup directory
- **Modifies:** nothing
- **Verify:** Backups match originals. Screenshot: SCEN-007/S002-backup.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `GET /api/sessions`
- **Goal:** Server running
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API returns 200. Screenshot: SCEN-007/S003-server-ok.png

#### S004: Navigate to dashboard
- **Action:** `navigate_page` to `http://localhost:23000`
- **Goal:** Login page loads
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Login form visible. Screenshot: SCEN-007/S004-login-page.png

---

## Phase 1: LoginGate and Preconditions

#### S005: Log in with governance password
- **Action:** Fill password `mYkri1-xoxrap-gogtan`, click Login
- **Goal:** Dashboard loads
- **Creates:** Session cookie
- **Modifies:** nothing
- **Verify:** Dashboard visible. Screenshot: SCEN-007/S005-dashboard.png

#### S006: Take pre-test screenshot (baseline)
- **Action:** `take_screenshot`
- **Goal:** Baseline captured
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved. Screenshot: SCEN-007/S006-baseline.png

#### S007: Ensure no MANAGER and verify no-manager blocking
- **Action:** Check `GET /api/governance` for `hasManager: false`. If MANAGER exists, remove. Verify team creation is blocked.
- **Goal:** No MANAGER, teams blocked
- **Creates:** nothing
- **Modifies:** Possibly removes MANAGER
- **Verify:** `hasManager: false`, team creation shows error. Screenshot: SCEN-007/S007-no-manager.png

---

## Phase 2: Assign MANAGER (Claude Agent)

#### S008: Create and assign MANAGER `scen7-manager`
- **Action:** Wizard: Claude Code -> `scen7-manager` -> AUTONOMOUS -> finish. Then assign MANAGER with password `mYkri1-xoxrap-gogtan`.
- **Goal:** MANAGER active with Claude-native plugin
- **Creates:** Agent, plugin
- **Modifies:** Governance, registry
- **Verify:** MANAGER badge, `ai-maestro-assistant-manager-agent`. Screenshot: SCEN-007/S008-manager-assigned.png

#### S009: Verify MANAGER via API
- **Action:** `GET /api/governance`
- **Goal:** `hasManager: true`
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API confirms. Screenshot: SCEN-007/S009-governance-api.png

---

## Phase 3: Create Team with Auto-COS

#### S010: Create team `scen7-mixed-team`
- **Action:** Teams tab -> Create Team -> `scen7-mixed-team` -> submit
- **Goal:** Team created with Claude auto-COS
- **Creates:** Team + auto-COS
- **Modifies:** Registries
- **Verify:** Team in sidebar. Screenshot: SCEN-007/S010-team-created.png

#### S011: Verify auto-COS agent is Claude Code with plugin
- **Action:** Check COS agent client and plugin
- **Goal:** COS is Claude Code with `ai-maestro-chief-of-staff`
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Client=claude, plugin present. Screenshot: SCEN-007/S011-cos-verified.png

---

## Phase 4: COS Immutability Probe (R4.7)

#### S012: Attempt to remove COS from team agentIds via API
- **Action:** `PUT /api/teams/<teamId>` with agentIds excluding COS ID
- **Goal:** API returns 400 -- COS immutability enforced
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 400. Screenshot: SCEN-007/S012-cos-immutability.png

---

## Phase 5: Add Claude Agent -- MEMBER + Claude-Native Plugin

#### S013: Create Claude agent `scen7-claude-member` and add to team
- **Action:** Create agent (Claude Code, AUTONOMOUS), then add to `scen7-mixed-team`
- **Goal:** Claude agent is MEMBER with Claude-native programmer plugin
- **Creates:** Agent
- **Modifies:** Team agentIds, title, plugin
- **Verify:** MEMBER badge, `ai-maestro-programmer-agent`. Screenshot: SCEN-007/S013-claude-member.png

---

## Phase 6: Add Codex Agent -- MEMBER + Codex-Converted Plugin

#### S014: Create Codex agent `scen7-codex-member` and add to team
- **Action:** Wizard: Codex -> `scen7-codex-member` -> AUTONOMOUS. Then add to team.
- **Goal:** Codex agent is MEMBER with Codex-converted plugin
- **Creates:** Agent with `program: 'codex'`
- **Modifies:** Team agentIds, title, plugin
- **Verify:** MEMBER badge, plugin present (Codex format). Screenshot: SCEN-007/S014-codex-member.png

#### S015: Verify mixed-client team composition
- **Action:** Check team agentIds includes both Claude and Codex agents
- **Goal:** Team contains agents from different clients
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Both agents in team. Screenshot: SCEN-007/S015-mixed-team.png

---

## Phase 7: RBAC Probes

#### S016: Attempt agent self-modification for Claude member
- **Action:** `PATCH /api/agents/<claudeMemberId>` with `X-Agent-Id: <claudeMemberId>` and body `{"label": "self-hack"}`
- **Goal:** 403 -- no self-modification
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 403. Screenshot: SCEN-007/S016-no-self-mod.png

#### S017: Attempt agent lifecycle by MEMBER
- **Action:** `POST /api/agents/<codexMemberId>/hibernate` with `X-Agent-Id: <claudeMemberId>`
- **Goal:** 403 -- MEMBER cannot hibernate other agents
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 403. Screenshot: SCEN-007/S017-rbac-denied.png

---

## Phase 8: Title Swaps -- Per-Client Plugin Format

#### S018: Assign ORCHESTRATOR to Claude agent
- **Action:** Click Claude agent -> title badge -> ORCHESTRATOR -> password `mYkri1-xoxrap-gogtan`
- **Goal:** Claude-native orchestrator plugin installed
- **Creates:** nothing
- **Modifies:** Title, plugin (Claude format)
- **Verify:** ORCHESTRATOR badge, `ai-maestro-orchestrator-agent`. Screenshot: SCEN-007/S018-claude-orchestrator.png

#### S019: Assign ARCHITECT to Codex agent
- **Action:** Click Codex agent -> title badge -> ARCHITECT -> password `mYkri1-xoxrap-gogtan`
- **Goal:** Codex-converted architect plugin installed
- **Creates:** nothing
- **Modifies:** Title, plugin (Codex format)
- **Verify:** ARCHITECT badge, `ai-maestro-architect-agent`. Screenshot: SCEN-007/S019-codex-architect.png

#### S020: Verify both agents coexist with different titles and formats
- **Action:** Check API for team composition
- **Goal:** COS (Claude), ORCHESTRATOR (Claude), ARCHITECT (Codex) all in team
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** All three in team with correct titles. Screenshot: SCEN-007/S020-mixed-titles.png

---

## Phase 9: Kanban Task Usage

#### S021: Open team kanban and create task
- **Action:** Team dashboard -> Kanban tab -> quick-add "SCEN-007 mixed-client test" in Backlog
- **Goal:** Task created in Backlog
- **Creates:** Task in team tasks file
- **Modifies:** nothing
- **Verify:** Task visible in Backlog. Screenshot: SCEN-007/S021-kanban-task.png

#### S022: Drag task to Review
- **Action:** Drag task to Review column
- **Goal:** Task status changes
- **Creates:** nothing
- **Modifies:** Task status
- **Verify:** Task in Review. Screenshot: SCEN-007/S022-task-review.png

---

## Phase 10: Remove Codex Agent -- AUTONOMOUS, Plugin Stripped

#### S023: Remove Codex agent from team
- **Action:** Profile -> Leave team on `scen7-codex-member`
- **Goal:** Title -> AUTONOMOUS, Codex-converted plugin removed
- **Creates:** nothing
- **Modifies:** Team agentIds, title, plugin
- **Verify:** AUTONOMOUS, no plugin. Screenshot: SCEN-007/S023-codex-autonomous.png

---

## Phase 11: Delete Team (Keep Agents)

#### S024: Delete team with governance password
- **Action:** Teams -> delete `scen7-mixed-team` -> Delete -> password `mYkri1-xoxrap-gogtan` -> Keep Agents
- **Goal:** Team deleted via 8-gate pipeline, surviving agents revert
- **Creates:** nothing
- **Modifies:** Team removed, all titles -> AUTONOMOUS
- **Verify:** Team gone, agents AUTONOMOUS. Screenshot: SCEN-007/S024-team-deleted.png

#### S025: Verify all former agents are AUTONOMOUS
- **Action:** Check all former team agents
- **Goal:** All AUTONOMOUS, no plugins
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** All AUTONOMOUS. Screenshot: SCEN-007/S025-all-autonomous.png

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

#### S026: Remove MANAGER title from `scen7-manager`
- **Action:** Title -> AUTONOMOUS -> password `mYkri1-xoxrap-gogtan`
- **Removes:** MANAGER title
- **Verify:** `hasManager: false`. Screenshot: SCEN-007/S026-no-manager.png

#### S027: Delete `scen7-manager`
- **Action:** Danger Zone -> Delete
- **Removes:** Agent
- **Verify:** Gone. Screenshot: SCEN-007/S027-mgr-deleted.png

#### S028: Delete `scen7-claude-member`
- **Action:** Danger Zone -> Delete
- **Removes:** Agent
- **Verify:** Gone. Screenshot: SCEN-007/S028-claude-deleted.png

#### S029: Delete `scen7-codex-member`
- **Action:** Danger Zone -> Delete
- **Removes:** Agent
- **Verify:** Gone. Screenshot: SCEN-007/S029-codex-deleted.png

#### S030: Delete any remaining auto-COS agents
- **Action:** Delete cos-* agents from this test
- **Removes:** Auto-COS agents
- **Verify:** None remain. Screenshot: SCEN-007/S030-cos-deleted.png

#### S031: Verify cemetery entries and purge
- **Action:** Settings -> Cemetery. Verify test entries. Purge all.
- **Removes:** Cemetery archives
- **Verify:** No test entries. Screenshot: SCEN-007/S031-cemetery-purged.png

#### S032: STATE-WIPE -- Restore configuration files
- **Action:** Restore from S002 backup
- **Goal:** All files match
- **Verify:** Hash match. Screenshot: SCEN-007/S032-state-restored.png

#### S033: Post-test screenshot
- **Action:** `take_screenshot`
- **Goal:** UI identical to baseline
- **Verify:** Visual comparison with S006. Screenshot: SCEN-007/S033-post-cleanup.png
