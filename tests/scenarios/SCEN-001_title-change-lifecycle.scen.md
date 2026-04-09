---
number: 1
name: Title Change Lifecycle
version: "2.0"
description: >
  The user logs in, creates a test agent, then assigns it the ORCHESTRATOR
  title via the Title Assignment Dialog — confirming the role-plugin installs
  automatically. They swap the title to ARCHITECT and verify the old plugin
  is replaced. They check that MANAGER is grayed out (singleton), attempt
  self-modification via API (blocked), revert the agent to AUTONOMOUS,
  delete it through the Danger Zone, and confirm the cemetery entry.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance (ChangeTitle pipeline, LoginGate, RBAC)
  - role-plugins (auto-install, auto-uninstall, singleton enforcement)
  - agent-registry (governanceTitle field, cemetery)
  - element-management-service
  - auth (session auth, agent auth, no-self-modification)
ui_sections:
  - Login page (governance password login)
  - Sidebar -> Agents tab -> Agent list
  - Agent Profile -> Overview tab -> Governance Title
  - Agent Profile -> Config tab -> Role Plugin
  - Title Assignment Dialog (radio cards, password prompt)
  - Governance Password Dialog
  - Settings -> Cemetery tab
data_produced:
  - 1 test agent (temporary, created and deleted)
  - Plugin settings.local.json modifications (temporary, cleaned up)
  - Agent registry entry (temporary, deleted)
  - Cemetery archive entry (temporary, purged)
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
  - At least 1 existing team with available slots
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
author: AI Maestro Team
---

# Title Change Lifecycle Scenario

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state with known commit hash
- **Creates:** nothing
- **Modifies:** git history (new commit if needed)
- **Verify:** `git status` shows clean working tree. Screenshot: SCEN-001/S001-git-clean.png

#### S002: STATE-WIPE Checkpoint -- Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/title-change-lifecycle_<timestamp>/`
- **Goal:** Copies of settings.json, registry.json, teams.json, governance.json saved
- **Creates:** Backup directory with config copies
- **Modifies:** nothing
- **Verify:** Backup files exist and match originals (hash comparison). Screenshot: SCEN-001/S002-backup-created.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `/api/sessions`
- **Goal:** Server running, returns 200
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API returns session list. Screenshot: SCEN-001/S003-server-healthy.png

#### S004: Navigate to dashboard
- **Action:** `navigate_page` to `http://localhost:23000`
- **Goal:** Login page loads (LoginGate requires authentication before dashboard access)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot shows login form with password field. Screenshot: SCEN-001/S004-login-page.png

---

## Phase 1: LoginGate Authentication

#### S005: Verify unauthenticated access is blocked
- **Action:** Check `GET /api/auth/session` (no cookies set yet)
- **Goal:** API returns 401 or `{ authenticated: false }` -- unauthenticated users cannot access the dashboard
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Session API confirms not authenticated. Screenshot: SCEN-001/S005-no-session.png

#### S006: Enter governance password and log in
- **Action:** Fill password field with `mYkri1-xoxrap-gogtan`, click "Login" button
- **Goal:** Login succeeds, dashboard loads with sidebar and agent list
- **Creates:** Session cookie set in browser
- **Modifies:** nothing
- **Verify:** Dashboard visible with agent list. `GET /api/auth/session` now returns `{ authenticated: true }`. Screenshot: SCEN-001/S006-dashboard-loaded.png

#### S007: Take pre-test screenshot (baseline)
- **Action:** `take_screenshot` of full page
- **Goal:** Baseline image for CLEAN-AFTER-YOURSELF verification
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved. Screenshot: SCEN-001/S007-baseline.png

---

## Phase 2: Create Test Agent (0-IMPACT)

#### S008: Click "Create new agent" button
- **Action:** Click the "+" button in sidebar header
- **Goal:** Agent creation wizard opens
- **Creates:** nothing (wizard only)
- **Modifies:** nothing
- **Verify:** Wizard dialog visible with client selection step. Screenshot: SCEN-001/S008-wizard-open.png

