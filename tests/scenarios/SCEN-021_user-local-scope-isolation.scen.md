---
number: 21
name: User-scope vs local-scope isolation (bidirectional)
version: "1.1"
description: >
  Verifies the strict scope invariant: elements installed at `--scope user`
  from Settings affect ALL agents on the host (global) but do NOT appear in
  any agent's local config listing. Conversely, elements installed at
  `--scope local` from Agent Profile → Config affect ONLY the target agent
  and do NOT appear in Settings → Plugins Explorer (which lists user scope).
  Disabling a user-scope plugin must NOT affect any local-scope install of
  the same plugin; disabling a local-scope plugin must NOT affect the
  user-scope install. Two test AUTONOMOUS agents are created to verify
  per-agent independence as well. AUTONOMOUS is used because it is a
  standalone title (no team required, avoids ChangeTitle Gate 9 blocker
  that MEMBER without team would hit).
client: claude
interhosts: false
device: desktop
subsystems:
  - MarketplaceManager (Settings) — user-scope install
  - MarketplacesTab.tsx (Agent Profile → Config) — local-scope install
  - PluginsTab.tsx (local-scope enumeration)
  - GlobalElementsSection (user-scope enumeration)
  - /api/settings/global-plugins (user scope)
  - /api/agents/role-plugins/install (local scope, scope="local")
  - agent-local-config-service (scanAgentLocalConfig for local list)
ui_sections:
  - Settings → Plugins Explorer → Plugins subtab
  - Settings → Plugins Explorer → Marketplaces subtab
  - Agent Profile → Config → Plugins section
  - Agent Profile → Config → Marketplaces section
  - Filter inputs on each list
  - Sudo password modal (Rule 12)
data_produced:
  - 2 test agents, "scen021-alpha" and "scen021-beta" (temporary)
  - 1 test plugin installed at user scope then at local scope
    (temporary, removed during cleanup)
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
  - ai-maestro-plugins marketplace registered
  - At least one role-plugin available (e.g. ai-maestro-autonomous-agent)
  - A small, non-destructive test plugin available in some marketplace.
    Suggested: `rechecker-plugin` or any minor utility plugin. The exact
    plugin name is recorded in the scenario report.
governance_password: "mYkri1-xoxrap-gogtan"
rewipe-list:
  - ~/.claude/settings.json
  - ~/.claude/settings.local.json
  - ~/.aimaestro/governance.json
  - ~/.aimaestro/agents/registry.json
  - ~/.aimaestro/teams/teams.json
  - ~/.aimaestro/teams/groups.json
git-fixtures: []
dir-fixtures: []
commit: TBD
---

## Phase 0: SAFE-SETUP

### S001: Server health + backup
- **Action:** `curl /api/v1/health` (Rule 6 state-verification read);
  backup `~/.claude/settings.json`, `~/.claude/settings.local.json`,
  `~/.aimaestro/agents/registry.json`, `~/.aimaestro/governance.json` to
  `tests/scenarios/state-backups/SCEN-021_<timestamp>/`.
- **Goal:** Pre-test state captured.
- **Creates:** backup directory
- **Modifies:** nothing
- **Verify:** Health OK; backups exist.

### S002: Login
- **Action:** Navigate to `/`; enter password `mYkri1-xoxrap-gogtan`; click
  Login.
- **Goal:** Session established.
- **Creates:** session cookie
- **Modifies:** nothing
- **Verify:** Dashboard loads.

---

## Phase 1: Create two test agents

### S003: Create scen021-alpha (claude, AUTONOMOUS)
- **Action:** Sidebar + → Create Agent → fill `scen021-alpha`, client
  `claude`, title `AUTONOMOUS` (standalone title — no team required,
  avoids MEMBER + no team failure at ChangeTitle Gate 9). Role-plugin
  auto-resolves to `ai-maestro-autonomous-agent` per R9.13. Finish
  wizard.
- **Goal:** Agent alpha created.
- **Creates:** test agent alpha; folder `~/agents/scen021-alpha/`;
  registry entry; tmux session
- **Modifies:** registry.json
- **Verify:** Sidebar card present; `~/agents/scen021-alpha/` exists.

### S004: Create scen021-beta (claude, AUTONOMOUS)
- **Action:** Same flow as S003, name `scen021-beta`, title AUTONOMOUS.
- **Goal:** Second agent created.
- **Creates:** test agent beta; folder; registry entry; tmux session
- **Modifies:** registry.json
- **Verify:** Both agents visible in sidebar.

---

## Phase 2: User-scope install — must NOT appear in local scopes

### S005: Open Settings → Plugins → Marketplaces
- **Action:** Navigate to Settings → Plugins → Marketplaces subtab.
- **Goal:** Marketplace list visible.
- **Creates:** nothing
- **Modifies:** URL
- **Verify:** `ai-maestro-plugins` marketplace card present.

### S006: Install a test plugin at USER scope
- **Action:** Expand `ai-maestro-plugins`, pick a small non-critical plugin
  (e.g. `rechecker-plugin`), click Install (default is user scope).
- **Goal:** Plugin installed at `~/.claude/plugins/cache/...` and listed
  in `~/.claude/settings.json` `plugins` field.
- **Creates:** User-scope plugin install
- **Modifies:** `~/.claude/settings.json`
- **Verify:** Plugin card shows "Installed" at user scope.

