---
number: 8
name: Manager Gate Team Lifecycle (No-Plugin Client)
version: "2.0"
description: >
  Tests the MANAGER-gated team lifecycle when agents use clients that have NO
  plugin support (Gemini CLI). Adds LoginGate authentication, RBAC probes
  (no-self-modification, wrong-role denial), COS immutability probe (R4.7),
  DeleteTeam 8-gate pipeline with governance password, and cemetery verification.
  Validates that governance titles work correctly for no-plugin clients: title
  changes succeed but plugin installation is gracefully skipped. Mixed-client
  team with MANAGER and auto-COS as Claude Code (with plugins) while Gemini CLI
  agent joins, receives titles, and leaves without plugin operations.
  Validates governance rules R4, R9, R10, R11, R16, ChangeTitle Gates 3/15/16.
subsystems:
  - governance
  - teams
  - role-plugins
  - agent-registry
  - element-management-service
  - client-capabilities
  - auth (LoginGate, RBAC, no-self-modification)
ui_sections:
  - Login page (governance password login)
  - Sidebar -> Agents tab -> Agent list
  - Sidebar -> Teams tab -> Team list
  - Agent Profile -> Overview tab -> Governance Title
  - Agent Profile -> Config tab -> Role Plugin
  - Title Assignment Dialog (radio cards, password prompt)
  - Agent Creation Wizard (client picker, plugin picker)
  - Settings -> Cemetery tab
data_produced:
  - 2 test agents (temporary, created and deleted)
  - 1 auto-COS agent (temporary, created by system, deleted)
  - 1 test team (temporary, created and deleted)
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

# Manager Gate Team Lifecycle (No-Plugin Client) Scenario

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state
- **Creates:** nothing
- **Modifies:** git history
- **Verify:** Clean working tree. Screenshot: SCEN-008/S001-commit.png

#### S002: STATE-WIPE Checkpoint -- Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/manager-gate-no-plugin-client_<timestamp>/`
- **Goal:** All config files saved
- **Creates:** Backup directory
- **Modifies:** nothing
- **Verify:** Backups match originals. Screenshot: SCEN-008/S002-backup.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `GET /api/sessions`
- **Goal:** Server running
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API returns 200. Screenshot: SCEN-008/S003-server-ok.png

#### S004: Navigate to dashboard
- **Action:** `navigate_page` to `http://localhost:23000`
- **Goal:** Login page loads
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Login form visible. Screenshot: SCEN-008/S004-login-page.png

---

## Phase 1: LoginGate and Preconditions

#### S005: Log in with governance password
- **Action:** Fill password `mYkri1-xoxrap-gogtan`, click Login
- **Goal:** Dashboard loads
- **Creates:** Session cookie
- **Modifies:** nothing
- **Verify:** Dashboard visible. Screenshot: SCEN-008/S005-dashboard.png

#### S006: Take pre-test screenshot (baseline)
- **Action:** `take_screenshot`
- **Goal:** Baseline captured
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved. Screenshot: SCEN-008/S006-baseline.png

#### S007: Ensure no MANAGER exists
- **Action:** Check `GET /api/governance`, remove MANAGER if needed
- **Goal:** No MANAGER on host
- **Creates:** nothing
- **Modifies:** Possibly removes MANAGER
- **Verify:** `hasManager: false`. Screenshot: SCEN-008/S007-no-manager.png

---

## Phase 2: Assign MANAGER (Claude Code)

#### S008: Create and assign MANAGER `scen8-manager`
- **Action:** Wizard: Claude Code, `scen8-manager`, AUTONOMOUS, finish. Assign MANAGER with password `mYkri1-xoxrap-gogtan`.
- **Goal:** MANAGER active
- **Creates:** Agent, plugin
- **Modifies:** Governance, registry
- **Verify:** MANAGER badge, plugin. Screenshot: SCEN-008/S008-manager-assigned.png

---

## Phase 3: Create Team with Auto-COS

#### S009: Create team `scen8-noplugin-team`
- **Action:** Teams tab, Create Team, name `scen8-noplugin-team`, submit
- **Goal:** Team created with Claude auto-COS (with plugin)
- **Creates:** Team + auto-COS
- **Modifies:** Registries
- **Verify:** Team in sidebar. Record COS name. Screenshot: SCEN-008/S009-team-created.png

---

## Phase 4: COS Immutability Probe (R4.7)

#### S010: Attempt to remove COS from team agentIds via API
- **Action:** `PUT /api/teams/<teamId>` with agentIds excluding COS ID
- **Goal:** 400 -- COS immutability
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 400. Screenshot: SCEN-008/S010-cos-immutability.png

---

## Phase 5: Add Gemini Agent -- MEMBER Title, NO Plugin

#### S011: Create Gemini CLI agent via wizard
- **Action:** Wizard: Gemini CLI -> `scen8-gemini-member` -> select `scen8-noplugin-team` -> MEMBER -> observe Step 5 shows "No plugin" only -> finish
- **Goal:** Agent created as MEMBER with NO plugin (Gemini has no plugin support)
- **Creates:** Agent with client=gemini
- **Modifies:** Registry, team agentIds
- **Verify:** Agent in sidebar with MEMBER title. Screenshot: SCEN-008/S011-gemini-member.png

