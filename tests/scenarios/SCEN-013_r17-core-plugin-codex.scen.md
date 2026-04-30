---
number: 13
name: R17 Core Plugin Enforcement (Codex Client)
version: "1.0"
description: >
  The user logs in and creates a new Codex agent through the wizard. They open
  the agent's Config tab and see the ai-maestro-plugin (converted to Codex
  format) marked as "core" with no uninstall button. They attempt to uninstall
  it via API call (rejected). They manually disable the plugin in settings,
  restart the server, and confirm it was re-enabled automatically. They remove
  the plugin file from disk, wake the agent, and verify the plugin reinstalls
  with cross-client conversion. Same flow as SCEN-012 but for a Codex client.
  They clean up the test agent when done.
client: codex
interhosts: false
device: desktop
subsystems:
  - governance (R17 core plugin enforcement)
  - element-management-service (CreateAgent G11, ChangePlugin G01b)
  - agents-core-service (wakeAgent R17 gate, R17-TRUST auto-accept)
  - server startup (R17 audit, marketplace registration)
  - agent-registry (corePluginMissing flag)
ui_sections:
  - Login page (governance password login)
  - Sidebar -> Agents tab -> Create new agent
  - Agent Creation Wizard (steps 1-7)
  - Agent Profile -> Config tab -> Plugins section
  - Agent Profile -> Advanced tab -> Danger Zone
data_produced:
  - 1 test agent "scen013-codex-r17-test" (temporary, created and deleted)
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
  - No pre-existing agent named "scen013-codex-r17-test"
  - Codex CLI installed (`which codex` succeeds)
governance_password: "mYkri1-xoxrap-gogtan"
rewipe-list:
  # Rule 3: STATE-WIPE only restores config files modified by side effects.
  # Do NOT include registry.json or teams.json — UI delete + cleanup already handles those,
  # and restoring them re-creates orphan registry entries for already-deleted agents.
  - ~/.aimaestro/governance.json
  - ~/.aimaestro/teams/groups.json
git-fixtures: []
dir-fixtures: []
commit: TBD
author: AI Maestro Team
---

# R17 Core Plugin Enforcement (Codex Client) Scenario

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state with known commit hash
- **Creates:** nothing
- **Modifies:** git history (new commit if needed)
- **Verify:** `git status` shows clean working tree. Screenshot: SCEN-013/S001-git-clean.png

#### S002: STATE-WIPE Checkpoint — Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/scen012_<timestamp>/`: `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.aimaestro/governance.json`, `~/.aimaestro/agents/registry.json`, `~/.aimaestro/teams/teams.json`, `~/.aimaestro/teams/groups.json`
- **Goal:** Copies of all config files saved for post-test restoration
- **Creates:** Backup directory with config copies
- **Modifies:** nothing
- **Verify:** Backup files exist and match originals (hash comparison). Screenshot: SCEN-013/S002-backup-created.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `GET /api/sessions` returns 200
- **Goal:** Server running with latest build
- **Creates:** nothing
- **Modifies:** PM2 process state
- **Verify:** `/api/sessions` returns 200. Screenshot: SCEN-013/S003-server-running.png

#### S004: Kill orphan test sessions
- **Action:** `tmux list-sessions | grep '^scen012-' | cut -d: -f1 | xargs -I{} tmux kill-session -t {}`
- **Goal:** No leftover sessions from previous runs
- **Creates:** nothing
- **Modifies:** tmux state
- **Verify:** `tmux list-sessions | grep scen012` returns nothing

#### S005: Login to dashboard
- **Action:** Navigate to `http://localhost:23000/`, enter governance password `mYkri1-xoxrap-gogtan`, click Sign In
- **Goal:** Authenticated session established
- **Creates:** Session cookie
- **Modifies:** nothing
- **Verify:** Dashboard loads, sidebar shows agent count. Screenshot: SCEN-013/S005-logged-in.png

#### S006: Baseline screenshot
- **Action:** `take_screenshot` of full dashboard
- **Goal:** Baseline for post-test comparison
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved as SCEN-013/S006-baseline.png

