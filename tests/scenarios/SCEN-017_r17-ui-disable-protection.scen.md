---
number: 17
name: R17 Core Plugin UI Disable Protection (Multi-Surface)
version: "1.0"
description: >
  The user logs in and creates a test Claude agent. They then exercise every
  UI surface that could theoretically uninstall or disable the core
  ai-maestro-plugin, confirming each surface either hides/disables the
  destructive control OR surfaces a clear error when the control is clicked
  (no silent failure, no stale-optimistic UI). Three surfaces are tested:
  (1) Agent Profile -> Config -> Plugins section (must show "core" badge, no
  XCircle uninstall button); (2) Settings -> Plugins Explorer -> Plugins
  subtab (user-scope toggle must be either absent or reject with a visible
  error on click, and the on-screen state must revert to enabled); (3)
  Settings -> Plugins Explorer -> Marketplaces subtab (per-plugin Uninstall
  and delete-marketplace buttons must either be hidden for the core plugin
  or reject at the server with a visible error). SCEN-012/013 cover the
  backend enforcement (ChangePlugin Gate 7, startup audit, periodic
  enforcement, file-removal self-healing); SCEN-020 covers the Agent
  Profile surface only. SCEN-017 is the missing multi-surface UI audit.
  Cleanup deletes the test agent and STATE-WIPEs any settings files the
  test touched.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance (R17 core plugin enforcement, UI gating)
  - element-management-service (ChangePlugin Gate 7 rejection)
  - global-plugins API (/api/settings/global-plugins POST enable/disable)
  - marketplaces API (/api/settings/marketplaces DELETE + GET)
  - plugin-storage-service (MAIN_PLUGIN_NAME = ai-maestro-plugin)
ui_sections:
  - Login page (governance password login)
  - Sidebar -> Agents tab -> Create new agent
  - Agent Creation Wizard (steps 1-7)
  - Agent Profile -> Config tab -> Plugins section
  - Settings -> Plugins Explorer -> Plugins subtab -> ai-maestro-plugin row
  - Settings -> Plugins Explorer -> Marketplaces subtab -> ai-maestro-plugins card
  - Agent Profile -> Advanced tab -> Danger Zone
data_produced:
  - 1 test agent "scen017-ui-test" (temporary, created and deleted)
  - Plugin settings.local.json modifications on agent (temporary, cleaned up)
  - Possible ~/.claude/settings.json enabledPlugins modifications (temporary, restored via STATE-WIPE)
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
  - ai-maestro-plugins marketplace registered at user scope
  - ai-maestro-plugin installed and enabled at user scope (verify via `GET /api/settings/global-plugins`)
  - No pre-existing agent named "scen017-ui-test"
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

# R17 Core Plugin UI Disable Protection (Multi-Surface)

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes with message `pre-scenario: SCEN-017 R17 UI disable protection`
- **Goal:** Clean git state with known commit hash recorded in report header
- **Creates:** nothing (possibly one git commit)
- **Modifies:** git history (new commit only if needed)
- **Verify:** `git status` shows clean working tree; `git rev-parse HEAD` returned in report. Screenshot: SCEN-017/S001-git-clean.png

#### S002: STATE-WIPE Checkpoint — Save configuration
- **Action:** Backup the following to `tests/scenarios/state-backups/SCEN-017_<timestamp>/`: `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.aimaestro/governance.json`, `~/.aimaestro/agents/registry.json`, `~/.aimaestro/teams/teams.json`, `~/.aimaestro/teams/groups.json`
- **Goal:** Copies of all 6 config files saved for post-test restoration
- **Creates:** Backup directory with config copies
- **Modifies:** nothing
- **Verify:** Backup files exist and match originals (sha256 comparison). Screenshot: SCEN-017/S002-backup-created.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `GET /api/sessions` returns 200
- **Goal:** Server running with latest build
- **Creates:** nothing
- **Modifies:** PM2 process state
- **Verify:** `curl -s -o /dev/null -w "%{http_code}" http://localhost:23000/api/sessions` returns 200. Screenshot: SCEN-017/S003-server-running.png

