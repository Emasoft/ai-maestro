---
name: role-plugins
description: "what is a role-plugin / fourfold identity rule / how many predefined role-plugins are there / how do I edit a role-plugin without losing changes on update / claude plugin cache gets overwritten / compatible-titles compatible-clients / Haephestos plugin creation flow / N:1 title to plugin mapping"
ocd: 2026-08-02
lmd: 2026-09-25
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: plugins-and-marketplaces
publish-globally: false
---

# role-plugins

^FUKGUDFZ [desc: "Role-plugins define an agent's job specialization via a .agent.toml profile carrying compatible-titles and compatible-clients fields.", keywords: what_is_a_role-plugin how_does_an_agent_get_its_job_specialization agent.toml_profile compatible-titles_field compatible-clients_field role-plugin_definition where_does_a_role-plugin_actually_run_from source-vs-install-target, ocd: 2026-08-02, lmd: 2026-09-24]
Role-plugins define an agent's job specialization. They contain a `.agent.toml` profile with `compatible-titles` and `compatible-clients` fields. See [[plugin-architecture-source-vs-install-target]] for the source-vs-install-target distinction that governs where a role-plugin actually runs from.

^NK66POOL [desc: "Role-plugin SOURCES live under ~/agents/role-plugins/ (Haephestos-authored/converted) or GitHub Emasoft/ai-maestro-plugins (8 predefined); the install target is always the client's own plugin cache.", keywords: where_do_role-plugin_sources_live role-plugin_source_storage_location haephestos_custom_plugin_path predefined_role-plugin_github_location install_target_vs_source_distinction agents_role-plugins_marketplace_plugin-name_folder ai-maestro-plugins_github_repo, ocd: 2026-08-02, lmd: 2026-09-24]
**Source storage** (NOT installed state — see [[plugin-architecture-source-vs-install-target]]): role-plugin SOURCES live in `~/agents/role-plugins/<marketplace>/<plugin-name>/` (Haephestos-authored or converted) or on GitHub `Emasoft/ai-maestro-plugins` (8 predefined defaults). The INSTALL target is always the client's own plugin cache, reached via that client's install protocol.

^DPD2860O [desc: "The local role-plugin marketplace is ai-maestro-local-roles-marketplace, a directory-based marketplace registered via claude plugin marketplace add ~/agents/role-plugins/.", keywords: local_role-plugin_marketplace_name ai-maestro-local-roles-marketplace how_is_the_role-plugin_marketplace_registered claude_plugin_marketplace_add_role-plugins directory-based_marketplace registering_the_local_roles_marketplace, ocd: 2026-08-02, lmd: 2026-09-24]
**Local marketplace:** `ai-maestro-local-roles-marketplace` (directory-based, registered with Claude CLI via `claude plugin marketplace add ~/agents/role-plugins/`).

^4JW633HN [desc: "Two role-plugin sources: Predefined (8) on GitHub Emasoft/ai-maestro-plugins, cached to ~/.claude/plugins/cache/, created by Emasoft; Custom at ~/agents/role-plugins/<name>/, created by Haephestos.", keywords: predefined_vs_custom_role-plugins where_are_predefined_role-plugins_stored where_are_custom_role-plugins_stored who_creates_role-plugins haephestos_agent_creation_helper emasoft_project_owner ai-maestro-plugins_cache_location two_sources_for_role-plugins, ocd: 2026-08-02, lmd: 2026-09-25]
**Two sources for role-plugins:**

| Source | Location | Created by |
|--------|----------|------------|
| **Predefined** (8 defaults) | GitHub `Emasoft/ai-maestro-plugins` → cached to `~/.claude/plugins/cache/` | Emasoft (project owner) |
| **Custom** | `~/agents/role-plugins/<name>/` | Haephestos (agent creation helper) |

^T8XDFFVN [desc: "The 8 predefined role-plugins and their title mapping: amama-/MANAGER, amcos-/CHIEF-OF-STAFF, ampa-/MEMBER, amoa-/ORCHESTRATOR, amia-/INTEGRATOR, amaa-/ARCHITECT, amma-/MAINTAINER, amaua-/AUTONOMOUS.", keywords: how_many_predefined_role-plugins_are_there list_of_predefined_role-plugins role-plugin_governance_title_mapping amama_prefix_manager amcos_prefix_chief-of-staff ampa_prefix_member amoa_prefix_orchestrator amia_prefix_integrator amaa_prefix_architect amma_prefix_maintainer amaua_prefix_autonomous N:1_title_to_plugin_mapping, ocd: 2026-08-02, lmd: 2026-09-25]
**Predefined role-plugins:**

