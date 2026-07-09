# The script layer — the immutable API boundary

**Every plugin element talks to AI Maestro through these scripts. Nothing else may
call the server API.**

Not the skills. Not the commands. Not the agents. Not the hooks. Not the MCP
servers. Not the core `ai-maestro-plugin` — there is no element-level exception,
because the boundary is the *script layer*, not a privileged plugin.

## Why

The AI Maestro API changes constantly. There are a dozen plugins in the ecosystem
and more coming. If a skill embeds `curl http://localhost:23000/api/agents/…`,
then every API change breaks every plugin that guessed the endpoint, and shipping
a rename means republishing twelve repos.

The scripts in `~/.local/bin/` are that problem's answer. Their **command surface
is immutable**; the server API behind them is free to move. Adding capability
means a **new subcommand or a new optional flag** — never a changed one, never a
removed one.

The scripts live in **this repo** (`scripts/*.sh`), not in any plugin. A plugin
that needs a call the layer does not offer does not reach past it — it asks for
the script to gain a subcommand.

## The scripts

Installed to `~/.local/bin/` and on `PATH`.

### `aimaestro-session.sh` — drive an agent's terminal

| Subcommand | Does |
|---|---|
| `inject <agent> <text>` | type raw text into the agent's tmux pane |
| `slash <agent> <command>` | send a slash command (`/compact`, `/reload-plugins`) |
| `slash-keys <agent> …` | send a slash command plus keystrokes |
| `state <agent>` | the agent's live activity state (5-state model) |
| `read-prompt <agent>` | read a pending permission / AskUserQuestion menu |
| `answer <agent> …` | answer that pending prompt |
| `queue <agent> <command>` | enqueue a command to fire at the next safe idle prompt |
| `queue-list <agent>` | list pending queued commands (FIFO) |
| `queue-cancel <agent> <entry>` | cancel one queued command |

### `aimaestro-panel.sh` — drive the dashboard HTML side panel

| Subcommand | Does |
|---|---|
| `set <agent> --html … \| --url …` | render content in the agent's side panel |
| `open <agent>` / `close <agent>` / `refresh <agent>` | control the panel |
| `status <agent>` | connected dashboard clients + pending feedback count |
| `feedback <agent>` | drain the feedback events the panel's HTML posted back |

Pushed HTML renders in a sandboxed `iframe srcdoc` **without** `allow-same-origin`.
A live `--url` renders with `allow-same-origin` and only `https:`/`http:` schemes
are accepted (`javascript:`, `file:`, `data:` are rejected with a 400).

`set` returns `delivered: N`. **`delivered: 0` means the message was DROPPED**,
not queued — the panel is a live surface, unlike the command queue. Zero means no
dashboard currently has that agent active.

### `aimaestro-trdd.sh` — the 3-pillars task API

`search` · `read` · `edit` · `approve` · `refuse` · `promote` · `archive`

`archive` accepts `completed`, `cancelled`, `superseded` — and **refuses
`failed`**, because a failed TRDD is retryable and stays open. Giving up on it is
an explicit `cancel`.

### `amp-kanban-*.sh` — the team board

`list` · `get` · `create-task` · `move` · `edit` · `archive`

`move` is the narrow verb (status only). `edit` is the general one: every field
the task PUT accepts. Both speak the ratified 17-column vocabulary, 1:1 with the
TRDD `column:` field. Consumers align to that vocabulary; it never bends to them.

### The rest

`aimaestro-agent.sh` (agent lifecycle) · `aimaestro-teams.sh` ·
`aimaestro-governance.sh` · `aimaestro-hook.sh` (the shim every plugin's hook
calls instead of the API) · the `amp-*.sh` messaging family · the `aid-*.sh`
identity family.

## Authorization — what actually happens when you call one

The scripts authenticate with `Authorization: Bearer $AID_AUTH`. The server then
applies the R32 dual path:

- **Agent caller** (Bearer `aim_tk_*`) — never sees a sudo prompt. Authorized by
  AID identity plus governance title.
- **USER caller** (session cookie) — strict routes require a fresh, one-shot,
  subject-and-operation-bound sudo token, obtained by re-entering the governance
  password.

Since TRDD-D3RP7KQZ (2026-07-09) the rule for an agent is:

> **An agent may drive its own surface. It may never reconfigure itself.**

So `inject`, `slash`, `answer`, `queue`, and every `panel` verb work on the
agent's **own** id. Targeting *another* agent needs MANAGER, or CHIEF-OF-STAFF
within its own team. Configuration — role plugin, extensions, MCP, hooks,
sub-agents, title, team — is refused on self for every title, including MANAGER.

### Two things that are NOT true yet

Documented here rather than discovered later:

1. **The `aimaestro-trdd.sh` write verbs 403 for agents.** `edit`, `approve`,
   `refuse`, `promote`, and `archive` are strict routes still sitting in
   `AGENT_POLICY_PENDING` (`lib/sudo-guard.ts`) — they need a `manage-trdd`
   AuthAction whose matrix mirrors the approval tiers. `search` and `read` work.
   The refusal is explicit (`agent_policy_undefined`), not a silent failure.
2. **There is no USER auth path in the scripts.** `scripts/shell-helpers/common.sh::get_auth_args`
   emits only the AID bearer. A human running `aimaestro-panel.sh status <agent>`
   from a terminal gets `401 auth_required`. Teaching `get_auth_args` about the
   `aim_session` cookie is open work.

## How they reach `~/.local/bin/`

| Path | Mechanism |
|---|---|
| Fresh install | `remote-install.sh` → `install.sh --from-remote` → `install-messaging.sh -y` |
| Update | `update-aimaestro.sh` → `install-messaging.sh -y` |
| Update (remote) | `remote-install.sh` update branch → `install.sh --from-remote` |

`install-messaging.sh` copies `scripts/*.sh` **by glob**, so a new wrapper is
picked up with no installer edit. Adding a script to `scripts/` is enough.

If a wrapper is missing from `~/.local/bin/`, the installer simply has not been
re-run since that wrapper landed. Re-run `./install-messaging.sh -y`.

## Adding a capability

1. Add a **new subcommand** or a **new optional flag** to the relevant script.
   Never change or remove an existing one — a plugin somewhere calls it.
2. If the route is strict, declare its agent policy in `lib/sudo-guard.ts`
   (`STRICT_AGENT_RULES`, `SYSTEM_OWNER_ONLY_STRICT`, or `AGENT_POLICY_PENDING`).
   A coverage test fails if you don't, which is the point: a strict route with no
   declared policy 403s every agent silently, and that is how the entire write
   surface of one epic shipped inert.
3. Document it here.
4. Tell the plugins. A capability nobody knows about is not a capability.
