---
number: 11
name: R15 Written Orders Workflow
version: "1.0"
description: >
  Tests R15 (Written Orders & GitHub Trail). Creates a MANAGER and a full team,
  then sends a task to the MANAGER. Verifies that the MANAGER produces written
  .md files from templates, and that inter-agent commands use GitHub issue URLs
  instead of inline AMP content. This validates the paper trail requirement.
subsystems:
  - governance
  - teams
  - agent-registry
  - agent-messaging (AMP)
  - element-management-service
ui_sections:
  - Sidebar -> Agents tab -> Agent list
  - Sidebar -> Teams tab -> Team list
  - Agent Profile -> Overview tab -> Governance Title
  - Terminal view (MANAGER agent input/output)
data_produced:
  - 1 MANAGER agent (temporary)
  - 1 test team with 5+ agents (temporary)
  - AMP messages (temporary)
  - Written .md order files in agent work dirs (temporary)
  - GitHub issues with attachments (temporary — close after test)
  - Agent folders under ~/agents/ (temporary)
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
  - GitHub CLI (gh) authenticated for issue creation
  - Role-plugins have message templates in shared/ or references/
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
author: AI Maestro Team
---

# R15 Written Orders Workflow Scenario

> **Purpose:** Validates R15 — all inter-agent commands and reports must be
> written .md files using role-plugin templates. Attachments must be published
> as GitHub issues, not sent inline via AMP. The MANAGER is exempt from R15.

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state
- **Creates:** nothing
- **Modifies:** git history
- **Verify:** Clean working tree. Screenshot: SCEN-011/S001-git-clean.png

#### S002: STATE-WIPE Checkpoint
- **Action:** Backup config files
- **Goal:** Pre-test state saved
- **Creates:** Backup directory
- **Modifies:** nothing
- **Verify:** 6 files backed up. Screenshot: SCEN-011/S002-backup.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`
- **Goal:** Server running
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API returns 200. Screenshot: SCEN-011/S003-server-ok.png

#### S004: Baseline screenshot
- **Action:** Navigate to dashboard, screenshot
- **Goal:** Baseline captured
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot: SCEN-011/S004-baseline.png

---

## Phase 1: Create MANAGER and Full Team

#### S005: Create MANAGER agent and assign title
- **Action:** Wizard: Claude Code → `scen-r15-mgr` → No team → AUTONOMOUS → Auto-folder → Create → Assign MANAGER → password `mYkri1-xoxrap-gogtan`
- **Goal:** MANAGER active with plugin
- **Creates:** Agent, tmux session, folder
- **Modifies:** Governance state
- **Verify:** MANAGER badge, plugin installed. Screenshot: SCEN-011/S005-manager.png

#### S006: Create team with batch API
- **Action:** Create team `r15-test-team`, then batch-create 4 agents (architect, orchestrator, integrator, member)
- **Goal:** Full R12-compliant team (COS + 4 = 5 agents)
- **Creates:** Team + 5 agents
- **Modifies:** Team registry
- **Verify:** `GET /api/teams/{id}/composition-check` returns `complete: true`. Screenshot: SCEN-011/S006-team-complete.png

---

## Phase 2: Send Task and Verify Written Orders

#### S007: Launch MANAGER Claude Code session
- **Action:** Click "New Session" in profile
- **Goal:** Claude Code running with MANAGER persona
- **Creates:** Claude process
- **Modifies:** nothing
- **Verify:** Idle prompt visible. Screenshot: SCEN-011/S007-claude-running.png

#### S008: Send task to MANAGER
- **Action:** In Prompt Builder: "Send a design task to the team: Design the data model for a TODO app with tags, priorities, and due dates. The ARCHITECT should produce a design document and share it with the team via a GitHub issue. Use the /team-governance skill. Governance password: mYkri1-xoxrap-gogtan"
- **Goal:** MANAGER processes task
- **Creates:** AMP messages
- **Modifies:** nothing
- **Verify:** Terminal shows MANAGER working. Screenshot: SCEN-011/S008-task-sent.png

#### S009: Wait for MANAGER to delegate
- **Action:** Wait for MANAGER to send AMP message to COS
- **Goal:** Message delivered
- **Creates:** AMP message files
- **Modifies:** nothing
- **Verify:** Check AMP inbox of COS. Screenshot: SCEN-011/S009-delegation.png

#### S010: Verify MANAGER used written format
- **Action:** Analyze MANAGER's conversation log for .md file creation or GitHub issue creation
- **Goal:** MANAGER is EXEMPT from R15 — may send direct AMP. But should still be noted.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Log analysis via LLM Externalizer. Screenshot: SCEN-011/S010-mgr-log.png

#### S011: Check for template-based .md files
- **Action:** Search agent work directories for .md files created during this test
- **Goal:** If any non-MANAGER agent produced work, it should be in .md format
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `find ~/agents/scen-r15-*/` for new .md files. Screenshot: SCEN-011/S011-md-files.png

---

## Phase CLEANUP: Restore Original State

#### S012: Delete team with all agents
- **Action:** Teams page → Delete → password `mYkri1-xoxrap-gogtan` → Delete Agents Too
- **Goal:** Team removed
- **Removes:** Team + all agents
- **Verify:** Team gone. Screenshot: SCEN-011/S012-team-deleted.png

#### S013: Remove MANAGER and delete agent
- **Action:** AUTONOMOUS → password → Delete agent with folder
- **Goal:** No test artifacts
- **Removes:** MANAGER agent + folder
- **Verify:** Baseline counts. Screenshot: SCEN-011/S013-cleanup.png

#### S014: STATE-WIPE restore
- **Action:** Restore config files
- **Goal:** Files match backup
- **Removes:** nothing
- **Verify:** Hash match. Screenshot: SCEN-011/S014-state-restored.png

#### S015: Post-test screenshot
- **Action:** Screenshot
- **Goal:** UI matches baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot: SCEN-011/S015-post-cleanup.png
