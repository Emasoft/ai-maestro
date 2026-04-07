---
number: 6
name: Manager Gate Team Lifecycle (Codex Client)
version: "2.0"
description: >
  Variant of SCEN-005 that uses Codex as the AI client for team member agents.
  Tests the MANAGER-gated team lifecycle with LoginGate authentication, cross-client
  plugin conversion, RBAC probes (no-self-modification, wrong-role denial),
  COS immutability (R4.7), cemetery verification, and the DeleteTeam 8-gate
  pipeline with governance password. The MANAGER agent remains Claude Code
  (host-level), and the auto-COS agent is created by the server with
  program='claude' (default). Team member agents are created with Codex client
  and receive converted plugins. Validates governance rules R4, R9, R10, R11,
  R16 plus cross-client conversion for Codex targets.
subsystems:
  - governance
  - teams
  - role-plugins
  - agent-registry
  - element-management-service
  - cross-client-conversion-service
  - auth (LoginGate, RBAC, no-self-modification)
ui_sections:
  - Login page (governance password login)
  - Sidebar -> Agents tab -> Agent list
  - Sidebar -> Teams tab -> Team list
  - Agent Profile -> Overview tab -> Governance Title
  - Agent Profile -> Config tab -> Role Plugin
  - Title Assignment Dialog (radio cards, password prompt)
  - Governance Password Dialog
  - Team Creation Dialog
  - Agent Creation Wizard (Step 1 client selector -> Codex)
  - Settings -> Cemetery tab
data_produced:
  - 2 test agents (temporary, created and deleted)
  - 1 auto-COS agent (temporary, created by system with program=claude, deleted)
  - 1 test team (temporary, created and deleted)
  - Plugin settings.local.json modifications (temporary, cleaned up)
  - Agent registry entries (temporary, deleted)
  - Team registry entries (temporary, deleted)
  - Governance state changes (temporary, restored)
  - Cross-client converted plugin files (temporary, cleaned up)
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
  - Codex CLI installed and available on PATH (verify with `which codex`)
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
author: AI Maestro Team
---

# Manager Gate Team Lifecycle (Codex Client) Scenario

> **Relation to SCEN-005:** This scenario follows the same governance lifecycle
> as SCEN-005 but creates team member agents with **Codex** as the AI client.

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state with known commit hash
- **Creates:** nothing
- **Modifies:** git history (new commit if needed)
- **Verify:** `git status` shows clean working tree. Screenshot: SCEN-006/S001-commit.png

#### S002: STATE-WIPE Checkpoint -- Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/manager-gate-codex-client_<timestamp>/`
- **Goal:** Copies of all governance-relevant config files saved
- **Creates:** Backup directory with config copies
- **Modifies:** nothing
- **Verify:** Backup files exist and match originals. Screenshot: SCEN-006/S002-backup.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `GET /api/sessions`
- **Goal:** Server running, returns 200
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API returns session list. Screenshot: SCEN-006/S003-server-ok.png

#### S004: Navigate to dashboard
- **Action:** `navigate_page` to `http://localhost:23000`
- **Goal:** Login page loads (LoginGate)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Login form visible. Screenshot: SCEN-006/S004-login-page.png

---

## Phase 1: LoginGate and Preconditions

#### S005: Log in with governance password
- **Action:** Fill password with `mYkri1-xoxrap-gogtan`, click Login
- **Goal:** Dashboard loads
- **Creates:** Session cookie
- **Modifies:** nothing
- **Verify:** Dashboard visible. Screenshot: SCEN-006/S005-dashboard.png

#### S006: Take pre-test screenshot (baseline)
- **Action:** `take_screenshot` of full page
- **Goal:** Baseline captured
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved. Screenshot: SCEN-006/S006-baseline.png

#### S007: Ensure no MANAGER exists
- **Action:** Check `GET /api/governance` for `hasManager: false`. Remove if needed.
- **Goal:** No MANAGER on host
- **Creates:** nothing
- **Modifies:** Possibly removes existing MANAGER
- **Verify:** `hasManager: false`. Screenshot: SCEN-006/S007-no-manager.png

#### S008: Verify Codex CLI is available
- **Action:** Run `which codex` or `codex --version`
- **Goal:** Codex binary found on PATH
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Valid path or version. Screenshot: SCEN-006/S008-codex-cli.png