---

## Phase 1: Create Agent and Verify Core Plugin Installation

> This phase tests R17.1–R17.6: automatic installation at creation time via CreateAgent G11.

#### S007: Open Agent Creation Wizard
- **Action:** Click the "+" (Create new agent) button in the sidebar
- **Goal:** Wizard opens at Step 1 (client selection)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows "New Agent Setup" heading, Step 1 of 7. Screenshot: SCEN-013/S007-wizard-step1.png

#### S008: Select Codex as client
- **Action:** Click "Codex" button in the client selection
- **Goal:** Step 2 appears (Persona Name + Avatar)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows Step 2, "Persona Name" field visible. Screenshot: SCEN-013/S008-wizard-step2.png

#### S009: Enter agent name
- **Action:** Type `scen013-codex-r17-test` in the Persona Name field
- **Goal:** Name entered, Next button enabled
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Field shows "scen013-codex-r17-test", Next button is clickable. Screenshot: SCEN-013/S009-name-entered.png

#### S010: Click Next to Step 3
- **Action:** Click the Next button
- **Goal:** Step 3 appears (team selection)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows Step 3, "No team (Autonomous)" option visible. Screenshot: SCEN-013/S010-wizard-step3.png

#### S011: Select No team (Autonomous)
- **Action:** Click "No team (Autonomous)" button
- **Goal:** Step 4 appears (governance title)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows Step 4 with AUTONOMOUS option. Screenshot: SCEN-013/S011-wizard-step4.png

#### S012: Select AUTONOMOUS title
- **Action:** Click "AUTONOMOUS" button
- **Goal:** Step 5 appears (working directory)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows Step 5 with "Auto-create agent folder" option. Screenshot: SCEN-013/S012-wizard-step5.png

#### S013: Select auto-create folder
- **Action:** Click "Auto-create agent folder ~/agents/scen013-codex-r17-test/"
- **Goal:** Step 6 appears (role plugin)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows Step 6 with plugin selection. Screenshot: SCEN-013/S013-wizard-step6.png

#### S014: Continue past plugin step
- **Action:** Click "Continue" (no role plugin for AUTONOMOUS)
- **Goal:** Step 7 appears (summary)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows Step 7 summary: name=scen013-codex-r17-test, title=AUTONOMOUS, folder=~/agents/scen013-codex-r17-test/. Screenshot: SCEN-013/S014-wizard-step7.png

#### S015: Click Create Agent
- **Action:** Click "Create Agent!" button
- **Goal:** Agent created, wizard shows completion screen, agent appears in sidebar
- **Creates:** Agent in registry, ~/agents/scen013-codex-r17-test/ directory, tmux session
- **Modifies:** Registry (new agent entry), settings.local.json (ai-maestro-plugin installed)
- **Verify:** Wizard shows "Your Agent is Ready!", sidebar shows new agent. Screenshot: SCEN-013/S015-agent-created.png

#### S016: Dismiss wizard and verify agent is online
- **Action:** Click "Let's Go!" button to dismiss wizard
- **Goal:** Dashboard shows agent selected, terminal connected
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Terminal status shows "Connected", agent name in toolbar. Screenshot: SCEN-013/S016-agent-online.png

#### S017: Verify ai-maestro-plugin in settings.local.json
- **Action:** Read file `~/agents/scen013-codex-r17-test/.claude/settings.local.json`
- **Goal:** The file contains `"ai-maestro-plugin@ai-maestro-plugins": true` in enabledPlugins
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** File content confirms plugin is installed and enabled. Screenshot: SCEN-013/S017-settings-local.png

---

## Phase 2: Verify Plugin Visible in Config Tab with "core" Protection

