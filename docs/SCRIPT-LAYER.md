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

> **The exhaustive inventory + the frozen signatures live in
> [SCRIPT-MANIFEST.md](./SCRIPT-MANIFEST.md).** This file is the prose: why the
> layer exists, what each main script *means*, and how authorization works. The
> manifest is the contract: every script, every subcommand, every flag — plus the
> scripts the plugins call that this repo does **not** ship (§5 there).

## The scripts

Installed to `~/.local/bin/` and on `PATH`. This section covers the load-bearing
ones; the manifest covers all 74.

### `aimaestro-session.sh` — drive an agent's terminal

| Subcommand | Does |
|---|---|
| `inject <agent> <text>` | type raw text into the agent's tmux pane |
| `slash <agent> <command-key>` | send an allowlisted slash command (`compact`, `reload-plugins`, `janitor-arm`, …) |
| `slash-keys` | list the allowlisted command keys (takes no agent) |
| `state <agent>` | the agent's live activity state (5-state model) |
| `read-prompt <agent>` | read a pending permission / AskUserQuestion menu |
| `answer <agent> …` | answer that pending prompt |
| `queue <agent> --command "<text>" \| --command-key <key>` | enqueue a command to fire at the next safe idle prompt; `--when idle\|online\|now-if-idle-else-queue`, `--wake-first` |
| `queue-list <agent>` | list pending queued commands (FIFO) |
| `queue-cancel <agent> <entry>` | cancel one queued command |

### RULE — a hibernated agent is never waited on; the command is enqueued

**Never block a fleet-wide command on an agent waking up.** `queue` persists
server-side, so a command addressed to a hibernated agent is *held, never
dropped*, and fires the moment that agent next reaches a safe idle prompt.
Delivery is **eventual, not conditional**: the caller returns immediately and
the command still runs, minutes or days later.

```bash
# arm the janitor on an agent — works whether it is live, busy, or hibernated
aimaestro-session.sh queue <agent> --command-key janitor-arm --when idle

# same, but wake it now instead of waiting for someone else to
aimaestro-session.sh queue <agent> --command-key janitor-arm --when idle --wake-first
```

The consequence: **arming the janitor on an agent always succeeds.** Live agents
arm at their next idle window; hibernated agents arm on wake. There is no "the
agent was asleep, so this partially failed" outcome — only "armed now" and
"armed later".

The command being enqueued is `/janitor-arm`, and it is **per-project**: its
skill calls `CronCreate` and stamps
`$CLAUDE_PROJECT_DIR/.janitor/state/heartbeat-armed-at.ts`, so it arms only the
project whose session runs it. That is precisely why it must be *delivered into
each agent's own session* instead of invoked once centrally — and why the queue
is the right carrier.

Do not confuse it with `/janitor-global-arm`, which clears the machine-wide
kill-switch and global-pause flags (`global_control_cli.py arm`, the reverse of
`/janitor-global-disarm`). That command arms no heartbeat, enqueues nothing, and
never touches an agent. **No fleet-wide arm command exists today**; the queue is
what would make one possible.

Verified end-to-end in this repo (TRDD-41FJM8A8):

1. `POST /api/agents/[id]/queue` → `enqueueCommand()` persists the entry to
   `~/.aimaestro/command-queue/<agentId>.json` (atomic write), then calls
   `onQueueEnqueued()`.
2. `onQueueEnqueued()` (`services/agents-core-service.ts`) checks
   `sessionExists`. Hibernated + `wakeFirst` → `wakeAgent({startProgram:true})`.
   Hibernated without it → the entry is simply held.
3. The agent's hook POSTs `idle_prompt` to the activity route; that calls
   `drainCommandQueueForSession()` (`services/sessions-service.ts`), which
   dequeues FIFO and injects via `sendAgentSessionCommand`.

Nothing polls. The drain is hook-driven, so an idle agent costs nothing.

**The authorization limit, stated plainly.** `queue` is a strict route mapped to
the `send-command` action. Who may enqueue *on whom* is the ordinary
`authorize()` matrix, and enqueueing does not widen it:

| Caller | May enqueue on |
|---|---|
| the human USER | any agent (needs a fresh sudo token) |
| **every agent — MANAGER and CHIEF-OF-STAFF included** | **itself only** |

**R42 (2026-07-14, USER-set) revoked the cross-agent grant this table used to
carry** — the MANAGER could enqueue on any agent and a COS on its own team's.
Both are now `403`. `send-command` is a DRIVE action, and no title drives another
agent: a superior's directive is a *message* the recipient decides to act on, not
a keystroke that acts for it. See R42 in `docs/GOVERNANCE-RULES.md`.

So the janitor running inside a MEMBER's session can arm *that* agent and no
other — and now that is true of every session, including the MANAGER's.

**The consequence, stated rather than discovered later: a fleet-wide arm has no
working caller today.** The only principal R42 leaves able to drive another agent
is the human USER — who, per *"One thing that is NOT true yet"* below, has **no
auth path in these scripts at all**. That gap was a nuisance before R42; it is now
the single thing standing between the USER and their own fleet, which is why
teaching `get_auth_args` about the `aim_session` cookie stopped being optional.

