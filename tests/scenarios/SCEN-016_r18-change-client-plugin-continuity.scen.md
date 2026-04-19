---
number: 16
name: R18 Plugin Continuity on Client Change
version: "1.0"
description: >
  The user logs in, creates a new Claude agent through the wizard, and confirms
  the agent has the core ai-maestro-plugin installed. They then change the
  agent's client from Claude to Codex via the Config tab. They verify via API
  and filesystem that (a) the plugin snapshot was taken BEFORE any uninstall,
  (b) a converted Codex version of ai-maestro-plugin was created in
  custom-plugins/codex/, (c) the Universal Plugin IR was stored in
  custom-plugins/.abstract/, (d) the old Claude plugin files were removed, and
  (e) the converted Codex plugin files are now installed in the agent directory.
  They also verify the agent's `program` field in the registry is now "codex"
  and that the agent was never left without its core plugin during the switch.
  Cleanup: delete the test agent, restore state.
client: [claude, codex]
interhosts: false
device: desktop
subsystems:
  - governance (R18 plugin continuity)
  - element-management-service (ChangeClient G04-G10 pipeline)
  - plugin-storage-service (convertAndStorePlugin, emitForClient, getUniversalIR)
  - client-plugin-adapters (claude-adapter, codex-adapter)
  - agent-local-config-service (scanAgentLocalConfig for snapshot)
ui_sections:
  - Login page (governance password login)
  - Sidebar -> Agents tab -> Create new agent
  - Agent Creation Wizard (steps 1-7)
  - Agent Profile -> Config tab -> Plugins section
  - Agent Profile -> Config tab -> client selector
  - Agent Profile -> Advanced tab -> Danger Zone
data_produced:
  - 1 test agent "scen016-r18-test" (temporary, created and deleted)
  - ~/agents/scen016-r18-test/ working directory (temporary, deleted)
  - ~/agents/custom-plugins/.abstract/ai-maestro-plugin/ (may be pre-existing; untouched on cleanup)
  - ~/agents/custom-plugins/codex/ai-maestro-plugin-codex/ (may be pre-existing; untouched on cleanup)
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
  - No pre-existing agent named "scen016-r18-test"
  - Codex CLI installed (`which codex` succeeds)
  - Claude CLI installed (`which claude` succeeds)
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

# R18 Plugin Continuity on Client Change Scenario

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes with message `pre-scenario: SCEN-016 R18 plugin continuity`
- **Goal:** Clean git state with known commit hash
- **Creates:** nothing
- **Modifies:** git history (new commit if needed)
- **Verify:** `git status` shows clean working tree. Screenshot: SCEN-016/S001-git-clean.png

#### S002: STATE-WIPE Checkpoint — Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/scen016_<timestamp>/`: `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.aimaestro/governance.json`, `~/.aimaestro/agents/registry.json`, `~/.aimaestro/teams/teams.json`, `~/.aimaestro/teams/groups.json`
- **Goal:** Copies of all config files saved for post-test restoration
- **Creates:** Backup directory with config copies
- **Modifies:** nothing
- **Verify:** Backup files exist and match originals (hash comparison). Screenshot: SCEN-016/S002-backup-created.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `GET /api/sessions` returns 200
- **Goal:** Server running with latest build
- **Creates:** nothing
- **Modifies:** PM2 process state
- **Verify:** `/api/sessions` returns 200. Screenshot: SCEN-016/S003-server-running.png

#### S004: Kill orphan test sessions
- **Action:** `tmux list-sessions 2>/dev/null | grep '^scen016-' | cut -d: -f1 | xargs -I{} tmux kill-session -t {}` (ignore errors if no sessions exist)
- **Goal:** No leftover sessions from previous runs
- **Creates:** nothing
- **Modifies:** tmux state (kills old scen016-* sessions only)
- **Verify:** `tmux list-sessions` shows no scen016-* sessions. Screenshot: SCEN-016/S004-no-orphans.png

