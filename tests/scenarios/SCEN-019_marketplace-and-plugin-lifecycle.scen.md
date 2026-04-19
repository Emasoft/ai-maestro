---
number: 19
name: Marketplace registration + plugin install/uninstall + enable/disable
version: "1.1"
description: >
  The user logs in, opens Settings → Plugins Explorer → Marketplaces tab,
  registers a new marketplace from a GitHub URL, verifies it appears in the
  list, expands it to browse plugins, installs one plugin at user scope,
  enables and disables it, uninstalls it, then removes the marketplace.
  The scenario also verifies filter-as-you-type search works on both the
  marketplace list and the plugin list, and that Cancel/Clear correctly
  resets the filter. Additionally verifies the add / remove actions route
  through the CreateMarketplace / DeleteMarketplace pipelines (commit
  a2f90e0e) rather than bypassing them.
client: claude
interhosts: false
device: desktop
subsystems:
  - MarketplaceManager (Settings → Plugins Explorer → Marketplaces subtab)
  - GlobalElementsSection (Plugins Explorer UI)
  - /api/settings/marketplaces (list + CreateMarketplace / DeleteMarketplace routing)
  - /api/settings/global-plugins (install/uninstall/enable/disable)
  - element-management-service (CreateMarketplace / DeleteMarketplace pipelines)
  - Claude CLI plugin marketplace add/remove/update
ui_sections:
  - Login page
  - Settings → Plugins Explorer → Marketplaces subtab
  - Settings → Plugins Explorer → Plugins subtab
  - Filter inputs at top of each list (filter-as-you-type)
  - Marketplace card expand/collapse
  - Plugin card with install/uninstall/enable/disable buttons
  - Sudo password modal (Rule 12)
data_produced:
  - 1 test marketplace registered (temporary, removed during cleanup)
  - 1 test plugin installed at user scope (temporary, uninstalled during cleanup)
  - Claude CLI ~/.claude/settings.json modifications (restored via STATE-WIPE)
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
  - Chrome browser with DevTools accessible
  - Internet access for cloning marketplace from GitHub
  - `which gh && gh auth status` succeeds
  - Marketplace used for testing: https://github.com/cblecker/claude-plugins
governance_password: "mYkri1-xoxrap-gogtan"
rewipe-list:
  - ~/.aimaestro/governance.json
  - ~/.aimaestro/agents/registry.json
  - ~/.aimaestro/teams/teams.json
  - ~/.aimaestro/teams/groups.json
git-fixtures: []
dir-fixtures: []
commit: TBD
---

## Phase 0: SAFE-SETUP

### S001: Commit pre-test state and verify server health
- **Action:** `curl -s http://localhost:23000/api/v1/health` and
  `pm2 list | grep ai-maestro` — confirm server is running. (Rule 6
  state-verification read only.)
- **Goal:** Server healthy and listening.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Health endpoint returns `{"status":"healthy"}`.

### S002: STATE-WIPE backup
- **Action:** Copy `~/.claude/settings.json`,
  `~/.claude/settings.local.json`, `~/.aimaestro/governance.json` to
  `tests/scenarios/state-backups/SCEN-019_<timestamp>/`.
- **Goal:** Pre-test state captured so CLEANUP can restore it.
- **Creates:** state-backups directory for this run
- **Modifies:** nothing
- **Verify:** All 3 files exist in the backup dir with non-zero size.

### S003: Navigate to login + authenticate
- **Action:** `navigate_page` to `http://localhost:23000/`, enter governance
  password `mYkri1-xoxrap-gogtan`, click Login.
- **Goal:** Dashboard loads with the logged-in user.
- **Creates:** `aim_session` cookie
- **Modifies:** in-memory session map
- **Verify:** Screenshot shows the dashboard with sidebar visible.

---

## Phase 1: Navigate to Marketplaces tab

### S004: Open Settings
- **Action:** Click "Settings" in the dashboard top bar (or navigate to
  `/settings`).
- **Goal:** Settings page loads with sidebar nav.
- **Creates:** nothing
- **Modifies:** URL
- **Verify:** Screenshot shows the settings sidebar with Plugins entry.

### S005: Open Plugins Explorer
- **Action:** Click "Plugins" in the settings sidebar.
- **Goal:** GlobalElementsSection loads with Plugins / Marketplaces / Elements
  subtabs.
- **Creates:** nothing
- **Modifies:** activeSection state
- **Verify:** Three subtab buttons are visible.

### S006: Switch to Marketplaces subtab
- **Action:** Click the "Marketplaces" subtab.
- **Goal:** MarketplaceManager renders with registered marketplace list.
- **Creates:** nothing
- **Modifies:** subtab state
- **Verify:** Screenshot shows at least 1 marketplace card
  (`ai-maestro-plugins` should be present from prior state).

### S007: Verify filter-as-you-type works on marketplace list
- **Action:** In the marketplace search box type "ai-maestro", then clear
  it with the ✕ button.
- **Goal:** The list filters live as the user types and resets when cleared.
- **Creates:** nothing
- **Modifies:** filter state
- **Verify:** Typing reduces visible cards; clearing restores the full list.

---

## Phase 2: Register a new marketplace (via CreateMarketplace pipeline)

### S008: Open Add Marketplace form
- **Action:** Click the "Add Marketplace" button at the top of
  MarketplaceManager.
- **Goal:** URL input + submit button appear.
- **Creates:** nothing
- **Modifies:** UI state
- **Verify:** The form is visible.

### S009: Paste test marketplace URL
- **Action:** `fill` the URL input with
  `https://github.com/cblecker/claude-plugins`.
- **Goal:** URL is in the input ready to submit.
- **Creates:** nothing
- **Modifies:** form state
- **Verify:** Input value matches.

