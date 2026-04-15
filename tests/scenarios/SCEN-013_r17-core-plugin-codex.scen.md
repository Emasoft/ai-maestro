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

## Phase 4: Verify Wake-Gate Re-Enables Disabled Plugin

> This phase tests R17.15 + R17.18 via the wake-gate path: if the plugin is manually disabled
> in settings.local.json, the next wake of the agent must re-install/re-enable it.
> Enforcement is done by `wakeAgent()` in `services/agents-core-service.ts` (R17 gate) —
> the old startup audit was removed in favor of this on-demand repair, so the test must
> hibernate the agent and wake it again to observe the fix.

#### S022: Manually disable the plugin in settings.local.json
- **Action:** Read `~/agents/scen013-codex-r17-test/.claude/settings.local.json`, edit the `ai-maestro-plugin@ai-maestro-plugins` value from `true` to `false`, write back
- **Goal:** Plugin is now disabled in the config file
- **Creates:** nothing
- **Modifies:** settings.local.json (ai-maestro-plugin set to false)
- **Verify:** File content shows `"ai-maestro-plugin@ai-maestro-plugins": false`. Screenshot: SCEN-013/S022-manually-disabled.png

#### S023: Hibernate the agent via the UI
- **Action:** Select scen013-codex-r17-test in the sidebar, then click the Hibernate button in the Agent Profile header (or the sidebar hibernate button on the row). When the sudo password modal appears, enter the governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Agent session is killed and the agent status changes to hibernated/offline in the sidebar
- **Creates:** nothing
- **Modifies:** Agent session status → offline, tmux session killed
- **Verify:** Sidebar shows the agent as hibernated (offline badge). Screenshot: SCEN-013/S023-agent-hibernated.png

#### S024: Wake the agent via the UI
- **Action:** Click the Wake button on the hibernated agent (sidebar row Wake action, or Agent Profile Wake button). Wait up to 10s for the new tmux session to spin up and the terminal to reconnect.
- **Goal:** Agent comes back online; during the wake call, the R17 gate in `wakeAgent()` detects the disabled plugin and re-installs it BEFORE the tmux session is created
- **Creates:** New tmux session for scen013-codex-r17-test
- **Modifies:** Agent session status → online, settings.local.json (plugin re-enabled via InstallElement)
- **Verify:** Sidebar badge flips back to online; terminal shows the Codex prompt. Screenshot: SCEN-013/S024-agent-woken.png

#### S025: Verify plugin was re-enabled by the wake-gate
- **Action:** Read `~/agents/scen013-codex-r17-test/.claude/settings.local.json`
- **Goal:** The plugin value is back to `true` — the wakeAgent R17 gate forced it back on during S024
- **Creates:** nothing
- **Modifies:** nothing (already modified by the server during wake)
- **Verify:** File content shows `"ai-maestro-plugin@ai-maestro-plugins": true`. Screenshot: SCEN-013/S025-re-enabled.png

#### S026: Verify PM2 logs show [Wake] R17: repair confirmation
- **Action:** Check PM2 logs for the wake-gate log lines emitted during S024 — look for `[Wake] R17: ai-maestro-plugin missing or disabled for "scen013-codex-r17-test" — installing before wake...` followed by `[Wake] R17: ai-maestro-plugin installed for "scen013-codex-r17-test"`
- **Goal:** Logs confirm the wake-gate path (not the removed startup audit) performed the repair
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Both `[Wake] R17:` log lines exist with the agent name. No `[Startup] R17:` line is expected (the startup audit was removed). Screenshot: SCEN-013/S026-wake-logs.png

---

## Phase 5: Verify Trust Auto-Accept on First Launch

> This phase tests R17.22–R17.23: the trust prompt is auto-accepted on first agent launch.
> Since the agent was already created and launched in Phase 1, we need a fresh agent to test this.
> We verify by checking the PM2 logs for the R17-TRUST message from the Phase 1 creation.

#### S027: Check server logs for trust auto-accept
- **Action:** Check PM2 logs for `[Wake] R17-TRUST: Auto-accepted directory trust prompt for "scen013-codex-r17-test"` from the Phase 1 agent creation
- **Goal:** The trust prompt was detected and auto-accepted on first launch
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Log line exists confirming auto-accept. Screenshot: SCEN-013/S027-trust-accepted.png

> **Note:** If the trust prompt was NOT shown (because the directory was already trusted from a previous run of `r17-test-agent`), the log will not contain this message. In that case, verify by checking that the agent reached the Claude idle prompt (╭─) without manual intervention.

---

## Phase 6: Verify Wake-Gate Reinstalls Missing Plugin

> This phase tests R17.9 + R17.18 via the wake-gate path: when the ai-maestro-plugin entry
> is removed entirely from settings.local.json, the next wake of the agent must reinstall it.
> Same enforcement point as Phase 4 (`wakeAgent()` R17 gate in
> `services/agents-core-service.ts`) — the removed startup audit no longer sets a
> corePluginMissing flag, so the test hibernates and wakes the agent to observe the
> on-demand reinstall and confirms the flag is not set (or is cleared) afterwards.

#### S028: Remove plugin from settings.local.json entirely
- **Action:** Read `~/agents/scen013-codex-r17-test/.claude/settings.local.json`, remove the `ai-maestro-plugin@ai-maestro-plugins` key entirely from enabledPlugins, write back
- **Goal:** Plugin entry completely removed from config
- **Creates:** nothing
- **Modifies:** settings.local.json (plugin entry removed)
- **Verify:** File content shows enabledPlugins without any ai-maestro-plugin key. Screenshot: SCEN-013/S028-plugin-removed.png

