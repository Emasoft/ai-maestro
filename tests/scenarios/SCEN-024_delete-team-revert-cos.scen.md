---
number: 24
name: DeleteTeam Revert COS Regression
version: "1.0"
description: >
  The user logs in and creates a fresh test team with a COS and a regular
  MEMBER. After the team is running, the user deletes the team and verifies
  that (a) the COS agent reverts to AUTONOMOUS, (b) the COS role-plugin is
  uninstalled from the former COS agent, and (c) the MEMBER agent is also
  reverted to AUTONOMOUS. This is a dedicated regression scenario for
  BUG-002 from SCEN-005, which had ChangeTitle silently failing on the
  team-delete revert path because authContext was not propagated.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance
  - teams
  - element-management-service
  - role-plugins
  - agent-registry
ui_sections:
  - Sidebar -> Agents tab -> Create new agent
  - Agent Creation Wizard (steps 1-7)
  - Sidebar -> Teams tab -> Create team
  - Agent Profile -> Overview tab -> Title Assignment Dialog
  - Sidebar -> Teams tab -> Delete Team dialog
  - Agent Profile -> Advanced tab -> Danger Zone -> Delete Agent
data_produced:
  - 3 test agents "scen024-mgr-01", "scen024-cos-01", "scen024-mbr-01" (temporary)
  - 1 test team "scen024-team" (temporary)
  - Plugin settings.local.json modifications (temporary, restored)
  - Agent registry entries (temporary, deleted)
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
  - No pre-existing agents matching "scen024-*"
  - No pre-existing team named "scen024-team"
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
author: AI Maestro Team
---

# DeleteTeam Revert COS Regression Scenario

> **Purpose:** BUG-002 in SCEN-005 was caused by `ChangeTitle` being called without
> `authContext` on the DeleteTeam revert path. Gate 0 soft-returned "authContext is
> mandatory" and the COS silently kept its title + role-plugin after the team was
> gone. PR #11 (\`p0-001-authcontext-v2\`) fixed the root cause by making authContext
> a required positional argument. This scenario locks the fix in place by exercising
> the exact failing flow: create a team with COS + MEMBER → delete the team → verify
> both revert to AUTONOMOUS and the COS role-plugin is uninstalled.
>
> **R18 standalone-title note:** Per WT-006/7#2, the MANAGER agent (created as the
> system owner) must NOT be stripped by DeleteTeam — it's a standalone title. This
> scenario verifies that the MANAGER survives the team deletion untouched.

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** `git status` + commit any uncommitted changes
- **Goal:** Clean git state
- **Creates:** nothing
- **Modifies:** git (new commit if needed)
- **Verify:** `git status` clean. Screenshot: SCEN-024/S001-git-clean.jpg

#### S002: STATE-WIPE Checkpoint — Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/scen024_<timestamp>/`: `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.aimaestro/governance.json`, `~/.aimaestro/agents/registry.json`, `~/.aimaestro/teams/teams.json`, `~/.aimaestro/teams/groups.json`
- **Goal:** Pre-test config captured
- **Creates:** Backup dir
- **Modifies:** nothing
- **Verify:** Backup files hash-match. Screenshot: SCEN-024/S002-backup.jpg

#### S003: Build + server restart
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, `GET /api/sessions`
- **Goal:** Server running latest build
- **Creates:** nothing
- **Modifies:** PM2 state
- **Verify:** 200 response. Screenshot: SCEN-024/S003-server.jpg

#### S004: Login
- **Action:** Navigate to `http://localhost:23000/`, enter `mYkri1-xoxrap-gogtan`, click Sign In
- **Goal:** Authenticated session
- **Creates:** Session cookie
- **Modifies:** nothing
- **Verify:** Dashboard loads. Screenshot: SCEN-024/S004-login.jpg

#### S005: Baseline screenshot
- **Action:** `take_screenshot` of full dashboard
- **Goal:** Baseline for post-test comparison
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot: SCEN-024/S005-baseline.jpg

---

## Phase 1: Create MANAGER + team with COS and MEMBER

