---
name: ecosystem-constants-and-repos
description: "where are the marketplace repo names defined / MARKETPLACE_REPO MAIN_PLUGIN_NAME single source of truth / which github repo owns amp-*.sh scripts / 3-repo split ai-maestro vs ai-maestro-plugin vs ai-maestro-plugins / can I merge upstream 23blocks-OS into the marketplace fork / role-plugin repo list / which repo do I post the issue to / origin is the upstream not my fork / a tool reports 23blocks-OS instead of Emasoft / origin-main-HEAD overstates the unpushed commit count"
ocd: 2026-08-02
lmd: 2026-09-27
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: plugins-and-marketplaces
publish-globally: false
---

# ecosystem-constants-and-repos

^GWQ1KSAC [desc: "All marketplace repos, plugin names and ecosystem identifiers live in two mirrored single-source-of-truth files: lib/ecosystem-constants.ts (TypeScript, server-side) and scripts/ecosystem-config.sh (shell, installers). Change repo/org names there and nowhere else.", keywords: where_are_marketplace_repo_names_defined ecosystem_constants_single_source_of_truth MARKETPLACE_REPO_constant_file lib_ecosystem_constants_ts scripts_ecosystem_config_sh where_do_I_change_the_github_org_name which_file_defines_plugin_names shell_mirror_of_typescript_constants, ocd: 2026-08-02, lmd: 2026-09-27]
All marketplace repos, plugin names, and ecosystem identifiers are centralized in two mirrored files, and the AI Maestro ecosystem itself is split across three separate GitHub repos under the `Emasoft` org.

### Ecosystem Constants (Single Source of Truth)

- **TypeScript**: `lib/ecosystem-constants.ts` — used by all server-side services and API routes
- **Shell**: `scripts/ecosystem-config.sh` — sourced by all installer/updater shell scripts

When the project owner changes repos or orgs, only these two files need updating. All shell scripts use `${MARKETPLACE_REPO:-Emasoft/ai-maestro-plugins}` (with fallback) after sourcing the config. All TypeScript code imports constants from `lib/ecosystem-constants.ts`.

^BSIQYPRH [desc: "Key ecosystem constants: MARKETPLACE_REPO/MARKETPLACE_NAME, MAIN_PLUGIN_NAME (ai-maestro-plugin), ROLE_PLUGIN_* and PREDEFINED_ROLE_PLUGIN_NAMES (exactly 8 role plugins), PLUGIN_COMPATIBLE_TITLES, TITLE_PLUGIN_MAP, AI_MAESTRO_REPO/MARKETPLACE_REPO_URL. Emasoft/ai-maestro-plugins in docs is documentation value; runtime comes from the constants.", keywords: what_constants_does_ecosystem_constants_define MARKETPLACE_REPO_MAIN_PLUGIN_NAME role_plugin_names_tuple predefined_role_plugin_names_8 title_plugin_map_governance compatible_titles_map are_documented_repo_names_runtime_values ecosystem_constant_reference_list, ocd: 2026-08-02, lmd: 2026-09-27]
**Key constants defined:**
- `MARKETPLACE_REPO` / `MARKETPLACE_NAME` — GitHub marketplace org/repo
- `MAIN_PLUGIN_NAME` — Main AI Maestro plugin (`ai-maestro-plugin`)
- `ROLE_PLUGIN_*` — All 8 predefined role-plugin names (MANAGER, COS, ARCHITECT, INTEGRATOR, ORCHESTRATOR, PROGRAMMER, MAINTAINER, AUTONOMOUS)
- `PREDEFINED_ROLE_PLUGIN_NAMES` — The tuple of all 8 names used by consumer code
- `PLUGIN_COMPATIBLE_TITLES` — Map from plugin name to list of compatible governance titles
- `TITLE_PLUGIN_MAP` — Governance title to default role-plugin mapping
- `AI_MAESTRO_REPO` / `MARKETPLACE_REPO_URL` — Repo URLs

**Note:** The `Emasoft/ai-maestro-plugins` references in CLAUDE.md/this page are documentation values. The actual runtime values come from ecosystem-constants.

