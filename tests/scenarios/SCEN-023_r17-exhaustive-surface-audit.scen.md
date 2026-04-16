---
number: 23
name: R17 Exhaustive Surface Audit
version: "1.1"
description: >
  The user logs in, creates a fresh Claude test agent, and then systematically
  attempts to remove, disable, or move the core ai-maestro-plugin through every
  known surface: the UI Uninstall button, the UI Disable toggle, a direct
  DELETE API call, a marketplace removal, a manual settings.local.json edit
  followed by a server restart, and a file-deletion plus wake-cycle. R17 must
  block surfaces 1-5 outright and AUTO-REPAIR surfaces 6-7 via the wake-gate.
  After each attempt the user verifies that ai-maestro-plugin is still
  installed and enabled on the test agent. The user then cleans up the test
  agent and restores config files from backup.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance
  - element-management-service
  - role-plugins
  - agent-registry
  - ai-maestro-plugins marketplace (remote GitHub, hosts the core plugin)
ui_sections:
  - Sidebar -> Agents tab -> Create new agent
  - Agent Creation Wizard (steps 1-7)
  - Agent Profile -> Plugins tab -> Uninstall button
  - Agent Profile -> Plugins tab -> Disable toggle
  - Settings -> Plugins Explorer -> Marketplaces tab -> Remove button
  - Agent Profile -> Advanced tab -> Danger Zone -> Delete Agent
  - Sudo password modal (Rule 12)
data_produced:
  - 1 test agent "scen023-r17-audit-01" (temporary, created and deleted)
  - Plugin settings.local.json modifications (temporary, restored via R17 repair)
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
  - ai-maestro-plugins marketplace registered (remote GitHub marketplace —
    hosts the core `ai-maestro-plugin`; per R20, Claude core is
    remote-only and has no local core marketplace)
  - No pre-existing agent named "scen023-r17-audit-01"
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
author: AI Maestro Team
---

# R17 Exhaustive Surface Audit Scenario

> **Purpose:** R17 protects the core ai-maestro-plugin. SCEN-012 and SCEN-020 already
> cover the happy path (plugin is installed, stays installed). This scenario hunts for
> the corner cases — every surface where a user or agent might try to remove, disable,
> or tamper with the core plugin. Each attempt MUST be blocked or auto-repaired.
>
> **Rule 6 exception:** Phases 4 and 5 perform direct API calls via curl. This is
> allowed here because the scenario is testing that the API itself blocks bad requests —
> state verification by testing the boundary, not bypass. No successful destructive
> action is performed through these calls; the expected outcome is rejection.
>
> **R20 marketplace naming:** The core plugin lives in the remote `ai-maestro-plugins`
> marketplace (GitHub). Per R20, there is NO local core marketplace for Claude — the
> core is remote-only. Local marketplaces are `ai-maestro-local-roles-marketplace`
> (role-plugins, custom + converted) and `ai-maestro-local-custom-marketplace-<client>`
> (non-Claude custom plugins). This scenario exercises the remote-core assumption in
> Phase 5 by attempting to remove the ai-maestro-plugins marketplace.

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state
- **Creates:** nothing
- **Modifies:** git (new commit if needed)
- **Verify:** `git status` shows clean working tree. Screenshot: SCEN-023/S001-git-clean.jpg

#### S002: STATE-WIPE Checkpoint — Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/scen023_<timestamp>/`: `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.aimaestro/governance.json`, `~/.aimaestro/agents/registry.json`
- **Goal:** Pre-test config captured
- **Creates:** Backup directory
- **Modifies:** nothing
- **Verify:** Backup files exist and hash-match originals. Screenshot: SCEN-023/S002-backup.jpg

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, `GET /api/sessions` (Rule 6 verification read)
- **Goal:** Server running with latest build
- **Creates:** nothing
- **Modifies:** PM2 process state
- **Verify:** `/api/sessions` returns 200. Screenshot: SCEN-023/S003-server.jpg

#### S004: Login to dashboard
- **Action:** Navigate to `http://localhost:23000/`, enter `mYkri1-xoxrap-gogtan`, click Sign In
- **Goal:** Authenticated session
- **Creates:** Session cookie
- **Modifies:** nothing
- **Verify:** Dashboard loads. Screenshot: SCEN-023/S004-login.jpg

#### S005: Baseline screenshot
- **Action:** `take_screenshot` of full dashboard
- **Goal:** Baseline for post-test comparison
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved as SCEN-023/S005-baseline.jpg

---

## Phase 1: Create test agent and confirm core plugin installed

#### S006: Open Agent Creation Wizard
- **Action:** Click "+ Create Agent" in the sidebar header
- **Goal:** Wizard modal opens at step 1
- **Creates:** nothing (modal only)
- **Modifies:** UI state
- **Verify:** Wizard visible. Screenshot: SCEN-023/S006-wizard-open.jpg

