# The frozen script manifest

**The authoritative list of the skill-facing CLI scripts AI Maestro ships, and their
frozen signatures.** This is the contract a plugin may depend on. Nothing else is.

Read [SCRIPT-LAYER.md](./SCRIPT-LAYER.md) first — it explains *why* the layer exists,
what the authorization model is, and what each of the main scripts *means*. This file is
the other half: the exhaustive **inventory** and the **freeze contract**.

Generated from `scripts/*.sh` **in this repo** — deliberately *not* from a host's
`~/.local/bin/`. A deployed directory is one machine's snapshot; using it as the source
of truth is exactly what §5 shows going wrong.

- Source of truth: `scripts/*.sh` (75 files at the time of writing)
- Install target: `~/.local/bin/` (via `install-messaging.sh`, by glob)
- Last reconciled: 2026-07-14 — commit `abc3514c`

---

## 1. The freeze contract

**Frozen** means: for every script in §2, its **name**, its **subcommand set**, and every
**existing flag** are permanent. The API behind them is free to move; the surface is not.

| You may | You may not |
|---|---|
| add a **new** subcommand | rename or remove a subcommand |
| add a **new optional** flag | rename, remove, or make-required an existing flag |
| add a field to a JSON output | remove or rename a field a caller may read |
| widen what an argument accepts | narrow it |
| change the HTTP route a script calls | change what the script is *called with* |

A plugin that needs a call the layer does not offer **asks for a new subcommand**. It does
not reach past the layer — not with `curl`, not with `fetch`, not from a hook, not from an
MCP server. That rule has no element-level exception, including the core plugin.

**Tiers, and what each promises:**

| Tier | Promise |
|---|---|
| **A — frozen CLI** (§2, 43 scripts) | a contract. Call these. |
| **B — internal library** (§3, 12 files) | *sourced*, not executed. Not a contract; may change without notice. |
| **C — operator/dev** (§4, 20 scripts) | ships to `~/.local/bin` by glob, but is **not** a plugin-facing API. Do not call from a plugin. |
| **D — dead** (§5) | referenced by plugins, **absent from source**. Never call. Fix the caller. |

43 + 12 + 20 = 75, the whole of `scripts/*.sh`. Every file is in exactly one tier.

---

## 2. Tier A — the frozen skill-facing CLI (43 scripts)

### 2.1 `aimaestro-*` — the server surface (8)

Everything that touches the AI Maestro API goes through one of these eight. They all
accept `help`, all read `AID_AUTH` / `AIMAESTRO_SUDO_TOKEN` / `AIMAESTRO_API_BASE` (§6).

#### `aimaestro-agent.sh <command> [options]` — agent lifecycle

Frozen subcommands (19):

```
list · show · config · resolve · create · delete · update · rename · session
hibernate · wake · restart · skill · plugin · export · import · presence · help
```

- `create <name> --dir <path> [options] [-- <program-args>…]`
- `resolve <name> | --cwd <dir>` → the agent's tmux session name
- `config <agent>` → consolidated config (teams, repo, docker, tasks, AID)
- `presence` → the human user's last input + idle window
- `session`, `skill`, `plugin` are sub-dispatchers; each takes `--help`.

Shared flag vocabulary (all frozen where they appear):
`--all --avatar --client --cwd --delete-folder --dir --dry-run --force --format --github-repo
--include-data --json --keep-data --keep-folder --label --model --name --no-folder --no-session
--output --plugin --program --quiet --rename-folder --rename-session --role --scope --status
--tags --team --title --type --wait --yes`

#### `aimaestro-session.sh <command> <agent> [flags]` — drive an agent's terminal