#### S006: Create MANAGER agent `scen024-mgr-01`
- **Action:** Sidebar → + Create Agent → name `scen024-mgr-01`, client `claude`, leave title AUTONOMOUS, accept defaults, Create
- **Goal:** Agent created
- **Creates:** Agent `scen024-mgr-01`, folder, tmux session
- **Modifies:** Registry
- **Verify:** Agent in sidebar. Screenshot: SCEN-024/S006-mgr-created.jpg

#### S007: Assign MANAGER title to `scen024-mgr-01`
- **Action:** Open scen024-mgr-01 profile → click title badge → select MANAGER → enter sudo password `mYkri1-xoxrap-gogtan` → Confirm
- **Goal:** Agent becomes MANAGER
- **Creates:** nothing
- **Modifies:** Registry (governanceTitle=manager), settings.local.json (MANAGER role-plugin installed)
- **Verify:** `GET /api/agents/<id>` → `data.agent.governanceTitle === "manager"`. Screenshot: SCEN-024/S007-mgr-titled.jpg

#### S008: Create agent `scen024-cos-01`
- **Action:** Sidebar → + Create Agent → name `scen024-cos-01`, client `claude`, title AUTONOMOUS, Create
- **Goal:** Second test agent created
- **Creates:** Agent `scen024-cos-01`
- **Modifies:** Registry
- **Verify:** Agent in sidebar. Screenshot: SCEN-024/S008-cos-created.jpg

#### S009: Create agent `scen024-mbr-01`
- **Action:** Sidebar → + Create Agent → name `scen024-mbr-01`, client `claude`, title AUTONOMOUS, Create
- **Goal:** Third test agent created
- **Creates:** Agent `scen024-mbr-01`
- **Modifies:** Registry
- **Verify:** Agent in sidebar. Screenshot: SCEN-024/S009-mbr-created.jpg

#### S010: Create team `scen024-team` with both agents
- **Action:** Sidebar → Teams tab → + Create Team → name `scen024-team`, add scen024-cos-01 and scen024-mbr-01 as members, Create
- **Goal:** Team exists with both agents
- **Creates:** Team `scen024-team`, teams.json entry, both agents auto-titled MEMBER
- **Modifies:** Registry (both agents → member)
- **Verify:** Team in sidebar. `GET /api/teams/<id>` returns the new team with both agentIds. Screenshot: SCEN-024/S010-team-created.jpg

#### S011: Promote scen024-cos-01 to CHIEF-OF-STAFF
- **Action:** Open scen024-cos-01 profile → click title badge → CHIEF-OF-STAFF → select `scen024-team` in the team picker → enter sudo password `mYkri1-xoxrap-gogtan` → Confirm
- **Goal:** Agent becomes COS of scen024-team
- **Creates:** nothing
- **Modifies:** Registry (governanceTitle=chief-of-staff), teams.json (chiefOfStaffId set), settings.local.json (COS role-plugin installed)
- **Verify:** `GET /api/agents/<id>` → `governanceTitle === "chief-of-staff"`. Read `~/agents/scen024-cos-01/.claude/settings.local.json` — COS role-plugin key present and enabled. Screenshot: SCEN-024/S011-cos-promoted.jpg

#### S012: Confirm initial state
- **Action:** Read registry for all 3 agents + teams.json
- **Goal:** Baseline state before DeleteTeam
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** mgr=manager, cos=chief-of-staff, mbr=member, team.chiefOfStaffId=cos-id, team.agentIds=[cos, mbr]. Screenshot: SCEN-024/S012-baseline-state.jpg

---

## Phase 2: Delete the team and verify revert

#### S013: Open the Delete Team dialog
- **Action:** Sidebar → Teams tab → click `scen024-team` → Delete team button
- **Goal:** Delete Team dialog opens
- **Creates:** nothing
- **Modifies:** UI state
- **Verify:** Dialog visible with governance password field. Screenshot: SCEN-024/S013-delete-dialog.jpg

#### S014: Submit team deletion
- **Action:** Enter governance password `mYkri1-xoxrap-gogtan` in the dialog. Click "Delete Team". Wait for the success response.
- **Goal:** Team deleted, pipeline runs G03 revert on all former members
- **Creates:** nothing
- **Modifies:** teams.json (team removed), registry (cos+mbr titles reverted to autonomous), settings.local.json on former COS (COS role-plugin uninstalled)
- **Verify:** Team not in sidebar. `GET /api/teams/<id>` → 404. Screenshot: SCEN-024/S014-team-deleted.jpg

