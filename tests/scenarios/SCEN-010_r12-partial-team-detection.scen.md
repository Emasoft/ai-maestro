---
number: 10
name: R12 Partial Team Detection
version: "1.0"
description: >
  Tests R12 (Minimum Team Composition) enforcement. Creates a team with only
  3 agents (COS + ARCHITECT + MEMBER), deliberately missing ORCHESTRATOR and
  INTEGRATOR. Verifies the system detects the non-functional team and that
  the composition-check API reports missing titles. Also tests R14 (Team
  Resilience) by deleting one of the 5 required agents and verifying detection.
subsystems:
  - governance
  - teams
  - agent-registry
  - element-management-service
ui_sections:
  - Sidebar -> Agents tab -> Agent list
  - Sidebar -> Teams tab -> Team list
  - Agent Profile -> Overview tab -> Governance Title
  - Title Assignment Dialog (radio cards, password prompt)
data_produced:
  - 1 MANAGER agent (temporary, created and deleted)
  - 1 test team (temporary, created and deleted)
  - 5 test agents (temporary, created and deleted)
  - Agent folders under ~/agents/ (temporary, deleted)
  - Plugin settings modifications (temporary, restored via STATE-WIPE)
required_tools:
  - mcp__plugin_chromedev-tools_cdt__navigate_page
  - mcp__plugin_chromedev-tools_cdt__take_snapshot
  - mcp__plugin_chromedev-tools_cdt__take_screenshot
  - mcp__plugin_chromedev-tools_cdt__click
  - mcp__plugin_chromedev-tools_cdt__fill
  - mcp__plugin_chromedev-tools_cdt__wait_for
prerequisites:
  - AI Maestro server running at http://localhost:23000
  - Governance password set
  - Chrome browser open with DevTools accessible via CDP
  - ai-maestro-plugins marketplace registered
  - No MANAGER currently assigned
  - R12 composition-check API implemented (GET /api/teams/{id}/composition-check)
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
author: AI Maestro Team
---

# R12 Partial Team Detection Scenario

> **Purpose:** Validates that the system detects teams missing required titles
> (R12) and that deleted core agents are detected (R14). Unlike SCEN-009 which
> tests MANAGER-driven creation, this scenario creates a deliberately incomplete
> team to verify detection mechanisms.

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state with known commit hash
- **Creates:** nothing
- **Modifies:** git history (new commit if needed)
- **Verify:** `git status` shows clean working tree. Screenshot: SCEN-010/S001-git-clean.png

#### S002: STATE-WIPE Checkpoint — Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/r12-partial-team_<timestamp>/`
- **Goal:** Copies of all governance-relevant config files saved
- **Creates:** Backup directory with config copies
- **Modifies:** nothing
- **Verify:** Backup files exist and match originals (hash comparison). Screenshot: SCEN-010/S002-backup.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `GET /api/sessions`
- **Goal:** Server running, returns 200
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API returns session list. Screenshot: SCEN-010/S003-server-ok.png

#### S004: Navigate to dashboard and take baseline screenshot
- **Action:** `navigate_page` to `http://localhost:23000`, `take_screenshot`
- **Goal:** Dashboard loads, baseline captured
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved to `tests/scenarios/screenshots/SCEN-010/S004-baseline.png`

#### S005: Record baseline counts
- **Action:** Check `GET /api/agents` and `GET /api/teams` and `GET /api/governance`
- **Goal:** Baseline recorded: agent count, team count, hasManager=false
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Counts recorded. Screenshot: SCEN-010/S005-baseline-counts.png

---

## Phase 1: Create MANAGER and Test Team

#### S006: Create MANAGER agent via wizard
- **Action:** Click "+" → "Create Agent" → Claude Code → name `scen-r12-mgr` → No team → AUTONOMOUS → Auto-folder → Create Agent! → Let's Go!
- **Goal:** MANAGER agent created
- **Creates:** Agent `scen-r12-mgr` in registry, tmux session, folder ~/agents/scen-r12-mgr/
- **Modifies:** Agent registry
- **Verify:** Agent appears in sidebar. Screenshot: SCEN-010/S006-mgr-created.png

#### S007: Assign MANAGER title
- **Action:** Click AUTONOMOUS badge → select MANAGER → Confirm → enter password `mYkri1-xoxrap-gogtan` → Confirm
- **Goal:** Title changes to MANAGER
- **Creates:** Plugin entry in agent settings
- **Modifies:** Governance state (hasManager: true)
- **Verify:** Profile shows MANAGER badge. `GET /api/governance` returns `hasManager: true`. Screenshot: SCEN-010/S007-manager-assigned.png

#### S008: Create test team via API
- **Action:** `POST /api/teams` with `{"name": "scen-r12-incomplete", "type": "closed"}`
- **Goal:** Team created with auto-COS
- **Creates:** Team + auto-COS agent
- **Modifies:** Teams registry
- **Verify:** `GET /api/teams` shows team. Record team ID and COS ID. Screenshot: SCEN-010/S008-team-created.png

#### S009: Create ARCHITECT agent in team
- **Action:** `POST /api/agents` with `{"name": "scen-r12-architect", "client": "claude", "teamId": "TEAM_ID", "governanceTitle": "architect"}`
- **Goal:** Agent created with ARCHITECT title in one call (BUG-022 fix)
- **Creates:** Agent `scen-r12-architect`
- **Modifies:** Team agentIds, agent registry
- **Verify:** `GET /api/agents/{id}` returns `governanceTitle: "architect"`. Screenshot: SCEN-010/S009-architect.png