| Subcommand | Flags |
|---|---|
| `inject <agent> --command "<text>"` | `--no-newline`, `--require-idle` |
| `slash <agent> <command-key>` | — |
| `slash-keys` | — (takes no agent) |
| `state <agent>` | `--pane` |
| `read-prompt <agent>` | — |
| `answer <agent>` | `--option <key>` \| `--text "<answer>"` |
| `queue <agent>` | `--command "<text>"` \| `--command-key <key>`; `--when idle\|online\|now-if-idle-else-queue`; `--wake-first` |
| `queue-list <agent>` | — |
| `queue-cancel <agent> <entryId>` | — |

`queue` is the reason a hibernated agent is **never waited on** — see SCRIPT-LAYER.md.

#### `aimaestro-panel.sh <command> <agent> [flags]` — the dashboard side panel

| Subcommand | Flags |
|---|---|
| `open <agent>` | `--url <https-url>` |
| `close <agent>` / `refresh <agent>` | — |
| `set <agent>` | exactly one of `--html-file <path>` \| `--html "<html>"` \| `--url <https-url>` |
| `status <agent>` | — |
| `feedback <agent>` | — (drains: read + clear) |

HTML is capped at 2 MB; `javascript:` / `file:` / `data:` URLs are rejected 400.
`set` returns `delivered: N` — **`0` means DROPPED, not queued.**

#### `aimaestro-trdd.sh <command> <trdd-id> [flags]` — the 3-pillars task SSOT

| Subcommand | Flags |
|---|---|
| `search` | `--column C` `--id I` `--keyword K` `--zone proposals\|tasks\|archived\|refused` |
| `read <id>` | — |
| `verify <id>` | `--json` — **is this card's approval REAL?** exit `0` verified · **`2` NOT verified** · `1` error |
| `edit <id>` | `--set k=v` (repeatable) — frontmatter in place, no folder move |
| `approve <id>` | `--approver W` `--tier N` `--rationale R` — proposal → planned, `git mv` proposals/ → tasks/ |
| `refuse <id>` | `--approver W` `--tier N` `--reason R` — → refused/ |
| `promote <id> --column C` | `--note N` `--approver W` — advance in place |
| `archive <id> --state S` | `--reason R` `--superseded-by ID` `--approver W` |

Global: `--agent <uuid\|name>` operates on that agent's `<workdir>/design` corpus.
`archive --state` accepts `completed`, `cancelled`, `superseded` — and **refuses `failed`**
(a failed TRDD is retryable and stays open; giving up is an explicit `cancel`).
Nothing is committed for you.

