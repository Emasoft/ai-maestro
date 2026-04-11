---
number: 20
name: Core plugins are unchangeable (R17 + title-locked role-plugins)
version: "1.0"
description: >
  The user creates a test agent with a governance title (e.g. MEMBER), then
  verifies that (a) the core `ai-maestro-plugin` cannot be uninstalled
  from the agent's local scope — both the UI shows a disabled state with a
  "core" badge AND the API rejects uninstall attempts with a 403/409;
  (b) the role-plugin assigned by the title cannot be uninstalled directly —
  the user must first change the title, which triggers ChangeTitle Gate 15
  to swap the plugin. Attempts to bypass via direct API DELETE must fail.
client: claude
interhosts: false
device: desktop
subsystems:
  - element-management-service (R17 enforcement in ChangePlugin Gate 7)
  - element-management-service (ChangeTitle Gate 15 plugin swap)
  - plugin-storage-service (role-plugin lookup + install/uninstall)
  - /api/agents/role-plugins/install (DELETE endpoint)
  - PluginsTab.tsx (UI rendering of core + role badges)
ui_sections:
  - Login page
  - Sidebar → Create Agent (wizard)
  - Agent Profile → Config → Plugins section
  - Plugin cards with core / role / uninstall badges
  - Role Plugin modal (change role-plugin)
data_produced:
  - 1 test agent (temporary, deleted during cleanup)
required_tools:
  - mcp__chrome-devtools__navigate_page
  - mcp__chrome-devtools__take_snapshot
  - mcp__chrome-devtools__take_screenshot
  - mcp__chrome-devtools__click
  - mcp__chrome-devtools__fill
  - mcp__chrome-devtools__wait_for
prerequisites:
  - AI Maestro server running at http://localhost:23000
  - Governance password set + MANAGER exists (needed for title changes)
  - `ai-maestro-plugin` installed at user scope
  - `ai-maestro-programmer-agent` role-plugin available in local marketplace
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
---

## Phase 0: SAFE-SETUP

### S001: Server health + state backup
- **Action:** `curl http://localhost:23000/api/v1/health`; backup
  `~/.aimaestro/agents/registry.json`, `~/.aimaestro/governance.json`,
  `~/.aimaestro/teams/teams.json` to
  `tests/scenarios/state-backups/SCEN-020_<timestamp>/`.
- **Goal:** Pre-test state captured.
- **Verify:** Health OK, backups exist.

### S002: Login
- **Action:** Navigate to `/`, enter password, click Login.
- **Goal:** Session established.
- **Verify:** Dashboard loads.

---

## Phase 1: Create test agent with MEMBER title

### S003: Open Agent Creation Wizard
- **Action:** Click the "+" button in the sidebar → "Create Agent".
- **Goal:** Wizard opens.
- **Verify:** Step 1 visible.

### S004: Fill wizard with a MEMBER-titled agent
- **Action:** Set name `scen020-member-test`, client `claude`, title
  `MEMBER`, role-plugin `ai-maestro-programmer-agent`. Complete the wizard.
- **Goal:** Agent created with title MEMBER and programmer role-plugin.
- **Creates:** 1 test agent; folder at `~/agents/scen020-member-test/`;
  registry entry; tmux session
- **Verify:** Agent appears in sidebar and Config → Plugins lists both
  `ai-maestro-plugin` (core) and `ai-maestro-programmer-agent` (role).

### S005: Open Agent Profile → Config → Plugins
- **Action:** Click the agent in the sidebar, click Profile, switch to
  Config tab, expand Plugins section.
- **Goal:** Plugin list is visible.
- **Verify:** Screenshot shows the two plugins.

---

## Phase 2: Verify core plugin is unchangeable

### S006: Locate ai-maestro-plugin in the list
- **Action:** Find the row for `ai-maestro-plugin`.
- **Goal:** The row is identifiable.
- **Verify:** Row shows a "core" badge.

### S007: Verify the "core" badge replaces the uninstall button
- **Action:** Inspect the row via `take_snapshot`.
- **Goal:** The row does NOT have an Uninstall (XCircle) button; only the
  "core" label is rendered.
- **Verify:** Snapshot text confirms "core" exists and no Trash icon.

### S008: Attempt backend bypass — DELETE the plugin via API
- **Action:** `curl -b "aim_session=<cookie>" -X DELETE
  http://localhost:23000/api/agents/role-plugins/install -H
  "Content-Type: application/json" -d '{"pluginName":"ai-maestro-plugin",
  "agentDir":"/Users/emanuelesabetta/agents/scen020-member-test"}'`
- **Goal:** Server rejects with 403 or 409 and the plugin remains installed.
- **Verify:** HTTP status is non-2xx; `ls
  ~/agents/scen020-member-test/.claude/settings.local.json` still shows
  ai-maestro-plugin in the plugins array.

---

## Phase 3: Verify role-plugin is title-locked

### S009: Locate ai-maestro-programmer-agent row
- **Action:** Find the role-plugin row.
- **Goal:** Row identified.
- **Verify:** Row has a "role" badge.

### S010: Verify no uninstall button for the role-plugin row
- **Action:** Inspect row snapshot.
- **Goal:** UI hides the uninstall button when the plugin equals the
  agent's current role-plugin.
- **Verify:** No Trash icon in the row.

### S011: Attempt API bypass — DELETE the role-plugin
- **Action:** `curl` DELETE against role-plugins/install for
  `ai-maestro-programmer-agent`.
- **Goal:** Server rejects because the plugin is tied to the agent's
  current title.
- **Verify:** HTTP non-2xx; the plugin is still installed in the agent
  directory.

### S012: Verify proper path — Change Title to AUTONOMOUS
- **Action:** Open the title selector in Profile → Overview, pick
  `AUTONOMOUS`, confirm with governance password.
- **Goal:** ChangeTitle Gate 15 removes the old role-plugin (AUTONOMOUS has
  no required role-plugin).
- **Verify:** After reload, Plugins list no longer contains
  `ai-maestro-programmer-agent`; core `ai-maestro-plugin` still present.

### S013: Revert title to MEMBER (for cleanup symmetry)
- **Action:** Change title back to MEMBER + pick programmer role-plugin.
- **Goal:** Gate 15 re-installs the role-plugin.
- **Verify:** Plugins list now shows both plugins again.

---

## Phase 4: CLEANUP

### S014: Delete the test agent
- **Action:** Profile → Advanced → Danger Zone → Delete Agent. Enter
  sudo password. Check "Also delete agent folder". Type agent name. Click
  Delete Forever.
- **Removes:** The test agent + its folder + tmux session
- **Verify:** Agent no longer in sidebar; registry, folder, session all
  gone.

### S015: Purge cemetery entry
- **Action:** Settings → Cemetery tab → Purge row for `scen020-member-test`.
- **Removes:** Cemetery record
- **Verify:** Cemetery list no longer shows the entry.

### S016: STATE-WIPE restore
- **Action:** Compare config files with S001 backups. Restore any that
  differ (only settings files should be restored; registry/teams are
  already cleaned by UI delete).
- **Verify:** Files match byte-for-byte.

### S017: Post-test screenshot
- **Action:** Take screenshot of the dashboard.
- **Goal:** UI matches pre-test baseline.
- **Verify:** Visual comparison.