### `aimaestro-continuity.sh` — the agent-continuity surface (TRDD-DXJZM3BW)

The ONLY new script surface the Family-A continuity absorption adds (TRDD-KCRMSNL7).
Three **self-scoped** verbs (R42 — the target is always the caller's own agent; the human
owner may target any). The ai-maestro-tailored janitor's `#J` shim calls these; the
server owns all actuation. Everything else (waking, injecting) reuses
`aimaestro-session.sh`.

| Subcommand | Does |
|---|---|
| `status <self>` | the 5 continuity-status fields for this host's account: `account_healthy`, `window_5h_pct`, `window_7d_pct`, `cache_ttl_minutes`, `next_action`. A DELIBERATE metadata ceiling (TRDD-H24DF6ZC) — **no OAuth token can leak through it** |
| `ensure-resume <self>` | idempotently ensure THIS agent is resumed — no-op (`already-live`) if live, else the server resumes it via the existing wake path |
| `restart-self [--force]` | restart THIS agent's OWN tmux session (stop → wait for shell → relaunch with the stored persona). Calls `POST /api/sessions/me/restart`, whose session is DERIVED from the caller's AID — **it takes no target argument**, so no invocation can name another agent (self-only *by construction*, TRDD-4P1M8I18, stronger than the `<self>` verbs' self-only-by-authorization). `--force` overrides the running-subagents refusal. The `#J` continuity path uses it to recover a stuck self |

`status`'s window/cache fields come from the AgentlensPro CLI (observe-only, no token —
TRDD-Y916N7WL); `next_action` is computed server-side (interim from observables until the
OAuth manager TRDD-1GGQ4HWY lands). The server-INTERNAL fleet-wide liveness scan +
cross-agent actuation is TRDD-CHN16JXZ — never a call from this self-scoped surface, because
an agent must not drive another (R42).

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

**`verify` is the one exit-code exception in this whole layer.** It uses `2` = the
approval is INVALID (a substantive answer) and `1` = the check ERRORED — inverted
against the pillar CLIs' trichotomy below, where `1` is the substantive answer and
`2` is the tool failing. It is **grandfathered, not a second convention**:
`governance-spec.md` `R41.enf-verify` pins only *"exits non-zero when the approval
does not verify"*, so renumbering would satisfy the spec, but this is the external
boundary plugins call and a consumer branching on `[ $? -eq 2 ]` lives in a repo
this project cannot audit. Gate on it with `||` — for `verify` both non-zero codes
mean "do not proceed", which is exactly why that idiom is right here and **wrong**
for `trddgrep validate`.

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

And since R42 (TRDD-BF3JN4TL, 2026-07-14) the other half is absolute:

> **An agent may drive ONLY its own surface. No title drives another agent.**

So `inject`, `slash`, `answer`, `queue`, and every `panel` verb work on the
agent's **own** id and nowhere else — targeting *another* agent is `403` for every
caller with an agent identity, MANAGER and CHIEF-OF-STAFF included. Configuration
— role plugin, extensions, MCP, hooks, sub-agents, title, team — is the mirror
image: refused on **self** for every title, and it remains a MANAGER/COS power
over *others* (R42.6 — configuring an agent is not driving it).

The two rules meet cleanly: **an agent shapes what another agent IS, and never
what it DOES.**

The `aimaestro-trdd.sh` write verbs — `edit`, `approve`, `refuse`, `promote`,
`archive` — **work for agents as of `d7531e53`** (TRDD-K2WJH7RF). They are governed
by the `manage-trdd` AuthAction, whose matrix mirrors the approval tiers
(`none < orchestrator < chief-of-staff < manager < user`): the required authority is
read from the TRDD's own `min-approval-requirement:`, no agent may approve a
`user`-tier TRDD, and **nobody may approve their own proposal** — MANAGER included.
Until that landed they 403'd every agent with `agent_policy_undefined`, which made
the CLI half a tool: read the board, never touch it.

### One thing that is NOT true yet

**There is no USER auth path in the scripts.** `scripts/shell-helpers/common.sh::get_auth_args`
emits only the AID bearer. A human running `aimaestro-panel.sh status <agent>` from a
terminal gets `401 auth_required`. Teaching `get_auth_args` about the `aim_session`
cookie is open work.

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

## The pillar CLIs — repo-local, and deliberately NOT on this boundary

Three tools read the 3-pillars corpus (`design/`) **directly off disk, with no
server and no API**, so they are not part of the boundary above:

| `yarn` script | What it is |
|---|---|
| `yarn trddgrep` | query + `lint` + `validate` + `fix` + `env` the TRDD corpus (`--help` lists every subcommand) |
| `yarn trdd:doctor` / `trdd:fix` / `trdd:board` | the 19-rule doctor; `:fix` repairs only the mechanically-derivable findings |
| `yarn pillars:lint` | the cross-pillar reference DAG (`PRRD ← SPECS ← TRDD`) |

**Exit codes — the trichotomy, and it is `grep`'s own** (`0` found · `1` not found ·
`2` could not run, verified by running `grep` directly):

