---
name: plugin-abstraction-and-script-layer
description: "why can't a plugin call the ai-maestro API directly / a hook is calling fetch('/api/...') and breaking on updates / what is the script layer / aimaestro-*.sh amp-*.sh aid-*.sh boundary / decoupling invariant / a plugin element hardcodes an endpoint URL"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: aspect
  topic: plugins-and-marketplaces
---

# plugin-abstraction-and-script-layer

All AI Maestro functionality is exposed through two abstraction layers. External plugins MUST use these layers — never call the API directly. See [docs/PLUGIN-ABSTRACTION-PRINCIPLE.md](../../docs/PLUGIN-ABSTRACTION-PRINCIPLE.md) for the full guide.

### Layer 1: Skills (for agents)

All AI Maestro skills are bundled in the `ai-maestro` plugin (marketplace: `Emasoft/ai-maestro-plugins`). Key skills:

| Skill | Covers |
|-------|--------|
| `team-governance` | Team CRUD, COS assignment, governance requests, transfers, auth headers |
| `ai-maestro-agents-management` | Agent lifecycle via `aimaestro-agent.sh` CLI |
| `agent-messaging` | Inter-agent messaging via `amp-*` scripts + governance messaging rules |
| `agent-identity` | AID protocol — Ed25519 identity, proof of possession, OAuth token exchange |
| `team-kanban` | Team task boards, dependencies, status tracking, GitHub sync |
| `mcp-discovery` | Discover MCP server tools without installing plugins |

These skills ARE the authoritative reference. When the API changes, only these skill files need updating. The plugin also includes 12 AMP slash commands (`/amp-send`, `/amp-inbox`, etc.).

### Layer 2: Scripts (for hooks)

AI Maestro installs CLI scripts to `~/.local/bin/` that wrap API calls:
- `aimaestro-agent.sh` — Agent lifecycle CLI (delegates to `agent-*.sh` modules)
- `aimaestro-session.sh` — Terminal control: `inject`, `slash`, `state`, `read-prompt`, `answer`, `queue*`
- `aimaestro-panel.sh` — HTML side panel: `set`, `open`, `close`, `refresh`, `status`, `feedback`
- `aimaestro-trdd.sh` — 3-pillars task API: `search`, `read`, `edit`, `approve`, `refuse`, `promote`, `archive`
- `aimaestro-teams.sh`, `aimaestro-governance.sh`, `aimaestro-hook.sh` — teams, governance, the hook shim
- `amp-send.sh`, `amp-inbox.sh`, `amp-read.sh`, `amp-kanban-*.sh`, etc. — Messaging + kanban CLI
- `aid-init.sh`, `aid-token.sh`, etc. — Agent Identity CLI

The same scripts are also bundled in the plugin (for slash commands). When the API changes, only these scripts need updating.

