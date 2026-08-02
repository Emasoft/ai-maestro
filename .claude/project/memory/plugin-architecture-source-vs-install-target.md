---
name: plugin-architecture-source-vs-install-target
description: "where does a plugin actually live / is ~/agents/role-plugins/ the installed location / R20.29 source vs install target / why can't I find an installed plugin under ~/agents / LOCAL vs USER scope uninstall semantics / R20.30 R20.31"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
---

# plugin-architecture-source-vs-install-target

Plugins in AI Maestro are split into two completely separate categories with different lifecycles, storage locations, and management flows. **Never mix the two.** This page covers the source-vs-install-target distinction that governs BOTH categories (role-plugins and normal plugins alike); see [[role-plugins]] for the role-plugin-specific detail.

### CRITICAL — source vs install target (clarified 2026-04-20, R20.29)

**The three AI Maestro local-marketplace containers under `~/agents/{role,custom,core}-plugins/…` are SOURCE STORAGE / publishing surfaces, NOT the installed location of any plugin.**

A plugin LIVES at its install target — the CLIENT'S own plugin cache (`~/.claude/plugins/cache/…`, `~/.codex/plugins/cache/…`, etc.) — reached via THAT CLIENT'S own install protocol. This invariant holds regardless of the plugin's source:

- a GitHub URL,
- a local folder,
- one of the 3 AI Maestro local marketplaces, OR
- a remote marketplace (`Emasoft/ai-maestro-plugins` or any third-party).

In all 4 cases AI Maestro invokes the client's protocol to install INTO the client:
- **Claude**: `claude plugin install <plugin> <marketplace> --scope local` (+ enable in `~/.claude/settings.local.json`).
- **Codex**: file-based — add entry to `~/.agents/plugins/marketplace.json`, flip `enabled=true` for `<name>@<marketplace>` in `~/.codex/config.toml`, reload Codex.
- Future clients: whatever their protocol is.

AI Maestro only WRITES into `~/agents/{role,custom,core}-plugins/…` when it is the AUTHOR or CONVERTER of the plugin (Haephestos-generated customs, Claude→non-Claude conversions, core-plugin emissions for non-Claude clients). In every other case the plugin's source stays where the user pointed and AI Maestro installs from there directly. Uninstall operates on the client target only — the AI Maestro source, when one exists, is preserved across uninstall/reinstall cycles so later reinstalls do not require re-emission. **AI Maestro NEVER deletes from the 3 source containers; removing a source folder is a manual user action, outside AI Maestro's scope** (R20.31).

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
