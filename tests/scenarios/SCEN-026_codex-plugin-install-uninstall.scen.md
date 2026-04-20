---
number: 26
name: Codex Role-Plugin Emission + Normal-Plugin Install/Uninstall via UI
version: "1.0"
description: >
  TWO DISTINCT FLOWS, both driven entirely through the UI.

  Role-plugin flow (Phases 1-3): The user creates a Codex agent via the
  Agent Creation Wizard. Because no Codex-native role-plugin ships for
  the default title, AI Maestro's plugin-storage-service auto-emits a
  Codex build from the Claude abstract (UniversalPluginIR), stores it
  under ~/agents/role-plugins/codex-roles-marketplace/<name>/, and the
  ChangePlugin installer wires it into Codex's own marketplace manifest
  at ~/.agents/plugins/marketplace.json. The user swaps the agent's
  title (MEMBER → ARCHITECT) and confirms the converter emits + installs
  a second role-plugin while the old one is uninstalled via ChangePlugin
  G14c. Uninstalling the active role-plugin exercises R9.13: the agent
  auto-hibernates and POST /api/agents/{id}/wake refuses with 409
  role_plugin_required. A compatible role-plugin is re-assigned via the
  Config tab; the agent wakes.

  Regular-plugin flow (Phases 4-5): the user registers and installs 4
  real-world Codex plugins — a mix of (a) two catalog MARKETPLACES
  (openai/plugins, hashgraph-online/awesome-codex-plugins) and (b) two
  SINGLE-PLUGIN repos (remotion-dev/codex-plugin,
  supabase-community/codex-plugin) — via Settings → Plugins Explorer.
  These plugins are ALREADY in Codex format. AI Maestro does NOT copy
  them into any AI-Maestro-owned folder. Instead the UI invokes Codex's
  own file-based install protocol — edits ~/.agents/plugins/marketplace.json,
  flips enable state in ~/.codex/config.toml — and records every
  operation in the signed ledger so the matching Uninstall button can
  roll it back. Plugin-name collisions are disambiguated by
  "<name>@<marketplace>" (e.g. codex-plugin@supabase-community/codex-plugin
  vs codex-plugin@remotion-dev/codex-plugin); no folder rename is needed
  because these are regular plugins, not Haephestos-created/converted
  customs. Cleanup removes all 4 via the UI and deletes the test agent.
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
  - Up to 2 converted Codex role-plugins under ~/agents/role-plugins/codex-roles-marketplace/ (role-plugins ARE stored by AI Maestro because they were derived from the Claude abstract — per TRDD-c7a81642 R20.28)
  - 4 regular Codex marketplaces/plugins referenced from ~/.agents/plugins/marketplace.json + enable flags in ~/.codex/config.toml (owned by Codex itself, NOT copied by AI Maestro)
  - Ledger entries: create_agent, change_title, change_plugin (×N, both role-plugin and regular), hibernate_role_missing, wake, add_marketplace (×2), remove_marketplace (×2)
  - Backup directory under tests/scenarios/state-backups/SCEN-026_<ts>/
rewipe-list:
  - ~/.aimaestro/governance.json
  - ~/.aimaestro/agents/registry.json
  - ~/.aimaestro/teams/teams.json
  - ~/.aimaestro/teams/groups.json
  # Codex-owned files are included so Phase 4/5 mutations can be
  # verified-and-restored bit-for-bit via CHECKPOINT-RESTORE. The
  # UI cleanup path should already leave these clean; STATE-WIPE is
  # belt-and-braces.
  - ~/.agents/plugins/marketplace.json
  - ~/.codex/config.toml
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