| Plugin Name | Prefix | Governance Title |
|-------------|--------|-----------------|
| `ai-maestro-assistant-manager-agent` | `amama-` | MANAGER |
| `ai-maestro-chief-of-staff` | `amcos-` | CHIEF-OF-STAFF |
| `ai-maestro-programmer-agent` | `ampa-` | MEMBER |
| `ai-maestro-orchestrator-agent` | `amoa-` | ORCHESTRATOR |
| `ai-maestro-integrator-agent` | `amia-` | INTEGRATOR |
| `ai-maestro-architect-agent` | `amaa-` | ARCHITECT |
| `ai-maestro-maintainer-agent` | `amma-` | MAINTAINER |
| `ai-maestro-autonomous-agent` | `amaua-` | AUTONOMOUS |

^H1JQUDOI [desc: "The Fourfold Identity Rule: plugin.json name, folder name, <name>.agent.toml [agent].name, and agents/<name>-main-agent.md frontmatter name must all match, or the role-plugin is rejected.", keywords: fourfold_identity_rule role-plugin_naming_convention plugin.json_name_canonical_identity agent.toml_name_must_match main-agent.md_frontmatter_name invalid_role-plugin_rejected predefined_naming_ai-maestro-agent-name custom_naming_kebab-case why_was_my_role-plugin_rejected, ocd: 2026-08-02, lmd: 2026-09-24]
**Fourfold Identity Rule:** The canonical identity of a role-plugin is the `name` field in `.claude-plugin/plugin.json` (what Claude Code displays). All 4 must match:

1. **`plugin.json` `name`** = canonical identity (e.g., `pedro` or `ai-maestro-programmer-agent`)
2. **Folder name** = must equal plugin.json name
3. **`<name>.agent.toml`** must exist at plugin root AND `[agent].name` inside = plugin.json name
4. **`agents/<name>-main-agent.md`** must exist AND frontmatter `name:` = `<name>-main-agent`

If ANY of the 4 don't match → invalid role-plugin, rejected. Naming conventions:
- Predefined: `ai-maestro-<agent-name>` (in remote GitHub marketplace)
- Custom: `<agent-name>` — user-chosen, kebab-case (in local marketplace)

^QDX78A3R [desc: "The client a role-plugin belongs to is determined only by the compatible-clients field in .agent.toml, never by the plugin name.", keywords: how_is_a_role-plugins_client_determined compatible-clients_field_agent.toml role-plugin_target_client_not_by_name server_reads_agent.toml_for_target_clients client_determination_rule, ocd: 2026-08-02, lmd: 2026-09-24]
**Client determination:** The client a role-plugin belongs to is determined ONLY by the `compatible-clients` field in `.agent.toml`, NOT by the plugin name. The server reads `.agent.toml` to discover target clients.

^3LQU05HR [desc: "N:1 compatibility: role-plugins declare compatible-titles/clients; the UI shows a fixed label for 1 compatible plugin or a dropdown for 2+, and every title can swap between compatible plugins.", keywords: N:1_title_to_plugin_mapping compatible-titles_field multiple_plugins_serve_the_same_title dropdown_to_choose_a_role-plugin UI_compatible_plugin_selection can_MANAGER_swap_its_role-plugin can_COS_swap_its_role-plugin fixed_label_vs_dropdown_role-plugin, ocd: 2026-08-02, lmd: 2026-09-25]
**N:1 compatibility model:** Role-plugins declare which titles they're compatible with via `compatible-titles` in `.agent.toml`. Multiple plugins can serve the same title. Plugins also declare `compatible-clients` (e.g., `["claude-code"]`, `["claude-code", "codex"]`). The UI shows:
- **1 compatible plugin** → fixed label (no choice needed)
- **2+ compatible plugins** → dropdown to choose between them
- ALL titles (including COS, MANAGER) can swap between compatible plugins

^YO4OIL1G [desc: "Haephestos creation flow: gather info, generate TOML via PSS, prune/review, build via PSS make-plugin, add compat fields, validate with CPV, publish via creation-helper API; appears in every picker.", keywords: haephestos_plugin_creation_flow 8_steps_to_create_a_role-plugin PSS_binary_TOML_profile cpv-validate-plugin publish-plugin_API how_does_haephestos_build_a_plugin agent_creation_helper_workflow where_does_a_new_role-plugin_appear_after_publishing, ocd: 2026-08-02, lmd: 2026-09-25]
**Haephestos creation flow (8 steps):**
1. Gather info (role description + project type)
2. Generate TOML profile via PSS binary
3. Prune and refine elements
4. User review in TOML preview panel
5. Build plugin via PSS make-plugin (into `~/agents/haephestos/build/`)
6. Add AI Maestro compat fields (`compatible-titles`, `compatible-clients`, verify quad-identity)
7. Validate with CPV (`/cpv-validate-plugin`, `/cpv-fix-validation`)
8. Publish via `POST /api/agents/creation-helper/publish-plugin` (copies to marketplace, runs `claude plugin marketplace update ai-maestro-local-roles-marketplace`)