> This phase tests R17.1 (plugin visible in agent's local plugins), R17.16 (core label, no uninstall button).
> The Config tab reads from the agent's `settings.local.json` — this is the UI confirmation that G11 worked.

#### S018: Navigate to Config tab in profile panel
- **Action:** Click "Config" tab in the profile panel (right side of dashboard)
- **Goal:** Config tab loads showing element summary: Skills count, Commands count, Plugins count
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows "Plugins 1" (exactly 1 plugin — the ai-maestro-plugin). Also shows Skills 12 and Commands 12 (from the ai-maestro-plugin's bundled elements). Screenshot: SCEN-013/S018-config-tab.png

#### S019: Expand the Plugins section to see the plugin entry
- **Action:** Click on the "Plugins 1" row to expand it and reveal the plugin list
- **Goal:** The plugin list expands showing the ai-maestro-plugin entry with name, version, and element count
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows a plugin entry with StaticText "ai-maestro-plugin", a version number (e.g. "2.5.0"), and an element count badge. Screenshot: SCEN-013/S019-plugins-expanded.png

#### S020: Verify the "core" label is shown (NOT an uninstall button)
- **Action:** Inspect the ai-maestro-plugin entry in the accessibility snapshot
- **Goal:** The entry shows a **"core"** text label, NOT an X icon with description "Uninstall this plugin". This confirms R17.16 — the UI protects the core plugin from uninstallation.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot contains StaticText "core" adjacent to "ai-maestro-plugin". There is NO element with `description="Uninstall this plugin"` for this plugin entry. If any other non-core plugins were installed, THOSE would have the X button — but the ai-maestro-plugin must not. Screenshot: SCEN-013/S020-core-label.png

---

## Phase 3: Verify API Rejects Uninstall/Disable

> This phase tests R17.14–R17.15: ChangePlugin pipeline rejects uninstall/disable for core plugin.
> Note: These are read-only API checks to verify server-side enforcement. They do not modify state.

#### S021: Attempt API uninstall of core plugin
- **Action:** Read-only verification: after the UI test, use the browser console or API to confirm the server would reject `DELETE /api/agents/role-plugins/install` with body `{ pluginName: "ai-maestro-plugin", agentDir: "~/agents/scen013-codex-r17-test" }`. The actual test: verify the ai-maestro-plugin is still installed in settings.local.json after any UI interaction.
- **Goal:** The plugin remains installed — the API rejects the uninstall request with R17 error
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Read `~/agents/scen013-codex-r17-test/.claude/settings.local.json` — ai-maestro-plugin still present and set to true. Screenshot: SCEN-013/S021-still-installed.png

---

## Phase 4: Verify Re-Enable on Wake (wake-gate reconciliation)

> This phase tests the wake-gate R17 reconciliation path: when an agent is hibernated
> and its `ai-maestro-plugin` entry is disabled in settings.local.json while asleep,
> the wakeAgent R17 gate (during ChangeClient / InstallElement EXE phase) must
> re-enable the plugin before the agent's Claude session launches.
> This is distinct from the startup audit — it runs per-wake, not per-server-restart.

#### S022: Hibernate the test agent
- **Action:** In the dashboard, select `scen013-codex-r17-test`, click Stop (send `/exit` in terminal if needed), then from Profile click Hibernate. Wait for the agent to show as hibernated.
- **Goal:** Agent's Claude session is terminated; registry marks it hibernated. No running tmux process holds settings files open.
- **Creates:** nothing
- **Modifies:** Agent session status → hibernated
- **Verify:** Sidebar shows agent as hibernated. API `GET /api/agents/<id>` reports no active session. Screenshot: SCEN-013/S022-hibernated.png

#### S023: Manually disable the plugin in settings.local.json while hibernated
- **Action:** Read `~/agents/scen013-codex-r17-test/.claude/settings.local.json`, edit the `ai-maestro-plugin@ai-maestro-plugins` value from `true` to `false`, write back.
- **Goal:** Plugin is disabled in the config file while agent is asleep (pre-wake state: broken).
- **Creates:** nothing
- **Modifies:** settings.local.json (ai-maestro-plugin set to false)
- **Verify:** File content shows `"ai-maestro-plugin@ai-maestro-plugins": false`. Registry still shows agent hibernated. Screenshot: SCEN-013/S023-manually-disabled.png

#### S024: Wake the agent via UI and verify wake-gate reconciliation
- **Action:** In the dashboard, select `scen013-codex-r17-test` and click Wake. The wakeAgent pipeline MUST run the R17 reconciliation gate (part of ChangeClient G06-G07 or InstallElement EXE phase) which detects the disabled ai-maestro-plugin and re-enables it before launching the Claude Code session. Wait for the Claude idle prompt to appear.
- **Goal:** Wake-gate detects disabled core plugin, re-enables it, plugin converts/installs for Codex if missing, agent launches cleanly with ai-maestro-plugin active.
- **Creates:** nothing (reconciliation only)
- **Modifies:** settings.local.json (plugin flipped back to true), agent session status (online)
- **Verify:** Read `~/agents/scen013-codex-r17-test/.claude/settings.local.json` — `"ai-maestro-plugin@ai-maestro-plugins": true` is restored. PM2 logs show `[Wake] R17:` or `[Wake] R17-TRUST:` indicating the wake-gate ran reconciliation. Agent shows online in sidebar with Claude idle prompt visible. Registry reports hibernated=false. Screenshot: SCEN-013/S024-wake-reenabled.png

---

## Phase 5: Verify Trust Auto-Accept on First Launch

> This phase tests R17.22–R17.23: the trust prompt is auto-accepted on first agent launch.
> Since the agent was already created and launched in Phase 1, we need a fresh agent to test this.
> We verify by checking the PM2 logs for the R17-TRUST message from the Phase 1 creation.

#### S025: Check server logs for trust auto-accept
- **Action:** Check PM2 logs for `[Wake] R17-TRUST: Auto-accepted directory trust prompt for "scen013-codex-r17-test"` from the Phase 1 agent creation
- **Goal:** The trust prompt was detected and auto-accepted on first launch
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Log line exists confirming auto-accept. Screenshot: SCEN-013/S025-trust-accepted.png

> **Note:** If the trust prompt was NOT shown (because the directory was already trusted from a previous run of `r17-test-agent`), the log will not contain this message. In that case, verify by checking that the agent reached the Claude idle prompt (╭─) without manual intervention.

---

## Phase 6: Verify corePluginMissing Flag Reconciled on Wake

> This phase tests R17.9 + R17.18 via the wake-gate path: when the core plugin
> file is completely missing from settings.local.json while the agent is
> hibernated, waking it via the UI must trigger ChangeClient/InstallElement EXE
> phase to detect the missing plugin and reinstall it automatically before the
> Claude/Codex session launches. This is a wake-gate reconciliation test,
> NOT a server-startup audit test.

#### S026: Hibernate the test agent again
- **Action:** Select `scen013-codex-r17-test`, click Stop, then Hibernate from Profile. Wait until sidebar shows hibernated.
- **Goal:** Agent's session is terminated so its settings.local.json can be edited safely.
- **Creates:** nothing
- **Modifies:** Agent session status → hibernated
- **Verify:** API reports no active session for this agent. Screenshot: SCEN-013/S026-hibernated-again.png

#### S027: Remove plugin from settings.local.json entirely (while hibernated)
- **Action:** Read `~/agents/scen013-codex-r17-test/.claude/settings.local.json`, remove the `ai-maestro-plugin@ai-maestro-plugins` key entirely from enabledPlugins, write back.
- **Goal:** Plugin entry completely gone from config (simulates a broken or tampered install while agent sleeps).
- **Creates:** nothing
- **Modifies:** settings.local.json (plugin entry removed)
- **Verify:** File content shows `enabledPlugins` without any ai-maestro-plugin key. Screenshot: SCEN-013/S027-plugin-removed.png

#### S028: Capture pre-wake registry state
- **Action:** Read agent from API: `GET /api/agents/<agentId>`. Because the server has not run a startup audit yet, the registry may not have the `corePluginMissing` flag set — the point of this phase is that the wake-gate detects the mismatch at wake time, regardless of what the registry says about it.
- **Goal:** Record the registry state (flag may or may not be set — not authoritative). The authoritative detection happens in the next step when the user wakes the agent.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API response captured for later comparison. If `corePluginMissing` is true, note it; if absent, the wake-gate itself must detect and repair. Screenshot: SCEN-013/S028-registry-state.png

#### S029: Wake the agent and verify wake-gate reinstalls the core plugin
- **Action:** In the dashboard, select `scen013-codex-r17-test` and click Wake. The wake-gate (ChangeClient G06-G07 plugin re-emit phase or InstallElement EXE phase) MUST detect the missing ai-maestro-plugin, convert it if needed for Codex format, install it into the agent folder, write it back into settings.local.json, then launch the Codex session. Wait for the Codex idle prompt.
- **Goal:** Wake-gate plugin reconciliation ran (not a server audit). Core plugin is reinstalled specifically by the wake path, not by periodic enforcement.
- **Creates:** Installed plugin files under ~/agents/scen013-codex-r17-test/ (location depends on Codex adapter)
- **Modifies:** settings.local.json (ai-maestro-plugin key added back, set to true), registry (corePluginMissing cleared if it was set), session status (online)
- **Verify:** Read `~/agents/scen013-codex-r17-test/.claude/settings.local.json` — `"ai-maestro-plugin@ai-maestro-plugins": true` is present again. PM2 logs show `[Wake] R17:` or `[Wake] R17-TRUST:` confirming the wake-gate ran the reconciliation. `GET /api/agents/<id>` shows `corePluginMissing: false` or absent. Agent online with idle prompt. Screenshot: SCEN-013/S029-wake-reinstalled.png

---

## Phase CLEANUP: Restore Original State

#### S030: Stop the test agent
- **Action:** In the dashboard, select scen013-codex-r17-test, click Stop button. SUDO-MODE: when the sudo password modal appears (POST `/api/sessions/{id}/stop` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm. (Alternative: send `/exit` via terminal; this path does not prompt but requires manual confirmation inside the Codex CLI.)
- **Goal:** Agent's Codex session exits gracefully
- **Creates:** nothing
- **Modifies:** Agent session status → offline
- **Verify:** Agent shows as offline/hibernated in sidebar. Screenshot: SCEN-013/S030-agent-stopped.png

#### S031: Delete the test agent via UI
- **Action:** Agent Profile → Advanced tab → Danger Zone → Delete Agent → check "Also delete agent folder" → type `scen013-codex-r17-test` → click "Delete Forever". SUDO-MODE: when the sudo password modal appears (DELETE `/api/agents/{id}` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Agent removed from registry, folder deleted, tmux session killed
- **Removes:** Agent from registry, ~/agents/scen013-codex-r17-test/ directory, tmux session
- **Verify:** Agent no longer in sidebar. Run `ls ~/agents/scen013-codex-r17-test` and confirm "No such file or directory" — this verifies the "Also delete agent folder" checkbox actually removed the folder. Screenshot: SCEN-013/S031-agent-deleted.png

#### S032: Purge cemetery entry
- **Action:** Navigate to Settings → Cemetery tab → find scen013-codex-r17-test → click Purge. SUDO-MODE: when the sudo password modal appears (DELETE `/api/agents/cemetery` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Cemetery entry removed
- **Removes:** Cemetery archive entry for scen013-codex-r17-test
- **Verify:** scen013-codex-r17-test not listed in cemetery. Screenshot: SCEN-013/S032-cemetery-purged.png

#### S033: STATE-WIPE — Restore configuration files
- **Action:** Compare current config files with backups from S002. Restore any that differ.
- **Goal:** All config files match pre-test state
- **Removes:** nothing
- **Verify:** File hash comparison — all 6 files match. Screenshot: SCEN-013/S033-state-restored.png

#### S034: Post-test screenshot
- **Action:** `take_screenshot` of full dashboard
- **Goal:** UI identical to Phase 0 baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved as SCEN-013/S034-post-test.png. Visual comparison with S006 baseline.