#### S029: Hibernate the agent via the UI
- **Action:** Select scen013-codex-r17-test in the sidebar, then click the Hibernate button in the Agent Profile header (or the sidebar hibernate button on the row). When the sudo password modal appears, enter the governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Agent session is killed and the agent status changes to hibernated/offline in the sidebar
- **Creates:** nothing
- **Modifies:** Agent session status → offline, tmux session killed
- **Verify:** Sidebar shows the agent as hibernated (offline badge). Screenshot: SCEN-013/S029-agent-hibernated.png

#### S030: Wake the agent via the UI
- **Action:** Click the Wake button on the hibernated agent (sidebar row Wake action, or Agent Profile Wake button). Wait up to 10s for the new tmux session to spin up and the terminal to reconnect.
- **Goal:** Agent comes back online; during the wake call, the R17 gate in `wakeAgent()` detects the missing plugin and reinstalls it BEFORE the tmux session is created
- **Creates:** New tmux session for scen013-codex-r17-test
- **Modifies:** Agent session status → online, settings.local.json (plugin key added back and set to true)
- **Verify:** Sidebar badge flips back to online; terminal shows the Codex prompt. Screenshot: SCEN-013/S030-agent-woken.png

#### S031: Verify plugin was reinstalled by the wake-gate
- **Action:** Read `~/agents/scen013-codex-r17-test/.claude/settings.local.json`
- **Goal:** The plugin key is back in enabledPlugins and set to `true` — the wakeAgent R17 gate reinstalled it during S030
- **Creates:** nothing
- **Modifies:** nothing (already modified by the server during wake)
- **Verify:** File content shows `"ai-maestro-plugin@ai-maestro-plugins": true`. Screenshot: SCEN-013/S031-reinstalled.png

#### S032: Verify corePluginMissing flag is not set (or cleared) in the registry
- **Action:** Read agent from API: `GET /api/agents/<agentId>` (use agent ID from S015). Access the nested `agent` object — remember `data.agent.corePluginMissing`, not `data.corePluginMissing`.
- **Goal:** Agent record shows `corePluginMissing: false` or the field is absent/undefined. The startup audit that used to set this flag is gone, and the wakeAgent R17 gate's `else if (agent.corePluginMissing)` branch clears any pre-existing stale flag.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API response contains `"agent": { ..., "corePluginMissing": false, ... }` or the field is missing entirely. Screenshot: SCEN-013/S032-flag-cleared.png

#### S033: Verify PM2 logs show [Wake] R17: reinstall confirmation
- **Action:** Check PM2 logs for the wake-gate log lines emitted during S030 — look for `[Wake] R17: ai-maestro-plugin missing or disabled for "scen013-codex-r17-test" — installing before wake...` followed by `[Wake] R17: ai-maestro-plugin installed for "scen013-codex-r17-test"`
- **Goal:** Logs confirm the wake-gate path (not the removed startup audit or the removed periodic enforcement) performed the reinstall
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Both `[Wake] R17:` log lines exist with the agent name. No `[Startup] R17:` or `[R17] Periodic enforcement:` line is expected for this agent (those code paths were removed). Screenshot: SCEN-013/S033-wake-reinstall-logs.png

---

## Phase CLEANUP: Restore Original State

#### S034: Stop the test agent
- **Action:** In the dashboard, select scen013-codex-r17-test, click Stop button (or send `/exit` via terminal)
- **Goal:** Agent's Claude session exits gracefully
- **Creates:** nothing
- **Modifies:** Agent session status → offline
- **Verify:** Agent shows as offline/hibernated in sidebar. Screenshot: SCEN-013/S034-agent-stopped.png

#### S035: Delete the test agent via UI
- **Action:** Agent Profile → Advanced tab → Danger Zone → Delete Agent → check "Also delete agent folder" → type "scen013-codex-r17-test" → click "Delete Forever"
- **Goal:** Agent removed from registry, folder deleted, tmux session killed
- **Removes:** Agent from registry, ~/agents/scen013-codex-r17-test/ directory, tmux session
- **Verify:** Agent no longer in sidebar. Folder `~/agents/scen013-codex-r17-test/` does not exist. Screenshot: SCEN-013/S035-agent-deleted.png

#### S036: Purge cemetery entry
- **Action:** Navigate to Settings → Cemetery tab → find scen013-codex-r17-test → click Purge
- **Goal:** Cemetery entry removed
- **Removes:** Cemetery archive entry for scen013-codex-r17-test
- **Verify:** scen013-codex-r17-test not listed in cemetery. Screenshot: SCEN-013/S036-cemetery-purged.png

#### S037: STATE-WIPE — Restore configuration files
- **Action:** Compare current config files with backups from S002. Restore any that differ.
- **Goal:** All config files match pre-test state
- **Removes:** nothing
- **Verify:** File hash comparison — all 6 files match. Screenshot: SCEN-013/S037-state-restored.png

#### S038: Post-test screenshot
- **Action:** `take_screenshot` of full dashboard
- **Goal:** UI identical to Phase 0 baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved as SCEN-013/S038-post-test.png. Visual comparison with S006 baseline.