**After publishing:** The plugin appears automatically in any UI that lists role-plugins (wizard step 5, Config tab dropdown, role-plugin status API).

^6X2IZC90 [desc: "Normal (general-purpose) plugins are installed via Claude CLI at user or local scope, managed under ~/.claude/plugins/cache/ and settings.json — never placed in ~/agents/role-plugins/.", keywords: normal_plugins_vs_role-plugins general-purpose_plugin_installation user_scope_vs_local_scope_plugin_install marketplace_management_claude_plugin_marketplace_add normal_plugins_never_in_role-plugins_folder settings_page_plugins_explorer_tab agent_profile_config_tab_install, ocd: 2026-08-02, lmd: 2026-09-24]
### Normal Plugins (General-Purpose Tools) — the other category

Normal plugins are general-purpose tools (skills, MCP servers, hooks, etc.) installed from GitHub marketplaces.

**Installation:**
- **User scope** (global): Settings page → Plugins Explorer tab → browse marketplace → install
- **Local scope** (per-agent): Agent Profile → Config tab → browse marketplace → install

**Marketplace management:**
- **Add marketplace:** Settings → Plugins Explorer → Marketplaces tab → add marketplace URL
- **Remove marketplace:** Same tab → remove button
- All marketplace operations use Claude CLI: `claude plugin marketplace add/remove/update <name>`

**Normal plugins are NEVER put in `~/agents/role-plugins/`.** They are managed entirely by Claude CLI's standard plugin system (`~/.claude/plugins/cache/`, `settings.json`, `settings.local.json`).

^DCBVRHHT [desc: "Conversion rules: a role-plugin gets a client-suffixed name (bare for Claude), OVERWRITES an existing same-named folder (no rename path); a normal plugin gets a -<client> suffix under custom-plugins/.", keywords: role-plugin_conversion_rules converting_a_role-plugin_between_clients client_suffix_naming_ai-maestro-programmer-agent-codex overwrites_existing_folder_update_in_place converting_a_normal_plugin_between_clients R20.1_R20.23_R20.26_R20.28 why_does_the_converted_plugin_name_change plugin_names_are_immutable_no_rename_path, ocd: 2026-08-02, lmd: 2026-09-25]
**Role-plugin conversion rules:**
- When converting a role-plugin from one client to another, the converter
  (per R20.1 naming, R20.23 duplication, R20.26 no-renaming — TRDD-39ABGST4
  resolved the old "no suffix / never overwrite" wording here as stale):
  - Computes the TARGET name: a Claude target keeps the bare `<name>`; every
    other client gets the `-<client>` suffix (`ai-maestro-programmer-agent` →
    `ai-maestro-programmer-agent-codex`). The suffix is load-bearing: role
    marketplaces share the bare `ai-maestro-local-roles-marketplace` name
    across clients, so the suffixed plugin name is what keeps
    `<name>@<marketplace>` keys unique per client.
  - CHANGES `compatible-clients` in `.agent.toml` to the target client
  - Enforces fourfold identity with the TARGET name (folder, plugin.json,
    `.agent.toml`, main-agent .md all carry the suffixed name for non-Claude)
  - Stores under the per-client marketplace dir inside `~/agents/role-plugins/`
    (`<client>-roles-marketplace/`; bare `roles-marketplace/` for Claude)
  - OVERWRITES an existing same-named folder (update in place, R20.26) —
    plugin names are immutable identifiers; there is no rename path
- When converting an ordinary (non-role) plugin, the converter:
  - ADDS `-<client>` suffix to the name for non-Claude targets (e.g., `my-formatter-codex`); Claude-targeted customs keep their original name
  - Stores under `~/agents/custom-plugins/<client>-custom-marketplace/<name>-<client>/` (per R20.28; use `custom-marketplace/` for Claude)
  - Registers in `ai-maestro-local-custom-marketplace`

