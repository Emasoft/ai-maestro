---
name: role-plugins
description: "what is a role-plugin / fourfold identity rule / how many predefined role-plugins are there / how do I edit a role-plugin without losing changes on update / claude plugin cache gets overwritten / compatible-titles compatible-clients / Haephestos plugin creation flow / N:1 title to plugin mapping"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
---

# role-plugins

Role-plugins define an agent's job specialization. They contain a `.agent.toml` profile with `compatible-titles` and `compatible-clients` fields. See [[plugin-architecture-source-vs-install-target]] for the source-vs-install-target distinction that governs where a role-plugin actually runs from.

**Source storage** (NOT installed state — see [[plugin-architecture-source-vs-install-target]]): role-plugin SOURCES live in `~/agents/role-plugins/<marketplace>/<plugin-name>/` (Haephestos-authored or converted) or on GitHub `Emasoft/ai-maestro-plugins` (8 predefined defaults). The INSTALL target is always the client's own plugin cache, reached via that client's install protocol.

**Local marketplace:** `ai-maestro-local-roles-marketplace` (directory-based, registered with Claude CLI via `claude plugin marketplace add ~/agents/role-plugins/`).

**Two sources for role-plugins:**

| Source | Location | Created by |
|--------|----------|------------|
| **Predefined** (8 defaults) | GitHub `Emasoft/ai-maestro-plugins` → cached to `~/.claude/plugins/cache/` | Emasoft (project owner) |
| **Custom** | `~/agents/role-plugins/<name>/` | Haephestos (agent creation helper) |

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

**Fourfold Identity Rule:** The canonical identity of a role-plugin is the `name` field in `.claude-plugin/plugin.json` (what Claude Code displays). All 4 must match:

1. **`plugin.json` `name`** = canonical identity (e.g., `pedro` or `ai-maestro-programmer-agent`)
2. **Folder name** = must equal plugin.json name
3. **`<name>.agent.toml`** must exist at plugin root AND `[agent].name` inside = plugin.json name
4. **`agents/<name>-main-agent.md`** must exist AND frontmatter `name:` = `<name>-main-agent`

If ANY of the 4 don't match → invalid role-plugin, rejected. Naming conventions:
- Predefined: `ai-maestro-<agent-name>` (in remote GitHub marketplace)
- Custom: `<agent-name>` — user-chosen, kebab-case (in local marketplace)

**Client determination:** The client a role-plugin belongs to is determined ONLY by the `compatible-clients` field in `.agent.toml`, NOT by the plugin name. The server reads `.agent.toml` to discover target clients.

**N:1 compatibility model:** Role-plugins declare which titles they're compatible with via `compatible-titles` in `.agent.toml`. Multiple plugins can serve the same title. Plugins also declare `compatible-clients` (e.g., `["claude-code"]`, `["claude-code", "codex"]`). The UI shows:
- **1 compatible plugin** → fixed label (no choice needed)
- **2+ compatible plugins** → dropdown to choose between them
- ALL titles (including COS, MANAGER) can swap between compatible plugins

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

### Title → Role-Plugin Auto-Assignment

When a governance title is assigned via the UI (Title Assignment Dialog), the ChangeTitle pipeline (Gates 15-16) automatically:
1. Finds compatible plugins for the new title + agent's client (`getCompatiblePluginsForTitle()`)
2. If the current plugin is already compatible → keeps it
3. If not → installs the first compatible plugin (uninstalls the old one)
4. If no native plugin for this client → auto-converts from Claude source via adapter system (`convertAndStorePlugin` + `emitForClient` + client adapter)

### Key Files

- `services/role-plugin-service.ts` — Core service: `generatePluginFromToml()`, `createPersona()`, `listRolePlugins()`, `getPluginsForTitle()`, `ensureMarketplace()`, `updateMarketplaceManifest()`
- `services/element-management-service.ts` — `ChangeTitle()` (Gates 15-16 handle plugin swap), `getCompatiblePluginsForTitle()`, `installPluginLocally()`
- `app/api/agents/role-plugins/` — List/install/uninstall/status API
- `app/api/agents/creation-helper/publish-plugin/` — Publishes Haephestos-built plugin to local marketplace
- `components/agent-profile/RoleTab.tsx` — Dynamic label vs dropdown based on compatible plugin count
- `components/AgentCreationWizard.tsx` — Step 5 filters by `compatible-titles` + `compatible-clients`
- `lib/ecosystem-constants.ts` — `LOCAL_MARKETPLACE_NAME`, `GITHUB_MARKETPLACE_NAME`, `getLocalMarketplacePath()`
- `agents/haephestos-creation-helper.md` — 8-step role-plugin creation protocol

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

**What NOT to do:**
- Do NOT edit `~/.claude/plugins/cache/<marketplace>/<plugin>/` — changes are lost on update
- Do NOT edit `~/agents/role-plugins/<plugin>/` for predefined plugins — that's for Haephestos-created custom plugins only
- Do NOT push directly to `Emasoft/ai-maestro-plugins` marketplace — plugin repos trigger marketplace updates automatically

## See also

- [[plugin-architecture-source-vs-install-target]] — the source-vs-install-target invariant (R20.29-R20.31) that governs where a role-plugin's bytes actually live
- [[ecosystem-constants-and-repos]] — the SSOT constants files and the per-repo home for each of the 8 predefined role-plugins
- [[plugin-abstraction-and-script-layer]] — why a role-plugin's elements must never call the API directly

## Notes and lessons learned