#### S012: Verify NO plugin installed (Gemini no-plugin client)
- **Action:** Check Config tab or API
- **Goal:** No role-plugin -- Gemini CLI cannot install plugins
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** No plugin. Screenshot: SCEN-008/S012-no-plugin.png

---

## Phase 6: RBAC Probes

#### S013: Attempt agent self-modification for Gemini agent
- **Action:** `PATCH /api/agents/<geminiId>` with `X-Agent-Id: <geminiId>` and body `{"label": "self-hack"}`
- **Goal:** 403 -- no self-modification
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 403. Screenshot: SCEN-008/S013-no-self-mod.png

#### S014: Attempt lifecycle operation as MEMBER
- **Action:** `POST /api/agents/<managerId>/hibernate` with `X-Agent-Id: <geminiId>`
- **Goal:** 403 -- MEMBER cannot hibernate others
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 403. Screenshot: SCEN-008/S014-rbac-denied.png

---

## Phase 7: Change Gemini Title to ORCHESTRATOR -- NO Plugin

#### S015: Open Title Dialog and assign ORCHESTRATOR
- **Action:** Click MEMBER badge -> ORCHESTRATOR -> password `mYkri1-xoxrap-gogtan`
- **Goal:** Title changes, plugin skipped (Gemini no-plugin)
- **Creates:** nothing
- **Modifies:** Agent title
- **Verify:** ORCHESTRATOR badge. No error. Still no plugin. Screenshot: SCEN-008/S015-gemini-orchestrator.png

---

## Phase 8: Verify Plugin Status Contrast

#### S016: Check COS has plugin (Claude contrast)
- **Action:** Click COS agent, check Config tab
- **Goal:** COS has `ai-maestro-chief-of-staff` plugin (Claude can)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin present. Screenshot: SCEN-008/S016-cos-has-plugin.png

#### S017: Verify Gemini agent still no plugin
- **Action:** Click `scen8-gemini-member`, check Config/Role tab
- **Goal:** No plugin. Clear "No plugin support" messaging.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** No plugin. Screenshot: SCEN-008/S017-gemini-no-plugin.png

---

## Phase 9: Remove Gemini Agent -- AUTONOMOUS

#### S018: Leave team
- **Action:** Profile -> Leave team on Gemini agent
- **Goal:** AUTONOMOUS, no plugin uninstall needed
- **Creates:** nothing
- **Modifies:** Team agentIds, title
- **Verify:** AUTONOMOUS. No errors. Screenshot: SCEN-008/S018-gemini-autonomous.png

---

## Phase 10: Delete Team via DeleteTeam Pipeline

#### S019: Delete team with "Delete Agents Too"
- **Action:** Teams -> delete `scen8-noplugin-team` -> Delete -> password `mYkri1-xoxrap-gogtan` -> Delete Agents Too
- **Goal:** Team and COS deleted. Gemini agent survives (already left).
- **Creates:** nothing
- **Modifies:** Team removed, COS deleted
- **Verify:** Team gone. Screenshot: SCEN-008/S019-team-deleted.png

#### S020: Verify Gemini agent survives
- **Action:** Check `GET /api/agents` for `scen8-gemini-member`
- **Goal:** Agent exists as AUTONOMOUS
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Agent present. Screenshot: SCEN-008/S020-gemini-survives.png

---

## Phase CLEANUP: Restore Original State

#### S021: Remove MANAGER title
- **Action:** Title -> AUTONOMOUS -> password `mYkri1-xoxrap-gogtan`
- **Removes:** MANAGER title
- **Verify:** `hasManager: false`. Screenshot: SCEN-008/S021-no-manager.png

#### S022: Delete `scen8-manager`
- **Action:** Danger Zone -> Delete
- **Removes:** Agent
- **Verify:** Gone. Screenshot: SCEN-008/S022-mgr-deleted.png

#### S023: Delete `scen8-gemini-member`
- **Action:** Danger Zone -> Delete
- **Removes:** Agent
- **Verify:** Gone. Screenshot: SCEN-008/S023-gemini-deleted.png

#### S024: Delete any remaining auto-COS agents
- **Action:** Delete cos-* agents from this test
- **Removes:** Auto-COS
- **Verify:** None remain. Screenshot: SCEN-008/S024-cos-deleted.png

#### S025: Verify cemetery entries and purge
- **Action:** Settings -> Cemetery. Verify and purge test entries.
- **Removes:** Cemetery archives
- **Verify:** No test entries. Screenshot: SCEN-008/S025-cemetery-purged.png

#### S026: STATE-WIPE -- Restore configuration files
- **Action:** Restore from S002 backup
- **Goal:** All files match
- **Verify:** Hash match. Screenshot: SCEN-008/S026-state-restored.png

#### S027: Post-test screenshot
- **Action:** `take_screenshot`
- **Goal:** UI identical to baseline
- **Verify:** Visual comparison with S006. Screenshot: SCEN-008/S027-post-cleanup.png