**Hibernated agents are never waited on.** A command addressed to a hibernated
agent is *enqueued*, not blocked on — `aimaestro-session.sh queue <agent>
--command-key <key> [--wake-first]` persists server-side and fires when that
agent next reaches a safe idle prompt. So an enqueued `/janitor-arm` always
succeeds: live agents run it now, hibernated agents run it on wake. Delivery is
eventual, never conditional. The queue does not widen authorization — `queue`
maps to `send-command`, which **R42 makes self-only for every title**: an agent
may enqueue on itself and on nobody else, MANAGER and COS included. Fanning out
across the fleet is the human USER's alone — and the USER *can* now call it:
`get_auth_args` resolves `$AID_AUTH` → `$AIMAESTRO_SESSION` →
`~/.aimaestro/cli-session` (the token `aimaestro-governance.sh login` writes), so
an agent sends a bearer and a human sends an `aim_session` cookie. (This
paragraph said the opposite — *"no USER auth path yet, so today it has no working
caller at all"* — for 19 days after `bc177864` built it, ai-maestro#55.)

`/janitor-arm` is per-project (it arms the heartbeat of the project whose session
runs it), which is why it must be delivered into each agent's own session. It is
NOT `/janitor-global-arm` — that one clears the machine-wide kill-switch and
pause flags and arms no heartbeat. No fleet-wide arm command exists today. See
[docs/SCRIPT-LAYER.md](../../docs/SCRIPT-LAYER.md) § *a hibernated agent is never
waited on*.

**Full reference: [docs/SCRIPT-LAYER.md](../../docs/SCRIPT-LAYER.md)** — every subcommand and the
authorization rules that apply to an agent caller. `install-messaging.sh` copies
`scripts/*.sh` by glob, so a new wrapper needs no installer edit.

This sentence used to end *"and the two things that are not true yet
(`aimaestro-trdd.sh`'s write verbs 403 for agents; the scripts have no USER auth
path)"*. **Both were fixed and the sentence was not.** The write verbs work for
agents under the `manage-trdd` action since `d7531e53` (TRDD-K2WJH7RF), and the
USER auth path landed in `bc177864` (ai-maestro#55). A "not true yet" list is a
promise to delete an entry when it comes true; **when you close one, delete its
line in the same commit** — a doc that says a capability is MISSING is worse than
one that omits it, because the reader stops looking. Two of these lived in the
file loaded into every session of this project.

### The decoupling invariant (the WHY — derive every rule below from THIS)

**Every plugin element MUST be decoupled from the AI Maestro server API.** The
API changes constantly; plugins must not. The immutable CLI script layer
(`~/.local/bin/aimaestro-*.sh`, `amp-*.sh`, `aid-*.sh`) is the ONLY boundary
that touches the API — it is the UI that shields every plugin from the
ever-changing API behind it. Any plugin element that names a `/api/...`
endpoint, a `:23000` URL, or issues an HTTP call to the server has coupled
itself to the API and WILL break on the next API change. **This applies to
EVERY element type — hooks and MCP servers included — not just the ones named
below. Derive the consequence for each element type; do not wait to be told.**

### Rules for External Plugins

1. **Prompt-elements (skills / commands / agents / rules / output-styles) MUST NOT embed API syntax** (no curl, no endpoint URLs, no headers). They describe functionality and reference the global AI Maestro skill by name.
2. **Executable elements — hooks, MCP servers, bundled scripts, and ANY other code a plugin ships — MUST NOT call the API directly.** They shell out to the globally-installed AI Maestro CLI scripts (`aimaestro-agent.sh`, `aimaestro-governance.sh`, `aimaestro-teams.sh`, `aimaestro-hook.sh`, `amp-*.sh`, …). A hook STAYS in its plugin but becomes a thin shim that calls the intermediary script (see `aimaestro-hook.sh`); an MCP server that needs server data calls the script layer, never `fetch('/api/...')`. If the layer lacks a needed call, ADD a script to ai-maestro — never reach past it.
3. **Governance rules are discovered at runtime** by reading the `team-governance` skill. Plugins MUST NOT hardcode governance rules, permission matrices, or role restrictions.
4. **No element-level exception — not even the core `ai-maestro-plugin`** (this SUPERSEDES the former "AI Maestro's own plugin is the exception"). The boundary is the **script layer**, not a plugin: the `aimaestro-*` / `amp-*` / `aid-*` scripts are the intermediary and the ONLY code allowed to call the API — and those scripts are **owned by and shipped from the ai-maestro project** (this repo), not bundled in any plugin. The core plugin's hook (`ai-maestro-hook.cjs`) goes through `aimaestro-hook.sh` exactly like every other plugin's elements. Any script that internally depends on the API lives in ai-maestro, OUT of the plugins.

### Benefits
- API change → update 1 skill/script → all plugins work
- New feature → add to skill → all agents discover it
- Governance rule change → update skill → all agents learn it automatically
- No "update hundreds of plugins" problem as the ecosystem grows

## See also

- [[role-plugins]] — role-plugins are one of the two plugin categories this script-layer boundary governs

## Notes and lessons learned