| Code | Meaning |
|---|---|
| `0` | clean — the check ran and found nothing |
| `1` | **findings** — the check ran and the answer is negative |
| `2` | **the check COULD NOT RUN** — an unreadable zone, a missing `design/` dir, a bad flag |

`2` exists because the older two-outcome shape made a gate that read *nothing* exit
`0`: run from the wrong directory and "the corpus is clean" and "I never saw the
corpus" were the same answer. **Never collapse `1` and `2`.** In particular
`trddgrep validate || handle` turns *could-not-run* into *found-findings*, which is
the precise conflation the third code exists to prevent — and `||` is the obvious
thing to copy across from `aimaestro-trdd.sh verify`, where it IS correct.
`--strict` on `lint`/`validate` additionally fails on warnings (exit `1`).

**Flags.** All three take `--design-dir <path>`, so none of them requires being run
from the repo root. `trddgrep` alone takes `--no-index`: it answers the graph
subcommands (`why`/`unblocks`/`roots`/board) from the SQLite index at
`~/.aimaestro/pillar-index/` when one is fresh, and `--no-index` forces the corpus
walk instead. Search is walk-only by design (FTS5 cannot evaluate a regex) and
`show` always re-reads its one file for freshness.

### They ARE installed to `~/.local/bin/` — one launcher, one name per pillar

This section used to argue the opposite, and the argument was overruled by the USER
(2026-07-30) for a reason no amount of internal reasoning would have surfaced: **the
janitor's Claude reported it "has no access to the trddgrep tool at all."** A
3-pillar system every agent is governed by, whose tools only one repo can run, is a
governance document nobody can query. Two independent causes, and both had to be
fixed (TRDD-217AYEOT):

1. **Not distributed.** The installer copies `scripts/*.sh` by glob, and these are
   `*.mjs`.
2. **Not guessable.** The tool was named `greptrdd` — the two words backwards. The
   USER's naming law is that every corpus tool is `<document type>grep`: `memgrep`,
   `trddgrep`, `prrdgrep`, `specgrep`. **A tool whose name cannot be GUESSED from the
   corpus it reads is not installed, whatever the filesystem says.**

`install-messaging.sh` now records the install root at
`~/.local/share/aimaestro/install-root` (never a hardcoded `~/ai-maestro` — a packaged
install has no such directory) and copies **`scripts/pillar-cli`** to `~/.local/bin/`
once per pillar name. That file is the ONE launcher for all of them: it dispatches on
`basename $0`, so there is one implementation and N entry points rather than N scripts
to drift apart. It carries no `.sh` extension **on purpose** — a `pillar-cli.sh` would
also be picked up by the `scripts/*.sh` glob and land under a fourth, undocumented
name. A pillar name is installed only when its `.mjs` exists, so `prrdgrep` and
`specgrep` appear the day they are implemented and never as a stub that refuses: an
agent that finds a tool and gets an error cannot tell *planned* from *broken*.

The Node-22 objection was real and is handled rather than avoided: the launcher sources
`scripts/pin-node.sh` (which version-CHECKS each candidate binary and FAILS rather than
falling back — `better-sqlite3` hard-caps at Node 25), then loads tsx by **absolute**
path with `TSX_TSCONFIG_PATH` pinned. Both halves are required and both were established
by measurement: a bare `--import tsx` resolves against the CWD and dies with "Cannot
find package 'tsx'" from a caller's project, and tsx discovers `tsconfig.json` from the
CWD too, so without the pin the `@/lib/...` aliases go unresolved. It must be `#!/bin/bash`:
sourced from zsh, `pin-node.sh` degrades silently and hands back an out-of-range Node
(measured: bash → v22.23.1, zsh → v26.5.0).

**The corpus is the CALLER's, never the install's.** The launcher keeps the caller's cwd
and defaults `--design-dir` to `$PWD/design`, so `trddgrep` in any project answers about
*that* project. A global tool that resolved `design/` against its own install would
answer every question with ai-maestro's corpus — the "gate that passed because it read
nothing" bug inverted into one that read someone *else's* corpus.

**Which environment am I in?** `trddgrep env` prints `mode=standalone` (a plain project:
the whole 3-pillar surface, never degraded) or `mode=agent` + the agent name (an
ai-maestro registered workdir, which additionally unlocks the verbs that are impossible
without a live server and an AID), always with the reason it concluded that. Detection
reads `~/.aimaestro/agents/registry.json` **read-only** — deliberately not through
`loadAgents()`, which `mkdir`s the state dir before its own existence guard and carries a
migration that SAVES the registry, i.e. an observer that creates what it measures. `env`
is the one verb exempt from the corpus check, because gating it on a corpus existing
removes the diagnostic from exactly the situation that prompts someone to ask for it.

These remain **developer/agent tools over a git-tracked corpus**, not an API surface a
plugin should couple to — the API-facing task verbs are `aimaestro-trdd.sh` above. From
inside this repo, run them through `bash scripts/with-node.sh yarn <script>` if your
shell does not already select Node 22; the installed `trddgrep` selects Node itself.

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