#### S004: Kill orphan test sessions
- **Action:** `tmux list-sessions 2>/dev/null | grep '^scen017-' | cut -d: -f1 | xargs -I{} tmux kill-session -t {}`
- **Goal:** No leftover tmux sessions from previous SCEN-017 runs
- **Creates:** nothing
- **Modifies:** tmux state (kills only scen017-* sessions)
- **Verify:** `tmux list-sessions | grep '^scen017-'` returns nothing. Screenshot: SCEN-017/S004-no-orphans.png

#### S005: Verify ai-maestro-plugin is installed at user scope
- **Action:** `curl -s http://localhost:23000/api/settings/global-plugins | jq '.marketplaces[] | select(.marketplace=="ai-maestro-plugins") | .plugins[] | select(.name=="ai-maestro-plugin")'` — confirm the core plugin is present and enabled at user scope before the test begins
- **Goal:** The core plugin is installed and enabled — scenario will test the protection of an already-present plugin, not its initial install
- **Creates:** nothing (verification only)
- **Modifies:** nothing
- **Verify:** JSON output includes `"name": "ai-maestro-plugin"` with `"enabled": true`. If absent, prerequisites are broken — STOP and fix before running. Screenshot: SCEN-017/S005-plugin-installed.png

#### S006: Login to dashboard
- **Action:** Navigate to `http://localhost:23000/`, fill governance password `mYkri1-xoxrap-gogtan`, click Sign In
- **Goal:** Authenticated maestro session established
- **Creates:** Session cookie
- **Modifies:** browser cookies
- **Verify:** Dashboard loads, sidebar shows agent count. Screenshot: SCEN-017/S006-logged-in.png

#### S007: Baseline screenshot
- **Action:** `take_screenshot` of full dashboard
- **Goal:** Baseline for post-test visual comparison (CLEAN-AFTER-YOURSELF verification)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved as SCEN-017/S007-baseline.png

---

## Phase 1: Create Test Agent

> This phase creates one minimal test agent so we have a concrete `workingDirectory` with the core plugin installed in local scope. Subsequent phases exercise three UI surfaces: Agent Profile, Settings Plugins subtab, and Settings Marketplaces subtab.

#### S008: Open Agent Creation Wizard
- **Action:** Click the "+" (Create new agent) button in the sidebar
- **Goal:** Wizard opens at Step 1 (client selection)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows "New Agent Setup" heading, Step 1 visible. Screenshot: SCEN-017/S008-wizard-step1.png

#### S009: Pick Claude + name + AUTONOMOUS
- **Action:** Click "Claude Code" client card. In Step 2, type `scen017-ui-test` in the Persona Name field, click Next. Step 3: click "No team (Autonomous)". Step 4: click "AUTONOMOUS". Step 5: click "Auto-create agent folder ~/agents/scen017-ui-test/". Step 6: click "Continue" (no role plugin for AUTONOMOUS).
- **Goal:** Wizard reaches Step 7 (summary) with scen017-ui-test / AUTONOMOUS / auto-created folder
- **Creates:** nothing yet (wizard state only)
- **Modifies:** nothing
- **Verify:** Step 7 summary shows name=scen017-ui-test, title=AUTONOMOUS, folder=~/agents/scen017-ui-test/. Screenshot: SCEN-017/S009-wizard-summary.png

#### S010: Click Create Agent
- **Action:** Click "Create Agent!" button, wait for completion screen, click "Let's Go!" to dismiss the wizard
- **Goal:** Agent created and appearing in sidebar; terminal connected
- **Creates:** Agent registry entry, `~/agents/scen017-ui-test/` directory, tmux session, `~/agents/scen017-ui-test/.claude/settings.local.json` with ai-maestro-plugin enabled
- **Modifies:** registry.json (new entry)
- **Verify:** Sidebar shows scen017-ui-test; terminal status shows "Connected". Screenshot: SCEN-017/S010-agent-created.png

#### S011: Confirm core plugin in agent's local settings
- **Action:** Read `~/agents/scen017-ui-test/.claude/settings.local.json`
- **Goal:** File contains `"ai-maestro-plugin@ai-maestro-plugins": true` in enabledPlugins — the baseline state this scenario protects
- **Creates:** nothing (read-only verification allowed by Rule 6)
- **Modifies:** nothing
- **Verify:** File content contains the exact key `"ai-maestro-plugin@ai-maestro-plugins": true`. Screenshot: SCEN-017/S011-local-config.png