> **The write verbs work for agents as of `d7531e53` (TRDD-K2WJH7RF).** `edit`, `approve`,
> `refuse`, `promote`, `archive` used to 403 every agent with `agent_policy_undefined`.
> They are now governed by the `manage-trdd` AuthAction, whose matrix mirrors the approval
> tiers (`none < orchestrator < chief-of-staff < manager < user`): approval authority is
> read from the TRDD's own `min-approval-requirement:`, no agent may approve a `user`-tier
> TRDD, and **no one may approve their own proposal** — MANAGER included.
>
> **`approve` now MINTS a signed approval token, and `verify` reads it back
> (ai-maestro#47).** The approval is recorded as `approval-token:` in the card's
> frontmatter — a host-signed, ledger-anchored portfolio token PINNED to that card. `verify`
> answers from the TOKEN, never from the card's prose: `approval-judge:` and the
> `## Approval log` line are exactly what a forger rewrites, so the only thing taken from
> the file is the token id. It checks the signature, the R34 ledger anchor, that the issuer
> **still** holds its title, and that the issuer's authority **meets the card's
> `min-approval-requirement:`** — so a COS-issued token cannot satisfy a manager-tier card,
> and no agent token can ever satisfy a `user`-tier one.
>
> **What it does NOT prove:** the token binds an approval to the card's *identity*, not its
> *content*. Someone with repo write can still edit the body after approval, and `verify`
> will still say the approval is authentic — because it is. Freezing content needs a card
> digest inside the token (`attestation_ref`, reserved). Do not describe a verified approval
> as vouching for the body.

#### `aimaestro-teams.sh <command> [flags]` — teams

| Subcommand | Flags |
|---|---|
| `list` / `show <teamId>` | — |
| `create --name N` | `--description D` `--agents u1,u2` `--type T` `--cos UUID` `--password P` `--gh-owner O` `--gh-repo R` |
| `update <teamId>` | `--name` `--description` `--agents` `--orchestrator UUID\|null` `--gh-owner` `--gh-repo` |
| `delete <teamId>` | `--password P` `--delete-agents` |
| `add-agent <teamId> <agentUUID>` | `--password P` |
| `remove-agent <teamId> <agentUUID>` | `--password P` |
| `kanban-config <teamId>` | `--get` \| `--set <columns-json>` \| `--set-file <path>` (1..20 columns) |
| `tasks <teamId>` | — |
| `reassign-cos <teamId> <agentUUID> --password P` | — |

#### `aimaestro-governance.sh <command> [flags]` — governance

| Subcommand | Flags |
|---|---|
| `login` | — (prompts on the **TTY**) — **the human's way in** (#55). Stores a session TOKEN at `~/.aimaestro/cli-session` (0600); every `aimaestro-*.sh` / `amp-*.sh` then authenticates as you |
| `logout` | — (forgets the stored token) |
| `whoami` / `status` | — (manager, owner title, hasManager) |
| `invalidate-password` | — (prompts on the **TTY**; never takes the password as an argument) |
| `requests` | `--status S` `--type T` `--host H` `--agent A` |
| `request` | `--type T` `--password P` `--target-host H` `--requested-by RB` `--role R` `--agent A` \| `--payload-json '{…}'` |
| `approve <id> --password P` | `--approver UUID` |
| `reject <id> --password P` | `--rejector UUID` `--reason R` |
| `transfer list` | `--team ID` `--agent ID` `--status S` |
| `transfer create --agent ID --from-team ID --to-team ID` | `--note TEXT` |
| `transfer resolve <transferId> --action approve\|reject` | `--reject-reason TEXT` |

#### `aimaestro-portfolio.sh <command> [flags]` — approval / mandate tokens (R28)

The **verification surface** (ai-maestro#47, ask 2). `--subject` is always the agent whose
enclave HOLDS the token (the empowered agent), never the issuer.

| Subcommand | Flags |
|---|---|
| `mint --subject A --kind approval\|mandate --scope <resource:action>` | `--binds <trdd-id>` `--binds-agent <id>` `--binds-team <id>` `--ttl <seconds>` |
| `list --subject A` | — (that agent's ACTIVE tokens) |
| `verify --subject A --token <uuid>` | `--binds <trdd-id>` `--binds-agent <id>` `--binds-team <id>` `--scope <resource:action>` `--json` |
| `revoke --subject A --token <uuid>` | — (issuer or system-owner only) |

`verify` re-checks the host's Ed25519 signature over the token, its R34 ledger anchor, that
the issuer **still holds** the title it minted under, and its status / expiry / uses — then
answers with a **verdict** (which checks passed, and what the token actually binds), never a
bare boolean.

**`verify` exit codes are the contract:** `0` VALID · **`2` INVALID** (the server answered:
the token does not verify) · `1` ERROR (usage / transport / HTTP — the verdict is *unknown*).
`0` vs `2` vs `1` is the whole point: *"not authentic"* and *"could not ask"* demand different
responses, and collapsing them turns a verifier outage into a verifier **bypass**. So:

```bash
aimaestro-portfolio.sh verify --subject "$ME" --token "$TOK" --binds K3QX9P2W \
  || { echo "unverified mandate — refusing to act"; exit 1; }
```

**Ask the specific question.** `--binds <trdd-id>` turns *"is this token real?"* into *"is this
an approval **for this card**?"* — the vague question is the one a genuine token replayed from
someone else's card passes.

Agent-primary (R32): an agent authorizes by `AID_AUTH` + title and faces **no sudo gate** here.

#### `aimaestro-hook.sh <command> --cwd <dir> [flags]` — the hook shim

The **only** thing a plugin's Claude Code hook may call. (The hook itself stays in the
plugin; it must not `fetch` the API.)

| Subcommand | Flags |
|---|---|
| `activity --cwd <dir>` | `--status S` `--hook-status H` `--notification-type idle_prompt\|permission_prompt\|elicitation_dialog` `--subagent-count N` `--error-type E` `--end-reason R` |
| `notify --cwd <dir> --message <text>` | — |
| `check-messages --cwd <dir>` | `--json` |

---

### 2.2 `amp-*` — the messaging + kanban + repo surface (28)

Every one accepts `--help`, and every one accepts the identity flags `--id <uuid>` and
(where noted) `--name <agentName>` (§6.1).

**Messaging**

| Script | Signature |
|---|---|
| `amp-init.sh` | `[--auto] [--name <n>] [--tenant <t>]` |
| `amp-identity.sh` | `[--json] [--brief]` — the first command an agent should run |
| `amp-status.sh` | `[--json]` |
| `amp-send.sh` | `<recipient> <subject> <message> [--priority low\|normal\|high\|urgent] [--type request\|response\|notification\|task\|status] [--reply-to ID] [--context JSON] [--attach FILE …] [--id UUID] [--name NAME]` |
| `amp-reply.sh` | `<message-id> <reply> [--priority P] [--type T] [--attach FILE …] [--id] [--name]` |
| `amp-inbox.sh` | `[--all] [--count]` |
| `amp-read.sh` | `<message-id> [--no-mark-read]` |
| `amp-delete.sh` | `<message-id> [--sent] [--force] [--id]` |
| `amp-download.sh` | `<message-id> [<attachment-id> \| --all] [--dest DIR] [--sent] [--id] [--name]` |
| `amp-fetch.sh` | `[--provider P] [--verbose] [--no-mark] [--id]` |
| `amp-register.sh` | `--provider P (--user-key K \| --token T \| --tenant T) [--name N] [--api-url U] [--force] [--id]` |
| `amp-statusline.sh` | `[--install \| --uninstall \| --test]` — else reads Claude Code's JSON on stdin |

**Kanban** — all speak the ratified 17-column vocabulary (14 lifecycle + `blocked`,
`failed`, `superseded`), 1:1 with the TRDD `column:` field. Consumers align to it; it
never bends to them.

| Script | Signature |
|---|---|
| `amp-kanban-list.sh` | `[--status S] [--assignee A] [--label L] [--task-type T] [--query TEXT] [--team ID] [--id]` |
| `amp-kanban-get.sh` | `<task-id> [--team ID] [--id]` |
| `amp-kanban-create-task.sh` | `<title> [--description D] [--assignee A] [--labels "a,b"] [--status S] [--priority N] [--task-type T] [--parent ID] [--npt "…"] [--eht "…"] [--supersedes "…"] [--relevant-rules "3,27"] [--severity CRITICAL\|HIGH\|MEDIUM\|LOW\|NIT] [--effort S\|M\|L\|XL] [--release-via publish\|deploy\|none] [--external-ref REF] [--team ID] [--id]` |
| `amp-kanban-move.sh` | `<task-id> <status> [--team ID] [--id]` — the narrow verb (status only) |
| `amp-kanban-edit.sh` | `<task-id> (--set k=v \| --set-json k=<json>)… [--team ID] [--id]` — the general one |
| `amp-kanban-archive.sh` | `<task-id> [--team ID] [--id]` |

**Team / project / repo**

| Script | Signature |
|---|---|
| `amp-team-members.sh` | `[--team ID] [--id]` |
| `amp-project-info.sh` | `[--team ID] [--id]` |
| `amp-project-repos.sh` | `[--team ID] [--id]` |
| `amp-list-local-repos.sh` | `[--id]` |
| `amp-clone-repo.sh` | `<url> [<localName>] [--id]` |
| `amp-create-repo.sh` | `<name> [--org O] [--private] [--description D] [--team ID] [--id]` |
| `amp-create-branch.sh` | `<repo-path> <branch-name>` |
| `amp-submit-pr.sh` | `<repo-path> <title> [--body "…"] [--base main]` |
| `amp-task-done.sh` | `<message> [--id]` — reports up to the team's ORCHESTRATOR |
| `amp-task-blocked.sh` | `<reason> [--id]` — high-priority blocker to the ORCHESTRATOR |

### 2.3 `aid-*` — the identity surface (6)

| Script | Signature |
|---|---|
| `aid-init.sh` | `(--auto \| --name NAME) [--force]` — create the Ed25519 identity |
| `aid-status.sh` | `[--json]` |
| `aid-auth.sh` | *(no flags)* → prints the best available bearer token. `TOKEN=$(aid-auth.sh)`. Priority: `$AID_AUTH` → `aid-maestro-token.sh` → legacy AMP key |
| `aid-maestro-token.sh` | `[--url U] [--scope S] [--json] [--no-cache] [--quiet]` — Ed25519 PoP → `aim_tk_*` governance token |
| `aid-token.sh` | `--auth <url> [--scope "…"] [--json] [--no-cache] [--quiet]` — RS256 JWT from a 23blocks auth server |
| `aid-register.sh` | `--auth <url> --token <jwt> --role-id <id> [--api-key K] [--name N] [--description D] [--lifetime S]` |

### 2.4 Other frozen skill-facing CLI (1)

| Script | Signature |
|---|---|
| `mcp-discover.sh` | `<config-path> <server-name> [opts]` \| `--plugin <plugin-name> <server-name> [opts]`; `--format json\|text\|llm` `--raw` `--method <jsonrpc-method>` `--tool-name <name>` — backs the `mcp-discovery` skill |

---

## 3. Tier B — internal libraries (12) — sourced, **not** a contract

These are `source`d by the Tier-A scripts. They are not on any plugin's call path and
their function signatures may change at any time. Do not execute them; do not depend on
them.

| File | Sourced by |
|---|---|
| `agent-helper.sh` · `agent-core.sh` · `agent-commands.sh` · `agent-session.sh` · `agent-skill.sh` · `agent-plugin.sh` | `aimaestro-agent.sh` (in that order) |
| `amp-helper.sh` · `amp-security.sh` · `amp-name-resolve.sh` | every `amp-*` CLI |
| `aid-helper.sh` | every `aid-*` CLI |
| `ecosystem-config.sh` | any script needing marketplace/plugin constants (mirrors `lib/ecosystem-constants.ts`) |
| `pin-node.sh` | `with-node.sh` — the one place that decides which Node this repo runs on |

Also `scripts/shell-helpers/common.sh` (installed to `~/.local/share/aimaestro/shell-helpers/`).

`agent-plugin.sh` is marked **deprecated** in-source: plugin operations now belong to the
API (`ChangePlugin`). It still works; do not build on it.

---

## 4. Tier C — operator / dev scripts (20) — **not** a plugin API

`install-messaging.sh` copies `scripts/*.sh` by glob, so these land in `~/.local/bin` too.
Being on `PATH` does **not** make them a contract. A plugin must never call them.

| Script | What it is |
|---|---|
| `remote-install.sh` · `install-code-analysis-tooling.sh` · `distribute-code-analysis-skill.sh` | installers |
| `setup-tmux.sh` · `setup-tailscale.sh` · `setup-tailscale-serve.sh` · `setup-gateway.sh` · `start-with-ssh.sh` | host setup |
| `with-node.sh` · `build-jsonl-reader.sh` · `bump-version.sh` | build / release (`bash scripts/with-node.sh <cmd>` — the repo needs Node 22) |
| `migrate-r20-disk-layout.sh` · `index-all-agents.sh` | one-shot migrations / maintenance |
| `export-agent.sh` · `import-agent.sh` · `list-agents.sh` | operator equivalents of `aimaestro-agent.sh export/import/list` — **use the CLI subcommands instead** |
| `test-amp-routing.sh` · `test-amp-cross-host.sh` · `test-amp-local-delivery-sig.sh` · `test-tailscale-access.sh` | test suites |

---

## 5. Tier D — DEAD: referenced by plugins, absent from source

**This is the sync bug the manifest exists to expose.** The plugins in
`Emasoft/ai-maestro-plugins` call **24 scripts that this repo does not ship.** They appear
to work on a long-lived host only because `install-messaging.sh` *copies* and never
*prunes* — so deleted scripts survive in `~/.local/bin` as residue. **On a fresh install
they are simply absent, and the skills that call them fail.**

That is precisely why a deployed `~/.local/bin` must never be used as the source of truth,
and why this manifest is generated from `scripts/`.

### 5.1 Orphaned — deleted from the repo, residue on old hosts (20)

Removed in `b862c6b0` (*feat(memory): Phase 7+8 — scripts/docs cleanup + npm package
removal*, **TRDD-70a521d9** — the RAG/CozoDB removal). The **plugin skills were never
updated**:

| Family | Scripts | Still called by |
|---|---|---|
| memory | `memory-search.sh` `memory-helper.sh` | `memory-search` skill (150 refs) |
| docs | `docs-search.sh` `docs-find-by-type.sh` `docs-get.sh` `docs-list.sh` `docs-index.sh` `docs-index-delta.sh` `docs-stats.sh` `docs-helper.sh` | `docs-search` skill (131 refs) |
| graph | `graph-describe.sh` `graph-find-callers.sh` `graph-find-callees.sh` `graph-find-associations.sh` `graph-find-by-type.sh` `graph-find-path.sh` `graph-find-related.sh` `graph-find-serializers.sh` `graph-index-delta.sh` `graph-helper.sh` | `graph-query` skill (100+ refs) |

### 5.2 Phantom — exist nowhere, not even as residue (4)

These are referenced by plugin skills and **do not exist on disk at all** — not in the
repo, not in `~/.local/bin`. They are broken today, on every host:

`memory-tools.sh` · `graph-tools.sh` · `graph-index.sh` · `aimaestro-messages.sh`

### 5.3 The other direction — shipped, but no plugin knows

`aimaestro-session.sh`, `aimaestro-panel.sh`, and `aimaestro-trdd.sh` are Tier A and
**zero plugins reference them**. A capability nobody knows about is not a capability.

### 5.4 Remediation (owners)

| Item | Owner |
|---|---|
| Drop the `graph-query` / `memory-search` / `docs-search` skills, or reimplement them on a shipped surface | `Emasoft/ai-maestro-plugin` |
| Purge the 4 phantom references | `Emasoft/ai-maestro-plugin` |
| Adopt `aimaestro-session.sh` / `-panel.sh` / `-trdd.sh` in the role-plugins | each role-plugin repo |
| Stop `install-messaging.sh` claiming it installed "graph, memory, docs" | this repo |
| Make the installer **prune** a `~/.local/bin` script this repo no longer ships | this repo |

---

## 6. Conventions every Tier-A script honours

### 6.1 Identity

| Flag | Meaning |
|---|---|
| `--id <uuid>` | operate as that agent (the UUID from its `config.json`). Accepted by every `amp-*` CLI. |
| `--name <agentName>` | same, resolved through `~/.agent-messaging/agents/.index.json` (TRDD-VGTXJTZ3). Accepted by `amp-send`, `amp-reply`, `amp-download`. |
| neither | the agent is inferred from the environment (`CLAUDE_AGENT_NAME`, cwd) |

`aimaestro-*` scripts take an `<agent>` positional and accept a **name or a UUID**.

### 6.2 Environment

| Var | Used by |
|---|---|
| `AID_AUTH` | every `aimaestro-*` script — the **agent's** `Bearer` token. `export AID_AUTH="$(aid-auth.sh)"` |
| `AIMAESTRO_SESSION` | the **human's** session token, sent as `Cookie: aim_session=…`. Normally you don't set it — `aimaestro-governance.sh login` writes it to `~/.aimaestro/cli-session` (0600) and the scripts read it from there. `AIMAESTRO_SESSION_FILE` overrides that path. |
| `AIMAESTRO_SUDO_TOKEN` | passed through as `X-Sudo-Token` on strict routes — for **USER** callers. Agent callers never need one. |
| `AIMAESTRO_API_BASE` | override the API base URL (default: this host) |

**Resolution order in `get_auth_args` (first match wins):** `AID_AUTH` → `AIMAESTRO_SESSION`
→ `~/.aimaestro/cli-session`. An agent's own identity must win, so the bearer is checked
first.

> **"Localhost is trusted" was never true, and this table used to say it was** (#55). An
> unauthenticated call to `/api/sessions` from `127.0.0.1` returns **401** — SF-058 closed
> that hole deliberately. So before `login` existed, a HUMAN got 401 from *every* script in
> Tier A: the one sanctioned boundary to the API was unusable by the person who owns the
> machine. A doc line asserting the opposite is what let it go unnoticed.

**The governance password is never part of any of this.** `login` prompts for it on the TTY,
exchanges it for a token once, and discards it. It is never an argument (it would sit in `ps`
and shell history), never an env var (inherited by every child), and never written to disk —
only the token is, and a token expires and can be revoked. A password can do neither.

### 6.3 Authorization (R32 dual path)

- **Agent caller** (`Bearer aim_tk_*`): never sees a sudo prompt. Authorized by AID identity
  + governance title. Since TRDD-D3RP7KQZ: *an agent may drive its own surface; it may
  never reconfigure itself.*
- **USER caller** (session cookie): strict routes require a fresh, one-shot,
  subject-and-operation-bound sudo token, obtained by re-entering the governance password.

**A secret is never an argument.** `aimaestro-governance.sh invalidate-password` prompts on
the TTY — a password on `argv` leaks through `ps` and shell history (TRDD-E9BZ5P7S).

> **Known gap:** `scripts/shell-helpers/common.sh::get_auth_args` emits only the AID
> bearer — there is **no USER auth path in the scripts**. A human running
> `aimaestro-panel.sh status <agent>` from a terminal gets `401 auth_required`. Open work.

---

## 7. Adding a capability

1. Add a **new subcommand** or a **new optional flag**. Never change or remove one.
2. If the route is strict, **declare its agent policy** in `lib/sudo-guard.ts`
   (`STRICT_AGENT_RULES`, `SYSTEM_OWNER_ONLY_STRICT`, or a `deferToRoute` seam). A coverage
   test fails if you don't — which is the point: a strict route with no declared policy
   403s every agent silently, and that is how the entire write surface of one epic shipped
   inert.
3. Update §2 of **this file** and the prose in `SCRIPT-LAYER.md`.
4. **Tell the plugins.** §5.3 is what happens when you don't.

## 8. Verifying this manifest

```bash
# every Tier-A/B/C script this repo ships — must equal 43 + 12 + 20
ls -1 scripts/*.sh | wc -l                     # 75

# scripts a plugin calls but this repo does not ship (must be EMPTY — §5 is the debt)
comm -13 <(ls -1 scripts/*.sh | xargs -n1 basename | sort) \
         <(grep -rhoE '\b[a-z][a-z0-9-]*\.sh' ~/.claude/plugins/cache/ai-maestro-plugins/*/*/ \
            | sort -u)

# scripts on this host that the repo no longer ships (installer residue)
comm -13 <(ls -1 scripts/*.sh | xargs -n1 basename | sort) \
         <(ls -1 ~/.local/bin/*.sh | xargs -n1 basename | sort)
```
