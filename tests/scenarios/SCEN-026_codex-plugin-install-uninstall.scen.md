---
number: 26
name: Codex Role-Plugin Emission + Normal-Plugin Install/Uninstall via UI
version: "1.0"
description: >
  The user creates a Codex agent via the Agent Creation Wizard. Because
  there is no Codex-native role-plugin shipped for the default title,
  AI Maestro's plugin-storage-service auto-emits a Codex build from the
  Claude abstract (UniversalPluginIR), stores it under
  ~/agents/role-plugins/codex-roles-marketplace/<name>/, and the
  ChangePlugin installer wires it into the agent's Codex config. The
  user then swaps the agent's title (MEMBER → ARCHITECT) and confirms
  the converter emits + installs a second role-plugin, and the old one
  is uninstalled via ChangePlugin G14c. The user uninstalls the active
  role-plugin to exercise the R9.13 role-plugin-or-hibernate invariant:
  the agent is auto-hibernated and POST /api/agents/{id}/wake refuses
  with 409 role_plugin_required. A compatible role-plugin is re-assigned
  via the Config tab, the agent wakes. Next, the user installs and
  uninstalls 4 real-world Codex plugins (openai/plugins,
  hashgraph-online/awesome-codex-plugins, remotion-dev/codex-plugin,
  supabase-community/codex-plugin) via Settings → Plugins Explorer to
  confirm the normal-plugin install/uninstall flow works for Codex.
  Cleans up the test agent + all 4 installed plugins via the UI.
client: codex
interhosts: false
device: desktop
browser_stack: dev-browser
subsystems:
  - governance (ChangeTitle Gates 14c, 15, 16; R9.13 invariant)
  - element-management-service (ChangePlugin install/uninstall, PG04 fallback-or-hibernate)
  - plugin-storage-service (convertAndStorePlugin Claude→Codex; emitForClient)
  - agents-core-service (CreateAgent G11 native vs converted; wakeAgent R9.13 gate)
  - agent-local-config-service (scanner quad-match on ~/.codex/plugins + ~/agents/role-plugins)
  - cross-client-conversion-service (UniversalPluginIR ↔ Codex adapter)
ui_sections:
  - Login page
  - Sidebar -> Agents tab -> Create new agent
  - Agent Creation Wizard (steps 1-7, client=codex)
  - Agent Profile -> Config tab -> Role-Plugin card
  - Agent Profile -> Config tab -> Plugins section
  - Agent Profile -> Advanced tab -> Danger Zone
  - Title Assignment Dialog (radio cards + password prompt)
  - Settings -> Plugins Explorer -> Marketplaces tab
  - Sudo password modal (Rule 12)
data_produced:
  - 1 test agent "scen026-codex-plugin-test" (temporary, created + deleted)
  - Up to 2 converted Codex role-plugins under ~/agents/role-plugins/codex-roles-marketplace/ (temporary)
  - 4 normal Codex plugins installed locally into the test agent's .codex config (temporary)
  - Ledger entries: create_agent, change_title, change_plugin (×N), hibernate_role_missing, wake
  - Backup directory under tests/scenarios/state-backups/SCEN-026_<ts>/
rewipe-list:
  - ~/.aimaestro/governance.json
  - ~/.aimaestro/agents/registry.json
  - ~/.aimaestro/teams/teams.json
  - ~/.aimaestro/teams/groups.json
git-fixtures:
  - https://github.com/openai/plugins
  - https://github.com/hashgraph-online/awesome-codex-plugins
  - https://github.com/remotion-dev/codex-plugin
  - https://github.com/supabase-community/codex-plugin
dir-fixtures: []
prerequisites:
  - AI Maestro server running at http://localhost:23000
  - Governance password set (see `governance_password` below)
  - Chrome available to dev-browser (the `ai-maestro-scenarios` named instance)
  - Codex CLI installed (`which codex` succeeds — scenario aborts in Phase 0 otherwise)
  - Claude Code installed (`which claude` succeeds — needed for the conversion source)
  - ai-maestro-plugins marketplace registered (`claude plugin marketplace list` shows it)
  - 4 git-fixtures cloned under `tests/scenarios/fixtures/git/<repo-name>/` with a `scenario-start` tag (scenario author responsibility — scenario-setup.sh resets them but never clones)
  - No pre-existing agent named "scen026-codex-plugin-test"
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
author: AI Maestro Team
---