> **Scope note — TWO distinct flows:**
>
> 1. **Role-plugins** (derivatives of Claude originals). Tested in
>    Phases 1-3. These ARE stored by AI Maestro under
>    `~/agents/role-plugins/codex-roles-marketplace/` because they
>    were auto-emitted from the Claude abstract — the rule
>    "uniquely named customs live in a local AI-Maestro marketplace"
>    applies ONLY here, per TRDD-c7a81642 R20.28. The scenario tests
>    one title swap (MEMBER → ARCHITECT) as a representative exercise.
>
> 2. **Regular plugins** (already in Codex format, not derived from
>    Claude). Tested in Phases 4-5. AI Maestro does NOT store these;
>    Codex owns them. Plugin-name collisions across publishers are
>    normal and are disambiguated by the `<name>@<marketplace>` fully
>    qualified form — e.g. `codex-plugin@supabase-community/codex-plugin`
>    vs `codex-plugin@remotion-dev/codex-plugin` live side by side
>    without any rename.

> **Reference:** Codex plugin model — https://developers.openai.com/codex/plugins/build
>
> Codex uses a FILE-BASED install model (no `codex plugin install` CLI
> exists today):
> - User-global marketplace manifest: `~/.agents/plugins/marketplace.json`
> - Repo-scoped marketplace manifest: `$REPO_ROOT/.agents/plugins/marketplace.json`
> - Cache path (where plugin files live once installed): `~/.codex/plugins/cache/<marketplace>/<name>/<version>/`
> - Enable/disable state: `~/.codex/config.toml`
> - Plugin manifest (inside the plugin dir): `.codex-plugin/plugin.json`
>
> So "install" under the hood means: (a) add a plugin entry to the
> marketplace manifest that points at the plugin folder, (b) flip
> enabled=true in `config.toml`, (c) restart Codex so it re-reads
> config. AI Maestro wraps this sequence behind a single UI Install
> button, and logs a `change_plugin` (or `add_marketplace`) ledger
> entry so the matching Uninstall button can reverse the change
> idempotently. AI Maestro never copies the plugin source files into
> any AI-Maestro-owned folder — they stay wherever the user points
> (the git fixture, a local working folder, or a GitHub URL).

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

## Phase 4: Register + install 4 regular Codex plugins via the Plugins Explorer

> **Fixture type map:**
>
> | Fixture | Type | Plugin count |
> |---|---|---|
> | `openai/plugins` | CATALOG MARKETPLACE | ~9 example plugins (Figma, Notion, Expo, Netlify, Remotion, Google Slides, …) |
> | `hashgraph-online/awesome-codex-plugins` | CATALOG MARKETPLACE | 12 official + ~40 community |
> | `remotion-dev/codex-plugin` | SINGLE PLUGIN | 1 (`codex-plugin`) |
> | `supabase-community/codex-plugin` | SINGLE PLUGIN | 1 (`codex-plugin`) |
>
> All 4 MUST be cloned by the scenario author to their per-publisher
> path under `tests/scenarios/fixtures/git/` with a `scenario-start`
> tag BEFORE the first run (Rule 3). Because the two single-plugin
> repos share the folder name `codex-plugin`, the fixture layout uses
> publisher-prefixed clone paths:
> - `tests/scenarios/fixtures/git/openai__plugins/`
> - `tests/scenarios/fixtures/git/hashgraph-online__awesome-codex-plugins/`
> - `tests/scenarios/fixtures/git/remotion-dev__codex-plugin/`
> - `tests/scenarios/fixtures/git/supabase-community__codex-plugin/`
>
> This on-disk prefix is a fixture-layout convenience only. The PLUGIN
> name inside each repo stays `codex-plugin`; Codex disambiguates by
> the marketplace portion of the fully qualified key
> (`<name>@<marketplace>`) — no plugin rename happens, because these
> are REGULAR plugins (already in Codex format), not Haephestos-
> created or cross-client-converted customs.