### S010: Submit the add-marketplace request (routes through CreateMarketplace pipeline)
- **Action:** Click "Add".
- **Goal:** The marketplace is added via Claude CLI and appears in the list.
  Per commit a2f90e0e, `POST /api/settings/marketplaces` now routes through
  the `CreateMarketplace` pipeline in element-management-service (not a
  direct CLI call), ensuring the pipeline's gates (name validation,
  duplicate detection, cache setup) are enforced.
- **Creates:** `claude-plugins` marketplace registered globally via
  CreateMarketplace pipeline
- **Modifies:** `~/.claude/settings.json` `extraKnownMarketplaces`, CLI
  cache under `~/.claude/plugins/cache/cblecker-claude-plugins/`
- **Verify:** Wait for the new card to appear (may take a few seconds while
  the CLI clones the repo). Screenshot. Verify PM2 logs show a
  `CreateMarketplace` pipeline invocation (e.g. `[CreateMarketplace] G*`
  gate entries) and NOT a direct `claude plugin marketplace add` without
  the pipeline wrapper.

### S011: Expand the new marketplace card
- **Action:** Click the card for `claude-plugins`.
- **Goal:** Card expands, showing the list of plugins inside.
- **Creates:** nothing
- **Modifies:** expandedMkt state
- **Verify:** Plugin list rendered with at least one entry.

---

## Phase 3: Install a plugin at user scope

### S012: Install the `github` plugin
- **Action:** Find the `github` plugin card in the expanded marketplace card.
  Click its "Install" button. The marketplace as of 2026-04 exposes 3 plugins:
  `git`, `github`, `gws`. We pick `github` because it is the smallest and has
  no external runtime dependency (unlike `gws` which needs a Go workspace).
- **Goal:** Plugin installs at user scope via Claude CLI.
- **Creates:** Plugin cache under `~/.claude/plugins/cache/cblecker-claude-plugins/github/`
- **Modifies:** `~/.claude/settings.json` `plugins` field (adds `github@claude-plugins` key)
- **Verify:** Plugin card shows an "Installed" badge and the Install button
  is replaced with Uninstall + Disable.

### S013: Verify it appears in the Plugins subtab
- **Action:** Switch to the Plugins subtab.
- **Goal:** The newly installed plugin is listed.
- **Creates:** nothing
- **Modifies:** subtab state
- **Verify:** Plugin name appears in the list; filter-as-you-type finds it
  by name.

### S014: Verify scope is USER (not local)
- **Action:** For each currently-running agent in the dashboard, open its
  Agent Profile → Config → Plugins section and verify the newly-installed
  plugin does NOT appear there.
- **Goal:** User-scope install does NOT affect agents' local scope.
  This is the critical invariant — scope isolation.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Agent's local plugin list does NOT contain the new plugin.

---

## Phase 4: Disable and re-enable

### S015: Click Disable on the installed plugin
- **Action:** Back on the Plugins subtab, click the plugin's "Disable"
  toggle.
- **Goal:** Plugin is marked disabled in settings.json.
- **Creates:** nothing
- **Modifies:** `plugins.<key>.enabled` → false
- **Verify:** Toggle state is off, plugin shows "disabled" badge.

### S016: Re-enable the plugin
- **Action:** Click the toggle again.
- **Goal:** Plugin is re-enabled.
- **Creates:** nothing
- **Modifies:** `plugins.<key>.enabled` → true
- **Verify:** Toggle state is on.

---

## Phase 5: CLEANUP

### S017: Uninstall the test plugin (Rule 12 sudo password)
- **Action:** Click Uninstall on the test plugin. When the sudo password
  modal appears (Rule 12 — DELETE /api/agents/role-plugins/install is
  classified strict), enter governance password `mYkri1-xoxrap-gogtan`
  and click Confirm. Then confirm the uninstall dialog.
- **Goal:** Plugin removed from user settings + cache cleaned.
- **Removes:** The installed plugin
- **Verify:** Plugin no longer appears in the Plugins subtab list. The
  sudo modal appeared exactly once before the uninstall proceeded.

### S018: Remove the test marketplace (Rule 12 sudo password + DeleteMarketplace pipeline)
- **Action:** Switch to Marketplaces subtab. Click Remove on the
  `claude-plugins` marketplace card. When the sudo password modal
  appears (Rule 12 — DELETE /api/settings/marketplaces is classified
  strict), enter governance password `mYkri1-xoxrap-gogtan` and click
  Confirm. Then confirm the removal dialog.
- **Goal:** Marketplace unregistered from Claude CLI + cache removed.
  Per commit a2f90e0e, `DELETE /api/settings/marketplaces` now routes
  through the `DeleteMarketplace` pipeline in element-management-service,
  enforcing pre-checks (e.g. refuse to remove a marketplace that hosts a
  core R17 plugin — this test marketplace does NOT host a core plugin,
  so removal should succeed).
- **Removes:** The registered marketplace
- **Verify:** Card no longer appears; `~/.claude/settings.json` no longer
  references `claude-plugins` in `extraKnownMarketplaces`. The sudo
  modal appeared exactly once. PM2 logs show a `DeleteMarketplace`
  pipeline invocation.

### S019: STATE-WIPE — Restore configuration files
- **Action:** Compare current config files with backups from S002. Restore
  any that still differ after the UI cleanup.
- **Goal:** All config files match pre-test state byte-for-byte.
- **Removes:** nothing
- **Verify:** File hash comparison.

### S020: Post-test screenshot
- **Action:** Navigate to Settings → Plugins → Marketplaces and take a
  screenshot.
- **Goal:** UI is identical to the Phase 0 baseline (no test marketplace,
  no test plugin).
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual comparison with baseline screenshot from S006.