^U07DEPLJ [desc: "The 3-repo split under Emasoft: Emasoft/ai-maestro (main app + canonical AMP/AID scripts, more up to date than the marketplace fork), Emasoft/ai-maestro-plugin (core plugin — skills/commands/hooks only, zero scripts except the hook handler), Emasoft/ai-maestro-plugins (marketplace, a fork of 23blocks-OS).", keywords: three_repo_split_ai_maestro_ecosystem which_repo_owns_amp_scripts where_do_ai_maestro_scripts_canonically_live is_ai_maestro_plugin_a_fork main_app_vs_core_plugin_vs_marketplace repo_more_up_to_date_than_marketplace ai_maestro_plugin_zero_scripts marketplace_fork_of_23blocks, ocd: 2026-08-02, lmd: 2026-09-27]
### GitHub Repos Architecture (3-Repo Split)

The AI Maestro ecosystem is split across three separate GitHub repos under the `Emasoft` org. Each has a distinct role:

#### 1. `Emasoft/ai-maestro` — Main App (the app repo)

The Next.js dashboard + server. Also the **canonical source** for all AMP and AID scripts:
- `scripts/amp-*.sh` (28 scripts) — Agent Messaging Protocol CLI
- `scripts/aid-*.sh` (5 scripts) — Agent Identity CLI
- `scripts/agent-*.sh`, `scripts/docs-*.sh`, `scripts/graph-*.sh`, `scripts/memory-*.sh` — Other CLI tools
- `install-messaging.sh` copies these scripts to `~/.local/bin/`

This repo's scripts are **more up to date** than the upstream marketplace — they include extra security fixes (e.g., MF-023 path traversal validation in `amp-send.sh`).

#### 2. `Emasoft/ai-maestro-plugin` — Core Plugin (NOT a fork)

The main AI Maestro Claude Code plugin (v2.2.0+). Contains **only** skills, commands, hooks — **zero scripts** except the hook handler:
- **1 hook script**: `scripts/ai-maestro-hook.cjs` (session tracking + message notifications)
- **Skills**: auto-discovered from `skills/*/SKILL.md`, so the count is whatever ships — **26** as
  of 2026-08-02.

  > **Corrected 2026-08-02.** This line, and a sibling one, both said **11** and gave two
  > DIFFERENT lists — and one named `agent-management`, which has never existed (it is
  > `ai-maestro-agents-management`). Fifteen real skills, including the whole `ama-*` 3-pillars
  > family, appeared in neither. Two sections agreeing on a number is not verification: they were
  > copies of one stale snapshot, and hand-listing an AUTO-DISCOVERED set guarantees this recurs.
- **12 AMP commands** (`commands/*.md`): `/amp-init`, `/amp-send`, `/amp-inbox`, etc. — reference scripts at `~/.local/bin/` (installed by main repo)
- **No regular scripts** — all scripts live in the main repo and are installed system-wide by the installers

#### 3. `Emasoft/ai-maestro-plugins` — Marketplace (fork of 23blocks-OS)

Fork of `23blocks-OS/ai-maestro-plugins`. Lists the 8 predefined role-plugins in `.claude-plugin/marketplace.json` (the latest additions are `ai-maestro-maintainer-agent` on 2026-04-11 and `ai-maestro-autonomous-agent` for mandatory AUTONOMOUS role-plugin coverage per R9.13/R11.12).

^RJBAOR6C [desc: "Do NOT merge upstream 23blocks-OS into the marketplace fork: the main repo is canonical for AMP/AID scripts, and upstream changes would overwrite the fork's extensions (extra scripts, security fixes, marketplace entries added after divergence). The 8 role-plugin repos are independent Emasoft repos, NOT forks — no upstream sync needed.", keywords: should_I_merge_upstream_into_marketplace_fork why_not_merge_23blocks_upstream role_plugin_repos_independent_not_forks no_upstream_sync_for_role_plugins fork_extensions_would_be_overwritten which_repos_are_forks_vs_independent role_plugin_repos_list_compatible_titles, ocd: 2026-08-02, lmd: 2026-09-27]
**Do NOT merge upstream into this fork** — the main repo is the canonical source for AMP/AID scripts, and any upstream changes would overwrite the fork's extensions (extra scripts, security fixes, and marketplace entries added after divergence).