#### S009: Select Claude Code as client
- **Action:** Click "Claude Code" option in client selector
- **Goal:** Claude Code selected
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Option highlighted/selected. Screenshot: SCEN-001/S009-client-selected.png

#### S010: Click Next
- **Action:** Click Next button
- **Goal:** Advances to avatar/name step
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Avatar picker and name input visible. Screenshot: SCEN-001/S010-name-step.png

#### S011: Enter test agent name
- **Action:** Type `scen-test-title-agent` in the name field
- **Goal:** Name entered, unique on this host
- **Creates:** nothing (not created yet)
- **Modifies:** nothing
- **Verify:** Name field shows `scen-test-title-agent`. Screenshot: SCEN-001/S011-name-entered.png

#### S012: Click Next through remaining wizard steps
- **Action:** Click Next through team selection (skip/no team), title (leave as default), finish
- **Goal:** Agent created as AUTONOMOUS with no team
- **Creates:** Agent `scen-test-title-agent` in registry
- **Modifies:** Agent registry (new entry)
- **Verify:** New agent appears in sidebar agent list. Screenshot: SCEN-001/S012-agent-created.png

#### S013: Click on the new test agent in sidebar
- **Action:** Click `scen-test-title-agent` in agent list
- **Goal:** Profile panel shows the new agent's details
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Profile panel heading shows `scen-test-title-agent`, title is AUTONOMOUS. Screenshot: SCEN-001/S013-profile-autonomous.png

---

## Phase 3: RBAC Probe -- No Self-Modification

> **Context:** The recent security changes enforce that no agent can PATCH its own
> properties via API. This phase verifies that constraint through the UI by
> attempting an API call with the agent's own auth headers.

#### S014: Verify no-self-modification via API
- **Action:** Check `GET /api/agents/<agentId>` to get the agent's ID. Then attempt `PATCH /api/agents/<agentId>` with auth header `X-Agent-Id: <agentId>` and body `{"label": "hacked"}`. This simulates an agent trying to modify itself.
- **Goal:** API returns 403 with error indicating self-modification is forbidden
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response status is 403. Error message mentions self-modification or "cannot modify own". Screenshot: SCEN-001/S014-no-self-mod.png

---

## Phase 4: Assign ORCHESTRATOR Title

#### S015: Click "ASSIGN TITLE" button in profile panel
- **Action:** Click the title button/badge showing current title
- **Goal:** Title Assignment Dialog opens with radio cards
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog shows AUTONOMOUS and MANAGER options (agent is not in a team -> standalone titles only). MANAGER grayed out if already assigned, with message showing who holds it. Screenshot: SCEN-001/S015-title-dialog-standalone.png

#### S016: Verify only standalone titles are shown and MANAGER singleton enforced
- **Action:** Inspect dialog options
- **Goal:** Only AUTONOMOUS and MANAGER should be visible (agent has no team -> team titles hidden). If MANAGER is already assigned, it should be disabled with explanation text.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** No ORCHESTRATOR/ARCHITECT/INTEGRATOR/MEMBER/COS options shown. MANAGER disabled if already taken. Screenshot: SCEN-001/S016-singleton-enforced.png

#### S017: Cancel dialog and add agent to existing team first
- **Action:** Cancel title dialog, click "Reassign" button next to Team field, select an existing team
- **Goal:** Agent joins a team, title auto-transitions to MEMBER with programmer plugin
- **Creates:** nothing (joining existing team)
- **Modifies:** Team membership (agent added), agent title (-> MEMBER), plugin (-> ai-maestro-programmer-agent)
- **Verify:** Team name shown in profile, title badge shows MEMBER, plugin banner shows ai-maestro-programmer-agent. Screenshot: SCEN-001/S017-joined-team-member.png

#### S018: Click title badge (now showing MEMBER)
- **Action:** Click the MEMBER title button
- **Goal:** Title dialog opens with team-specific titles
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog shows MEMBER, CHIEF-OF-STAFF, ORCHESTRATOR, ARCHITECT, INTEGRATOR. Screenshot: SCEN-001/S018-team-title-dialog.png