---

## Phase 2: Surface 1 — Agent Profile -> Config -> Plugins

> Re-verifies the surface covered by SCEN-012 Phase 2 as a regression baseline. If this surface is broken here too, SCEN-012 is also broken and we should stop.

#### S012: Navigate to Config tab in profile panel
- **Action:** With scen017-ui-test selected, click the "Config" tab in the profile panel (right side of dashboard)
- **Goal:** Config tab loads showing element summary including "Plugins 1"
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows "Plugins 1" (exactly one plugin — the core ai-maestro-plugin). Screenshot: SCEN-017/S012-config-tab.png

#### S013: Expand the Plugins section
- **Action:** Click on the "Plugins 1" row to expand it, revealing the ai-maestro-plugin entry
- **Goal:** Plugin list expands, ai-maestro-plugin row is visible with name, version, and element count badge
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot contains StaticText "ai-maestro-plugin" with a version number. Screenshot: SCEN-017/S013-plugins-expanded.png

#### S014: Verify "core" label (NOT an XCircle uninstall button)
- **Action:** Inspect the ai-maestro-plugin row in the accessibility snapshot. Look for any descendant with `description="Uninstall this plugin"` or an XCircle icon.
- **Goal:** The row shows a **"core"** text label. There is NO element with `description="Uninstall this plugin"` for this plugin entry.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot text includes "core" adjacent to "ai-maestro-plugin"; no XCircle / Uninstall control present on that row. If an XCircle button is rendered for this row, FILE BUG-SURFACE-1 and fix per Rule 4. Screenshot: SCEN-017/S014-core-label.png

---

## Phase 3: Surface 2 — Settings -> Plugins Explorer -> Plugins subtab

> This is the new ground SCEN-017 breaks. The user-scope plugin manager in Settings has its own per-plugin enable/disable toggle. The code in `components/settings/GlobalElementsSection.tsx` uses `plugin.name !== 'ai-maestro'` as the guard, but the actual `pluginName` parsed from the settings key `ai-maestro-plugin@ai-maestro-plugins` is `"ai-maestro-plugin"`, NOT `"ai-maestro"`. So the guard does not match and the toggle IS rendered. When clicked, `ChangePlugin` Gate 7 should reject the request — but we need to confirm the UI (a) surfaces a visible error and (b) does not leave a stale "disabled" optimistic state.

#### S015: Navigate to Settings -> Plugins Explorer (Plugins subtab)
- **Action:** `navigate_page` to `http://localhost:23000/settings?tab=global-elements&subtab=plugins`
- **Goal:** Settings page loads with Plugins Explorer active and Plugins subtab selected
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows heading "Plugins Explorer" and a Plugins subtab currently active. Screenshot: SCEN-017/S015-plugins-explorer.png

#### S016: Locate the ai-maestro-plugin row under the ai-maestro-plugins marketplace
- **Action:** Scroll / expand until the ai-maestro-plugins marketplace card is visible, then locate the row labeled `ai-maestro-plugin`
- **Goal:** The ai-maestro-plugin row is found in the marketplace-grouped list with a version label
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot contains StaticText "ai-maestro-plugin" under the "ai-maestro-plugins" marketplace group. Screenshot: SCEN-017/S016-row-found.png

#### S017: Inspect the row for the toggle control
- **Action:** `take_snapshot` focused on the ai-maestro-plugin row and note whether a ToggleRight / ToggleLeft button is rendered OR the toggle is absent. Record the rendered state (enabled vs disabled).
- **Goal:** Determine whether the UI currently exposes a disable control on the core plugin row
- **Creates:** nothing (observational)
- **Modifies:** nothing
- **Verify:** Snapshot records one of two outcomes: (A) toggle is absent (protection working correctly) — in which case steps S018-S020 are skipped and marked N/A; (B) toggle is present and shows "enabled" state — in which case the test continues to S018 to exercise the click path. Screenshot: SCEN-017/S017-toggle-state.png

