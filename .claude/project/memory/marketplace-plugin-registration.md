---
name: marketplace-plugin-registration
description: "how to register / publish a new plugin into the ai-maestro-plugins marketplace / publish.py hard-exits 'not registered in marketplace' at stage 5 / cross-marketplace dependency won't resolve at install / claude plugin install can't find the plugin / marketplace.json entry shape + allowCrossMarketplaceDependenciesOn"
ocd: 2026-07-08
lmd: 2026-07-08
metadata:
  node_type: memory
  type: project
  tier: component
---

# Registering a plugin in the ai-maestro-plugins marketplace

Verified end-to-end 2026-07-08 by publishing `web-scenario-tester` (the first MEMBER
role-plugin with a cross-marketplace dependency).

**Order matters:** the CPV canonical `publish.py` **hard-exits at its marketplace stage
when the plugin is not yet registered** in the marketplace manifest — so the manifest
entry must land BEFORE the first `publish.py` run, even though the entry references a
repo that has no releases yet.

**Entry shape** (mirror the existing entries — url-source form; see
[[marketplace-manifest-format]] for why `{source: url, url}` and never `{type: git}`):

```json
{
  "name": "<plugin-name>",
  "source": { "source": "url", "url": "https://github.com/<owner>/<repo>.git" },
  "description": "…", "version": "<current>", "author": {"name": "…"},
  "homepage": "…", "license": "MIT", "keywords": […], "category": "…",
  "repository": "https://github.com/<owner>/<repo>"
}
```

- The entry `name` is what `claude plugin install <name>@ai-maestro-plugins` resolves —
  the GitHub REPO name is independent (e.g. plugin `web-scenario-tester` lives in repo
  `ai-maestro-web-scenario-tester`; the fourfold identity binds plugin.json/toml/
  main-agent/entry-name, NOT the repo name).
- **`allowCrossMarketplaceDependenciesOn`** is a TOP-LEVEL marketplace.json array of
  foreign marketplace names. A plugin declaring
  `"dependencies": [{"name": "dev-browser", "marketplace": "dev-browser-marketplace"}]`
  in its plugin.json installs its dependency AUTOMATICALLY (verified live: the install
  printed "+ 1 dependency: dev-browser") — but CPV raises a MAJOR and install-time
  resolution fails if the hosting marketplace lacks the allowlist.
- Every plugin repo's `notify-marketplace` workflow auto-bumps its entry's `version` on
  each publish — the manifest on GitHub changes constantly, so **any clone of the
  marketplace repo goes stale fast; always `git pull --ff-only` immediately before
  editing the manifest**.[^1]
- The notify workflow's trigger branch must match the PLUGIN repo's default branch
  (caught live: trigger said `main`, repo used `master` → notify never fired until fixed).
- Repos also need the `MARKETPLACE_PAT` secret (set via the canonical
  `set_marketplace_pat.py`) for the notify chain.

Smoke-test a fresh registration without polluting anything: `claude plugin marketplace
update ai-maestro-plugins`, then `claude plugin install <name>@ai-maestro-plugins
--scope local` inside a THROWAWAY directory, verify the cache under
`~/.claude/plugins/cache/ai-maestro-plugins/<name>/<version>/`, then uninstall.

## Notes and lessons learned

[^1]: [ocd:2026-07-08 lmd:2026-07-08] The local marketplace clone was **187 commits
  behind** origin when the registration was attempted — every plugin publish had been
  pushing version bumps to GitHub for weeks. Editing without the ff-pull would have
  produced a manifest that silently reverted dozens of version bumps. Lesson: for any
  repo that MACHINES push to (notify workflows, bots), treat the local clone as stale by
  default and pull before every edit.