#### S019: Select ORCHESTRATOR
- **Action:** Click ORCHESTRATOR radio card
- **Goal:** ORCHESTRATOR selected, Confirm button enabled
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Blue border on ORCHESTRATOR card, Confirm not disabled. Screenshot: SCEN-001/S019-orchestrator-selected.png

#### S020: Click Confirm
- **Action:** Click Confirm button
- **Goal:** Password dialog appears
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** "Enter Governance Password" dialog with input field. Screenshot: SCEN-001/S020-password-dialog.png

#### S021: Enter governance password and submit
- **Action:** Type governance password `mYkri1-xoxrap-gogtan`, click Confirm
- **Goal:** Title changes to ORCHESTRATOR, role-plugin installed
- **Creates:** Plugin entry in agent's settings.local.json
- **Modifies:** Agent governanceTitle in registry, plugin state
- **Verify:** Profile shows ORCHESTRATOR badge, plugin banner shows `ai-maestro-orchestrator-agent`. Screenshot: SCEN-001/S021-orchestrator-assigned.png

---

## Phase 5: Swap to ARCHITECT

#### S022: Click ORCHESTRATOR title badge
- **Action:** Click the title button showing ORCHESTRATOR
- **Goal:** Title dialog opens
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog shows with ORCHESTRATOR pre-selected. Screenshot: SCEN-001/S022-title-dialog-orchestrator.png

#### S023: Select ARCHITECT and confirm with password
- **Action:** Select ARCHITECT, click Confirm, enter password `mYkri1-xoxrap-gogtan`, submit
- **Goal:** Title swaps to ARCHITECT, plugin swaps to architect
- **Creates:** nothing (plugin swap)
- **Modifies:** Agent title (-> ARCHITECT), plugin (orchestrator -> architect)
- **Verify:** Profile shows ARCHITECT badge, plugin banner shows `ai-maestro-architect-agent`. Screenshot: SCEN-001/S023-architect-assigned.png

#### S024: Verify only ONE role-plugin installed
- **Action:** Click Config tab in profile panel
- **Goal:** Only `ai-maestro-architect-agent` in plugin list, no orchestrator plugin
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Config tab shows exactly 1 role-plugin: architect. Screenshot: SCEN-001/S024-config-one-plugin.png

---

## Phase 6: Revert to MEMBER

#### S025: Click ARCHITECT title badge -> select MEMBER -> password
- **Action:** Open title dialog, select MEMBER, confirm with password `mYkri1-xoxrap-gogtan`
- **Goal:** Title reverts to MEMBER, programmer plugin auto-installed
- **Creates:** nothing
- **Modifies:** Agent title (-> MEMBER), plugin (-> ai-maestro-programmer-agent)
- **Verify:** Profile shows MEMBER badge, plugin banner shows "ai-maestro-programmer-agent". Screenshot: SCEN-001/S025-member-programmer.png

#### S026: Verify Config tab shows programmer role-plugin
- **Action:** Click Config tab
- **Goal:** Programmer role-plugin installed for MEMBER title
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Config tab shows `ai-maestro-programmer-agent` as active role-plugin. Screenshot: SCEN-001/S026-config-programmer.png

---

## Phase 7: Singleton Constraint Check

#### S027: Assign ORCHESTRATOR to test agent again
- **Action:** Open title dialog, select ORCHESTRATOR, password `mYkri1-xoxrap-gogtan`
- **Goal:** Test agent is now ORCHESTRATOR
- **Creates:** Plugin entry
- **Modifies:** Agent title, plugin
- **Verify:** ORCHESTRATOR badge visible. Screenshot: SCEN-001/S027-orchestrator-again.png

#### S028: Switch to a DIFFERENT agent in the same team
- **Action:** Click on another agent that is in the same team
- **Goal:** Profile panel shows the other agent
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Different agent's profile loaded. Screenshot: SCEN-001/S028-other-agent.png

#### S029: Open title dialog for the other agent
- **Action:** Click their title badge
- **Goal:** Title dialog opens
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog visible. Screenshot: SCEN-001/S029-title-dialog-other.png