#### S018: Click the disable toggle on the core plugin row
- **Action:** Click the toggle control on the ai-maestro-plugin row. If a sudo password modal appears, enter `mYkri1-xoxrap-gogtan` and click Confirm (note: at v3.6.0 `POST /api/settings/global-plugins` is NOT classified strict in security-registry.json, so no modal is expected — if one appears, that is an INFO observation, not a failure).
- **Goal:** The UI sends a disable request to the backend
- **Creates:** nothing (the backend is expected to reject)
- **Modifies:** nothing successful — the server-side ChangePlugin Gate 7 must reject with an R17 error
- **Verify:** Snapshot shows either a visible error toast / inline message / banner containing the word "core" or "R17" or "cannot"; OR the toggle visibly flips back to enabled within 3 seconds. If the toggle stays in the "disabled" position with no error, that is BUG-SURFACE-2A. Screenshot: SCEN-017/S018-toggle-clicked.png

#### S019: Verify ~/.claude/settings.json is unchanged
- **Action:** Read `~/.claude/settings.json` and check the `enabledPlugins.ai-maestro-plugin@ai-maestro-plugins` value
- **Goal:** Confirm the server rejected the disable operation — the value is still `true`
- **Creates:** nothing (read-only verification)
- **Modifies:** nothing
- **Verify:** File shows `"ai-maestro-plugin@ai-maestro-plugins": true` (or equivalent enabled state). If the value is `false`, R17 Gate 7 is broken — FILE BUG-SURFACE-2B (critical: enforcement bypass at user scope). Screenshot: SCEN-017/S019-settings-json.png

#### S020: Reload the Plugins subtab and verify displayed state
- **Action:** `navigate_page` to `http://localhost:23000/settings?tab=global-elements&subtab=plugins` again to force a fresh fetch
- **Goal:** After a hard reload (not optimistic state), the ai-maestro-plugin row still shows as enabled
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows the ai-maestro-plugin row with the enabled state (ToggleRight / bright-green icon). Screenshot: SCEN-017/S020-reloaded-state.png

---

## Phase 4: Surface 3 — Settings -> Plugins Explorer -> Marketplaces subtab

> MarketplaceManager.tsx has per-plugin Uninstall (Trash2) and Update (RefreshCw) buttons AND a delete-marketplace button. None of these have a core-plugin guard in the current code. R17 enforcement depends entirely on the backend rejecting these requests.

#### S021: Navigate to the Marketplaces subtab
- **Action:** Click the "Marketplaces" subtab in the Plugins Explorer, or navigate to `http://localhost:23000/settings?tab=global-elements&subtab=marketplaces`
- **Goal:** Marketplaces subtab loads showing marketplace cards
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows heading "Plugins Explorer" with the Marketplaces subtab active, and one or more marketplace cards rendered. Screenshot: SCEN-017/S021-marketplaces-tab.png

#### S022: Expand the ai-maestro-plugins marketplace card and locate ai-maestro-plugin row
- **Action:** Click the ai-maestro-plugins marketplace card header to expand it, revealing its plugin list
- **Goal:** The plugin list shows `ai-maestro-plugin` with action buttons (Toggle / Update / Uninstall)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot contains StaticText "ai-maestro-plugin" with visible action buttons adjacent. Screenshot: SCEN-017/S022-mkt-expanded.png

#### S023: Inspect the action-button presence for the core plugin row
- **Action:** `take_snapshot` focused on the ai-maestro-plugin row and note which of these controls are rendered: Toggle (ToggleLeft/Right), Update (RefreshCw), Uninstall (Trash2)
- **Goal:** Record the baseline. MarketplaceManager.tsx currently has no core-plugin guard — expect all three buttons to be rendered.
- **Creates:** nothing (observational)
- **Modifies:** nothing
- **Verify:** Snapshot lists rendered buttons. If Trash2 (Uninstall) and delete-marketplace are visible for the core plugin, that is ISSUE-SURFACE-3 (UX: destructive controls visible for protected plugin). Screenshot: SCEN-017/S023-mkt-buttons.png

