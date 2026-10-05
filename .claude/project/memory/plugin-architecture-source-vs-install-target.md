---
name: plugin-architecture-source-vs-install-target
description: "where does a plugin actually live / is the role-plugins folder under the agents home directory the installed location / R20.29 source vs install target / why can't I find an installed plugin under the agents home directory / LOCAL vs USER scope uninstall semantics / R20.30 R20.31"
ocd: 2026-08-02
lmd: 2026-10-05
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: plugins-and-marketplaces
publish-globally: false
---

# plugin-architecture-source-vs-install-target

^C1YY9KQ4 [desc: "AI Maestro plugins split into two separate categories, role-plugins and normal plugins, with different lifecycles, storage and management; never mix them. Covers source-vs-install-target.", keywords: plugins_two_categories_role_plugins_vs_normal_plugins plugin_lifecycle_storage_management_differences plugin_source_vs_install_target where_does_a_plugin_actually_live role_plugins_category_normal_plugins_category never_mix_plugin_categories plugin_architecture_overview, type: reference, ocd: 2026-08-02, lmd: 2026-10-05]
Plugins in AI Maestro are split into two completely separate categories with different lifecycles, storage locations, and management flows. **Never mix the two.** This page covers the source-vs-install-target distinction that governs BOTH categories (role-plugins and normal plugins alike); see [[role-plugins]] for the role-plugin-specific detail.

### CRITICAL — source vs install target (clarified 2026-04-20, R20.29)

^YHXG8825 [desc: "The local-marketplace containers ~/agents/{role,custom,core}-plugins are source storage and publishing surfaces, NOT where a plugin is installed; it lives in the client plugin cache.", keywords: agents_role_plugins_folder_is_not_installed_location source_storage_not_installed_location plugin_lives_in_client_plugin_cache R20_29 claude_plugins_cache_install_target codex_plugins_cache where_is_plugin_installed agents_custom_plugins_core_plugins_containers local_marketplace_containers_publishing_surfaces install_via_client_protocol github_url_local_folder_marketplace_source, type: reference, ocd: 2026-08-02, lmd: 2026-10-05]
**The three AI Maestro local-marketplace containers under `~/agents/{role,custom,core}-plugins/…` are SOURCE STORAGE / publishing surfaces, NOT the installed location of any plugin.**

A plugin LIVES at its install target — the CLIENT'S own plugin cache (`~/.claude/plugins/cache/…`, `~/.codex/plugins/cache/…`, etc.) — reached via THAT CLIENT'S own install protocol. This invariant holds regardless of the plugin's source:

- a GitHub URL,
- a local folder,
- one of the 3 AI Maestro local marketplaces, OR
- a remote marketplace (`Emasoft/ai-maestro-plugins` or any third-party).

^18LC8TGA [desc: "Per-client install protocols: Claude uses claude plugin install --scope local plus a settings.local.json enable; Codex is file-based (marketplace.json entry, config.toml enabled=true, reload).", keywords: claude_plugin_install_command_scope_local codex_file_based_plugin_install agents_plugins_marketplace_json codex_config_toml_enabled_true how_to_install_plugin_into_claude how_to_install_plugin_into_codex per_client_install_protocol claude_settings_local_json_enable_plugin codex_reload_after_install, type: reference, ocd: 2026-08-02, lmd: 2026-10-05]
In all 4 cases AI Maestro invokes the client's protocol to install INTO the client:
- **Claude**: `claude plugin install <plugin> <marketplace> --scope local` (+ enable in `~/.claude/settings.local.json`).
- **Codex**: file-based — add entry to `~/.agents/plugins/marketplace.json`, flip `enabled=true` for `<name>@<marketplace>` in `~/.codex/config.toml`, reload Codex.
- Future clients: whatever their protocol is.

^J1VU6GXC [desc: "AI Maestro writes into ~/agents/{role,custom,core}-plugins only as author or converter; uninstall touches only the client target and keeps the source; it never deletes from them (R20.31).", keywords: AI_maestro_never_deletes_source_containers R20_31 source_preserved_across_uninstall_reinstall who_writes_agents_role_plugins_folder uninstall_client_target_only_source_preserved haephestos_generated_custom_plugins claude_to_codex_conversion_writes_source core_plugin_emission_non_claude_clients removing_source_folder_manual_user_action reinstall_does_not_require_re_emission, type: reference, ocd: 2026-08-02, lmd: 2026-10-05]
AI Maestro only WRITES into `~/agents/{role,custom,core}-plugins/…` when it is the AUTHOR or CONVERTER of the plugin (Haephestos-generated customs, Claude→non-Claude conversions, core-plugin emissions for non-Claude clients). In every other case the plugin's source stays where the user pointed and AI Maestro installs from there directly. Uninstall operates on the client target only — the AI Maestro source, when one exists, is preserved across uninstall/reinstall cycles so later reinstalls do not require re-emission. **AI Maestro NEVER deletes from the 3 source containers; removing a source folder is a manual user action, outside AI Maestro's scope** (R20.31).

^N4P8F510 [desc: "A plugin lives in one scope per client, LOCAL (per-agent) or USER (global); two non-overlapping UI surfaces; an uninstall button never touches the opposite scope or source containers (R20.30, R20.20).", keywords: plugin_LOCAL_vs_USER_scope R20_30 R20_20 agent_profile_config_plugins_section settings_plugins_explorer_client_tab uninstall_button_never_touches_opposite_scope UI_two_surfaces_must_not_overlap not_all_clients_support_local_scope per_client_adapter_capability_declares_local_scope user_scope_uninstall_affects_every_agent cross_scope_invisibility scoped_uninstall_semantics, type: reference, ocd: 2026-08-02, lmd: 2026-10-05]
**Scope + UI semantics of install / uninstall (R20.30):** Every plugin lives in exactly one scope on the target client — either LOCAL (per-agent, scoped to a single agent's working directory) or USER (global, visible to every agent on the same client). Not all clients support local scope; the per-client adapter declares this capability.

The UI has two distinct surfaces for the two scopes, and they MUST NOT overlap:

| UI surface | Scope shown | Uninstall semantics |
|---|---|---|
| Agent Profile → Config → Plugins section | LOCAL scope only (the plugins installed in THIS agent's workdir) | LOCAL uninstall for this agent only — other agents using the same plugin are unaffected |
| Settings → Plugins Explorer → `<client>` tab | USER scope only (the plugins installed globally on this client) | USER uninstall for this client — affects every agent on that client simultaneously |

An uninstall button NEVER touches the opposite scope, and NEVER touches the AI Maestro source containers. Cross-scope invisibility is R20.20; the scoped-uninstall semantics above are R20.30.

See R20.29-R20.31 in `docs/GOVERNANCE-RULES.md` for the canonical wording and SCEN-026 for the end-to-end test.

## See also

- [[role-plugins]] — the role-plugin-specific detail (fourfold identity, 8 predefined plugins, editing workflow) built on top of this source-vs-install-target invariant

## Notes and lessons learned