---

## Phase 2: Verify No-Manager Blocking

#### S009: Verify governance API shows no MANAGER
- **Action:** Verify `GET /api/governance` returns `hasManager: false`
- **Goal:** No-MANAGER state confirmed
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API response. Screenshot: SCEN-006/S009-no-mgr-api.png

#### S010: Attempt to create a team via UI
- **Action:** Click Teams tab, click "Create Team"
- **Goal:** Error -- teams require a MANAGER first
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Error message visible. Screenshot: SCEN-006/S010-team-blocked.png

---

## Phase 3: Assign MANAGER (Claude Code)

#### S011: Create and assign MANAGER `scen-codex-manager`
- **Action:** Create agent via wizard (Claude Code, `scen-codex-manager`, AUTONOMOUS), then assign MANAGER title with password `mYkri1-xoxrap-gogtan`
- **Goal:** MANAGER active with plugin
- **Creates:** Agent, plugin
- **Modifies:** Governance state, agent registry
- **Verify:** MANAGER badge, `ai-maestro-assistant-manager-agent` plugin. Screenshot: SCEN-006/S011-manager-assigned.png

#### S012: Verify MANAGER via API
- **Action:** `GET /api/governance`
- **Goal:** `hasManager: true`, `managerId` matches
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API confirms. Screenshot: SCEN-006/S012-governance-api.png

---

## Phase 4: Create Team with Auto-COS

#### S013: Create team `scen-codex-governance-team`
- **Action:** Teams tab, Create Team, name `scen-codex-governance-team`, submit
- **Goal:** Team created with auto-COS
- **Creates:** Team + auto-COS agent
- **Modifies:** Registries
- **Verify:** Team in sidebar. Screenshot: SCEN-006/S013-team-created.png

#### S014: Verify auto-COS uses Claude (not Codex)
- **Action:** Check COS agent's `program` field via API
- **Goal:** Auto-COS created with `program: 'claude'` (server default)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `program: 'claude'`. Screenshot: SCEN-006/S014-cos-claude.png

#### S015: Verify COS has correct plugin and is in agentIds
- **Action:** Check COS plugin and team agentIds
- **Goal:** `ai-maestro-chief-of-staff` installed, COS in agentIds (R4.6)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin present, COS in agentIds. Screenshot: SCEN-006/S015-cos-verified.png

---

## Phase 5: COS Immutability Probe (R4.7)

#### S016: Attempt to remove COS from team agentIds via API
- **Action:** `PUT /api/teams/<teamId>` with agentIds excluding COS ID
- **Goal:** API returns 400 -- COS cannot be removed (R4.7)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 400. COS still in team. Screenshot: SCEN-006/S016-cos-immutability.png

---

## Phase 6: Add Codex Agent -- Cross-Client Plugin Conversion

#### S017: Create Codex agent `scen-codex-team-member`
- **Action:** Wizard: Codex client, name `scen-codex-team-member`, select team, MEMBER title, finish
- **Goal:** Agent created as MEMBER with Codex-converted plugin
- **Creates:** Agent with `program: 'codex'`
- **Modifies:** Agent registry, team agentIds
- **Verify:** Agent in sidebar with MEMBER title. Screenshot: SCEN-006/S017-codex-member.png

#### S018: Verify agent program is Codex
- **Action:** Check profile or API for `program` field
- **Goal:** `program: 'codex'`
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Codex confirmed. Screenshot: SCEN-006/S018-program-codex.png

#### S019: Verify cross-client plugin conversion
- **Action:** Check Config tab for installed role-plugin
- **Goal:** `ai-maestro-programmer-agent` installed (possibly with Codex conversion)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin present. Screenshot: SCEN-006/S019-codex-plugin.png

---

## Phase 7: RBAC Probes

#### S020: Attempt agent self-modification via API
- **Action:** `PATCH /api/agents/<codexMemberId>` with `X-Agent-Id: <codexMemberId>` and body `{"label": "self-hack"}`
- **Goal:** 403 -- no agent can modify itself
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 403. Screenshot: SCEN-006/S020-no-self-mod.png