#### S010: Create MEMBER agent in team
- **Action:** `POST /api/agents` with `{"name": "scen-r12-member", "client": "claude", "teamId": "TEAM_ID", "governanceTitle": "member"}`
- **Goal:** Agent created with MEMBER title
- **Creates:** Agent `scen-r12-member`
- **Modifies:** Team agentIds, agent registry
- **Verify:** `GET /api/agents/{id}` returns `governanceTitle: "member"`. Screenshot: SCEN-010/S010-member.png

---

## Phase 2: Verify R12 Non-Functional Team Detection

> **At this point the team has 3 agents: COS + ARCHITECT + MEMBER.**
> **Missing: ORCHESTRATOR and INTEGRATOR. Team is NON-FUNCTIONAL per R12.**

#### S011: Check composition via API
- **Action:** `GET /api/teams/{id}/composition-check`
- **Goal:** API reports missing titles: orchestrator, integrator
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response includes `{ complete: false, missing: ["orchestrator", "integrator"] }`. Screenshot: SCEN-010/S011-missing-titles.png

#### S012: Verify team shows in UI with warning
- **Action:** Navigate to Teams tab in sidebar. Look for warning badge on the incomplete team.
- **Goal:** Team visible with non-functional indicator
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Team card shows incomplete status. Screenshot: SCEN-010/S012-team-warning.png

---

## Phase 3: Complete the Team (Add Missing Agents)

#### S013: Create ORCHESTRATOR agent
- **Action:** `POST /api/agents` with `{"name": "scen-r12-orch", "client": "claude", "teamId": "TEAM_ID", "governanceTitle": "orchestrator"}`
- **Goal:** ORCHESTRATOR added to team
- **Creates:** Agent `scen-r12-orch`
- **Modifies:** Team agentIds
- **Verify:** `GET /api/agents/{id}` returns `governanceTitle: "orchestrator"`. Screenshot: SCEN-010/S013-orchestrator.png

#### S014: Create INTEGRATOR agent
- **Action:** `POST /api/agents` with `{"name": "scen-r12-integ", "client": "claude", "teamId": "TEAM_ID", "governanceTitle": "integrator"}`
- **Goal:** INTEGRATOR added to team
- **Creates:** Agent `scen-r12-integ`
- **Modifies:** Team agentIds
- **Verify:** `GET /api/agents/{id}` returns `governanceTitle: "integrator"`. Screenshot: SCEN-010/S014-integrator.png

#### S015: Verify team is now R12-complete
- **Action:** `GET /api/teams/{id}/composition-check`
- **Goal:** API reports team is complete
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response includes `{ complete: true, missing: [] }`. Screenshot: SCEN-010/S015-complete.png

---

## Phase 4: Test R14 — Agent Deletion Recovery Detection

#### S016: Delete the ORCHESTRATOR agent
- **Action:** Profile → Advanced → Danger Zone → Delete Agent (scen-r12-orch) with "Also delete folder"
- **Goal:** ORCHESTRATOR removed from team
- **Removes:** Agent `scen-r12-orch`, folder, tmux session
- **Verify:** Agent gone from sidebar. Screenshot: SCEN-010/S016-orch-deleted.png

#### S017: Verify team is non-functional again
- **Action:** `GET /api/teams/{id}/composition-check`
- **Goal:** API detects missing ORCHESTRATOR
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response includes `{ complete: false, missing: ["orchestrator"] }`. Screenshot: SCEN-010/S017-missing-orch.png

---

## Phase CLEANUP: Restore Original State

#### S018: Delete test team with all agents
- **Action:** Navigate to /teams → Delete team → password `mYkri1-xoxrap-gogtan` → Delete Agents Too
- **Goal:** Team and all team agents deleted
- **Removes:** Team, COS, all test agents
- **Verify:** Team not in `GET /api/teams`. Screenshot: SCEN-010/S018-team-deleted.png

#### S019: Remove MANAGER title
- **Action:** Click MANAGER badge → AUTONOMOUS → Confirm → password `mYkri1-xoxrap-gogtan` → Confirm
- **Goal:** No MANAGER on host
- **Removes:** MANAGER title
- **Verify:** `GET /api/governance` returns `hasManager: false`. Screenshot: SCEN-010/S019-mgr-removed.png

#### S020: Delete MANAGER agent with folder
- **Action:** Profile → Advanced → Danger Zone → Delete Agent → check "Also delete folder" → type `scen-r12-mgr` → Delete Forever
- **Goal:** Agent and folder removed
- **Removes:** Agent `scen-r12-mgr`, folder
- **Verify:** Agent not in sidebar. Screenshot: SCEN-010/S020-mgr-deleted.png

#### S021: STATE-WIPE — Restore configuration files
- **Action:** Compare current config files with backups from S002. Restore any that differ.
- **Goal:** All config files match pre-test state
- **Removes:** nothing
- **Verify:** File hash comparison — all 6 files match. Screenshot: SCEN-010/S021-state-restored.png

#### S022: Post-test screenshot
- **Action:** `take_screenshot` of full page
- **Goal:** UI identical to S004 baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved to `tests/scenarios/screenshots/SCEN-010/S022-post-cleanup.png`