^ZXEMPTTC [desc: "When a title is assigned via the UI, the ChangeTitle pipeline (Gates 15-16) keeps a compatible plugin, installs the first compatible one, or auto-converts from Claude source if none exists.", keywords: title_to_role-plugin_auto-assignment ChangeTitle_pipeline_gates_15-16 getCompatiblePluginsForTitle auto_install_compatible_plugin_on_title_change auto-convert_from_claude_source_adapter what_happens_when_i_change_an_agents_title convertAndStorePlugin_emitForClient, ocd: 2026-08-02, lmd: 2026-09-25]
### Title → Role-Plugin Auto-Assignment

When a governance title is assigned via the UI (Title Assignment Dialog), the ChangeTitle pipeline (Gates 15-16) automatically:
1. Finds compatible plugins for the new title + agent's client (`getCompatiblePluginsForTitle()`)
2. If the current plugin is already compatible → keeps it
3. If not → installs the first compatible plugin (uninstalls the old one)
4. If no native plugin for this client → auto-converts from Claude source via adapter system (`convertAndStorePlugin` + `emitForClient` + client adapter)

^O59QYGJY [desc: "Key files: role-plugin-service.ts, element-management-service.ts ChangeTitle, role-plugins API routes, RoleTab.tsx, AgentCreationWizard step5, ecosystem-constants.ts, haephestos-creation-helper.md.", keywords: role-plugin_key_source_files role-plugin-service.ts element-management-service.ts_ChangeTitle RoleTab.tsx AgentCreationWizard.tsx_step_5 ecosystem-constants.ts haephestos-creation-helper.md where_is_role-plugin_logic_implemented, ocd: 2026-08-02, lmd: 2026-09-25]
### Key Files

- `services/role-plugin-service.ts` — Core service: `generatePluginFromToml()`, `createPersona()`, `listRolePlugins()`, `getPluginsForTitle()`, `ensureMarketplace()`, `updateMarketplaceManifest()`
- `services/element-management-service.ts` — `ChangeTitle()` (Gates 15-16 handle plugin swap), `getCompatiblePluginsForTitle()`, `installPluginLocally()`
- `app/api/agents/role-plugins/` — List/install/uninstall/status API
- `app/api/agents/creation-helper/publish-plugin/` — Publishes Haephestos-built plugin to local marketplace
- `components/agent-profile/RoleTab.tsx` — Dynamic label vs dropdown based on compatible plugin count
- `components/AgentCreationWizard.tsx` — Step 5 filters by `compatible-titles` + `compatible-clients`
- `lib/ecosystem-constants.ts` — `LOCAL_MARKETPLACE_NAME`, `GITHUB_MARKETPLACE_NAME`, `getLocalMarketplacePath()`
- `agents/haephestos-creation-helper.md` — 8-step role-plugin creation protocol

^OIQO2D1I [desc: "Never edit ~/.claude/plugins/cache/ (overwritten on update); clone the plugin's own repo, edit source, run publish.py (strict, hook-enforced), optionally force-update; fix CPV via the fixer agent.", keywords: how_do_i_edit_a_role-plugin_without_losing_changes claude_plugin_cache_gets_overwritten never_edit_files_in_plugins_cache correct_workflow_to_edit_a_role-plugin publish.py_quality_gate_test_lint_validate_bump_commit_push cpv_plugin-fixer_agent pre-push_git_hook_refuses_direct_push claude_plugin_update_force_refresh, ocd: 2026-08-02, lmd: 2026-09-25]
### Editing Role-Plugins (CRITICAL — Never Edit Cache)

**NEVER edit files in `~/.claude/plugins/cache/`** — those are cached copies that get overwritten on every plugin update. All changes must go through the proper publish pipeline.

**Correct workflow to edit a role-plugin:**

```bash
# 1. Clone the plugin's own GitHub repo (NOT the marketplace, NOT the cache)
cd /tmp
git clone git@github.com:Emasoft/<plugin-name>.git
cd <plugin-name>

# 2. Make your edits to the actual source files
#    Main agent: agents/<plugin-name>-main-agent.md
#    Skills: skills/<skill-name>/SKILL.md
#    Plugin manifest: plugin.json
#    TOML profile: <plugin-name>.agent.toml

# 3. Publish using the unified publish pipeline (quality gate + version bump)
uv run python scripts/publish.py --patch
#    This runs: test → lint → validate → consistency-check → bump → commit → push
#    publish.py is STRICT (no skip flags, no env-var bypass). A pre-push git
#    hook refuses any push that isn't invoked from publish.py itself.
#
#    If CPV strict validation fails with MINOR/MAJOR/CRITICAL issues, spawn
#    the `claude-plugins-validation:plugin-fixer` agent — it reads the
#    validation report and applies fixes one by one from a deep knowledge
#    base in skills/fix-validation/references/. Example:
#      Agent(subagent_type="claude-plugins-validation:plugin-fixer",
#            prompt="Fix the CPV strict validation issues in <plugin-path>")
#    Then re-run publish.py. Do NOT hand-patch SKILL.md files by guessing
#    the CPV rules — the fixer agent knows them all.

# 4. The GitHub workflow in the plugin repo automatically triggers
#    Emasoft/ai-maestro-plugins marketplace to update its metadata
#    with the new version, so Claude Code auto-updates on next check.

# 5. Force update on the local machine (optional, for immediate testing):
claude plugin update <plugin-name>@ai-maestro-plugins
```