> **What AI Maestro actually does (Codex file-based install model, per
> https://developers.openai.com/codex/plugins/build):**
>
> 1. User clicks "Add Marketplace" or "Install Plugin" in the UI.
> 2. AI Maestro edits Codex's OWN `~/.agents/plugins/marketplace.json`
>    to add a marketplace entry pointing at the fixture folder.
> 3. For a plugin install, AI Maestro flips the plugin's enable flag
>    in `~/.codex/config.toml` (keyed by `<name>@<marketplace>`).
> 4. AI Maestro triggers a Codex reload so the new plugin is picked up.
> 5. Every operation is written to the signed ledger with
>    `authActor=user` so the matching Uninstall button can roll it
>    back symmetrically.
>
> AI Maestro does NOT copy plugin files into its own `~/agents/*`
> folders. The fixtures stay exactly where the user pointed them. Only
> the TWO Codex-owned files listed above are mutated, and they're in
> `rewipe-list` so STATE-WIPE restores them even if a test step errors
> out.

#### S018: Open Settings → Plugins Explorer → Marketplaces tab
- **Action:** Click the settings gear → "Plugins Explorer" sidebar item → "Marketplaces" tab
- **Goal:** The Marketplaces panel is visible, listing the currently registered marketplaces (`ai-maestro-plugins` remote + local containers)
- **Creates:** nothing (UI state only)
- **Modifies:** UI state
- **Verify:** At least 2 rows visible. Screenshot of the panel.

#### S019: Register the `openai/plugins` MARKETPLACE from the local fixture
- **Action:** Click "+ Add Marketplace" → choose "Local directory" → browse to `tests/scenarios/fixtures/git/openai__plugins/` → Confirm. Enter governance password in the sudo modal.
- **Goal:** AI Maestro adds a marketplace entry to `~/.agents/plugins/marketplace.json` pointing at the fixture path. Ledger entry `add_marketplace` with `authActor=user`. Codex itself is notified (reload or next start).
- **Creates:** Ledger entry `add_marketplace`; 1 new entry in `~/.agents/plugins/marketplace.json`
- **Modifies:** `~/.agents/plugins/marketplace.json`
- **Verify:** UI lists `openai/plugins` with its bundled plugin list expanded. `jq '.' < ~/.agents/plugins/marketplace.json` shows the new entry; `source.path` equals the absolute fixture path. Screenshot of the row.

#### S020: Install one plugin from the `openai/plugins` marketplace
- **Action:** Expand the `openai/plugins` row. Pick the first listed plugin (author's choice — typically `figma` or `notion`). Click its "Install" button. Enter governance password in the sudo modal.
- **Goal:** AI Maestro flips the plugin's enabled flag to true in `~/.codex/config.toml` keyed as `<name>@openai/plugins`. Codex is reloaded. Ledger entry `change_plugin(install)` with `authActor=user`.
- **Creates:** Ledger entry; new enable entry in `~/.codex/config.toml`
- **Modifies:** `~/.codex/config.toml`
- **Verify:** The chosen plugin shows "Installed" in the UI. `grep "@openai/plugins" ~/.codex/config.toml` returns the new line with `enabled=true`. Screenshot.

#### S021: Register `awesome-codex-plugins` + install one of its plugins
- **Action:** Repeat the S019-S020 pattern but point at `tests/scenarios/fixtures/git/hashgraph-online__awesome-codex-plugins/`. After the marketplace registers, install the first plugin it lists (author's choice — e.g. `github`, `linear`, or `slack`).
- **Goal:** Second marketplace registered + a second plugin enabled; 2 more ledger entries (`add_marketplace` + `change_plugin(install)`).
- **Creates:** 1 entry in marketplace.json, 1 entry in config.toml, 2 ledger entries
- **Modifies:** `~/.agents/plugins/marketplace.json` + `~/.codex/config.toml`
- **Verify:** Both files updated; UI shows Installed state. Screenshot.

#### S022: Register + install the `remotion-dev/codex-plugin` SINGLE-PLUGIN repo
- **Action:** Click "+ Add Marketplace" → "Local directory" → `tests/scenarios/fixtures/git/remotion-dev__codex-plugin/` → Confirm. Because this is a single-plugin repo, its own `.codex-plugin/plugin.json` is all AI Maestro needs to expose it as a one-plugin marketplace. Then click Install on the `codex-plugin` entry. Governance password as needed.
- **Goal:** Plugin enabled in `~/.codex/config.toml` as `codex-plugin@remotion-dev/codex-plugin`. The marketplace portion of the key will disambiguate it from S023's same-name plugin published by a DIFFERENT author.
- **Creates:** marketplace.json entry + config.toml entry + 2 ledger entries
- **Modifies:** same two files
- **Verify:** `grep "codex-plugin@remotion-dev" ~/.codex/config.toml` returns exactly 1 line. Screenshot.

#### S023: Register + install `supabase-community/codex-plugin` (same plugin name, different marketplace)
- **Action:** Same pattern as S022 but fixture `tests/scenarios/fixtures/git/supabase-community__codex-plugin/`. Both this plugin and the remotion one are named `codex-plugin` — they coexist because they live under DIFFERENT marketplaces. NO rename, NO conflict. This is the key property the scenario proves.
- **Goal:** Two plugins both named `codex-plugin` installed simultaneously, keyed as `codex-plugin@remotion-dev/codex-plugin` and `codex-plugin@supabase-community/codex-plugin`.
- **Creates:** marketplace.json entry + config.toml entry + 2 ledger entries
- **Modifies:** same two files
- **Verify:** `grep -c "codex-plugin@" ~/.codex/config.toml` returns 2. Both entries visible side-by-side in the UI. Screenshot of the Plugins Explorer showing both rows.

#### S024: Confirm all 4 regular plugins are listed in the agent's Config → Plugins section
- **Action:** Back in the agent's Profile → Config tab, scroll to the Plugins section. All 4 freshly-installed regular plugins appear with their fully qualified `<name>@<marketplace>` labels; the role-plugin row remains separate above them.
- **Goal:** The local-config scan correctly enumerates all 4 regular plugins (plus the role-plugin + R17 core plugin).
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** 4 regular-plugin rows visible with the expected `<name>@<marketplace>` labels; both `codex-plugin@…` rows are distinct. Screenshot.

---

## Phase 5: Uninstall the 4 regular Codex plugins

#### S025: Uninstall plugin 1 (`<name>@openai/plugins`) via the Config tab
- **Action:** In Profile → Config → Plugins section, click the trash icon next to the openai/plugins entry. Enter governance password in the sudo modal.
- **Goal:** AI Maestro flips the plugin's enable flag to false in `~/.codex/config.toml` (or removes the entry entirely, per the UI's uninstall semantics), Codex is reloaded, `change_plugin(uninstall)` ledger entry is appended with `authActor=user`.
- **Creates:** Ledger entry
- **Modifies:** `~/.codex/config.toml`
- **Verify:** Plugin row no longer appears in the Plugins section. `grep "@openai/plugins" ~/.codex/config.toml` returns 0 lines (or shows enabled=false, depending on UI semantics). Screenshot.

#### S026: Uninstall plugin 2 (`<name>@hashgraph-online/awesome-codex-plugins`)
- **Action:** Same pattern as S025
- **Goal:** Second regular plugin uninstalled
- **Creates:** Ledger entry
- **Modifies:** `~/.codex/config.toml`
- **Verify:** Plugin no longer listed; ledger entry present. Screenshot.

#### S027: Uninstall plugin 3 (`codex-plugin@remotion-dev/codex-plugin`)
- **Action:** Same pattern as S025. Critically, clicking uninstall here MUST NOT also uninstall the `codex-plugin@supabase-community/codex-plugin` entry — the marketplace portion of the key must uniquely scope the operation.
- **Goal:** Third plugin uninstalled; the other same-named plugin remains installed
- **Creates:** Ledger entry
- **Modifies:** `~/.codex/config.toml`
- **Verify:** `grep -c "codex-plugin@" ~/.codex/config.toml` returns 1 (only the supabase one remains). Screenshot of the UI showing exactly one `codex-plugin` row still present.

#### S028: Uninstall plugin 4 (`codex-plugin@supabase-community/codex-plugin`)
- **Action:** Same pattern as S025
- **Goal:** Fourth regular plugin uninstalled
- **Creates:** Ledger entry
- **Modifies:** `~/.codex/config.toml`
- **Verify:** `grep -c "codex-plugin@" ~/.codex/config.toml` returns 0. Screenshot.

#### S029: Confirm the agent's Plugins section is back to baseline
- **Action:** In Profile → Config → Plugins section, confirm only the R17 core plugin (ai-maestro-plugin, Codex-converted) and the role-plugin remain.
- **Goal:** No leftover regular plugins from the 4 fixture installs; only the two AI-Maestro-managed plugins (core + role) stay
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin count matches the pre-Phase-4 state — exactly 2 AI-Maestro-managed plugins visible. Screenshot.

---

## Phase CLEANUP: Restore Original State

#### S030: Remove the 4 fixture marketplaces from Settings → Plugins Explorer
- **Action:** In Settings → Plugins Explorer → Marketplaces tab, click the remove icon next to each of the 4 marketplaces registered in Phase 4 (openai/plugins, awesome-codex-plugins, remotion-dev/codex-plugin, supabase-community/codex-plugin). Enter the governance password in each sudo modal.
- **Goal:** Marketplaces unregistered via `DELETE /api/settings/marketplaces`. AI Maestro edits `~/.agents/plugins/marketplace.json` to remove each entry; `remove_marketplace` ledger entries appended with `authActor=user`.
- **Removes:** 4 marketplace entries from `~/.agents/plugins/marketplace.json`
- **Verify:** Marketplaces panel shows only pre-test marketplaces. `jq '.marketplaces | length' < ~/.agents/plugins/marketplace.json` equals the pre-test count. Screenshot.

#### S031: Delete the test agent via Profile → Advanced → Danger Zone
- **Action:** Open Profile → Advanced → Danger Zone → click "Delete Agent". Check "Also delete agent folder". Type the agent name `scen026-codex-plugin-test` in the confirmation field. Click "Delete Forever". Enter governance password in the sudo modal.
- **Goal:** DeleteAgent pipeline removes registry entry, kills tmux session, deletes `~/agents/scen026-codex-plugin-test/`. Converted Codex role-plugins left in `~/agents/role-plugins/codex-roles-marketplace/` are garbage-collected by the pipeline (or remain as inert emitted artifacts — either is acceptable; they have no `enabled` state anywhere now).
- **Removes:** agent registry entry, workdir, tmux session
- **Verify:** Sidebar no longer lists the agent. `GET /api/agents/<id>` returns 404. `ls ~/agents/scen026-codex-plugin-test/` returns ENOENT. Screenshot of the sidebar with the agent gone.

#### S032: Purge cemetery entry
- **Action:** Settings → Cemetery tab → find the `scen026-codex-plugin-test` entry → click "Purge". Enter governance password in the sudo modal.
- **Goal:** Cemetery cleared of this test agent
- **Removes:** cemetery entry
- **Verify:** Cemetery tab no longer lists the agent. Screenshot.

#### S033: STATE-WIPE — restore configuration files
- **Action:** Run `tests/scenarios/scripts/cleanup-SCEN-026.sh`. The script delegates to `scenario-restore.sh 26`, which compares every `rewipe-list` file against its backup SHA256 and restores any that differ.
- **Goal:** `governance.json`, `agents/registry.json`, `teams/teams.json`, `teams/groups.json`, `~/.agents/plugins/marketplace.json`, `~/.codex/config.toml` all match their pre-test SHA256. Belt-and-braces after the UI-driven cleanup in S025-S030.
- **Removes:** nothing (file contents restored if they drifted)
- **Verify:** `scenario-restore.sh` exits 0 after MANIFEST verification. Screenshot of the script's last line.

#### S034: Post-test screenshot
- **Action:** Navigate back to the dashboard root. Capture a full-page screenshot.
- **Goal:** UI matches Phase 0 baseline (Rule 1 CLEAN-AFTER-YOURSELF)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual comparison with the Phase 0 baseline screenshot shows no residual test artifacts (no `scen026-*` agent, no fixture marketplaces, no R9.13 banner).