---

## Phase 3: Verify invariants after DeleteTeam

#### S015: Verify scen024-cos-01 reverted to AUTONOMOUS
- **Action:** `GET /api/agents/<cos-id>` (use the agent ID from S008 / S011)
- **Goal:** Former COS is now AUTONOMOUS
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `data.agent.governanceTitle === "autonomous"` OR `null`. Screenshot: SCEN-024/S015-cos-reverted.jpg

#### S016: Verify COS role-plugin uninstalled from former COS
- **Action:** Read `~/agents/scen024-cos-01/.claude/settings.local.json`
- **Goal:** No `ai-maestro-chief-of-staff` key in enabledPlugins (or set to false)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** File content does NOT contain any `ai-maestro-chief-of-staff@...` key enabled. Screenshot: SCEN-024/S016-cos-plugin-gone.jpg

#### S017: Verify scen024-mbr-01 reverted to AUTONOMOUS
- **Action:** `GET /api/agents/<mbr-id>`
- **Goal:** Former MEMBER is AUTONOMOUS
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `data.agent.governanceTitle === "autonomous"` OR `null`. Screenshot: SCEN-024/S017-mbr-reverted.jpg

#### S018: Verify scen024-mgr-01 is STILL MANAGER (standalone title preserved)
- **Action:** `GET /api/agents/<mgr-id>`
- **Goal:** MANAGER is standalone — not touched by team deletion
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `data.agent.governanceTitle === "manager"`. Screenshot: SCEN-024/S018-mgr-preserved.jpg

#### S019: Verify team field cleared on former members (WT-009#2)
- **Action:** Check `data.agent.team` field in the responses from S015 and S017
- **Goal:** No zombie team field
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Both responses have `team === null` or the field absent. Screenshot: SCEN-024/S019-team-cleared.jpg

---

## Phase CLEANUP: Restore Original State

#### S020: Delete scen024-cos-01 via UI
- **Action:** Profile → Advanced → Danger Zone → Delete Agent. Enter sudo password `mYkri1-xoxrap-gogtan`. Check "Also delete agent folder". Type `scen024-cos-01`. Delete Forever.
- **Goal:** Agent removed
- **Removes:** Registry entry, ~/agents/scen024-cos-01/, tmux session
- **Verify:** Agent not in sidebar. Screenshot: SCEN-024/S020-cos-deleted.jpg

#### S021: Delete scen024-mbr-01 via UI
- **Action:** Same as S020 but for scen024-mbr-01. Enter sudo password when prompted.
- **Goal:** Agent removed
- **Removes:** Registry, folder, tmux session
- **Verify:** Not in sidebar. Screenshot: SCEN-024/S021-mbr-deleted.jpg

#### S022: Demote + delete scen024-mgr-01
- **Action:** Open profile → title badge → AUTONOMOUS → enter sudo password. Then Advanced → Danger Zone → Delete Agent, sudo password, "Also delete folder", type name, Delete Forever.
- **Goal:** MANAGER removed (two-step because MANAGER is a standalone title)
- **Removes:** Registry, folder, tmux session
- **Verify:** Not in sidebar. Screenshot: SCEN-024/S022-mgr-deleted.jpg

#### S023: Purge cemetery entries
- **Action:** Settings → Cemetery → Purge each of scen024-mgr-01, scen024-cos-01, scen024-mbr-01
- **Goal:** Cemetery clean
- **Removes:** Cemetery entries
- **Verify:** None listed. Screenshot: SCEN-024/S023-cemetery-purged.jpg

#### S024: STATE-WIPE — Restore configuration files
- **Action:** Compare current config with backups from S002. Restore settings.json / settings.local.json / governance.json if they differ. Do NOT restore registry.json / teams.json — UI delete already cleaned those.
- **Goal:** Config files match pre-test state
- **Removes:** nothing
- **Verify:** Hash comparison — all match. Screenshot: SCEN-024/S024-state-restored.jpg

#### S025: Post-test screenshot
- **Action:** `take_screenshot` of full dashboard
- **Goal:** UI identical to Phase 0 baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual comparison with S005. Screenshot: SCEN-024/S025-post-test.jpg