### S007: Verify it shows up in Settings → Plugins subtab
- **Action:** Switch to Plugins subtab.
- **Goal:** The installed plugin is listed with "user scope" badge.
- **Creates:** nothing
- **Modifies:** subtab state
- **Verify:** Row present; filter-as-you-type finds it by name.

### S008: Verify it is NOT in scen021-alpha's local config
- **Action:** Go back to dashboard, click `scen021-alpha`, open Profile →
  Config → Plugins section.
- **Goal:** The user-scope plugin is NOT listed in the agent's local
  plugin list — PluginsTab enumerates only plugins installed into the
  agent's `.claude/settings.local.json`.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Filter the list by the plugin name — no match.

### S009: Verify it is NOT in scen021-beta's local config either
- **Action:** Same check on the second agent (click scen021-beta →
  Profile → Config → Plugins).
- **Goal:** Scope isolation proven — user install does not leak into any
  agent's local scope.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** No match in beta's local plugin list.

---

## Phase 3: Local-scope install — must NOT affect user scope or other agents

### S010: Open scen021-alpha → Config → Marketplaces section
- **Action:** Expand the Marketplaces accordion in the Config tab.
- **Goal:** MarketplacesTab visible with read-only list.
- **Creates:** nothing
- **Modifies:** UI state
- **Verify:** Marketplace list rendered (same marketplaces as Settings).

### S011: Install a DIFFERENT test plugin at LOCAL scope
- **Action:** Pick another small plugin from the same marketplace (not the
  one from S006). Click Install — this calls
  `/api/agents/role-plugins/install` with `scope: 'local'`.
- **Goal:** Plugin installed only into alpha's
  `.claude/settings.local.json`.
- **Creates:** Local-scope plugin install in scen021-alpha
- **Modifies:** `~/agents/scen021-alpha/.claude/settings.local.json`
- **Verify:** The row in the Plugins section now shows the new plugin.

### S012: Verify scen021-beta does NOT have the local plugin
- **Action:** Open scen021-beta → Config → Plugins.
- **Goal:** Per-agent local scope isolation.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** The new plugin is NOT listed.

### S013: Verify user-scope Plugins subtab does NOT show the local install
- **Action:** Settings → Plugins subtab.
- **Goal:** Local install never leaks into the user-scope listing.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Filter by the new plugin's name — no match.

---

## Phase 4: Enable/disable state is per-scope

### S014: Disable the user-scope plugin in Settings
- **Action:** Settings → Plugins → toggle off the plugin installed in S006.
- **Goal:** User-scope enabled=false.
- **Creates:** nothing
- **Modifies:** `~/.claude/settings.json`
- **Verify:** Toggle state; `~/.claude/settings.json` updated.

### S015: Verify local-scope plugin state unchanged
- **Action:** Open alpha → Config → Plugins — the local-scope plugin must
  still be enabled.
- **Goal:** Per-scope enable flags are independent.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Local plugin shows enabled state.

### S016: Re-enable user-scope plugin
- **Action:** Settings → Plugins → toggle back on.
- **Goal:** State restored.
- **Creates:** nothing
- **Modifies:** `~/.claude/settings.json`
- **Verify:** Toggle state is on.

---

## Phase 5: CLEANUP

### S017: Uninstall local-scope plugin from scen021-alpha (Rule 12 sudo)
- **Action:** Alpha → Config → Plugins → click X on the local plugin.
  Confirm dialog. When the sudo password modal appears (DELETE
  /api/agents/role-plugins/install is strict), enter governance
  password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Removes:** local-scope install from scen021-alpha
- **Verify:** Plugin no longer listed; sudo modal appeared once.

### S018: Uninstall user-scope plugin from Settings (Rule 12 sudo)
- **Action:** Settings → Plugins → Uninstall the user-scope plugin.
  When the sudo password modal appears, enter governance password
  `mYkri1-xoxrap-gogtan` and Confirm.
- **Removes:** user-scope install
- **Verify:** Plugin no longer in the user list; sudo modal appeared.

### S019: Delete scen021-alpha (Rule 12 sudo)
- **Action:** Profile → Advanced → Delete Agent (check "Also delete agent
  folder" checkbox, type `scen021-alpha`). When the sudo password
  modal appears, enter governance password `mYkri1-xoxrap-gogtan` and
  Confirm.
- **Removes:** Agent alpha + folder + tmux session
- **Verify:** Not in sidebar; sudo modal appeared.

### S020: Delete scen021-beta (Rule 12 sudo)
- **Action:** Same flow as S019 (type `scen021-beta`, enter sudo
  password `mYkri1-xoxrap-gogtan` when prompted).
- **Removes:** Agent beta + folder + tmux session
- **Verify:** Not in sidebar; sudo modal appeared.

### S021: Purge cemetery entries for both agents
- **Action:** Settings → Cemetery → purge each row (enter sudo password
  when prompted).
- **Removes:** Cemetery records
- **Verify:** Cemetery list empty of test agents.

### S022: STATE-WIPE restore
- **Action:** Compare backups with current state; restore settings files
  that still differ.
- **Goal:** Config files match pre-test state.
- **Removes:** nothing
- **Verify:** File hashes match.

### S023: Post-test screenshot
- **Action:** Dashboard screenshot.
- **Goal:** UI identical to pre-test baseline.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual match.
