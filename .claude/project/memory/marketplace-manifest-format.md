---
name: marketplace-manifest-format
description: "claude plugin install fails 'Plugin not found in marketplace' — marketplace manifest plugin source must be { source: url, url: <git_url> } not { type: git, repo: <git_url> }"
metadata: 
  node_type: memory
  ocd: 2026-03-29
  lmd: 2026-07-08
  type: feedback
  tier: component
  originSessionId: e1b4c900-d366-4fc0-93a4-353bb259fe18
---

Marketplace manifest plugin source format must use `{ "source": "url", "url": "<git_url>" }` for external git repos.
The wrong format `{ "type": "git", "repo": "<git_url>" }` causes `claude plugin install` to fail with "Plugin not found in marketplace".

**Why:** Discovered during role-plugin install debugging. The ai-maestro-plugins marketplace used the wrong format, making `claude plugin install <name>@ai-maestro-plugins --scope local` fail silently.

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