^27XA4E6U [desc: "The 8 predefined role-plugin repos are each independent (not forked) under Emasoft/<name>; a 9th, ai-maestro-assistant-role-agent, is published but excluded from PREDEFINED_ROLE_PLUGIN_NAMES (#86).", keywords: 8_predefined_role-plugin_github_repos which_repo_does_each_role-plugin_live_in ai-maestro-assistant-role-agent_ninth_repo PREDEFINED_ROLE_PLUGIN_NAMES_ecosystem-constants_authority why_isnt_the_ninth_role-plugin_counted do_not_fix_the_count_to_9 ai-maestro#86_open_question, ocd: 2026-08-02, lmd: 2026-09-25]
**The 8 predefined role-plugin repos (each independent, NOT forked):**

> **Corrected 2026-08-02.** This heading said **7** and its table omitted
> `ai-maestro-autonomous-agent` — the one R9.13 makes mandatory for AUTONOMOUS — while the
> "GitHub Repos Architecture" section listed **8**. `PREDEFINED_ROLE_PLUGIN_NAMES` in
> `lib/ecosystem-constants.ts` is the authority and has 8. A **ninth** repo,
> `Emasoft/ai-maestro-assistant-role-agent`, is published and IS in the marketplace manifest but is
> deliberately NOT in that tuple — consumers assume a set of exactly 8, so adding it is an open
> question tracked on ai-maestro#86, not a settled fact. Do not "fix" the count to 9.

| Plugin | Repo |
|--------|------|
| `ai-maestro-assistant-manager-agent` | `Emasoft/ai-maestro-assistant-manager-agent` |
| `ai-maestro-chief-of-staff` | `Emasoft/ai-maestro-chief-of-staff` |
| `ai-maestro-architect-agent` | `Emasoft/ai-maestro-architect-agent` |
| `ai-maestro-orchestrator-agent` | `Emasoft/ai-maestro-orchestrator-agent` |
| `ai-maestro-integrator-agent` | `Emasoft/ai-maestro-integrator-agent` |
| `ai-maestro-programmer-agent` | `Emasoft/ai-maestro-programmer-agent` |
| `ai-maestro-maintainer-agent` | `Emasoft/ai-maestro-maintainer-agent` |
| `ai-maestro-autonomous-agent` | `Emasoft/ai-maestro-autonomous-agent` |

^RZ78R7YF [desc: "What NOT to do with role-plugins: never edit the plugin cache, never edit ~/agents/role-plugins/ for predefined plugins, never push directly to the ai-maestro-plugins marketplace.", keywords: what_not_to_do_with_role-plugins do_not_edit_plugins_cache do_not_edit_role-plugins_folder_for_predefined_plugins do_not_push_directly_to_ai-maestro-plugins_marketplace common_role-plugin_mistakes marketplace_updates_automatic_via_plugin_repo, ocd: 2026-08-02, lmd: 2026-09-24]
**What NOT to do:**
- Do NOT edit `~/.claude/plugins/cache/<marketplace>/<plugin>/` — changes are lost on update
- Do NOT edit `~/agents/role-plugins/<plugin>/` for predefined plugins — that's for Haephestos-created custom plugins only
- Do NOT push directly to `Emasoft/ai-maestro-plugins` marketplace — plugin repos trigger marketplace updates automatically

## See also

- [[plugin-architecture-source-vs-install-target]] — the source-vs-install-target invariant (R20.29-R20.31) that governs where a role-plugin's bytes actually live
- [[ecosystem-constants-and-repos]] — the SSOT constants files and the per-repo home for each of the 8 predefined role-plugins
- [[plugin-abstraction-and-script-layer]] — why a role-plugin's elements must never call the API directly

## Notes and lessons learned