#### S005: Baseline screenshot
- **Action:** `take_screenshot` of dashboard at http://localhost:23000
- **Goal:** Pre-test baseline for cleanup verification
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved as SCEN-016/S005-baseline.png

---

## Phase 1: Create a Claude Agent with Role Plugin

#### S006: Login with governance password
- **Action:** Navigate to http://localhost:23000, fill governance password `mYkri1-xoxrap-gogtan`, click Sign In
- **Goal:** Authenticated MAESTRO session
- **Creates:** Session cookie
- **Modifies:** browser cookies
- **Verify:** Dashboard loads with agent list. Screenshot: SCEN-016/S006-logged-in.png

#### S007: Open Create Agent wizard
- **Action:** Click "Create new agent" button in sidebar
- **Goal:** Wizard opens at step 1 (client picker)
- **Creates:** nothing
- **Modifies:** nothing (modal state only)
- **Verify:** Wizard visible, client picker showing (cards for Claude / Codex / Gemini / OpenCode / Kiro). Screenshot: SCEN-016/S007-wizard-open.png

#### S008: Wizard step 1 — client selection (Claude)
- **Action:** Click the "Claude" client card. The wizard auto-advances to step 2.
- **Goal:** Claude selected, wizard on step 2 (persona name + avatar)
- **Creates:** nothing (wizard state)
- **Modifies:** nothing
- **Verify:** Step 2 visible with "Persona Name" text input and avatar grid. Screenshot: SCEN-016/S008-claude-selected.png

#### S009: Wizard step 2 — persona name + avatar
- **Action:** Type `scen016-r18-test` into the Persona Name input. Click the first avatar in the grid (or leave the preview avatar), then click the Next button (chevron).
- **Goal:** Persona name accepted, avatar picked, wizard advances to step 3 (team)
- **Creates:** nothing (wizard state)
- **Modifies:** nothing
- **Verify:** Step 3 visible (team picker). Screenshot: SCEN-016/S009-name-avatar.png

#### S010: Fill wizard steps 3-6 with defaults
- **Action:** Step 3 (team): leave unselected for AUTONOMOUS, click Next. Step 4 (title): pick AUTONOMOUS, click Next. Step 5 (folder): accept default `~/agents/scen016-r18-test/`, click Next. Step 6 (role-plugin): pick "none", click Next.
- **Goal:** Reach step 7 (summary / confirm)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Summary page shown listing Claude / scen016-r18-test / AUTONOMOUS / no role-plugin. Screenshot: SCEN-016/S010-confirm-page.png

#### S011: Complete wizard — create agent
- **Action:** Click "Create Agent" button
- **Goal:** Agent is created and appears in sidebar
- **Creates:** 1 agent registry entry, 1 ~/agents/scen016-r18-test/ directory, 1 .claude/settings.local.json with ai-maestro-plugin enabled
- **Modifies:** registry.json
- **Verify:** Agent "scen016-r18-test" appears in sidebar. Screenshot: SCEN-016/S011-agent-created.png

#### S012: Verify core plugin installed (Claude version)
- **Action:** API GET `/api/agents/{scen016-r18-test-id}/local-config` and check that `plugins` array includes `ai-maestro-plugin` with `enabled: true`. Also check on disk: `ls ~/agents/scen016-r18-test/.claude/settings.local.json` and grep for `"ai-maestro-plugin@ai-maestro-plugins": true`.
- **Goal:** Claude version of core plugin is installed and enabled
- **Creates:** nothing (verification)
- **Modifies:** nothing
- **Verify:** Both API and disk confirm the Claude ai-maestro-plugin is enabled. Screenshot: SCEN-016/S012-claude-plugin-installed.png

---

## Phase 2: Change Client Claude → Codex (R18 Pipeline)