#### S030: Verify ORCHESTRATOR option is DISABLED
- **Action:** Inspect ORCHESTRATOR radio card
- **Goal:** ORCHESTRATOR is grayed out / not selectable, with explanation text
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** ORCHESTRATOR card shows disabled state with message like "Only one Orchestrator allowed". Screenshot: SCEN-001/S030-orchestrator-disabled.png

#### S031: Close the dialog
- **Action:** Click Cancel
- **Goal:** Dialog dismissed
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog gone. Screenshot: SCEN-001/S031-dialog-closed.png

---

## Phase 8: RBAC Probe -- Wrong-Role Title Change Denial

> **Context:** Only MANAGER or COS can change titles. A MEMBER agent trying to
> change another agent's title via the API should be denied.

#### S032: Attempt title change via API with MEMBER auth headers
- **Action:** Get a MEMBER agent's ID from the same team. Send `PATCH /api/agents/<testAgentId>` with header `X-Agent-Id: <memberAgentId>` and body `{"governanceTitle": "architect"}`.
- **Goal:** API returns 403 -- MEMBER agents cannot change titles (only MANAGER/COS/user can)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response status 403. Error indicates insufficient permissions. Test agent's title remains ORCHESTRATOR. Screenshot: SCEN-001/S032-rbac-denied.png

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

#### S033: Switch back to test agent
- **Action:** Click `scen-test-title-agent` in sidebar
- **Goal:** Test agent's profile shown
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Profile panel shows test agent. Screenshot: SCEN-001/S033-test-agent-profile.png

#### S034: Revert title to AUTONOMOUS
- **Action:** Open title dialog, leave team first (click "Leave team"), then verify title auto-reverts
- **Goal:** Agent removed from team, title becomes AUTONOMOUS, all plugins removed
- **Creates:** nothing
- **Modifies:** Team membership (removed), agent title (-> AUTONOMOUS), plugins (cleared)
- **Verify:** Title shows AUTONOMOUS, no team, no role-plugin. Screenshot: SCEN-001/S034-reverted-autonomous.png

#### S035: Delete test agent via UI
- **Action:** Click delete button in profile panel -> Danger Zone -> "Delete Agent" -> check "Also delete agent folder" -> type `scen-test-title-agent` -> click "Delete Forever"
- **Goal:** Test agent fully removed from registry, archived to cemetery
- **Creates:** Cemetery archive entry (zip file)
- **Modifies:** Agent registry (entry removed)
- **Verify:** Agent no longer appears in sidebar, API returns 404 for agent ID. Screenshot: SCEN-001/S035-agent-deleted.png

#### S036: Verify agent appears in Cemetery
- **Action:** Navigate to Settings page -> click "Cemetery" tab
- **Goal:** Deleted agent `scen-test-title-agent` appears in the cemetery list as an archived zip
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Cemetery list shows `scen-test-title-agent` with archive date and download/revive/purge options. Screenshot: SCEN-001/S036-cemetery-entry.png

#### S037: Purge agent from Cemetery
- **Action:** Click "Purge" button next to the `scen-test-title-agent` cemetery entry, confirm
- **Goal:** Cemetery entry fully removed (no test artifacts remain)
- **Removes:** Cemetery zip archive for `scen-test-title-agent`
- **Verify:** Agent no longer in cemetery list. Screenshot: SCEN-001/S037-cemetery-purged.png

#### S038: STATE-WIPE -- Restore configuration files
- **Action:** Compare current config files with backups from S002. If any differ, restore from backup.
- **Goal:** All config files match pre-test state
- **Creates:** nothing
- **Modifies:** Config files (restored to backup state)
- **Verify:** File hash comparison -- all match. Screenshot: SCEN-001/S038-state-restored.png

#### S039: Take post-test screenshot and compare with S007
- **Action:** `take_screenshot` of full page
- **Goal:** UI looks identical to pre-test baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual comparison with S007 screenshot -- sidebar, agent list, profile panel unchanged. Screenshot: SCEN-001/S039-post-cleanup.png
