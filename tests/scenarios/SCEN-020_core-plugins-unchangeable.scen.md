---
number: 20
name: Core plugins are unchangeable (R17 + title-locked role-plugins)
version: "1.1"
description: >
  The user creates a test AUTONOMOUS agent, then verifies that (a) the core
  `ai-maestro-plugin` cannot be uninstalled from the agent's local scope —
  the UI shows a disabled state with a "core" badge and no Uninstall
  button; (b) the role-plugin assigned by the title cannot be uninstalled
  directly from the UI — the user must first change the title, which
  triggers ChangeTitle Gate 15 to swap the plugin. All destructive
  attempts are driven through the UI per Rule 6; the only API calls are
  GET requests for state verification, which Rule 6 explicitly permits.
  AUTONOMOUS is chosen as the starting title because it is a standalone
  title (no team required, unlike MEMBER which would fail at ChangeTitle
  Gate 9 without team context).
client: claude
interhosts: false
device: desktop
subsystems:
  - element-management-service (R17 enforcement in ChangePlugin Gate 7)
  - element-management-service (ChangeTitle Gate 15 plugin swap)
  - plugin-storage-service (role-plugin lookup + install/uninstall)
  - PluginsTab.tsx (UI rendering of core + role badges)
ui_sections:
  - Login page
  - Sidebar → Create Agent (wizard)
  - Agent Profile → Config → Plugins section
  - Plugin cards with core / role / uninstall badges
  - Title Assignment Dialog (radio cards, password prompt)
  - Sudo password modal (Rule 12)
data_produced:
  - 1 test agent "scen020-autonomous-test" (temporary, deleted during cleanup)
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
  - "ai-maestro-plugin installed at local scope in each agent's workdir (core, per R17.17 — never user scope)"
  - "ai-maestro-autonomous-agent role-plugin available in local marketplace"
  - "MAINTAINER role-plugin available as an optional title for step S012 (per R19, MAINTAINER must be picker-visible)"
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

### S001: Server health + state backup
- **Action:** `curl http://localhost:23000/api/v1/health` (Rule 6
  state-verification read); backup
  `~/.aimaestro/agents/registry.json`, `~/.aimaestro/governance.json`,
  `~/.aimaestro/teams/teams.json` to
  `tests/scenarios/state-backups/SCEN-020_<timestamp>/`.
- **Goal:** Pre-test state captured.
- **Creates:** backup directory
- **Modifies:** nothing
- **Verify:** Health OK, backups exist.

### S002: Login
- **Action:** Navigate to `/`, enter password `mYkri1-xoxrap-gogtan`,
  click Login.
- **Goal:** Session established.
- **Creates:** session cookie
- **Modifies:** nothing
- **Verify:** Dashboard loads.

---

## Phase 1: Create test agent with AUTONOMOUS title

### S003: Open Agent Creation Wizard
- **Action:** Click the "+" button in the sidebar → "Create Agent".
- **Goal:** Wizard opens.
- **Creates:** nothing (modal only)
- **Modifies:** UI state
- **Verify:** Step 1 visible.

### S004: Fill wizard with an AUTONOMOUS-titled agent
- **Action:** Set name `scen020-autonomous-test`, client `claude`, title
  `AUTONOMOUS` (standalone title — no team required, avoids ChangeTitle
  Gate 9 team-membership requirement that would block MEMBER without a
  team). The wizard auto-resolves the mandatory role-plugin to
  `ai-maestro-autonomous-agent` per R9.13. Complete the wizard.
- **Goal:** Agent created with title AUTONOMOUS and the mandatory
  `ai-maestro-autonomous-agent` role-plugin installed at --scope local.
- **Creates:** 1 test agent; folder at `~/agents/scen020-autonomous-test/`;
  registry entry; tmux session
- **Modifies:** registry.json (new agent row),
  `~/agents/scen020-autonomous-test/.claude/settings.local.json`
- **Verify:** Agent appears in sidebar. Config → Plugins lists both
  `ai-maestro-plugin` (core badge) and `ai-maestro-autonomous-agent`
  (role badge).

### S005: Open Agent Profile → Config → Plugins
- **Action:** Click the agent in the sidebar, click Profile, switch to
  Config tab, expand Plugins section.
- **Goal:** Plugin list is visible.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot shows the two plugins — core + role.

---

## Phase 2: Verify core plugin is unchangeable (UI only)

### S006: Locate ai-maestro-plugin in the list
- **Action:** Find the row for `ai-maestro-plugin`.
- **Goal:** The row is identifiable.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Row shows a "core" badge.

### S007: Verify the "core" badge replaces the uninstall button
- **Action:** Inspect the row via `take_snapshot`.
- **Goal:** The row does NOT have an Uninstall (XCircle / Trash) button;
  only the "core" label is rendered. This is the UI enforcement of R17.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot text confirms "core" exists and no Trash icon or
  Uninstall button is present on the `ai-maestro-plugin` row.