#### S024: Click the per-plugin Uninstall (Trash2) on ai-maestro-plugin
- **Action:** Click the Trash2 button on the ai-maestro-plugin row. A confirmation modal appears with label `Uninstall "ai-maestro-plugin"?`. Click the red "Uninstall" button in that modal. When the sudo password modal appears (DELETE /api/agents/role-plugins/install is strict), enter `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** The backend receives the DELETE request, ChangePlugin Gate 7 rejects it (R17 + user-scope check), the UI shows a visible error
- **Creates:** nothing
- **Modifies:** nothing successful — the plugin must remain installed
- **Verify:** Snapshot shows a visible error toast / inline message containing "core", "R17", or "cannot" language; OR the plugin row stays rendered after 3 seconds with its version and Toggle button intact. If the plugin row disappears, that is BUG-SURFACE-3A (critical: backend let the uninstall through). Screenshot: SCEN-017/S024-uninstall-rejected.png

#### S025: Verify ai-maestro-plugin still on disk in cache
- **Action:** `ls ~/.claude/plugins/cache/ai-maestro-plugins/ai-maestro-plugin/` — list the plugin's cache folder
- **Goal:** Confirm the plugin cache directory still exists and contains `plugin.json`
- **Creates:** nothing (read-only verification)
- **Modifies:** nothing
- **Verify:** Directory exists and contains at least `plugin.json`. If missing, BUG-SURFACE-3B (critical). Screenshot: SCEN-017/S025-cache-present.png

#### S026: Verify ai-maestro-plugin still in user settings.json enabledPlugins
- **Action:** Read `~/.claude/settings.json`, look for `enabledPlugins.ai-maestro-plugin@ai-maestro-plugins`
- **Goal:** Value is still `true` — the uninstall was rejected at ChangePlugin Gate 7
- **Creates:** nothing (read-only verification)
- **Modifies:** nothing
- **Verify:** File content shows `"ai-maestro-plugin@ai-maestro-plugins": true`. Screenshot: SCEN-017/S026-settings-verify.png

#### S027: Attempt to delete the ai-maestro-plugins marketplace
- **Action:** Click the delete-marketplace (Trash) button on the ai-maestro-plugins marketplace card header. A confirmation modal appears with label `Delete marketplace "ai-maestro-plugins"? This will uninstall all its plugins and remove the marketplace.` Click the red "Delete" button. When the sudo password modal appears (DELETE /api/settings/marketplaces is strict), enter `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** The backend rejects the cascade delete because it would remove the core plugin. The UI shows a visible error.
- **Creates:** nothing
- **Modifies:** nothing successful — the marketplace and plugin must both remain
- **Verify:** Snapshot shows a visible error toast / inline message mentioning core plugin / R17 / cannot-remove; the marketplace card still renders after 3 seconds. If the card disappears, BUG-SURFACE-3C (critical: cascade delete bypassed R17). Screenshot: SCEN-017/S027-mkt-delete-rejected.png

#### S028: Verify ai-maestro-plugins marketplace is still registered
- **Action:** `navigate_page` back to `http://localhost:23000/settings?tab=global-elements&subtab=marketplaces` to force a fresh fetch
- **Goal:** The ai-maestro-plugins marketplace card is still present in the list
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot contains StaticText "ai-maestro-plugins" in the marketplace list. Screenshot: SCEN-017/S028-mkt-still-present.png

#### S029: Verify the core plugin is still installed on the test agent
- **Action:** Click the scen017-ui-test agent in the sidebar to return to its profile, then open Config -> Plugins and expand
- **Goal:** The agent's local scope still has ai-maestro-plugin with the "core" badge — the UI surfaces in Phases 3 and 4 left the agent untouched
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows ai-maestro-plugin with "core" label on the agent's Config panel. Also read `~/agents/scen017-ui-test/.claude/settings.local.json` and confirm the key is still `true`. Screenshot: SCEN-017/S029-agent-still-protected.png

---

## Phase CLEANUP: Restore Original State

> Cleanup MUST follow the MANDATORY UI-first order (see SCENARIOS_TESTS_RULES.md "Cleanup Order Is Non-Negotiable"): delete agent via UI → purge cemetery → STATE-WIPE restore of settings files.

