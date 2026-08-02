---
name: ecosystem-constants-and-repos
description: "where are the marketplace repo names defined / MARKETPLACE_REPO MAIN_PLUGIN_NAME single source of truth / which github repo owns amp-*.sh scripts / 3-repo split ai-maestro vs ai-maestro-plugin vs ai-maestro-plugins / can I merge upstream 23blocks-OS into the marketplace fork / role-plugin repo list"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
---

# ecosystem-constants-and-repos

All marketplace repos, plugin names, and ecosystem identifiers are centralized in two mirrored files, and the AI Maestro ecosystem itself is split across three separate GitHub repos under the `Emasoft` org.

### Ecosystem Constants (Single Source of Truth)

- **TypeScript**: `lib/ecosystem-constants.ts` — used by all server-side services and API routes
- **Shell**: `scripts/ecosystem-config.sh` — sourced by all installer/updater shell scripts

When the project owner changes repos or orgs, only these two files need updating. All shell scripts use `${MARKETPLACE_REPO:-Emasoft/ai-maestro-plugins}` (with fallback) after sourcing the config. All TypeScript code imports constants from `lib/ecosystem-constants.ts`.

**Key constants defined:**
- `MARKETPLACE_REPO` / `MARKETPLACE_NAME` — GitHub marketplace org/repo
- `MAIN_PLUGIN_NAME` — Main AI Maestro plugin (`ai-maestro-plugin`)
- `ROLE_PLUGIN_*` — All 8 predefined role-plugin names (MANAGER, COS, ARCHITECT, INTEGRATOR, ORCHESTRATOR, PROGRAMMER, MAINTAINER, AUTONOMOUS)
- `PREDEFINED_ROLE_PLUGIN_NAMES` — The tuple of all 8 names used by consumer code
- `PLUGIN_COMPATIBLE_TITLES` — Map from plugin name to list of compatible governance titles
- `TITLE_PLUGIN_MAP` — Governance title to default role-plugin mapping
- `AI_MAESTRO_REPO` / `MARKETPLACE_REPO_URL` — Repo URLs

**Note:** The `Emasoft/ai-maestro-plugins` references in CLAUDE.md/this page are documentation values. The actual runtime values come from ecosystem-constants.

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

## See also

- [[role-plugins]] — the plugin-content detail (fourfold identity rule, Haephestos creation flow, editing workflow) behind each predefined role-plugin repo

## Notes and lessons learned
