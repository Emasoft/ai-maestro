# The frozen script manifest

**The authoritative list of the skill-facing CLI scripts AI Maestro ships, and their
frozen signatures.** This is the contract a plugin may depend on. Nothing else is.

Read [SCRIPT-LAYER.md](./SCRIPT-LAYER.md) first — it explains *why* the layer exists,
what the authorization model is, and what each of the main scripts *means*. This file is
the other half: the exhaustive **inventory** and the **freeze contract**.

Derived from `scripts/*.sh` **in this repo** — deliberately *not* from a host's
`~/.local/bin/`. A deployed directory is one machine's snapshot; using it as the source
of truth is exactly what §5 shows going wrong.

**HAND-MAINTAINED, and enforced by a test rather than by a generator.** This line used to say
*"Generated from"*, which was false — nothing generated it — and that false claim is precisely why
it drifted: a reader who believes a file is generated does not check it. On 2026-08-05 it was
missing **7 shipped scripts** and carried **four mutually contradictory counts**. Adding a script to
`scripts/` therefore means adding its row HERE, in the same commit; `tests/unit/script-manifest-announces-every-script.test.ts`
fails the build otherwise. Per **R23.8**, announcing a verb is part of shipping it — an unannounced
verb looks absent, and a plugin that believes the layer lacks what it needs is pushed back toward
`/api/*`.