### S008: Confirm core plugin is still installed (state-verification read)
- **Action:** Read `~/agents/scen020-autonomous-test/.claude/settings.local.json`
  (Rule 6 state-verification read only, after the UI inspection in S007
  — no bypass action is performed).
- **Goal:** Verify that even with no uninstall UI affordance, the core
  plugin remains enabled in the agent's local settings file. Any attempt
  to bypass via direct API DELETE is blocked by ChangePlugin Gate 7
  (R17 enforcement); this is covered exhaustively in SCEN-023 Phase 4
  which documents that API-boundary test as a Rule 6 exception.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** File content includes
  `"ai-maestro-plugin@ai-maestro-plugins": true`.

---

## Phase 3: Verify role-plugin is title-locked (UI only)

### S009: Locate ai-maestro-autonomous-agent row
- **Action:** Find the role-plugin row in the Plugins section.
- **Goal:** Row identified.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Row has a "role" badge (green) indicating it's the agent's
  current role-plugin.

### S010: Verify no uninstall button for the role-plugin row
- **Action:** Inspect the role-plugin row via `take_snapshot`.
- **Goal:** The UI hides the uninstall button when the plugin equals the
  agent's current role-plugin — removal must go through ChangeTitle
  Gate 15, not direct uninstall.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** No Trash / Uninstall icon in the role-plugin row; only the
  "role" badge is rendered. Screenshot.

### S011: Confirm role-plugin is installed (state-verification read)
- **Action:** Read
  `~/agents/scen020-autonomous-test/.claude/settings.local.json` (Rule 6
  read only).
- **Goal:** Confirm the role-plugin is still installed in local scope
  after the UI inspection.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** File content includes a
  `"ai-maestro-autonomous-agent@..."` key set to `true`.

### S012: Change Title via UI — swap to MAINTAINER (proper path)
- **Action:** Open the title selector in Profile → Overview, click the
  current AUTONOMOUS badge. Verify the Title Assignment Dialog shows
  the full set of picker-visible titles: AUTONOMOUS, MAINTAINER,
  MANAGER, ARCHITECT, ORCHESTRATOR, INTEGRATOR, CHIEF-OF-STAFF, MEMBER.
  Pick `MAINTAINER` (standalone title — no team required, per R19).
  When the sudo password modal appears (Rule 12 — PATCH
  /api/agents/[id]/title is classified strict), enter governance
  password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** ChangeTitle Gate 15 uninstalls the AUTONOMOUS role-plugin
  and installs the MAINTAINER role-plugin (title swap pipeline).
- **Creates:** nothing
- **Modifies:** registry (governanceTitle=maintainer),
  `.claude/settings.local.json` (autonomous role-plugin uninstalled,
  maintainer role-plugin installed)
- **Verify:** After reload, Plugins list no longer contains
  `ai-maestro-autonomous-agent`. It now contains
  `ai-maestro-maintainer-agent` (role badge) alongside the core
  `ai-maestro-plugin`. The sudo modal appeared once.

### S013: Revert title back to AUTONOMOUS (for cleanup symmetry)
- **Action:** Click the MAINTAINER badge → pick AUTONOMOUS → enter sudo
  password `mYkri1-xoxrap-gogtan` → Confirm.
- **Goal:** Gate 15 re-installs the autonomous role-plugin.
- **Creates:** nothing
- **Modifies:** registry (governanceTitle=autonomous),
  `.claude/settings.local.json` (maintainer role-plugin uninstalled,
  autonomous role-plugin installed)
- **Verify:** Plugins list now shows
  `ai-maestro-autonomous-agent` + core `ai-maestro-plugin`. Sudo modal
  appeared once.

---

## Phase 4: CLEANUP

### S014: Delete the test agent (Rule 12 sudo password)
- **Action:** Profile → Advanced → Danger Zone → Delete Agent. Check
  "Also delete agent folder". Type agent name `scen020-autonomous-test`.
  Click Delete Forever. When the sudo password modal appears (DELETE
  /api/agents/[id] is strict), enter governance password
  `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Agent removed.
- **Removes:** Registry entry,
  `~/agents/scen020-autonomous-test/`, tmux session
- **Verify:** Agent no longer in sidebar; registry, folder, session all
  gone. The sudo modal appeared before the delete proceeded.

### S015: Purge cemetery entry
- **Action:** Settings → Cemetery tab → find the
  `scen020-autonomous-test` row → click Purge → enter sudo password
  `mYkri1-xoxrap-gogtan` when prompted.
- **Removes:** Cemetery record
- **Verify:** Cemetery list no longer shows the entry.

### S016: STATE-WIPE restore
- **Action:** Compare config files with S001 backups. Restore any that
  differ (only settings files should be restored; registry/teams are
  already cleaned by UI delete).
- **Goal:** Config files match pre-test state.
- **Removes:** nothing
- **Verify:** Files match byte-for-byte.

### S017: Post-test screenshot
- **Action:** Take screenshot of the dashboard.
- **Goal:** UI matches pre-test baseline.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual comparison.