# Codex Plugin Install/Uninstall Scenario

> **Scope note:** This scenario exists because role-plugins authored as
> Claude Code are the canonical source, and Codex-compatible builds are
> auto-derived via the UniversalPluginIR. If the converter + installer +
> uninstaller round-trip works, the system is in good shape for any
> title the user assigns on a Codex agent. The scenario tests ONE title
> swap (MEMBER → ARCHITECT) as a representative exercise — not every
> title, to keep the scenario bounded.

> **Reference:** Codex plugin model — https://developers.openai.com/codex/plugins/build
> Plugins install to `~/.codex/plugins/cache/<marketplace>/<name>/<version>/`.
> Manifest is `.codex-plugin/plugin.json`. Enable/disable state lives in
> `~/.codex/config.toml`. Scope: user-global (`~/.agents/plugins/marketplace.json`)
> or repo-scoped (`$REPO_ROOT/.agents/plugins/marketplace.json`).

---

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status`; if dirty, commit with message `pre-scenario: SCEN-026`
- **Goal:** Clean git working tree
- **Creates:** possibly one commit
- **Modifies:** possibly git history
- **Verify:** `git status` prints "working tree clean". Screenshot saved to the per-run dir.

#### S002: Run the scenario setup script
- **Action:** Execute `tests/scenarios/scripts/setup-SCEN-026.sh`. The script delegates to `scenario-setup.sh 26`, which backs up every file in `rewipe-list`, resets each `git-fixture` repo to its `scenario-start` tag, and verifies `dir-fixtures` (none here).
- **Goal:** `state-backups/SCEN-026_<ts>/` contains SHA256-verified backups + the 4 fixture repos are at their baseline commit
- **Creates:** `state-backups/SCEN-026_<ts>/` with MANIFEST.sha256
- **Modifies:** fixture repo working trees (reset to `scenario-start`)
- **Verify:** `MANIFEST.sha256` exists and each listed file's SHA matches on re-hash.

#### S003: Build + restart server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, hit `GET /api/sessions` via `dev-browser`
- **Goal:** Server healthy
- **Creates:** nothing
- **Modifies:** server process
- **Verify:** Response is HTTP 200 with an `agents` array.

#### S004: Kill stale scen* tmux sessions + verify prereqs
- **Action:** `tmux list-sessions | grep -E '^(scen-|cos-scen-)' | cut -d: -f1 | xargs -I{} tmux kill-session -t {}`. Then run `which codex` and `which claude`; both must succeed. Hit `GET /api/system/client-availability?client=codex` and confirm `available: true`.
- **Goal:** No leftover sessions from prior runs; both CLIs installed
- **Creates:** nothing
- **Modifies:** tmux session list
- **Verify:** `tmux list-sessions` returns zero matches; both `which` calls exit 0; API returns `available=true`.

#### S005: Open dashboard + login + baseline screenshot
- **Action:** Via `dev-browser`, open the persistent `dashboard` page on the `ai-maestro-scenarios` instance. If not logged in, log in with the governance password `mYkri1-xoxrap-gogtan`.
- **Goal:** Logged-in dashboard at the Agents view
- **Creates:** nothing
- **Modifies:** browser session cookie
- **Verify:** Sidebar renders the Agents tab. Baseline screenshot captured.

---

## Phase 1: Create a Codex agent + verify auto-emitted role-plugin

#### S006: Open the Agent Creation Wizard
- **Action:** Click the `+ New Agent` button in the sidebar header. The Wizard opens at Step 1 (Client).
- **Goal:** Wizard visible at Step 1
- **Creates:** nothing (wizard is client-side state)
- **Modifies:** UI state
- **Verify:** Modal contains "Choose AI Client". Screenshot of Step 1.

#### S007: Complete Wizard steps 1-7 for a Codex agent
- **Action:** Fill in the Wizard:
  - Step 1 Client: click "Codex"
  - Step 2 Name: `scen026-codex-plugin-test`
  - Step 3 Folder: leave default (`~/agents/scen026-codex-plugin-test/`)
  - Step 4 Avatar: pick the first default avatar
  - Step 5 Role-Plugin: leave the auto-suggested default (AI Maestro's MEMBER role-plugin converted to Codex)
  - Step 6 Team: "No team (autonomous)"
  - Step 7 Title: leave auto (MEMBER)
  Then click "Create Agent".
- **Goal:** Agent created via `POST /api/agents`, sidebar refreshes, new agent selected
- **Creates:** 1 agent registry entry; 1 agent workdir at `~/agents/scen026-codex-plugin-test/`; 1 Codex role-plugin auto-emitted under `~/agents/role-plugins/codex-roles-marketplace/ai-maestro-programmer-agent/`; ledger entries `create_agent` + `change_plugin(install)`
- **Modifies:** agents/registry.json; codex enable-state in the agent's workdir
- **Verify:** Agent appears in sidebar with green dot. `GET /api/agents/<id>` returns `program: "codex"`. `GET /api/agents/<id>/local-config` includes a non-null `rolePlugin`. Screenshot of the agent selected in the sidebar.

#### S008: Confirm the Codex-converted role-plugin files exist on disk
- **Action:** Read-only check: `ls ~/agents/role-plugins/codex-roles-marketplace/ai-maestro-programmer-agent/` and verify the quad-match files:
  - `<plugin-name>.agent.toml` with `compatible-clients = ["codex"]`
  - `agents/<plugin-name>-main-agent.md`
  - `plugin.json` (or Codex-flavored `.codex-plugin/plugin.json`, whichever the emitter produces)
- **Goal:** The UniversalPluginIR → Codex emitter produced a well-formed role-plugin
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** All 3 files exist and the TOML's `compatible-clients` list contains `codex`. Screenshot of the directory listing.

#### S009: Open Profile → Config tab → Role-Plugin card
- **Action:** Click the agent in the sidebar to open its Profile, then the `Config` tab. Locate the "Role-Plugin" card.
- **Goal:** UI shows the correct plugin name + a green "installed" indicator; the title shown matches what was assigned (MEMBER)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Card label reads `ai-maestro-programmer-agent` with a green dot or check icon. Screenshot of the Config tab.

---

## Phase 2: Swap title MEMBER → ARCHITECT; confirm role-plugin swap

#### S010: Open the Title Assignment Dialog
- **Action:** In the Profile header, click the TitleBadge (shows "MEMBER"). The Title Assignment Dialog opens.
- **Goal:** Dialog shows a radio-card per governance title
- **Creates:** nothing
- **Modifies:** UI state
- **Verify:** Dialog visible with 8 title cards. Screenshot of the open dialog.

#### S011: Assign ARCHITECT + enter governance password
- **Action:** Click the ARCHITECT radio card, enter governance password `mYkri1-xoxrap-gogtan` in the modal, click "Assign". If the sudo modal also appears, enter the same password there.
- **Goal:** ChangeTitle pipeline runs: G14c uninstalls the old programmer role-plugin, G16 installs the ARCHITECT-compatible role-plugin (auto-emitted to Codex from the Claude abstract if no native Codex version exists).
- **Creates:** 1 new Codex role-plugin under `~/agents/role-plugins/codex-roles-marketplace/ai-maestro-architect-agent/`; 3-4 new ledger entries (`change_title`, `change_plugin(uninstall)`, `change_plugin(install)`)
- **Modifies:** agents/registry.json (governanceTitle + rolePlugin); the agent's workdir Codex enable-state
- **Verify:** TitleBadge reads "ARCHITECT". Role-Plugin card updates to `ai-maestro-architect-agent` with green dot. `GET /api/agents/<id>/local-config` shows the new rolePlugin. Screenshot of the updated Profile header.

#### S012: Confirm on-disk the old role-plugin was uninstalled + new one installed
- **Action:** Read-only check of `~/.codex/plugins/cache/` (or the equivalent Codex scope) and the agent's Codex config — the old `ai-maestro-programmer-agent` entry is gone, the new `ai-maestro-architect-agent` entry is present.
- **Goal:** Codex uninstall pipeline executed cleanly (no orphaned enable entry)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** grep/`jq` shows exactly one AI Maestro role-plugin in the Codex config, and its name is `ai-maestro-architect-agent`. Screenshot of the grep output.

#### S013: Verify ledger captured the title swap
- **Action:** Read `~/.aimaestro/agents/registry.json.ledger.jsonl` (append-only). Filter by `op=change_title` and `op=change_plugin` within the last 60s.
- **Goal:** At least 1 `change_title` + 1 `change_plugin(install)` + 1 `change_plugin(uninstall)` recorded with `authActor=user`
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** The 3 ledger entries exist, contain the agent UUID in their diff path, and carry `authActor: "user"` + the signed host id. Screenshot of the log tail.

---

## Phase 3: R9.13 role-plugin-or-hibernate invariant

#### S014: Uninstall the active role-plugin from the Config tab
- **Action:** In Profile → Config tab → Role-Plugin card, click the "Uninstall" (or trash) button. When the sudo modal appears, enter `mYkri1-xoxrap-gogtan` and confirm.
- **Goal:** ChangePlugin PG04 runs. Since no compatible fallback role-plugin exists for ARCHITECT on Codex beyond `ai-maestro-architect-agent` (the one we just removed), PG04 sets `roleMissing=true` and auto-hibernates the agent.
- **Creates:** Ledger entries `change_plugin(uninstall)` + `hibernate_role_missing`
- **Modifies:** agent registry (rolePlugin=null, roleMissing=true); tmux session killed
- **Verify:** Sidebar shows the agent with the grey "hibernated" indicator. Profile panel shows the amber R9.13 banner + "Assign role-plugin" button. Screenshot of the banner.

#### S015: Attempt to wake the agent; confirm 409 role_plugin_required
- **Action:** From the sidebar right-click menu OR the Profile header, click "Wake". Capture the error response.
- **Goal:** POST /api/agents/{id}/wake returns HTTP 409 with body `{ error: "role_plugin_required", compatibleOptions: […] }`
- **Creates:** nothing
- **Modifies:** nothing (the wake is rejected)
- **Verify:** UI surfaces the structured error message; agent stays hibernated. Screenshot of the alert toast.

#### S016: Re-assign a compatible role-plugin via the Config tab
- **Action:** In Profile → Config tab → R9.13 banner, click "Assign role-plugin". A picker modal lists the compatible options (`ai-maestro-architect-agent` for ARCHITECT on Codex). Click it. Enter governance password if the sudo modal appears.
- **Goal:** ChangePlugin G16 installs the role-plugin again (auto-emits from Claude abstract if needed). `roleMissing` cleared.
- **Creates:** Ledger `change_plugin(install)`; possibly a freshly emitted Codex role-plugin if the previous one was also garbage-collected
- **Modifies:** agent registry (roleMissing=false, rolePlugin=<name>)
- **Verify:** R9.13 banner disappears. Role-Plugin card shows the name with a green dot. Screenshot of the restored card.

#### S017: Wake the agent
- **Action:** Click "Wake" in the sidebar. Agent tmux session is created.
- **Goal:** Agent is back online
- **Creates:** tmux session `scen026-codex-plugin-test`; Ledger entry `wake`
- **Modifies:** agent status in the registry
- **Verify:** Sidebar green dot, agent badge status active. Screenshot of the active agent.

---

## Phase 4: Install 4 normal Codex plugins via the Plugins Explorer

> **Note:** Each plugin below is installed from a local fixture clone at
> `tests/scenarios/fixtures/git/<repo>/`. We do this via the Settings →
> Plugins Explorer UI (never via shell) so Rule 6 holds. The scenario
> author must have cloned + tagged `scenario-start` for each fixture
> before the first run (see prerequisites).

#### S018: Open Settings → Plugins Explorer → Marketplaces tab
- **Action:** Click the settings gear → "Plugins Explorer" sidebar item → "Marketplaces" tab
- **Goal:** The Marketplaces panel is visible, listing the currently registered marketplaces (`ai-maestro-plugins` remote + local containers)
- **Creates:** nothing
- **Modifies:** UI state
- **Verify:** At least 2 rows visible. Screenshot of the panel.

#### S019: Install `openai/plugins` from the local fixture
- **Action:** Click "+ Add Marketplace", choose "Local directory", browse to `tests/scenarios/fixtures/git/plugins/` (the openai/plugins fixture). Confirm. Then from the plugin list within that marketplace, install one plugin (the fixture's first entry — scenario author's choice, typically the top-level example plugin).
- **Goal:** Plugin installed into the TEST AGENT's Codex config (local scope, not user-scope — Rule 2 0-IMPACT)
- **Creates:** Ledger `add_marketplace`; `change_plugin(install)`; plugin files cached under `~/.codex/plugins/cache/...`
- **Modifies:** Codex config.toml for the test agent's workdir (enable state); `~/.codex/plugins/cache/`
- **Verify:** Plugin listed as "installed" in the Marketplaces view. Screenshot of the installed state.

#### S020: Install a plugin from `hashgraph-online/awesome-codex-plugins`
- **Action:** Same as S019 but with fixture path `tests/scenarios/fixtures/git/awesome-codex-plugins/`. Install the first plugin listed in that marketplace.
- **Goal:** Second plugin installed
- **Creates:** ledger + plugin files (same shape as S019)
- **Modifies:** same scope as S019
- **Verify:** Installed indicator shown. Screenshot.

#### S021: Install `remotion-dev/codex-plugin`
- **Action:** Same as S019 but fixture path `tests/scenarios/fixtures/git/codex-plugin/` (the remotion-dev repo). Install the single plugin it exposes.
- **Goal:** Third plugin installed
- **Creates:** ledger + plugin files
- **Modifies:** same scope as S019
- **Verify:** Installed indicator shown. Screenshot.

#### S022: Install `supabase-community/codex-plugin`
- **Action:** Same as S019 but fixture path `tests/scenarios/fixtures/git/codex-plugin/` — NOTE: this repo name collides with remotion's, so the author must place it under `tests/scenarios/fixtures/git/supabase-codex-plugin/` and document the renamed fixture directory. Install the single plugin it exposes.
- **Goal:** Fourth plugin installed
- **Creates:** ledger + plugin files
- **Modifies:** same scope as S019
- **Verify:** Installed indicator shown. Screenshot.

#### S023: Confirm all 4 plugins are listed in the agent's Config → Plugins section
- **Action:** Back in the agent's Profile → Config tab, scroll to the Plugins section (below Role-Plugin). All 4 freshly-installed plugins are listed with their names + source marketplace.
- **Goal:** The agent's local-config scan correctly enumerates the 4 newly-installed plugins
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** 4 plugins visible with matching names. Screenshot of the Plugins section showing all 4.

---

## Phase 5: Uninstall the 4 normal Codex plugins

#### S024: Uninstall plugin 1 (openai/plugins) from the Config tab
- **Action:** Click the trash icon next to the plugin in the Config → Plugins section. Enter governance password in the sudo modal.
- **Goal:** Plugin uninstalled via ChangePlugin pipeline
- **Creates:** Ledger `change_plugin(uninstall)`
- **Modifies:** Codex config.toml; cache dir
- **Verify:** Plugin no longer listed in the Plugins section. Screenshot.

#### S025: Uninstall plugin 2 (awesome-codex-plugins)
- **Action:** Same pattern as S024
- **Goal:** Plugin 2 uninstalled
- **Creates:** Ledger entry
- **Modifies:** Codex config
- **Verify:** Plugin no longer listed. Screenshot.

#### S026: Uninstall plugin 3 (remotion-dev/codex-plugin)
- **Action:** Same pattern as S024
- **Goal:** Plugin 3 uninstalled
- **Creates:** Ledger entry
- **Modifies:** Codex config
- **Verify:** Plugin no longer listed. Screenshot.

#### S027: Uninstall plugin 4 (supabase-community/codex-plugin)
- **Action:** Same pattern as S024
- **Goal:** Plugin 4 uninstalled
- **Creates:** Ledger entry
- **Modifies:** Codex config
- **Verify:** Plugin no longer listed. Screenshot.

#### S028: Confirm the agent's Plugins section is back to baseline
- **Action:** In Profile → Config → Plugins section, confirm only the R17 core plugin (ai-maestro-plugin, Codex-converted) and the role-plugin remain.
- **Goal:** No leftover normal plugins from the 4 fixture installs
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin count matches pre-Phase-4 state. Screenshot.

---

## Phase CLEANUP: Restore Original State

#### S029: Remove the 4 fixture marketplaces from Settings → Plugins Explorer
- **Action:** In Settings → Plugins Explorer → Marketplaces tab, click the remove icon next to each of the 4 fixture marketplaces added in Phase 4. Enter the governance password in each sudo modal.
- **Goal:** Marketplaces unregistered via `DELETE /api/settings/marketplaces`; `remove_marketplace` ledger entries appended
- **Removes:** 4 marketplace registrations
- **Verify:** Marketplaces panel shows only pre-test marketplaces. Screenshot.

#### S030: Delete the test agent via Profile → Advanced → Danger Zone
- **Action:** Open Profile → Advanced → Danger Zone → click "Delete Agent". Check "Also delete agent folder". Type the agent name `scen026-codex-plugin-test` in the confirmation field. Click "Delete Forever". Enter governance password in the sudo modal.
- **Goal:** DeleteAgent pipeline removes registry entry, kills tmux session, deletes `~/agents/scen026-codex-plugin-test/`. Converted Codex role-plugins left in `~/agents/role-plugins/codex-roles-marketplace/` are garbage-collected by the pipeline (or remain as inert emitted artifacts — either is acceptable; they have no `enabled` state anywhere now)
- **Removes:** agent registry entry, workdir, tmux session
- **Verify:** Sidebar no longer lists the agent. `GET /api/agents/<id>` returns 404. `ls ~/agents/scen026-codex-plugin-test/` returns ENOENT. Screenshot of the sidebar with the agent gone.

#### S031: Purge cemetery entry
- **Action:** Settings → Cemetery tab → find the `scen026-codex-plugin-test` entry → click "Purge". Enter governance password in the sudo modal.
- **Goal:** Cemetery cleared of this test agent
- **Removes:** cemetery entry
- **Verify:** Cemetery tab no longer lists the agent. Screenshot.

#### S032: STATE-WIPE — restore configuration files
- **Action:** Run `tests/scenarios/scripts/cleanup-SCEN-026.sh`. The script delegates to `scenario-restore.sh 26`, which compares current `rewipe-list` files with their backups and restores any that differ.
- **Goal:** `governance.json`, `agents/registry.json`, `teams/teams.json`, `teams/groups.json` all match their pre-test SHA256
- **Removes:** nothing (file contents restored if they drifted; usually the UI delete in S030 + marketplace removals in S029 already restored them)
- **Verify:** `scenario-restore.sh` exits 0 after MANIFEST verification. Screenshot of the script's last line.

#### S033: Post-test screenshot
- **Action:** Navigate back to the dashboard root. Capture a full-page screenshot.
- **Goal:** UI matches Phase 0 baseline (Rule 1 CLEAN-AFTER-YOURSELF)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual comparison with the Phase 0 baseline screenshot shows no residual test artifacts (no `scen026-*` agent, no fixture marketplaces, no R9.13 banner).
