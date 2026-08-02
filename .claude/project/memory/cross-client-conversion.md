---
name: cross-client-conversion
description: "how do I move an agent from claude to codex / ChangeClient plugin re-emission / does converting a role-plugin lose data / X to Claude lossy conversion forbidden / which Codex model maps to which Claude model / Universal Plugin IR / gpt-5.x to claude family mapping / R18 plugin continuity pipeline"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
---

# cross-client-conversion

AI Maestro can move a running agent from one AI coding-agent client to another (e.g.
`claude` → `codex`) without losing its installed plugins, via the `ChangeClient` pipeline
(R18) and a Universal Plugin IR that every conversion routes through.

### ChangeClient — Plugin Continuity (R18)

Changing an agent's client (e.g. `claude` → `codex`) is **NEVER** a simple field update. An
agent's identity is defined by its installed plugins (role-plugin, core `ai-maestro-plugin`,
optional user plugins), so `ChangeClient` **MUST** re-emit every installed plugin in the new
client's format before touching the agent directory. R18 makes this mandatory — see
`docs/GOVERNANCE-RULES.md`.

**The pipeline:**

1. **G04: Snapshot** — scan the agent's working directory via `scanAgentLocalConfig()` to get
   the full list of installed plugins (role-plugin + normal plugins, enabled and disabled). R17
   safety net: `ai-maestro-plugin` is always added if missing from the scan.
2. **G05: Resolve conversion plan** — for each plugin, resolve a source in the **strict priority
   order (R18.3d)**:
   1. **Client-native plugin cache** (`~/.claude/plugins/cache/`, `~/.codex/plugins/cache/`,
      `~/.gemini/plugins/`, `~/.opencode/plugins/`, `~/.kiro/plugins/`) — authoritative, no
      conversion needed
   2. **Local role-plugins marketplace** (`~/agents/role-plugins/<name>/`) — use only if
      `compatible-clients` in `.agent.toml` includes the target client
   3. **Previously emitted custom-plugins** (`~/agents/custom-plugins/<client>/<name>/` or
      `<name>-<client>/`)
   4. **Emit from existing Universal IR** via `emitForClient(name, newClient)`
   5. **Fresh conversion** via `convertAndStorePlugin(name, sourceClient, [newClient])` —
      absolute last resort
   - **Never** convert/emit if any native version already exists (conversion is lossy).
   - **For Claude target specifically:** if no canonical Claude source is found (step 1 or 2),
     the operation aborts. X→Claude lossy conversion is forbidden (R18.3b).
   - If any plugin cannot be resolved → **abort before any uninstall** (no partial state).
3. **G06: Uninstall old-client plugins** — using the old client's adapter, remove all
   old-client plugin files. For Claude, a belt-and-braces `settings.local.json` strip ensures
   the key is removed even if the CLI uninstall fails silently.
4. **G07: Install new-client plugins** — using the new client's adapter, install the converted
   plugins into the agent directory. For Claude, a belt-and-braces `settings.local.json`
   write-back ensures the key is present even if the CLI install fails silently.
5. **G08: Update registry** — write `program: newClient` to the agent registry.
6. **G09: Mark restart needed** — the client binary must be relaunched.

**Critical invariants:**
- **Prefer native over converted (R18.3d)**: if a native version of the plugin exists for the
  target client (from GitHub marketplace, from Haephestos, or from user install), it is ALWAYS
  used. Conversion only happens when no native version exists anywhere.
- **Never X→Claude lossy (R18.3b)**: going to Claude requires the canonical Claude source. If
  it's missing, the operation refuses.
- **Plugins are never uninstalled without their replacement already being ready** (R18.4).
- The core `ai-maestro-plugin` (R17) is subject to the same conversion — it is treated as "just
  another plugin" by the pipeline, but R17 safety net guarantees it's always in the snapshot.
- Role-plugins (quad-match `.agent.toml`) preserve their name — no `-<client>` suffix. Their
  `.agent.toml` `compatible-clients` field is updated on conversion.
- If any plugin fails to convert, the entire `ChangeClient` operation aborts — no partial state.
- The agent's governance title remains unchanged — the role-plugin is converted (or reused if
  already compatible), not reassigned.

**Files:**
- `services/element-management-service.ts` — `ChangeClient()` pipeline
- `services/plugin-storage-service.ts` — `convertAndStorePlugin()`, `emitForClient()`,
  `getUniversalIR()`
- `lib/client-plugin-adapters/` — per-client adapters for install/uninstall
- `services/agent-local-config-service.ts` — `scanAgentLocalConfig()` for plugin enumeration

### Cross-Client Conversion Reference Repos

The skill/plugin conversion feature is based on code from these two open-source repos:

- **https://github.com/TokenRollAI/acplugin** — Converts Claude Code plugins to Codex,
  OpenCode, and Cursor formats. Handles skills, agents, commands, hooks, MCP, instructions.
  TypeScript, MIT license.