#### S007: Complete the wizard
- **Action:** Name `scen023-r17-audit-01`, client `claude`, title `AUTONOMOUS` (standalone title — no team required), accept defaults for folder/avatar, click Create
- **Goal:** Agent created and registered
- **Creates:** Agent `scen023-r17-audit-01`, folder `~/agents/scen023-r17-audit-01/`, tmux session, ai-maestro-plugin installed at local scope, ai-maestro-autonomous-agent role-plugin installed at local scope per R9.13
- **Modifies:** Registry, settings.local.json (ai-maestro-plugin enabled + autonomous role-plugin)
- **Verify:** Agent appears in sidebar. `GET /api/agents/<id>` returns the new agent (Rule 6 verification read). Screenshot: SCEN-023/S007-agent-created.jpg

#### S008: Confirm core plugin is installed + enabled
- **Action:** Navigate to Agent Profile → Config tab → Plugins section
- **Goal:** ai-maestro-plugin visible with "core" label and enabled toggle
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Read `~/agents/scen023-r17-audit-01/.claude/settings.local.json` — `"ai-maestro-plugin@ai-maestro-plugins": true`. Screenshot: SCEN-023/S008-plugin-visible.jpg

---

## Phase 2: UI uninstall button must be blocked

#### S009: Attempt UI uninstall
- **Action:** In Profile → Plugins tab, hover over ai-maestro-plugin row. Either the Uninstall button is hidden/disabled, OR click it and observe the rejection.
- **Goal:** The UI prevents uninstall of the core plugin
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Either no Uninstall button rendered, OR an error toast/message appears: "Core plugin cannot be uninstalled (R17)". Screenshot: SCEN-023/S009-ui-uninstall-blocked.jpg

#### S010: Verify plugin is still installed after UI attempt
- **Action:** Read `~/agents/scen023-r17-audit-01/.claude/settings.local.json`
- **Goal:** Plugin still present and enabled
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** File content shows `"ai-maestro-plugin@ai-maestro-plugins": true`. Screenshot: SCEN-023/S010-still-installed.jpg

---

## Phase 3: UI disable toggle must be blocked

#### S011: Attempt UI disable
- **Action:** In Profile → Plugins tab → click the enable/disable toggle on ai-maestro-plugin row
- **Goal:** The disable action is rejected
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Toggle does not flip, OR an error toast appears, OR the toggle is disabled/locked. Screenshot: SCEN-023/S011-disable-blocked.jpg

#### S012: Verify plugin is still enabled after disable attempt
- **Action:** Read `~/agents/scen023-r17-audit-01/.claude/settings.local.json`
- **Goal:** Plugin still `true`
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Same JSON content as S010. Screenshot: SCEN-023/S012-still-enabled.jpg

---

## Phase 4: Direct DELETE API must be blocked (Rule 6 exception)

> **Note:** This phase uses a direct curl call to `DELETE /api/agents/role-plugins/install`.
> This is permitted under Rule 6 because it tests that the API boundary itself rejects
> the request — bypassing the UI IS the test. We never perform a successful destructive
> action; the expected outcome is rejection. The sudo token is obtained fresh via
> `POST /api/auth/sudo-password` with the governance password; the test proves that
> even with a valid sudo token, R17 blocks the call.

#### S013: Direct API uninstall attempt (with fresh sudo token)
- **Action:** First, exchange the governance password for a sudo token via `POST /api/auth/sudo-password -d '{"password":"mYkri1-xoxrap-gogtan"}'`. Capture the returned X-Sudo-Token. Then run `curl -X DELETE 'http://localhost:23000/api/agents/role-plugins/install' -H 'Content-Type: application/json' -H 'X-Sudo-Token: <token>' -d '{"pluginName":"ai-maestro-plugin","agentDir":"~/agents/scen023-r17-audit-01","marketplaceName":"ai-maestro-plugins"}'`
- **Goal:** API rejects with R17 error even with a valid sudo token
- **Creates:** nothing (token consumed on first request is a single-shot per Rule 12)
- **Modifies:** nothing on the target plugin
- **Verify:** Response status is 400 or 403 with an R17-related error message. Screenshot: SCEN-023/S013-api-blocked.jpg

#### S014: Verify plugin still present
- **Action:** Read `~/agents/scen023-r17-audit-01/.claude/settings.local.json`
- **Goal:** Plugin untouched
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Same as S010. Screenshot: SCEN-023/S014-api-still-installed.jpg

---

## Phase 5: Marketplace removal must be blocked

> **Note:** This phase also uses a direct API call via curl for the same reason as Phase 4.
> Per R20, the `ai-maestro-plugins` marketplace is the remote GitHub marketplace that
> hosts the core plugin. DeleteMarketplace pipeline (commit a2f90e0e) must reject its
> removal because it hosts a core R17-protected plugin.

#### S015: Attempt marketplace removal of ai-maestro-plugins (with fresh sudo token)
- **Action:** Exchange password for a fresh sudo token via `POST /api/auth/sudo-password` (the S013 token was consumed). Then run `curl -X DELETE 'http://localhost:23000/api/settings/marketplaces?marketplaceName=ai-maestro-plugins' -H 'X-Sudo-Token: <token>'`
- **Goal:** Marketplace removal is rejected by the DeleteMarketplace pipeline because it hosts a core plugin (R17)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response status is 400 with R17 message (or similar). Screenshot: SCEN-023/S015-marketplace-blocked.jpg