#### S030: Delete the test agent via UI
- **Action:** With scen017-ui-test selected, open the profile panel → Advanced tab → Danger Zone → click "Delete Agent". In the dialog, check the "Also delete agent folder" checkbox, type `scen017-ui-test` into the confirmation field, click "Delete Forever". When the sudo password modal appears (DELETE /api/agents/[id] is strict), enter `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Agent removed from registry, tmux session killed, `~/agents/scen017-ui-test/` folder deleted
- **Removes:** Agent registry entry, ~/agents/scen017-ui-test/ directory, tmux session
- **Verify:** Agent no longer in sidebar; API `GET /api/agents` does not list scen017-ui-test; folder `~/agents/scen017-ui-test/` does not exist. Screenshot: SCEN-017/S030-agent-deleted.png

#### S031: Purge cemetery entry
- **Action:** Navigate to Settings → Cemetery tab, find the `scen017-ui-test` row, click Purge. When the sudo password modal appears (DELETE /api/agents/cemetery/[id] is strict), enter `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Cemetery archive entry removed
- **Removes:** Cemetery entry for scen017-ui-test
- **Verify:** scen017-ui-test no longer listed in Cemetery tab. Screenshot: SCEN-017/S031-cemetery-purged.png

#### S032: Verify no test artifacts remain
- **Action:** Check: no `scen017-ui-test` in registry.json (read via `GET /api/agents`), no `~/agents/scen017-ui-test/` directory on disk, no cemetery entry, no tmux session matching `scen017-`
- **Goal:** All test-created artifacts are gone
- **Removes:** nothing (verification only)
- **Verify:** All four checks pass. Screenshot: SCEN-017/S032-artifacts-gone.png

#### S033: STATE-WIPE — Restore configuration files
- **Action:** Compare current config files against the S002 backups. Restore any that differ (primarily `~/.claude/settings.json` if S018-S020 or S024 touched it, and `~/.claude/settings.local.json` for completeness). Do NOT restore registry.json or teams.json — those were already cleaned by the UI delete in S030.
- **Goal:** Config files match the pre-test state byte-for-byte
- **Removes:** nothing
- **Verify:** sha256 hash comparison — all 6 backed-up files either unchanged or restored. Screenshot: SCEN-017/S033-state-restored.png

#### S034: Post-test screenshot
- **Action:** Navigate back to `http://localhost:23000/`, `take_screenshot` of the full dashboard
- **Goal:** UI identical to the S007 baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved as SCEN-017/S034-post-test.png; visual comparison with SCEN-017/S007-baseline.png shows no differences (same agent count, same sidebar layout).

---

## Phase 11th-HOUR: Post-Scenario Analysis

After the run, analyze:

1. **Guard consistency:** Does every UI surface that can disable/uninstall a plugin have a core-plugin guard? Or does the codebase rely entirely on backend enforcement at ChangePlugin Gate 7 (and accept the resulting UX where the user can click a destructive button and see an error)?
2. **Guard correctness:** The guard in `GlobalElementsSection.tsx:561` is `plugin.name !== 'ai-maestro'`, but the actual MAIN_PLUGIN_NAME is `'ai-maestro-plugin'`. Is this a dead guard (always false), a legacy string from an earlier rename, or intentional (e.g., matching a display name rather than the canonical name)?
3. **MarketplaceManager core-plugin gating:** `MarketplaceManager.tsx` has zero core-plugin gating on its Uninstall (Trash2) and delete-marketplace buttons. Propose a MAIN_PLUGIN_NAME import and a conditional render for the core plugin row and the ai-maestro-plugins marketplace card.
4. **Error surfacing:** When ChangePlugin Gate 7 rejects the request, does the UI actually surface the error, or does it silently optimistic-update and leave a stale "disabled" state until the user reloads?
5. **Cascade protection:** Should `DELETE /api/settings/marketplaces` pre-check whether the target marketplace contains the core plugin and refuse the cascade entirely, rather than relying on per-plugin Gate 7 rejections mid-cascade (which may leave a half-torn state)?
6. **New scenarios:** Propose SCEN-023 for the same tests on a Codex-format core plugin (once the UI shows ai-maestro-plugin-codex in the same Settings surfaces), and SCEN-024 for the Haephestos publish path (what happens if the user attempts to uninstall the local role-plugin marketplace that also hosts a converted core plugin?).

Save the writeup to `tests/scenarios/reports/scenario_proposed-improvements_017_<datetime>.md` with P0/P1/P2 priority tags and file/line-level fix proposals.