#### 4. Role-Plugin Repos (8 repos, NOT forks)

Each is an independent Emasoft-owned repo (not forked from 23blocks-OS):

| Repo | compatible-titles |
|------|------------------|
| `Emasoft/ai-maestro-architect-agent` | `["ARCHITECT"]` |
| `Emasoft/ai-maestro-assistant-manager-agent` | `["MANAGER"]` |
| `Emasoft/ai-maestro-chief-of-staff` | `["CHIEF-OF-STAFF"]` |
| `Emasoft/ai-maestro-integrator-agent` | `["INTEGRATOR"]` |
| `Emasoft/ai-maestro-orchestrator-agent` | `["ORCHESTRATOR"]` |
| `Emasoft/ai-maestro-programmer-agent` | `["MEMBER"]` |
| `Emasoft/ai-maestro-maintainer-agent` | `["MAINTAINER"]` |
| `Emasoft/ai-maestro-autonomous-agent` | `["AUTONOMOUS"]` |

All have `compatible-titles` and `compatible-clients` fields in their `.agent.toml`. No upstream sync needed. See [[role-plugins]] for the plugin-content detail (fourfold identity rule, Haephestos creation flow, editing workflow) behind each of these repos.

^ZQ56O29Q [desc: "In Emasoft/ai-maestro the remotes are INVERTED: origin → 23blocks-OS/ai-maestro (UPSTREAM, not ours), fork → Emasoft/ai-maestro (where work lands and issues go). 'Push/post to origin' hits a repo the owner does not control; origin/main..HEAD overstates unpushed count ~4× — always derive against fork/.", keywords: origin_is_the_upstream_not_my_fork which_remote_do_I_push_to where_do_I_post_issues_in_this_repo origin_main_HEAD_overstates_unpushed_commits remote_named_fork_holds_my_repo inverted_remote_convention pushed_to_upstream_accident tool_reports_23blocks_instead_of_Emasoft, ocd: 2026-08-02, lmd: 2026-09-27]
## ⚠ `origin` IS THE UPSTREAM HERE — the remotes are inverted

```
origin   →  https://github.com/23blocks-OS/ai-maestro.git    ← UPSTREAM (not ours)
fork     →  https://github.com/Emasoft/ai-maestro.git        ← where work lands, where issues go
```

This is the opposite of the usual convention, and it silently inverts three habits:

- **"post the issue to origin" files against a repo the owner does not control** — an
  apparently-correct rule that violates the `Emasoft/*`-only constraint.
- **"push to origin" would push to the upstream.** Work goes to `fork`.
- **`origin/main..HEAD` measures the fork-vs-UPSTREAM gap**, roughly 4× the real unpushed count.
  Always derive against `fork/`. That substitution has been made at least three times.

Any tool that reads "the repo" from `git remote get-url origin` reports `23blocks-OS` on this
repo and is not wrong — it is reading the name faithfully. Key on SEMANTICS (upstream vs push
target), never on the remote's NAME.

## See also

- [[role-plugins]] — the plugin-content detail (fourfold identity rule, Haephestos creation flow, editing workflow) behind each predefined role-plugin repo

## Notes and lessons learned

[^9]: [id:ATOM-ECOR-0009, status:valid, keywords:"which_repo_do_I_post_the_issue_to origin_is_the_upstream remote_named_fork_holds_my_repo posted_to_the_wrong_repo origin_main_HEAD_overstates_unpushed_count tool_reports_23blocks_instead_of_Emasoft", ocd:2026-08-05, lmd:2026-08-05]
    DO NOT resolve "our repo" from the remote NAMED `origin`, BECAUSE in this repo `origin` is the
    UPSTREAM (`23blocks-OS/ai-maestro`) and the owner's fork sits under a remote literally named
    `fork` — so the conventional reading sends issues and pushes to a repo the owner does not
    control, and makes `origin/main..HEAD` overstate the unpushed count ~4×. DO resolve it by
    SEMANTICS (which remote is the push target) and derive commit counts against `fork/`.
    Surfaced 2026-08-05 when a status report "misreported" the repo and was in fact reading
    `origin` correctly — see TRDD-U27WXLWT.