#### S021: Attempt title change by MEMBER agent
- **Action:** `PATCH /api/agents/<codexMemberId>` with `X-Agent-Id: <managerId>` is the CORRECT caller. Instead test: `PATCH /api/agents/<managerId>` with `X-Agent-Id: <codexMemberId>` and body `{"governanceTitle": "autonomous"}`
- **Goal:** 403 -- MEMBER cannot change MANAGER's title
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 403. Screenshot: SCEN-006/S021-rbac-title-denied.png

---

## Phase 8: Remove Codex Agent -- AUTONOMOUS

#### S022: Click "Leave team" on Codex agent
- **Action:** Profile -> Leave team
- **Goal:** Agent removed, title -> AUTONOMOUS, plugin removed
- **Creates:** nothing
- **Modifies:** Team agentIds, agent title, plugin
- **Verify:** AUTONOMOUS, no plugin. Screenshot: SCEN-006/S022-codex-autonomous.png

---

## Phase 9: Title Requires Team (Gate 9) -- Client-Agnostic

#### S023: Open Title Assignment Dialog for teamless Codex agent
- **Action:** Click title badge on `scen-codex-team-member`
- **Goal:** Only AUTONOMOUS and MANAGER shown (no team -> no team titles)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** 2 options only. Screenshot: SCEN-006/S023-standalone-titles.png

#### S024: Close dialog
- **Action:** Click Cancel
- **Goal:** Dialog dismissed
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog gone. Screenshot: SCEN-006/S024-dialog-closed.png

---

## Phase 10: Delete Team via DeleteTeam Pipeline

#### S025: Delete team with governance password
- **Action:** Teams tab -> delete `scen-codex-governance-team` -> Delete -> password `mYkri1-xoxrap-gogtan` -> "Keep Agents"
- **Goal:** Team deleted via 8-gate pipeline, agents revert
- **Creates:** nothing
- **Modifies:** Team removed, titles -> AUTONOMOUS, plugins removed
- **Verify:** Team gone. Screenshot: SCEN-006/S025-team-deleted.png

#### S026: Verify all former agents are AUTONOMOUS
- **Action:** Check all former team agents via API
- **Goal:** None retain team titles
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** All AUTONOMOUS. Screenshot: SCEN-006/S026-all-autonomous.png

---

## Phase CLEANUP: Restore Original State

#### S027: Remove MANAGER title from `scen-codex-manager`
- **Action:** Title dialog -> AUTONOMOUS -> password `mYkri1-xoxrap-gogtan`
- **Goal:** No MANAGER
- **Removes:** MANAGER title
- **Verify:** `hasManager: false`. Screenshot: SCEN-006/S027-no-manager.png

#### S028: Delete `scen-codex-manager`
- **Action:** Danger Zone -> Delete Agent -> confirm
- **Goal:** Agent removed
- **Removes:** Agent
- **Verify:** Agent gone. Screenshot: SCEN-006/S028-manager-deleted.png

#### S029: Delete `scen-codex-team-member`
- **Action:** Danger Zone -> Delete Agent -> confirm
- **Goal:** Agent removed
- **Removes:** Agent
- **Verify:** Agent gone. Screenshot: SCEN-006/S029-codex-deleted.png

#### S030: Delete any remaining auto-COS agents
- **Action:** Check for cos-* agents from this test, delete each
- **Goal:** All auto-COS removed
- **Removes:** Auto-COS agents
- **Verify:** None remain. Screenshot: SCEN-006/S030-cos-deleted.png

#### S031: Verify cemetery entries and purge
- **Action:** Settings -> Cemetery tab. Verify test agents appear. Purge all.
- **Goal:** Cemetery verified, test entries purged
- **Removes:** Cemetery archives
- **Verify:** No test entries. Screenshot: SCEN-006/S031-cemetery-purged.png

#### S032: STATE-WIPE -- Restore configuration files
- **Action:** Compare and restore config files from S002 backup
- **Goal:** All files match pre-test state
- **Creates:** nothing
- **Modifies:** Config files restored
- **Verify:** All match. Screenshot: SCEN-006/S032-state-restored.png

#### S033: Post-test screenshot
- **Action:** `take_screenshot` of full page
- **Goal:** UI identical to baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual comparison with S006. Screenshot: SCEN-006/S033-post-cleanup.png