#### S013: Open agent Profile panel
- **Action:** Click agent card "scen016-r18-test" in sidebar
- **Goal:** Profile panel loads
- **Creates:** nothing
- **Modifies:** nothing (UI state)
- **Verify:** Profile panel shows "scen016-r18-test". Screenshot: SCEN-016/S013-profile-open.png

#### S014: Navigate to Config tab → Work Configuration
- **Action:** Click "Config" tab in profile panel, scroll to Work Configuration section
- **Goal:** Config tab open with Program field visible
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Program dropdown visible showing "claude". Screenshot: SCEN-016/S014-config-tab.png

#### S015: Record pre-change snapshot (for R18.2 verification)
- **Action:** Run API GET `/api/agents/{id}/local-config` and save JSON output to `tests/scenarios/reports/SCEN-016_pre_change_snapshot.json`. Count plugins, note role plugin.
- **Goal:** Pre-change plugin list recorded
- **Creates:** 1 JSON file in reports dir
- **Modifies:** nothing (just reading state)
- **Verify:** JSON file exists and lists `ai-maestro-plugin`. Screenshot: SCEN-016/S015-snapshot-recorded.png

#### S016: Change client to Codex via Program selector
- **Action:** Change Program dropdown from "claude" to "codex"
- **Goal:** ChangeClient AIO pipeline runs server-side
- **Creates:** `~/agents/custom-plugins/.abstract/ai-maestro-plugin/plugin-universal-ir.yaml` (if it did not exist), `~/agents/custom-plugins/codex/ai-maestro-plugin-codex/` directory
- **Modifies:** agent registry `program: "codex"`, agent .claude/ directory (plugin files replaced)
- **Verify:** API PATCH returns 200, no error. Screenshot: SCEN-016/S016-client-changed.png

#### S017: Verify R18.3(a/b/c) — Universal IR was created
- **Action:** Check existence of `~/agents/custom-plugins/.abstract/ai-maestro-plugin/plugin-universal-ir.yaml` on disk.
- **Goal:** Confirm the Universal IR was generated during the conversion
- **Creates:** nothing (verification)
- **Modifies:** nothing
- **Verify:** File exists with valid YAML content. Screenshot: SCEN-016/S017-universal-ir-exists.png

#### S018: Verify R18.3 — Codex plugin was emitted
- **Action:** Check `~/agents/custom-plugins/codex/ai-maestro-plugin-codex/` exists with at least one file (e.g. plugin.json, skills/, commands/)
- **Goal:** Confirm the Codex version was emitted from the IR
- **Creates:** nothing (verification)
- **Modifies:** nothing
- **Verify:** Directory exists, contains files. Screenshot: SCEN-016/S018-codex-emitted.png

#### S019: Verify R18.4 — Old Claude plugin removed from agent dir
- **Action:** Check agent's `.claude/settings.local.json`: `ai-maestro-plugin@ai-maestro-plugins: true` entry should be removed (or value set to false/removed via uninstall)
- **Goal:** Confirm the old Claude plugin was uninstalled
- **Creates:** nothing (verification)
- **Modifies:** nothing
- **Verify:** Settings file no longer references the Claude ai-maestro-plugin at the top level. Screenshot: SCEN-016/S019-claude-removed.png

#### S020: Verify R18.1 — Codex plugin installed in agent dir
- **Action:** Check agent's Codex config (depends on adapter — element-based adapters write to `.codex/` or similar inside agent dir). Run API GET `/api/agents/{id}/local-config` again.
- **Goal:** Confirm the Codex converted plugin is now present in the agent dir
- **Creates:** nothing (verification)
- **Modifies:** nothing
- **Verify:** Plugin elements (skills, commands, agents) from the converted Codex plugin are discoverable. Screenshot: SCEN-016/S020-codex-installed.png

#### S021: Verify registry update
- **Action:** API GET `/api/agents/{id}` and check `program === "codex"`
- **Goal:** Confirm registry was updated
- **Creates:** nothing (verification)
- **Modifies:** nothing
- **Verify:** `agent.program === "codex"`. Screenshot: SCEN-016/S021-registry-codex.png