> ## ⚠ INVOKE EVERY SCRIPT WITH ITS `.sh` SUFFIX — there are no bare-name aliases
>
> `aimaestro-trdd` is **`command not found`**. `aimaestro-trdd.sh` works. This holds for all
> **16** `aimaestro-*` scripts and for every other script in this manifest: **0 of 16 resolve by
> bare name** in `~/.local/bin`, deliberately and permanently.
>
> **Read this before you conclude a tool is missing.** An agent that types the natural name and
> gets `command not found` concludes the CLI does not exist and reaches for `/api/*` instead —
> that is the whole reason this warning sits at the top of the file rather than in a footnote
> (ai-maestro#148).
>
> **Why no aliases, and why not even a partial set** (hub ruling 2026-08-21, superseding the
> 2026-08-20 Option-A comment on #148): `aimaestro-agent` is **already taken on PATH** by an
> unrelated tool — a shim that `exec`s `aimaestro-agent.py`, a separate Python entry point, not
> `aimaestro-agent.sh`. Aliasing the family would collide with it. Aliasing only the other 15
> would be *worse*: bare names would start working everywhere except `aimaestro-agent`, which
> would then silently run **a different program**. `command not found` is a loud failure; running
> the wrong tool is a silent one, and the loud failure is the one this manifest can cure with a
> sentence.
>
> Two lookalikes that are **not** counter-examples: `aimaestro-agent` (the Python shim above) and
> `aimaestro-agent-bash` (a differently-named symlink to `aimaestro-agent.sh`). Neither is a
> bare-name alias of a `.sh` script.

- Source of truth: `scripts/*.sh` (**88** files)
- Install target: `~/.local/bin/` (via `install-messaging.sh`, by glob)
- **Invocation: always with `.sh`.** No bare-name aliases exist or will be added — see the box above.
- Last reconciled: **2026-08-05** — announced the 7 scripts that were shipping unannounced
  (`aimaestro-settings.sh` → Tier A; `aimaestro-check-decoupling.sh`, `install-boot-persistence.sh`,
  `install-pillar-tooling.sh`, `setup-local-marketplaces.sh`, `distribute-tailscale-skill.sh`,
  `simulate-blackout.sh` → Tier C), reconciled four contradictory counts, and added
  `aimaestro-groups.sh` (Tier A, ai-maestro#64 residual 6)

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
| **A — frozen CLI** (§2, 50 scripts) | a contract. Call these. |
| **B — internal library** (§3, 12 files) | *sourced*, not executed. Not a contract; may change without notice. |
| **C — operator/dev** (§4, 29 scripts) | ships to `~/.local/bin` by glob, but is **not** a plugin-facing API. Do not call from a plugin. |
| **D — dead** (§5) | referenced by plugins, **absent from source**. Never call. Fix the caller. |

50 + 12 + 28 = **90**, the whole of `scripts/*.sh`. Every file is in exactly one tier.

---

## 2. Tier A — the frozen skill-facing CLI (50 scripts)

### 2.1 `aimaestro-*` — the server surface (12)

Everything that touches the AI Maestro API goes through one of these twelve. They all
accept `help`, and every one that talks to the server reads `AID_AUTH` /
`AIMAESTRO_SUDO_TOKEN` / `AIMAESTRO_API_BASE` (§6).

> **Sub-counts reconcile: 12 + 28 + 6 + 2 = 48** (§2.1 + §2.2 + §2.3 + §2.4), matching the Tier-A
> total in §1. Measured with `grep -c '^#### \`aimaestro-'` per section, not asserted.
>
> This note previously recorded two things that are now resolved, kept here because the *pattern*
> keeps recurring: the subheading once read `(8)` while NINE entries sat below it, and
> `scripts/aimaestro-settings.sh` shipped **documented in no tier at all** — recorded as "a
> pre-existing gap, left as found rather than classified in passing". It was classified on
> 2026-08-05 (Tier A, §2.4), along with six other unannounced scripts. **Leaving a known gap as
> found is how it survives**: the note describing it reads as coverage.
>
> ⚠ These sub-counts are NOT covered by `tests/unit/script-manifest-announces-every-script.test.ts`,
> which checks only the three tier headings against disk. They can still drift silently — as the
> `(8)`-vs-nine case did. Bump them by hand when adding a `####` section here.

#### `aimaestro-agent.sh <command> [options]` — agent lifecycle

Frozen subcommands (19):

```
list · show · config · resolve · create · delete · update · rename · session
hibernate · wake · restart · skill · plugin · export · import · presence
hibernation · subconscious · help
```

- `create <name> [--dir <path>] [options] [-- <program-args>…]` — `--dir` is OPTIONAL and
  defaults to `~/agents/<name>/`, the only location the server accepts for an agent folder
  (the Wizard's G03 guard rejects any other, and `DeleteAgent` refuses `alsoDeleteFolder`
  outside it). There is still no way to register an agent WITHOUT a folder.
- `resolve <name> | --cwd <dir>` → the agent's tmux session name
- Every `<agent>` argument also accepts the literal `self` / `<self>` — resolved by
  `scripts/shell-helpers/common.sh::_resolve_agent_id` via `GET /api/agents/me` (the caller's
  own AID), not only the continuity verbs that spell `<self>` in their usage lines.
- `config <agent>` → consolidated config (teams, repo, docker, tasks, AID)
- `presence` → the human user's last input + idle window
- `hibernation [--json|--table]` → fleet roster: `running | hibernated | crashed | never_woken`
  per agent (**`hibernated` is HEALTHY — never report it as a fault**), plus persistence rows
  referencing agents no longer in the registry. Nothing in `Agent['status']`
  (`active|idle|offline|deleted`) can answer this — all three down-states read `offline`.
- `subconscious <agent> [--json|--table]` → is that agent's subconscious loop running, and its
  last run. Thin GET wrapper over `/api/agents/{id}/subconscious` (note: **no `/status`
  segment** — the memory-search skill cites one that does not exist). An agent may read only
  its OWN; the system owner may read any. The manual re-index counterpart was removed in
  TRDD-YEE33F3A and is not coming back — automatic indexing already runs.
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

#### `aimaestro-message.sh <command> [flags]` — inter-agent messaging (the governance door)

| Subcommand | Flags |
|---|---|
| `send <recipient-name\|--id UUID>` | `--subject <S>` `--body <B\|->` (`-` = stdin) `[--priority normal\|high\|urgent]` `[--type <amp-type>]` `[--reply-to <message-id>]` `[--from <sender>]` (owner path ONLY — an agent's sender is AID-overridden) |
| `resolve <name-pattern>` | — (TSV `name<TAB>id<TAB>title`; exit 0 one / 3 transport / 4 zero / 5 ambiguous / 7 auth) |
| `replies <message-id>` | `[--limit N]` `[--agent <name-or-id>]` (owner path) — TSV reply rows; exit 4 = none yet |

Thin transport over the SendMessage AIO pipeline (R6-gated, AID-attributed, logged); the
DISTINGUISHABLE exit codes are the contract — amp-send.sh is the feature-rich sibling on the
same pipeline (attachments, `--context`), this is the door a scripted gate branches on.
Exit 6 = R6 REFUSED with the server's routing hint verbatim on stderr: follow it, never
retry around it. (TRDD-0AB76JG3 / TRDD-BGAH6PHP; shipped 2026-08-20.)

#### `aimaestro-plugins.sh <command> [flags]` — plugin-update observability

| Subcommand | Flags |
|---|---|
| `update-trail` | `[--limit N]` `[--target <pluginId>]` `[--json]` |

One row per `claude plugin update` invocation the fleet-plugins-update lane ran
(`{target, scope, project, start_epoch, end_epoch, ok, detail, by}`, newest first) — the
per-fire attribution a last-run-only stamp cannot give. Empty trail = exit 0 with zero
rows (a legal fresh state, not an error). (TRDD-MNN0VAS6; shipped 2026-08-20.)

#### `aimaestro-continuity.sh <command> [args]` — agent-continuity (self-scoped)

| Subcommand | Args / flags |
|---|---|
| `status <self>` | — |
| `ensure-resume <self>` | — |
| `restart-self` | `--force` |

`status`/`ensure-resume` take the caller's own `<self>` (R42 self-only). `restart-self`
takes **no target** — it calls `POST /api/sessions/me/restart`, whose session is DERIVED
from the caller's AID, so no invocation can name another agent (self-only by construction,
TRDD-4P1M8I18). `--force` overrides the running-subagents refusal. See SCRIPT-LAYER.md.

#### `aimaestro-panel.sh <command> <agent> [flags]` — the dashboard side panel

| Subcommand | Flags |
|---|---|
| `open <agent>` | `--url <https-url>` |
| `close <agent>` / `refresh <agent>` | — |
| `set <agent>` | exactly one of `--html-file <path>` \| `--html "<html>"` \| `--url <https-url>` |
| `status <agent>` | — |
| `feedback <agent>` | — (drains: read + clear) |

HTML is capped at 2 MB — enforced server-side (`lib/panel-messages.ts`) AND pre-checked
client-side before the file is read into memory (`--html-file` fails fast naming the
2,097,152-byte limit; oversized artifacts use `--url`). `javascript:` / `file:` / `data:`
URLs are rejected 400. `set` returns `delivered: N` — **`0` means DROPPED, not queued.**
Installed to `~/.local/bin` by `install-agent-cli.sh` (in `INSTALLED_FILES` since
TRDD-COOLOZ1N ruling 1 — re-running the installer is the re-sync path for stale copies).

#### `aimaestro-trdd.sh <command> <trdd-id> [flags]` — the 3-pillars task SSOT

| Subcommand | Flags |
|---|---|
| `search` | `--column C` `--id I` `--keyword K` `--zone proposals\|tasks\|archived\|refused` |
| `read <id>` | — |
| `verify <id>` | `--json` — **is this card's approval REAL?** exit `0` verified · **`2` NOT verified** · `1` error |
| `edit <id>` | `--set k=v` (repeatable) — frontmatter in place, no folder move |
| `approve <id>` | `--approver W` `--rationale R` — proposal → planned, `git mv` proposals/ → tasks/ |
| `refuse <id>` | **`--reason R` (REQUIRED)** · `--approver W` — → refused/ |
| `promote <id> --column C` | `--note N` `--approver W` — advance in place |
| `archive <id> --state S` | `--reason R` `--superseded-by ID` `--approver W` |

**`refuse` REQUIRES `--reason`, and it must name a DEFECT** (ai-maestro#71, R49 — the refusal
protocol). An empty reason is rejected, and so are the stock dismissals (`denied`, `no`, `wontfix`,
`out of scope`, `insufficient`, …) — those are a verdict, not a finding. The error names the three
elements a refusal must carry: the precise defect, the bar for acceptance, and an invitation to
re-propose. **`approve` is deliberately exempt** — an approval that says nothing is merely terse; a
refusal that says nothing is the failure the protocol was ratified from. This is an ADDITIVE
tightening of a required-argument rule, not an interface change: every previously-valid `refuse`
call that named its defect still works.

**`--tier` is DEPRECATED on `approve`/`refuse` and is NOT sent** (ai-maestro#69). It is still
accepted, so every previously-valid call still works — but it now takes the five ladder NAMES
below (the numeric form `0..3` is decoded for compatibility) and REJECTS an unmatchable value
instead of accepting it silently. It was dead in both directions: the server retired the field
(#66 Q9) so the value was discarded, while the CLI demanded a number and so rejected the very
names this section publishes. The approval requirement is the CARD's, not the approver's — set
it with `edit <id> --set min-approval-requirement=<name>`.

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
| `update <teamId>` | `--name` `--description` `--agents` `--orchestrator UUID\|null` **`--cos UUID` \| `--remove-cos`** `--gh-owner` `--gh-repo` |
| `delete <teamId>` | `--password P` `--delete-agents` |
| `add-agent <teamId> <agentUUID>` | `--password P` |
| `remove-agent <teamId> <agentUUID>` | `--password P` |
| `kanban-config <teamId>` | `--get` \| `--set <columns-json>` \| `--set-file <path>` (1..20 columns) |
| `tasks <teamId>` | — |
| **`stats`** | — · **ALL-teams aggregate counts. Takes NO teamId** (ai-maestro#64 residual 3) |
| `reassign-cos <teamId> <agentUUID>` | `--password P` *(OPTIONAL)* — thin alias of `update --cos` |

**`update --cos <uuid>` / `--remove-cos` is the #64-canonical way to move the COS slot on an
EXISTING team** (`20f5ba72`, TRDD-RIFM4UXN). **MANAGER-by-AID, no governance password** — R32.3
forbids the password passing through a model — plus a **self-assign ban**: an agent may not make
itself or its ally the COS, which would otherwise be a fleet-takeover primitive. The human/UI path
keeps its password confirmation unchanged, so this is a strict superset with zero human-side
weakening. `reassign-cos` survives as a thin alias and its `--password` is now OPTIONAL, not
required as this table previously showed.

The team PUT deliberately **strips `chiefOfStaffId`**, so moving the COS slot always goes through
this verb rather than through a generic field update.

`kanban-config --set` **rejects a custom board that drops any governance column id** (`06e8ffe6`).
The 14 that must survive: `ai_review` `complete` `deploy` `design` `design_ai_review`
`design_human_review` `dev` `failed` `human_review` `live` `live_auditing` `publish` `published`
`superseded`. Freely renameable/omittable: `backburner` `approval` `todo` `verify_assumptions`
`plan` `dispatch` `testing` `blocked`.
**This prose is a MIRROR, not the source** — `GATE_CRITICAL_COLUMN_IDS` is DERIVED in
`lib/kanban-field-authority.ts` by spreading the gate's own sets, precisely so a future change to
what is governed updates the config check automatically. If this list and that constant ever
disagree, the constant is right and this line is stale. A board that renamed `human_review` left the self-review
ban's predicates unmatchable — the gate still ran, it just could never fire.

`create --type T` is vestigial: `TeamType` is the single-valued union `'closed'`, so there is
nothing to select. `update` has no `--type` and will not gain one (ai-maestro#64 residual 5).

#### `aimaestro-groups.sh <command> [flags]` — groups (ai-maestro#64 residual 6)

| Subcommand | Flags |
|---|---|
| `list` / `show <groupId>` | — |
| `create --name N` | `--description D` `--subscribers u1,u2` |
| `update <groupId>` | `--name N` \| `--description D` \| `--subscribers u1,u2` (at least one required) |
| `delete <groupId>` | — |
| `subscribe <groupId> <agentUUID>` | — |
| `unsubscribe <groupId> <agentUUID>` | — |
| `notify <groupId> --message M` | `--priority low\|normal\|high\|urgent` |

**Groups are NOT teams, and the authorization difference is the point.** A team is a governed
structure — closed messaging, an ACL, a COS, a kanban board — so creating or deleting one is a
governance action carrying the password. A group is a lightweight, unstructured collection used for
fan-out notification and **confers no authority**, so per **R20** every route here is *authenticated
but governance-FREE*: an agent authenticates by AID and that is the whole check.

**There is deliberately NO `--password` on any subcommand.** Adding one would imply a gate the
server does not have, and R32.3 forbids the governance password passing through a model regardless.

`update` sends only the flags actually given: both schemas are `.strict()` (an unsolicited key is a
**400**, not an ignored field), and every field is optional on PUT — so a blanket body would reach
2xx while silently CLEARING whatever the caller did not mention. `--priority` is validated in the
CLI before the request, so an unmatchable value fails locally naming the valid set rather than
costing a round-trip.

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

#### `aimaestro-statusline.sh <command> [flags]` — the statusline observation feed (TRDD-D8OYFG35)

The **only** thing that knows the `/api/statusline/*` endpoints. Claude Code hands its
`statusLine` command a payload that already carries the 5-hour and 7-day rate-limit
windows, computed locally at **zero API cost**; this is how that number reaches the fleet
instead of being thrown away.

| Subcommand | Flags | Notes |
|---|---|---|
| `ingest` | `--file PATH` | payload on stdin, or from PATH. Needs **no** credential — the route is console-only |
| `get <sessionId>` | — | that session's last observation + its age |
| `list` | — | fleet roll-up: the TIGHTEST 5h/7d window across live sessions |

`resets_at` is normalised to **epoch milliseconds** at the server boundary, from either
wire format (this feed sends epoch seconds; `/api/oauth/usage` sends ISO 8601).
The model-scoped weekly windows, `severity` and `is_active` are **not** in this feed and
remain endpoint-only.

#### `aimaestro-statusline-capture.sh [--] <inner command…>` — the statusline wrapper

A PASS-THROUGH, not a replacement: Claude Code supports exactly one `statusLine` command,
so "capture in addition" means wrapping. Reads stdin once, forks
`aimaestro-statusline.sh ingest` **detached**, and hands the identical bytes to the inner
command — relaying its stdout byte-for-byte and its exit code unchanged. Never writes to
stdout itself; fails soft when the server is down, slow, or absent.

Env: `AIMAESTRO_STATUSLINE_CLI` (override the ingest CLI path),
`AIMAESTRO_STATUSLINE_DEBUG` (diagnostics to stderr).

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
| `amp-kanban-list.sh` | `[--status S] [--assignee A] [--label L] [--task-type T] [--parent TASK_ID] [--query TEXT] [--team ID] [--id]` |
| `amp-kanban-get.sh` | `<task-id> [--team ID] [--id]` |
| `amp-kanban-create-task.sh` | `<title> [--description D] [--assignee A] [--labels "a,b"] [--status S] [--priority N] [--task-type T] [--parent ID] [--npt "…"] [--eht "…"] [--supersedes "…"] [--relevant-rules "3,27"] [--severity CRITICAL\|HIGH\|MEDIUM\|LOW\|NIT] [--effort S\|M\|L\|XL] [--release-via publish\|deploy\|none] [--external-ref REF] [--attachment "URL\|NAME\|KIND"]… [--team ID] [--id]` |
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

### 2.4 Other frozen skill-facing CLI (2)

| Script | Signature |
|---|---|
| `mcp-discover.sh` | `<config-path> <server-name> [opts]` \| `--plugin <plugin-name> <server-name> [opts]`; `--format json\|text\|llm` `--raw` `--method <jsonrpc-method>` `--tool-name <name>` — backs the `mcp-discovery` skill |
| `aimaestro-settings.sh` | `get <path>` · `set <path> --key <dot.path>\|--key-json <arr> --value <v> [--no-create]` · `delete <path> --key\|--key-json [--no-create]` · `edit <path> --ops '<json array>'` — the gated `settings.json` / `settings.local.json` editor |

**`aimaestro-settings.sh` is the ONLY sanctioned way to mutate a `settings.json`.** It is
Tier A despite not calling the HTTP API — deliberately so: it invokes
`scripts/aimaestro-settings-cli.mjs` in-process because the installer runs with the server
DOWN, and an HTTP-only tool would be useless at the moment it is most needed. It shares
`lib/settings-gate.ts` with `app/api/settings/edit/route.ts`, and both delegate to
`lib/json-io.ts`'s `updateJson` — the ONE lock-and-write path for every settings mutation in
this codebase.

That single-path property is the whole point, and it is why hand-editing is forbidden rather
than merely discouraged: a non-atomic write produces the torn file that a lenient reader then
parses as `{}` and replaces, so one defect creates the damage another completes. `<path>` must
be an absolute `settings.json`/`settings.local.json` living directly inside a `.claude`
directory — the guard that stops this becoming an arbitrary-file writer.

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

## 4. Tier C — operator / dev scripts (29) — **not** a plugin API

`install-messaging.sh` copies `scripts/*.sh` by glob, so these land in `~/.local/bin` too.
Being on `PATH` does **not** make them a contract. A plugin must never call them.

| Script | What it is |
|---|---|
| `remote-install.sh` · `install-code-analysis-tooling.sh` · `distribute-code-analysis-skill.sh` · `install-agentlens.sh` | installers |
| `setup-tmux.sh` · `setup-tailscale.sh` · `setup-tailscale-serve.sh` · `setup-gateway.sh` · `start-with-ssh.sh` | host setup |
| `with-node.sh` · `build-jsonl-reader.sh` · `bump-version.sh` | build / release (`bash scripts/with-node.sh <cmd>` — the repo needs Node 22) |
| `migrate-r20-disk-layout.sh` · `index-all-agents.sh` · `heal-amp-addresses.sh` | one-shot migrations / maintenance (`heal-amp-addresses.sh` batch-applies the AMP address self-heal to every registered config — TRDD-17K0SHDQ W-A, ai-maestro#46; deliberately named OUTSIDE the frozen `amp-*` family so the manifest builder's by-construction discriminator keeps it out of the skill-facing contract. Exit `0` sweep completed · `2` could not run) |
| `export-agent.sh` · `import-agent.sh` · `list-agents.sh` | operator equivalents of `aimaestro-agent.sh export/import/list` — **use the CLI subcommands instead** |
| `test-amp-routing.sh` · `test-amp-cross-host.sh` · `test-amp-local-delivery-sig.sh` · `test-tailscale-access.sh` · `simulate-blackout.sh` | test suites |
| `install-boot-persistence.sh` · `install-pillar-tooling.sh` · `setup-local-marketplaces.sh` · `distribute-tailscale-skill.sh` | installers / host setup (added 2026-08-05 — previously shipped and unannounced) |
| `sweep-external-blockers.sh` | **the stale-external-blocker re-check** (TRDD-8GBIQMEP). The board has no field for an external blocker, so an external wait lives only in prose and nothing re-checks it — this is the re-check. Read-only: greps `design/tasks/*.md` for issue refs in a BLOCKING context, resolves each via `gh issue view`, prints `card \| issue \| STATE`. Exit `0` every cited blocker still OPEN · `1` at least one CLOSED (a card holds a dead claim) · **`2` a ref could not be resolved** and nothing is CLOSED |
| `aimaestro-check-decoupling.sh` | **the R23 compliance gate, made runnable.** Scans a plugin tree for direct `/api/` calls — code *and* `.md` prompts, since a SKILL telling an agent to `curl` is a bypass. Self-tests its own needle each run. Exit `0` clean · `1` findings · **`2` COULD NOT RUN** |

> **`aimaestro-check-decoupling.sh` is Tier C by AUDIENCE, not by importance.** It is an
> audit/CI tool a plugin author runs *against* a tree — not something a plugin calls at
> runtime — so it is not a frozen contract. Run it from a checkout: `scripts/aimaestro-check-decoupling.sh <plugin-dir> ...`.
> Never write `check-decoupling || echo ok`: that collapses `2` into `1` and turns *"I never
> looked"* into *"I looked and it was fine"*, which is the exact failure it exists to prevent.

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

> **The USER auth path (closed 2026-08-02, TRDD-K2WJH7RF Part 3; this note previously
> claimed no such path existed — that was stale prose beside shipped code):**
> `get_auth_args` resolves `$AID_AUTH` → `$AIMAESTRO_SESSION` → `~/.aimaestro/cli-session`
> (the token `aimaestro-governance.sh login` writes), so a logged-in human drives every
> NON-STRICT verb (`aimaestro-panel.sh status/feedback`, etc.) from a terminal.
> **Strict verbs from a terminal remain sudo-gated BY DESIGN** (TRDD-COOLOZ1N ruling,
> 2026-08-08): there is deliberately NO CLI verb that mints a sudo token — a scriptable
> mint would defeat the one-shot re-confirmation property R32 exists for. A human's
> strict surface is the dashboard (which presents the sudo modal); a manually exported
> `AIMAESTRO_SUDO_TOKEN` stays the one-off escape hatch. Adding a mint verb would be a
> security-weakening change requiring a USER-tier ruling, not a convenience patch.

### 6.4 Exit status — the contract (TRDD-T3FXA0Y0, ai-maestro#121)

The fleet drives these scripts non-interactively and R23 makes this CLI the only sanctioned
surface, so **the exit status is the fleet's single machine-readable success signal**.

| Exit | Means | Obligation |
|---|---|---|
| `0` | the requested state change is **committed and verifiable** — or the verb was a pure query that answered | nothing further |
| non-zero | anything else | **at least one line on STDERR** naming what failed and why |

Three rules follow, and each closes a way the signal has already been broken here:

1. **No verb exits non-zero without a message.** A bare `1` is undiagnosable, and the caller
   cannot tell it from a crash.
2. **No verb exits `0` on a no-op the caller asked to be an op.** `list --status online`
   returning "exit 0, empty" for a value that *can never match* reports "no agents" when the
   truth is "your filter is impossible" (#114).
3. **`--help`, `-h`, `help`, `--version` and `-v` are LOCAL, OFFLINE operations.** They must
   be answerable with **no server, no network and no credential**, and must exit `0`. Put
   them BEFORE any `check_api_running` / identity-resolution / auth gate in the dispatcher.

**Why rule 3 is a rule and not a nicety.** With the API gate first, `aimaestro-agent.sh
--help` exited `1` on a completely successful run, and an unauthenticated caller got a 401
diagnostic *instead of* the help text — so the CLI was undiscoverable at exactly the moment
someone needed it most (a new agent, or a human whose `AID_AUTH` is not yet set, asking the
one question the tool can always answer). Ordering is the whole fix.

**The second-order harm, which is the reason this contract exists at all.** A CLI that exits
non-zero on success trains every caller — human and agent — to stop branching on the exit
code. Once they do, the exits that ARE real become invisible, and the `cmd || exit 1` guard
the shell rules mandate becomes a liability: it aborts correct runs, so it gets deleted, so
nothing catches the real failures.

**Measured baseline, 2026-08-05 — and then closed the same day.** On the **50 deployed**
`aimaestro-*`/`amp-*`/`aid-*` CLIs, `--help` exited non-zero on **29**.
`tests/unit/cli-help-exit-contract.test.ts` pins the violators BY NAME as a ratchet that may
only shrink; it scans the **52 in `scripts/`** (the repo is the source of truth per §5).

**29 → 1.** `aimaestro-agent.sh` was an ordering bug (the API gate ran before the dispatch).
The other 28 were **one root**: `amp-helper.sh` resolved AMP identity at SOURCE time, so
`--help` died before the calling script's own — correct — help branch was ever reached. The
helper now recognises a help-only invocation and skips resolution, setting `AMP_DIR` to a
**nonexistent** path so any operation attempted in that mode fails loudly rather than acting as
some other agent. The identity abort itself is untouched: a real `amp-send` from an unbound
session still exits 1, and still declines to print a pickable uuid list. `amp-create-branch.sh`
needed a second, unrelated fix — it had no `--help` verb at all, so the flag was read as a
positional argument.

**`aid-auth.sh` is the one remaining violator**, deliberately: it PRINTS a token to stdout, so
what `--help` should even mean there is a design question rather than this bug. It stays on the
list rather than being quietly exempted.
`aimaestro-agent.sh` is fixed. The remaining 28 are the whole `amp-*` family plus
`aid-auth.sh`, and they share ONE root — sourcing `amp-helper.sh` resolves AMP identity at
source time, so `--help` requires an identity it should never need. That is deliberately a
separate change (**TRDD-3KJW8P6R**): the abort it must not weaken is security code that
purposefully refuses to print a pickable uuid list.

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

**These are documented so they can be run, and the first one is now also a TEST**
(`tests/unit/script-manifest-announces-every-script.test.ts`) — because this section previously
claimed `75` while §1 said `77`, §2's own heading said `46`, and the disk held `86`. Four numbers,
none matching: a documented check nobody runs is not a check, and R23.8 makes an unannounced verb
formally nonexistent. The test is what keeps the count honest now; this block is for humans.

```bash
# every Tier-A/B/C script this repo ships — must equal 48 + 12 + 28
ls -1 scripts/*.sh | wc -l                     # 88

# scripts a plugin calls but this repo does not ship (must be EMPTY — §5 is the debt)
comm -13 <(ls -1 scripts/*.sh | xargs -n1 basename | sort) \
         <(grep -rhoE '\b[a-z][a-z0-9-]*\.sh' ~/.claude/plugins/cache/ai-maestro-plugins/*/*/ \
            | sort -u)

# scripts on this host that the repo no longer ships (installer residue)
comm -13 <(ls -1 scripts/*.sh | xargs -n1 basename | sort) \
         <(ls -1 ~/.local/bin/*.sh | xargs -n1 basename | sort)
```

## Pillar / governance tooling (.mjs — run via yarn or `node --import tsx`)

Added 2026-08-15 (gap survey A4, TRDD-1ZMEXD9X): the manifest previously covered the `.sh`
surface only, so the governance CLIs agents are told to use were in no contract at all.
Exit codes for ALL of these are grep's trichotomy — **0 clean/matched · 1 findings/no-match ·
2 COULD NOT RUN** — so `tool || fallback` is always a bug (it collapses could-not-run into
findings).

| tool | invocation | verbs / purpose |
|---|---|---|
| trddgrep | `yarn trddgrep <verb>` | TRDD corpus: `why unblocks roots next show board doctor lint validate index-verify fix edit env help` |
| trdd-doctor | `yarn trdd:doctor` / `:fix` / `:board` | lint + safe auto-repair + kanban render |
| trdd-watchdog | `yarn trdd:watchdog` | the consolidated §D4 approval-ladder sweep (doctor engine + objective-floor/mandate/supersede engine); also scheduled server-side every 6h, report to `reports/trdd-watchdog/` |
| prrdgrep | `node --import tsx scripts/prrdgrep.mjs <verb>` | PRRD documents: `edit show list` (lint/validate verbs: TRDD-BL0W6LGY, pending) |
| specgrep | `node --import tsx scripts/specgrep.mjs <verb>` | SPEC documents: same surface as prrdgrep |
| pillars-lint | `yarn pillars:lint` | cross-pillar reference DAG only (PRRD ← SPECS ← TRDD direction); does NOT validate internal grammar |