- **https://github.com/sustinbebustin/crucible** — Bidirectional converter for 7 AI coding
  harnesses (Claude, Codex, OpenCode, Cursor, Gemini, GitHub Copilot, Kiro). Handles skills and
  agent configs with format-specific output (TOML for Codex, JSON for Kiro, markdown-yaml for
  the rest). TypeScript, MIT license.

The best features from both should be combined into `services/cross-client-skill-service.ts`.
Prior analysis: `docs_dev/2026-03-31-crucible-integration-analysis.md`.

Additionally, **https://github.com/REPOZY/Hookbridge** — Universal hook compiler from YAML to
Claude Code and Codex native formats. Handles the hook format differences (26 Claude events vs
5 Codex events, 4 hook types vs 1). Provides loss reports and shim mechanism for approximated
features. Our `UniversalPluginIR` extends this pattern to all component types.

### Model Mapping Reference (2026-05)

Cross-client model conversion is in `lib/converter/rewrite/model.ts`.

**Family-based, version-proof.** Claude ships frontier models faster than a
static table can track — Opus went 4.6 → 4.7 → 4.8 inside one month (Claude
Code 2.1.142 → 2.1.154, Opus 4.8 GA on 2026-05-28). So the **Claude → X**
direction is keyed by *family alias* (`opus`/`sonnet`/`haiku`/`fable`) and any concrete
id is normalized to its family before lookup via `claudeFamily()`:
`claude-opus-4-8`, the 1M variant `claude-opus-4-8[1m]`, and a hypothetical
`claude-opus-5` all collapse to `opus`. New Claude releases need **no edit** to
the table. The reverse (**X → Claude**) emits the family *alias*, never a pinned
version, so a converted agent always resolves to the current Claude model.

**Claude → Codex** (Codex lineup verified 2026-05-28 against
https://developers.openai.com/codex/models):

| Claude family (any version, incl. `[1m]`) | Codex Model | Notes |
|-------------|-------------|-------|
| `opus` | `gpt-5.5` | Newest Codex frontier model (the recommended default) |
| `sonnet` | `gpt-5.3-codex` | Industry-leading coding model |
| `haiku` | `gpt-5.4-mini` | Fast, efficient for subagents |
| `fable` | `gpt-5.5` | Claude 5 flagship family (`claude-fable-*`) → Codex frontier default |

**Codex → Claude** (reverse — emits the alias, which tracks the latest model; the reverse
direction never emits `fable` — flagship Codex ids reverse-map to `opus`, a deliberate choice
in `model.ts`):

| Codex Model | Claude alias |
|-------------|-------------|
| `gpt-5.5` | `opus` |
| `gpt-5.4` | `opus` |
| `gpt-5.4-mini` | `haiku` |
| `gpt-5.3-codex` | `sonnet` |
| `gpt-5.3-codex-spark` | `sonnet` |
| `gpt-5.2` | `sonnet` (curated legacy downgrade) |
| `o3` | `opus` |
| `o3-mini` | `sonnet` |

A Codex `gpt-5.x` id the table doesn't list yet (a freshly-released frontier model) falls back
**by tier** via `codexTier()` — `*-mini`→`haiku`, `*-codex`→`sonnet`, bare `gpt-5.x`→`opus` — so
a new model never emits an invalid Claude id. The curated table always wins first (e.g.
`gpt-5.2`→`sonnet` is preserved despite its bare-frontier shape).

**Claude → Gemini**:

| Claude family | Gemini Model |
|-------------|-------------|
| `opus` | gemini-2-pro |
| `sonnet` | gemini-2-flash |
| `haiku` | gemini-3-flash |
| `fable` | gemini-2-pro |

Tests: `tests/unit/converter-model-mapping.test.ts` (incl. Opus 4.8 `[1m]`, the Claude 5 family
— `claude-sonnet-5`, `claude-fable-*` — and round-trip stability).

### Universal Plugin IR Architecture

Converted plugins use a universal intermediate representation stored at
`~/agents/custom-plugins/.abstract/<name>/plugin-universal-ir.yaml`. This extends the
Hookbridge pattern to all 16 component types (hooks, skills, agents, commands, MCP, LSP,
output-styles, instructions, executables, apps, user-config, channels, resources, extensions,
settings, interface).

Key files:
- `lib/converter/universal-ir.ts` — UniversalPluginIR types + bidirectional converters
  (ProjectIR ↔ UniversalPluginIR)
- `services/plugin-storage-service.ts` — `convertAndStorePlugin()`, `emitForClient()`,
  `getUniversalIR()`
- `lib/client-plugin-adapters/` — Per-client adapters (claude, codex, element-based for
  gemini/opencode/kiro)
- `lib/converter/emitters/shared.ts` — `transformPluginRootPaths()`, `scanMCPResourceFiles()`,
  `PLATFORM_PATHS`

## See also

## Notes and lessons learned