#### S016: Verify marketplace still registered
- **Action:** Run `claude plugin marketplace list` or `GET /api/settings/marketplaces` (Rule 6 verification read)
- **Goal:** ai-maestro-plugins marketplace still in the list
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Marketplace listed. Screenshot: SCEN-023/S016-marketplace-present.jpg

---

## Phase 6: Manual settings edit + restart must be auto-repaired

#### S017: Manually edit settings.local.json to disable plugin
- **Action:** Read `~/agents/scen023-r17-audit-01/.claude/settings.local.json`, change `"ai-maestro-plugin@ai-maestro-plugins": true` to `false`, write back
- **Goal:** Plugin disabled in config file (bypassing any UI/API guards)
- **Creates:** nothing
- **Modifies:** settings.local.json
- **Verify:** File content shows `false`. Screenshot: SCEN-023/S017-manually-disabled.jpg

#### S018: Hibernate the agent via UI
- **Action:** Select scen023-r17-audit-01 in the sidebar, click Hibernate (enter sudo password `mYkri1-xoxrap-gogtan` in the modal when prompted — Rule 12 hibernate is strict for team agents; AUTONOMOUS agents may or may not prompt depending on registry state)
- **Goal:** Agent hibernated
- **Creates:** nothing
- **Modifies:** Agent session status → offline, tmux session killed
- **Verify:** Sidebar shows agent as offline. Screenshot: SCEN-023/S018-hibernated.jpg

#### S019: Wake the agent via UI (triggers wake-gate R17)
- **Action:** Click Wake on scen023-r17-audit-01 (enter sudo password if prompted)
- **Goal:** Wake-gate R17 detects disabled core plugin and re-enables before session creation
- **Creates:** New tmux session
- **Modifies:** Agent session status → online, settings.local.json (plugin re-enabled)
- **Verify:** Agent online. Read settings.local.json — plugin back to `true`. PM2 logs show `[Wake] R17:` repair. Screenshot: SCEN-023/S019-wake-repaired.jpg

---

## Phase 7: File deletion + wake must be auto-repaired

#### S020: Remove plugin entry entirely from settings
- **Action:** Read settings.local.json, remove the `ai-maestro-plugin@ai-maestro-plugins` key, write back
- **Goal:** Plugin entry absent from config (simulates user editing by hand)
- **Creates:** nothing
- **Modifies:** settings.local.json (key removed)
- **Verify:** File content has no ai-maestro-plugin key. Screenshot: SCEN-023/S020-entry-removed.jpg

#### S021: Hibernate + wake to trigger repair
- **Action:** Hibernate then Wake the agent via UI (sudo password `mYkri1-xoxrap-gogtan` when prompted)
- **Goal:** Wake-gate R17 detects missing plugin and reinstalls
- **Creates:** settings.local.json plugin entry (reinstalled)
- **Modifies:** Agent session status, settings.local.json (plugin reinstalled)
- **Verify:** Read settings.local.json — plugin key back and `true`. PM2 logs show `[Wake] R17:` reinstall. Screenshot: SCEN-023/S021-reinstalled.jpg

---

## Phase CLEANUP: Restore Original State

#### S022: Delete the test agent via UI
- **Action:** Profile → Advanced → Danger Zone → Delete Agent. Check "Also delete agent folder". Type `scen023-r17-audit-01`. Click "Delete Forever". When the sudo password modal appears (DELETE /api/agents/[id] is strict), enter sudo password `mYkri1-xoxrap-gogtan` and Confirm.
- **Goal:** Agent removed from registry, folder deleted, tmux session killed
- **Removes:** Agent from registry, `~/agents/scen023-r17-audit-01/`, tmux session
- **Verify:** Agent no longer in sidebar. Folder does not exist. Screenshot: SCEN-023/S022-deleted.jpg

#### S023: Purge cemetery entry
- **Action:** Settings → Cemetery → find scen023-r17-audit-01 → click Purge → enter sudo password `mYkri1-xoxrap-gogtan` when prompted
- **Goal:** Cemetery entry removed
- **Removes:** Cemetery archive entry
- **Verify:** Entry not listed. Screenshot: SCEN-023/S023-cemetery-purged.jpg

#### S024: STATE-WIPE — Restore configuration files
- **Action:** Compare current config files with backups from S002. Restore settings.json / settings.local.json / governance.json if they differ (do NOT restore registry.json — UI delete already cleaned it).
- **Goal:** All side-effect-modified config files match pre-test state
- **Removes:** nothing
- **Verify:** File hash comparison — all match. Screenshot: SCEN-023/S024-state-restored.jpg

#### S025: Post-test screenshot
- **Action:** `take_screenshot` of full dashboard
- **Goal:** UI identical to Phase 0 baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual comparison with S005 baseline. Screenshot: SCEN-023/S025-post-test.jpg
