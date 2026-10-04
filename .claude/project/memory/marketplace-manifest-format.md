---
name: marketplace-manifest-format
description: "claude plugin install fails 'Plugin not found in marketplace' / marketplace manifest plugin source must be source-url-shaped not type-git-repo-shaped / why does a valid git repo url still fail to install / how do I fix a marketplace.json plugin source entry"
ocd: 2026-03-29
lmd: 2026-10-02
metadata: 
  node_type: memory
  type: feedback
  tier: component
  topic: plugins-and-marketplaces
  originSessionId: e1b4c900-d366-4fc0-93a4-353bb259fe18
publish-globally: false
---

^B89KVJTL [desc: "Marketplace manifest entries for external git plugins must use source=url plus url=<git_url>; the type=git plus repo=... shape makes claude plugin install fail with 'Plugin not found in marketplace'.", keywords: claude_plugin_install_fails_Plugin_not_found_in_marketplace marketplace_manifest_plugin_source_format source_url_not_type_git_repo valid_git_repo_url_still_fails_to_install fix_marketplace_json_plugin_source_entry external_git_repo_plugin_source marketplace_json_source_shape wrong_format_type_git_repo role_plugin_install_debugging install_fails_silently ai_maestro_plugins_marketplace, ocd: 2026-03-29, lmd: 2026-10-02]
Marketplace manifest plugin source format must use `{ "source": "url", "url": "<git_url>" }` for external git repos.
The wrong format `{ "type": "git", "repo": "<git_url>" }` causes `claude plugin install` to fail with "Plugin not found in marketplace".

^689BA150 [desc: "Found during role-plugin install debugging: the ai-maestro-plugins marketplace carried the wrong source format, so claude plugin install <name>@ai-maestro-plugins --scope local failed silently.", keywords: role_plugin_install_debugging ai_maestro_plugins_marketplace_wrong_format install_fails_silently_scope_local why_manifest_format_matters discovery_context wrong_source_format_root_cause claude_plugin_install_name_at_marketplace silent_install_failure marketplace_manifest_bug scope_local_install_fails role_plugin_installation_failure, ocd: 2026-03-29, lmd: 2026-10-02]
**Why:** Discovered during role-plugin install debugging. The ai-maestro-plugins marketplace used the wrong format, making `claude plugin install <name>@ai-maestro-plugins --scope local` fail silently.

^W0812WHZ [desc: "syncDefaultRolePlugins auto-fixes the manifest, installPluginLocally uses separate args, uninstall mirrors it; the main plugin uses --scope user and all 8 role-plugins use --scope local.", keywords: syncDefaultRolePlugins_auto_fixes_manifest role_plugin_service_ts installPluginLocally_separate_args claude_plugin_install_name_marketplace_scope_local claude_plugin_uninstall_marketplace_scope_local main_ai_maestro_plugin_scope_user eight_predefined_role_plugins_scope_local Emasoft_ai_maestro_plugins_fix_upstream marketplace_update_manifest_fix scope_user_vs_scope_local install_command_shape, ocd: 2026-03-29, lmd: 2026-10-02]
**How to apply:**
- `syncDefaultRolePlugins()` in `role-plugin-service.ts` auto-fixes the manifest after marketplace updates
- The Emasoft/ai-maestro-plugins repo needs the fix pushed upstream
- `installPluginLocally()` now uses `claude plugin install <name> <marketplace> --scope local` (separate args, not `@`)
- `claude plugin uninstall <name> <marketplace> --scope local` for uninstall
- Only the main `ai-maestro` plugin uses `--scope user`; all **8** predefined role-plugins use
  `--scope local`[^1]

See also [[marketplace-plugin-registration]] — the full entry shape,
`allowCrossMarketplaceDependenciesOn`, the register-BEFORE-first-publish ordering, and the
pull-before-edit staleness lesson.

## Notes and lessons learned

[^1]: [id:ATOM-MMF1-SC8P, status:valid, keywords:"how_many_predefined_role_plugins role_plugin_count_stale six_role_plugins ninth_role_plugin_not_in_the_tuple", ocd:2026-07-30, lmd:2026-07-30]
  DO NOT state a COUNT of the predefined role-plugins from memory, BECAUSE this page said "all 6"
  and `PREDEFINED_ROLE_PLUGIN_NAMES` holds exactly 8 (MAINTAINER and AUTONOMOUS landed after it was
  written), and a count is the one kind of fact that rots with nothing breaking to signal it. DO
  read the tuple in `lib/ecosystem-constants.ts` — and read the comment ABOVE it too: a NINTH
  constant (`ROLE_PLUGIN_ASSISTANT`) exists and is deliberately absent from the tuple because
  consumers that iterate it "assume a set of exactly 8", so "how many role-plugins are there" has a
  different answer from "how many are in the tuple". That is an open question on ai-maestro#86, not
  a settled 8.
