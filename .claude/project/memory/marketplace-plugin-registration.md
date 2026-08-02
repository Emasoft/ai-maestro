---
name: marketplace-plugin-registration
description: "how to register / publish a new plugin into the ai-maestro-plugins marketplace / publish.py hard-exits 'not registered in marketplace' at stage 5 / cross-marketplace dependency won't resolve at install / claude plugin install can't find the plugin / marketplace.json entry shape + allowCrossMarketplaceDependenciesOn"
ocd: 2026-07-08
lmd: 2026-07-09
metadata:
  node_type: memory
  type: project
  tier: component
  topic: plugins-and-marketplaces
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
- The notify→receiver auto-bump chain is **proven end-to-end for a PRE-EXISTING entry**
  (2026-07-09, `ai-maestro-webdesign`): the entry was registered at 0.1.0 before the first
  publish, and each publish (v0.1.1→v0.1.4) drove the receiver workflow to bump the manifest
  entry to match — 4 consecutive successful bumps. Contrast with a first publish whose entry
  did NOT exist at dispatch time (WST): the receiver no-ops (nothing to bump), so the entry
  version lags the shipped repo version until the next publish. Register the entry FIRST if you
  want the very first publish to also bump the manifest.
- **publish.py leaves `uv.lock` one version behind** and it bites the NEXT publish.[^2]

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

[^2]: [ocd:2026-07-09 lmd:2026-07-09] The CPV `publish.py` bump stage updates
  `pyproject.toml` + `.claude-plugin/plugin.json` + `marketplace.json` but does NOT run
  `uv lock`, so the committed `uv.lock`'s own project-version entry stays one version behind
  pyproject. On the NEXT publish, `uv run scripts/publish.py` re-locks `uv.lock` on invocation
  (syncing that version) which DIRTIES the working tree BEFORE publish.py's clean-tree
  pre-flight check runs → the publish aborts with "Working tree is dirty. Commit or stash
  changes first." Symptom seen live on webdesign v0.1.3: publish exited rc=1 at the pre-flight.
  Fix each time: `uv lock` then commit `uv.lock` in sync with the current pyproject version
  BEFORE running publish.py (the diff is a single `version = "x.y.z"` line). Root fix for the
  plugin's own maintenance: add a `uv lock` step to publish.py's bump stage so the lockfile
  never lags. Lesson: an on-invocation lockfile re-sync defeats a clean-tree pre-flight — keep
  `uv.lock` committed in sync, or lock as part of the bump.