#### S022: Verify R18.7 — Restart needed flag
- **Action:** Check that the PATCH response from S016 (saved to reports) included `restartNeeded: true` OR that a restart-needed indicator appears in the UI
- **Goal:** Confirm the client change flagged restart as needed
- **Creates:** nothing (verification)
- **Modifies:** nothing
- **Verify:** Restart indicator present. Screenshot: SCEN-016/S022-restart-needed.png

#### S023: R18.4 Abort-before-uninstall — DEFERRED to unit test
- **Action:** This negative test (verifying that ChangeClient aborts BEFORE any uninstall when the plugin source is missing) was originally written to `mv` the source plugin directory aside. That violates Rule 6 STICK-TO-UI because the dashboard has no "hide a plugin from disk" button. The correct home for this assertion is a unit test of services/element-management-service.ts ChangeClient with scanAgentLocalConfig and resolveConversionSource mocked. Skip this step in the UI scenario.
- **Goal:** nothing to verify in the UI — this path is not user-reachable.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** N/A (deferred). Track as TRDD: write tests/services/element-management-service.ChangeClient.test.ts with the R18.4 mock scenario.

---

## Phase CLEANUP: Restore Original State

#### S024: Delete test agent via UI
- **Action:** Open scen016-r18-test profile panel → Advanced tab → Danger Zone → Delete Agent → check "Also delete agent folder" → type `scen016-r18-test` → Delete Forever
- **Goal:** Agent fully removed from registry and filesystem
- **Removes:** agent registry entry, `~/agents/scen016-r18-test/` directory, tmux session (if any)
- **Verify:** Agent no longer in sidebar, API GET `/api/agents` does not list it. Screenshot: SCEN-016/S024-agent-deleted.png

#### S025: Purge cemetery entry
- **Action:** Navigate to Settings → Cemetery tab → find `scen016-r18-test` entry → Purge
- **Goal:** Cemetery archive cleared
- **Removes:** cemetery entry for the test agent
- **Verify:** Entry no longer in Cemetery tab. Screenshot: SCEN-016/S025-cemetery-purged.png

#### S026: Verify test artifacts removed
- **Action:** Check: no `scen016-r18-test` in registry.json, no `~/agents/scen016-r18-test/` directory, no cemetery entry
- **Goal:** All test-created artifacts are gone
- **Removes:** nothing (verification)
- **Verify:** All three checks pass. Screenshot: SCEN-016/S026-artifacts-gone.png

#### S027: STATE-WIPE — Restore configuration files
- **Action:** Compare current config files against backups from S002. Restore ONLY files that differ AND whose differences are side effects of the test (not cleanup-driven, e.g., settings.json). Do NOT restore registry.json or teams.json — those were cleaned via UI in S024.
- **Goal:** Config files match pre-test state
- **Removes:** nothing
- **Verify:** File hash comparison — all relevant files match backups. Screenshot: SCEN-016/S027-state-restored.png

#### S028: Post-test screenshot
- **Action:** `take_screenshot` of full dashboard
- **Goal:** UI identical to Phase 0 baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved as SCEN-016/S028-post-test.png, visually matches S005-baseline.png

---

## Phase 11th-HOUR: Post-Scenario Analysis

After the test completes, analyze:

1. Did every R18 sub-rule hold? (R18.1 through R18.10)
2. Was the abort-before-uninstall path (S023) triggered correctly?
3. Were there any race conditions or partial states observed?
4. Did the Codex adapter install the plugin elements correctly (skills/commands)?
5. What features were lost in the conversion (loss report)?
6. Are there opportunities to optimize the conversion pipeline (caching, skip if IR unchanged)?

Save the proposals to `tests/scenarios/reports/scenario_proposed-improvements_015_<datetime>.md`.
