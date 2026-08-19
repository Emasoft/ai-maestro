---
status: normative
generated-by: scripts/gen-specs.mjs
---

# AI Maestro scripts spec — the plugin-facing contract (GENERATED, do not hand-edit)

Plugins call THESE CLIs, never the HTTP API (decoupling invariant). Auth: agents
export `AID_AUTH` (Bearer); the human/UI path uses `AIMAESTRO_SESSION` (aim_session
cookie) and, for strict operations, a one-shot `AIMAESTRO_SUDO_TOKEN`. Exit codes are
the grep trichotomy where noted: 0 ok · 1 findings/refusal · 2 could-not-run.
New capability = spec first (TRDD), then implementation; `gen-specs.mjs --check` gates drift.

---

## aimaestro-agent.sh  ·  aimaestro-agent.sh v1.0.1

```text
shellcheck disable=SC2034  # FORCE variable is used by confirm() in agent-helper.sh
AI Maestro Agent Management CLI
Manage agents: create, delete, hibernate, wake, configure plugins, and more

Usage: aimaestro-agent.sh <command> [options]

Commands:
  list        List all agents
  show        Show agent details
  config      Print an agent's consolidated config (teams, repo, docker, tasks, AID)
  resolve     Resolve an agent (by name or --cwd) to its tmux session name
  create      Create a new agent
  delete      Delete an agent
  update      Update agent properties
  rename      Rename an agent
  session     Manage agent sessions
  hibernate   Hibernate an agent (stop session, preserve state)
  wake        Wake a hibernated agent
  restart     Restart an agent (hibernate + wake with verification)
  skill       Manage agent skills
  plugin      Manage Claude Code plugins for an agent
  export      Export agent to file
  import      Import agent from file
  presence    Print the human user's presence (last input + idle window)
  help        Show this help

Version: Sync with bump-version.sh - currently v1.0.1
```

---

## aimaestro-check-decoupling.sh

```text
Does a plugin tree call the ai-maestro server API directly? — the IRON RULE, made checkable.

THE RULE (USER, absolute, exception-free — binds the core plugin too): no ai-maestro plugin calls
the server API directly, ever. Plugins call ONLY the frozen CLI layer (`aimaestro-*.sh`, `amp-*.sh`,
`aid-*.sh`), which is the one boundary allowed to know an endpoint. The API changes constantly;
plugins must not.

WHY THIS SCRIPT EXISTS. ai-maestro-plugin#11 states the end state as "`grep -rn '/api/'` returns
nothing" — and NOTHING RUNS THAT GREP. A rule whose compliance is verified by a human remembering
to type a command is a rule that regresses the first time nobody remembers. On 2026-08-02 the whole
installed surface measured CLEAN; this script is what keeps that true tomorrow.

── THE THREE THINGS THAT MAKE A SCANNER LIE, AND WHAT IS DONE ABOUT EACH ────────────────────────
(Every one of these was hit for real while writing it — none is hypothetical.)

  1. SILENT SKIPPING. `rg` respects .gitignore by default, so a scanner can quietly not look at
     files and report clean. `--no-ignore` + EXPLICIT excludes: what is skipped is stated here,
     not inherited from a config nobody reads.
  2. THE NEEDLE THAT MATCHES NOTHING. The janitor hit this three times in one day (a lowercase
     severity set against a lib emitting "CRITICAL"; a `_SKIP_DIRS` entry matching only a dir
     literally named `_dev`; the right predicate for the wrong question) — each passed lint and
     types and was SILENT on malicious input. So this script SELF-TESTS on every run: it scans a
     built-in positive control and ABORTS (exit 2) if its own needle fails to find a known
     violation. A detector that cannot prove it fires is worse than no detector, because it
     appears in the audit as coverage.
  3. STDOUT LOST ON TIMEOUT. Two 8-minute timeouts were burned scanning a 1.2 GB tree with
     find|xargs before switching to rg (11 s). Results stream to a FILE as they are found, so even
     a kill leaves evidence.

── EXIT CODES: grep's own trichotomy, and `2` is the load-bearing one ───────────────────────────
  0 = clean · 1 = findings · 2 = COULD NOT RUN (missing tool, bad path, self-test failed)
Never write `check-decoupling || echo ok` — that collapses 2 into 1 and turns "I never looked" into
"I looked and it was fine", which is the failure this file is built to prevent.

── SCOPE: the ai-maestro SERVER's API only ─────────────────────────────────────────────────────
GitHub (`api.github.com`, `gh`), Anthropic (`api.anthropic.com/api/oauth/usage` — the janitor's
rotator reads the user's OWN usage), crates.io and any other third-party API are OUT of scope and
deliberately not matched. A rule that flags them trains everyone to ignore it.
```

---

## aimaestro-continuity.sh  ·  aimaestro-continuity.sh v1.0.0

Verbs: status · ensure-resume · restart-self

```text
AI Maestro Continuity CLI

Stable command-line wrapper around the AI Maestro agent-continuity API — the
ONLY new script surface the Family-A continuity absorption adds (TRDD-DXJZM3BW,
NPT of TRDD-KCRMSNL7). Plugins (the ai-maestro-tailored janitor `#J`) call THIS
script, never the HTTP API directly (R23): the CLI here is immutable; the server
API behind it may change freely.

Three self-scoped verbs — a deliberate, minimal contract:
  status <self>          the 5 continuity-status metadata fields for THIS host's
                         account (account_healthy, window_5h_pct, window_7d_pct,
                         cache_ttl_minutes, next_action). A DELIBERATE ceiling
                         (TRDD-H24DF6ZC Constraint 1): no OAuth token can leak
                         through the one verb an agent can call.
  ensure-resume <self>   idempotently ensure THIS agent is resumed. If already
                         live it is a no-op; otherwise the server resumes it via
                         the existing wake path. The server owns the actuation.
  restart-self [--force] restart THIS agent's OWN tmux session (stop the client,
                         wait for the shell, relaunch with the stored persona).
                         SELF-ONLY BY CONSTRUCTION (TRDD-4P1M8I18): it hits
                         POST /api/sessions/me/restart, whose target is DERIVED
                         from the caller's AID — there is NO agent argument, so no
                         invocation can name another agent (stronger than
                         self-only-by-authorization). The janitor `#J` continuity
                         path uses this to recover a stuck self. --force overrides
                         the running-subagents refusal (?force=true).

R42 self-only: `status`/`ensure-resume` take a <self> that must resolve to the
CALLER's own agent (its own AID); `restart-self` takes NO target at all. An agent
may act ONLY on itself; the human owner may target any. Cross-agent
liveness/actuation is the SERVER's job (TRDD-CHN16JXZ), never a call from here.

Auth: agent callers export AID_AUTH (Bearer); the local owner needs none.
Everything else (waking, injecting) reuses aimaestro-session.sh.

Usage:
  aimaestro-continuity.sh status <self>
  aimaestro-continuity.sh ensure-resume <self>
  aimaestro-continuity.sh restart-self [--force]

<self> is the caller's own agent UUID, or a name/alias resolved via /api/agents?q=.
```

---

## aimaestro-governance.sh  ·  aimaestro-governance.sh v1.0.0

Verbs: login · logout · invalidate-password · whoami|config|status · requests · request · approve · reject · transfer

```text
AI Maestro Governance CLI

Stable command-line wrapper around the AI Maestro governance API. Plugins
(MANAGER, CHIEF-OF-STAFF, …) call THIS script, never the HTTP API directly:
the skill-facing CLI here is immutable, while the server API behind it may
change freely. New capability = new subcommand or new optional flag only.

Auth: an agent caller exports AID_AUTH (Bearer token); the local system
owner needs none (localhost is trusted). A sudo token, when the caller has
one, is passed through AIMAESTRO_SUDO_TOKEN as the X-Sudo-Token header.
Governance passwords are passed per-command via --password (the body field
the route expects), never via a header.

Usage:
  aimaestro-governance.sh whoami
  aimaestro-governance.sh requests [--status S] [--type T] [--host H] [--agent A]
  aimaestro-governance.sh request --type T --password P --target-host H \
      --requested-by RB --role R (--agent A | --payload-json '{...}')
  aimaestro-governance.sh approve <id> --password P [--approver UUID]
  aimaestro-governance.sh reject  <id> --password P [--rejector UUID] [--reason R]
```

---

## aimaestro-groups.sh  ·  aimaestro-groups.sh v1.0.0

Verbs: list · show · create · update · delete · subscribe · unsubscribe · notify

```text
AI Maestro Groups CLI

Stable command-line wrapper around the AI Maestro groups API. Plugins call
THIS script, never the HTTP API directly (R23): the skill-facing CLI here is
immutable, while the server API behind it may change freely. New capability =
new subcommand or new optional flag only.

WHY THIS EXISTS. Groups had five live routes and ZERO CLI surface, so CORE's
team-governance skill documented the operation and then told the agent not to
do it — the `DECOUPLE-BLOCKED` marker at
`skills/team-governance/references/REFERENCE.md:58` (ai-maestro#64, residual 6).
Under R23.8 an unannounced verb formally does not exist, so a plugin that needs
groups is pushed back toward `/api/*` — or, correctly, blocks. It blocked.

GROUPS ARE NOT TEAMS, and the difference is why the authorization here is
simpler than in `aimaestro-teams.sh`. A team is a governed structure: closed
messaging, an ACL, a COS, a kanban board — so creating or deleting one is a
governance action carrying the governance password. A group is a lightweight,
unstructured collection of agents used for fan-out notification. It confers no
authority, so per R20 every route here is **authentication required,
governance-FREE**: an agent authenticates with its AID and that is the whole
check. There is NO --password flag on any subcommand, deliberately — adding one
would imply a governance gate the server does not have, and R32.3 forbids the
password passing through a model regardless.

Auth: agent callers export AID_AUTH (Bearer); the local owner needs none.
A sudo token, when held, is passed through AIMAESTRO_SUDO_TOKEN (X-Sudo-Token).

Usage:
  aimaestro-groups.sh list
  aimaestro-groups.sh show <groupId>
  aimaestro-groups.sh create --name N [--description D] [--subscribers u1,u2]
  aimaestro-groups.sh update <groupId> [--name N] [--description D] [--subscribers u1,u2]
  aimaestro-groups.sh delete <groupId>
  aimaestro-groups.sh subscribe <groupId> <agentUUID>
  aimaestro-groups.sh unsubscribe <groupId> <agentUUID>
  aimaestro-groups.sh notify <groupId> --message M [--priority low|normal|high|urgent]
```

---

## aimaestro-hook.sh  ·  aimaestro-hook.sh v1.0.0

Verbs: activity · notify · check-messages

```text
AI Maestro Hook Intermediary CLI

The intermediary (ai-maestro side) of the Claude Code session-tracking hook.

Hooks BELONG in the plugin (`ai-maestro-plugin/scripts/ai-maestro-hook.cjs`),
but a plugin must NEVER call the server API directly — every API touch goes
through the immutable CLI layer that lives in THIS repo. So the hook is split
in two:
  - PLUGIN side: a thin `ai-maestro-hook.cjs` that parses the hook stdin JSON
    and shells out to THIS script (no `fetch`, no `:23000`, no `/api/...`).
  - AI-MAESTRO side (this script): the only piece that talks to the API.

Subcommands map 1:1 to the hook's three API operations (was `broadcastStatusUpdate`,
`sendMessageNotification`, and the unread-inbox check in the .cjs):
  activity        — report session activity / notification state
                    (resolve cwd→agent, POST /api/sessions/activity/update)
  notify          — inject a message-notification into the agent's tmux session
                    (resolve cwd→agent, POST /api/sessions/<tmux>/command)
  check-messages  — count unread inbox messages for the agent
                    (resolve cwd→agent, GET /api/messages?...&status=unread)

Resolution is BY CWD (the directory the hook runs in), using the SAME
at-or-below-workdir match the .cjs used: an agent matches when its
workingDirectory EQUALS the cwd, or the cwd is a STRICT SUBDIR of it — never
a parent (matching a parent caused cross-session prompt-injection when cwd
was $HOME). This mirrors common.sh's lookup_agent_by_directory but returns
the full agent object so each subcommand can read the field it needs.

Auth: AID_AUTH Bearer (agent caller) + optional AIMAESTRO_SUDO_TOKEN. Hooks
are latency-sensitive and fire-and-forget — every call is --max-time bounded;
the plugin hook invokes this fire-and-forget so a non-zero exit never blocks
the agent's turn.

Usage:
  aimaestro-hook.sh activity --cwd <dir> [--status S] [--hook-status H]
      [--notification-type NT] [--subagent-count N] [--error-type E] [--end-reason R]
  aimaestro-hook.sh notify --cwd <dir> --message <text>
  aimaestro-hook.sh check-messages --cwd <dir> [--json]
```

---

## aimaestro-panel.sh  ·  aimaestro-panel.sh v1.0.0

Verbs: status · feedback

```text
AI Maestro HTML Side-Panel CLI

Stable command-line wrapper around the AI Maestro dashboard side-panel API.
The skill-facing CLI here is IMMUTABLE, while the server API behind it may
change freely — that contract is fact and holds regardless of callers.
Visualizer plugins (visual-communicator, webdesign, …) are INTENDED to call
this script, never the HTTP API directly. As of 2026-08-08 NEITHER plugin has
wired it (zero callers in both repos, measured by the COS session — ai-maestro#132);
the sentence above states the integration contract, not a shipped integration.

Lets an agent push live HTML — or a live URL — into the human's dashboard side
panel, open/close/refresh it remotely, and drain the click feedback the human
generated inside it. That replaces "deploy to Vercel and paste the link" with
"show it right here, get feedback back".

Auth: agent callers export AID_AUTH (Bearer); the local owner needs none.
`open`/`close`/`refresh`/`set` hit a strict-classified route (pushing HTML into
the human's dashboard is the same trust level as injecting into a terminal), so
a USER caller must supply AIMAESTRO_SUDO_TOKEN; an AGENT caller authorizes by
AID + governance title (the R32 dual-path) and needs none.

Usage:
  aimaestro-panel.sh open <agent> [--url <https-url>]
  aimaestro-panel.sh close <agent>
  aimaestro-panel.sh refresh <agent>
  aimaestro-panel.sh set <agent> --html-file <path> | --html "<html>" | --url <https-url>
  aimaestro-panel.sh status <agent>
  aimaestro-panel.sh feedback <agent>

<agent> is an agent UUID, or a name/alias resolved via /api/agents?q=.

NOTE ON `delivered`: the panel is a LIVE surface, not a queue. A response with
"delivered": 0 means no dashboard currently has that agent's panel channel open
— the message was dropped, NOT stored. Check `status` first if that matters.
```

---

## aimaestro-portfolio.sh  ·  aimaestro-portfolio.sh v1.0.0

Verbs: mint · list · verify · revoke

```text
AI Maestro Portfolio CLI — mint, list, VERIFY, revoke approval/mandate tokens

Stable command-line wrapper around the AI Maestro portfolio API (R28: the
per-agent "secure enclave" holding the approval and mandate tokens that are the
THIRD authorization check, after (1) AID identity and (2) TITLE privilege).
Plugins call THIS script, never the HTTP API directly.

WHY `verify` EXISTS (ai-maestro#47, ask 2). Governance rule R41 says an approval
or mandate is "signed, verifiable, binding". Two of those were already true; the
middle one was not. The only evidence a receiving agent had that "the MANAGER
approved this" was an `## Approval log` line in a git-tracked file — auditable,
and forgeable by anyone with repo write. `verify` is the third party an agent can
ask instead: the server re-checks the host's Ed25519 signature over the token,
that the token is anchored in the host-signed ledger (R34), that its issuer STILL
holds the title it minted under, and that it is not expired / consumed / revoked.

`verify` EXITS NON-ZERO WHEN THE VERDICT IS INVALID. That is the whole contract —
it is what lets an agent write:

    aimaestro-portfolio.sh verify --subject "$ME" --token "$TOK" --binds K3QX9P2W \
      || { echo "unverified mandate — refusing to act"; exit 1; }

ASK THE SPECIFIC QUESTION. `--binds <trdd-id>` turns "is this token real?" into
"is this an approval FOR THIS CARD?". The vague question is the one a token
replayed from another card passes.

Auth: agent callers export AID_AUTH (Bearer). The portfolio routes are AGENT-
PRIMARY (R32) — an agent authorizes by AID + title and faces NO sudo gate here.

Usage:
  aimaestro-portfolio.sh mint   --subject <agent> --kind approval|mandate
                                --scope <resource:action>
                                [--binds <trdd-id>] [--binds-agent <id>]
                                [--binds-team <id>] [--ttl <seconds>]
  aimaestro-portfolio.sh list   --subject <agent>
  aimaestro-portfolio.sh verify --subject <agent> --token <uuid>
                                [--binds <trdd-id>] [--binds-agent <id>]
                                [--binds-team <id>] [--scope <resource:action>]
                                [--json]
  aimaestro-portfolio.sh revoke --subject <agent> --token <uuid>

`--subject` is the agent whose enclave HOLDS the token (the empowered agent),
not the issuer.
```

---

## aimaestro-session.sh  ·  aimaestro-session.sh v1.0.0

Verbs: inject · slash · slash-keys · state · read-prompt · block-state · answer · queue · queue-list · queue-cancel

```text
AI Maestro Session Control CLI

Stable command-line wrapper around the AI Maestro agent terminal-control API.
Plugins (the janitor, MANAGER, every governance agent) call THIS script, never
the HTTP API directly: the skill-facing CLI here is immutable, while the server
API behind it may change freely. New capability = new subcommand or new
optional flag only.

Covers the whole "drive a live Claude Code terminal" surface:
  inject / slash   — type a command into the agent's tmux pane
  state            — the agent's live session + pane status
  read-prompt      — the permission / question menu the agent is blocked on
  block-state      — is it blocked and WHY, read from the terminal itself
  answer           — answer that menu, by option key or free text
  queue / queue-*  — enqueue a command to fire when the agent is next idle

Auth: agent callers export AID_AUTH (Bearer); the local owner needs none.
A sudo token, when held, is passed through AIMAESTRO_SUDO_TOKEN (X-Sudo-Token).
`answer` and `queue` hit strict-classified routes (they inject keystrokes into
a live terminal), so a USER caller must supply AIMAESTRO_SUDO_TOKEN; an AGENT
caller authorizes by AID + governance title (the R32 dual-path) and never
needs one.

WHAT AN AGENT MAY AIM AT ANOTHER AGENT — read this before assuming a title is
enough. The verbs split in two, and the split is not by danger, it is by whose
decision the keystroke expresses:

  inject / slash / queue / state --pane  →  SELF-ONLY for every title.
      R42 revoked cross-agent drive outright: an injected command IS the
      victim's own action, taken without its judgment. No title is exempt, and
      that includes MANAGER and CHIEF-OF-STAFF. Aim these at another agent and
      the server answers 403 — correctly. Use AMP messaging: ask, never inject.

  read-prompt / answer  →  the R42.8 exception (USER ruling, 2026-08-05).
      A MANAGER may answer any agent's PENDING prompt; a CHIEF-OF-STAFF may
      answer one for agents OF ITS OWN TEAM. Never an ASSISTANT, under any
      title. Answering your OWN prompt has always been allowed. `answer` also
      requires a prompt to actually be pending — with none, it 409s, because
      an unblock answers a question the agent raised and nothing else.

This block replaced a line that said agent callers "authorize by AID +
governance title" full stop. That described the PRE-R42 world and had been
false since 2026-07-14: a MANAGER following it refused twice to unblock a
stalled agent, then escalated to the human, because the CLI advertised an
authority the API had already revoked.

Usage:
  aimaestro-session.sh inject <agent> --command "<text>" [--no-newline] [--no-require-idle]
  aimaestro-session.sh slash <agent> <command-key>
  aimaestro-session.sh slash-keys
  aimaestro-session.sh state <agent> [--pane]
  aimaestro-session.sh read-prompt <agent>
  aimaestro-session.sh block-state <agent> [--match "<regex>"]
  aimaestro-session.sh answer <agent> --option <key> | --text "<answer>"
  aimaestro-session.sh queue <agent> --command "<text>" | --command-key <key>
      [--when idle|online|now-if-idle-else-queue] [--wake-first]
  aimaestro-session.sh queue-list <agent>
  aimaestro-session.sh queue-cancel <agent> <entryId>

<agent> is an agent UUID, or a name/alias resolved via /api/agents?q=.
```

---

## aimaestro-settings.sh

```text
AI Maestro Settings CLI — the universal gated settings.json /
settings.local.json editor (TRDD-RYFP030K).

Unlike every other aimaestro-*.sh wrapper in this directory, this one does
NOT talk to the HTTP API. It invokes scripts/aimaestro-settings-cli.mjs
directly, in-process, because the installer runs with the ai-maestro server
DOWN — an HTTP-only tool would be useless at the exact moment it is most
needed. Both this CLI and app/api/settings/edit/route.ts call the SAME
shared function, lib/settings-gate.ts's editSettings/readSettings, which
itself delegates to lib/json-io.ts's updateJson — the ONE lock + write path
for every settings mutation in this codebase (TRDD-RYFP030K).

Usage:
  aimaestro-settings.sh get <path>
  aimaestro-settings.sh set <path> --key <dot.path> --value <json-or-string> [--no-create]
  aimaestro-settings.sh set <path> --key-json '["a","b"]' --value <json-or-string> [--no-create]
  aimaestro-settings.sh delete <path> --key <dot.path> [--no-create]
  aimaestro-settings.sh delete <path> --key-json '["a","b"]' [--no-create]
  aimaestro-settings.sh edit <path> --ops '<json array of {"op":"set"|"delete","keyPath":[...],"value"?:...}>' [--no-create]

<path> must be an absolute settings.json or settings.local.json path, living
directly inside a ".claude" directory — see lib/settings-gate.ts. --key is
dot-path sugar; a key containing a literal dot needs --key-json instead.

⚠ AND THAT FAILS SILENTLY, WHICH IS WHY IT IS SPELLED OUT RATHER THAN LEFT TO
THE LINE ABOVE. Passing such a key to --key does not error — it SPLITS, exit 0,
and the file still parses, so the damage surfaces much later as a hook or
permission that never fires:

  --key 'hooks.Bash(x.y:*)'        →  hooks → "Bash(x" → "y:*)"     WRONG, silent
  --key-json '["hooks","Bash(x.y:*)"]'                              correct

This is the COMMON case, not an edge case: Claude Code matchers and permission
entries routinely contain dots — Bash(node script.js:*), mcp__srv__tool. Use
--key-json for any key that might contain one.

(Reported by the CORE plugin's Claude, 2026-08-02, ai-maestro-plugin#31. Their
note on HOW they found it is worth as much as the finding: their first probe
used `permissions.Bash(ls:*)` and "passed" — that key has no dot INSIDE it, so
it proved nothing. When a property has a boundary, the fixture must cross it on
purpose, never by luck.)

WHY BASH, NOT SH/ZSH: it sources scripts/pin-node.sh, which is bash-only
(BASH_SOURCE, `local -a`). Sourced from zsh its version gate degrades
SILENTLY and can hand back a Node past this repo's <26 engines cap (measured
2026-07-30 on scripts/pillar-cli, the sibling script this one's ROOT/tsx
resolution below is deliberately modelled on).
```

---

## aimaestro-statusline-capture.sh

```text
AI Maestro Statusline Capture — a PASS-THROUGH wrapper   (TRDD-D8OYFG35)

  aimaestro-statusline-capture.sh [--] <your existing statusline command...>

Claude Code supports exactly ONE `statusLine` command, so "capture the payload
IN ADDITION to the existing status bar" can only mean wrapping it. This script
reads stdin once, forks a detached copy to the AI Maestro ingest CLI, and hands
the identical bytes to the command you gave it — passing that command's stdout
and exit code through unchanged.

Install (the USER's own ~/.claude/settings.json — this script never edits it):

  "statusLine": {
    "type": "command",
    "command": "~/.local/bin/aimaestro-statusline-capture.sh <your old command>"
  }

With no inner command it runs in CAPTURE-ONLY mode: it ingests and prints
nothing, which is the correct behaviour for a user who has no status bar yet.

── THE FOUR PROPERTIES THIS SCRIPT EXISTS TO GUARANTEE ─────────────────────

1. NOTHING EXTRA ON STDOUT, EVER. Stray output corrupts the user's status bar.
   Our own diagnostics go to stderr, and only under AIMAESTRO_STATUSLINE_DEBUG.

2. THE CAPTURE IS DETACHED AND NON-BLOCKING. Claude Code's own doc: "If a new
   update triggers while your script is still running, Claude Code cancels the
   in-flight script", debounced at 300ms. A synchronous POST would stall the
   bar and get itself cancelled. We fork, redirect the child's stdio to
   /dev/null, and NEVER wait.

3. FAIL-SOFT ABSOLUTELY. Server down, unreachable, slow, CLI missing, mktemp
   refused — the bar still renders. Deliberately no `set -e`, no `set -u`, no
   `pipefail`: each of those turns a survivable hiccup into a broken status bar
   on every keystroke, which is the one failure mode a status line cannot have.

4. THE INNER COMMAND SEES THE EXACT BYTES. stdin is captured to a temp file and
   replayed by redirect, never through a shell variable — command substitution
   strips trailing newlines, and this payload is not ours to alter.

Environment:
  AIMAESTRO_STATUSLINE_CLI    override the path to aimaestro-statusline.sh
  AIMAESTRO_STATUSLINE_DEBUG  print diagnostics to stderr (off by default)
```

---

## aimaestro-statusline.sh

Verbs: ingest · get · list

```text
AI Maestro Statusline Feed CLI          (TRDD-D8OYFG35)

THE ONLY THING IN THE ECOSYSTEM THAT KNOWS THE STATUSLINE ENDPOINTS.

Per the decoupling invariant, no plugin, hook, skill or agent may curl the AI
Maestro API directly — the API changes constantly and plugins must not. This
script is the immutable CLI in front of it: new capability = new subcommand or
new optional flag, never a changed contract.

  aimaestro-statusline.sh ingest [--file PATH]
      Send ONE Claude Code statusline payload (JSON on stdin, or from PATH).
      This is what `aimaestro-statusline-capture.sh` forks, detached.

  aimaestro-statusline.sh get <sessionId>
      The last observation stored for that session, plus its age.

  aimaestro-statusline.sh list
      The fleet roll-up: the TIGHTEST 5h/7d window across live sessions.

WHY AN AGENT WANTS THIS: the 5-hour and 7-day rate-limit windows arrive in the
statusline payload at ZERO API cost. `get`/`list` hand them back without any
agent having to spend a call on /api/oauth/usage. (The model-scoped weekly
windows, `severity` and `is_active` are NOT in this feed and remain
endpoint-only — do not expect them here.)

Auth: `get`/`list` are ordinary fleet reads — agent callers export AID_AUTH,
the human uses the dashboard session cookie (both resolved by get_auth_args).
`ingest` needs NO credential: the route is console-only, and Claude Code runs
the user's statusline in a plain terminal with neither a cookie nor a token.
```

---

## aimaestro-teams.sh  ·  aimaestro-teams.sh v1.2.0

Verbs: list · show · create · update · delete · add-agent · remove-agent · kanban-config · tasks · stats · reassign-cos

```text
AI Maestro Teams CLI

Stable command-line wrapper around the AI Maestro teams API. Plugins
(CHIEF-OF-STAFF, MANAGER, …) call THIS script, never the HTTP API directly:
the skill-facing CLI here is immutable, while the server API behind it may
change freely. New capability = new subcommand or new optional flag only.

Team creation/deletion are governance actions: pass the governance password
with --password (the body field the route expects). Membership changes
(add-agent / remove-agent) are expressed as a full agentIds array on PUT —
there is no per-agent subroute — so this CLI reads the team, edits the
array, and writes it back.

Auth: agent callers export AID_AUTH (Bearer); the local owner needs none.
A sudo token, when held, is passed through AIMAESTRO_SUDO_TOKEN (X-Sudo-Token).

Usage:
  aimaestro-teams.sh list
  aimaestro-teams.sh show <teamId>
  aimaestro-teams.sh create --name N [--description D] [--agents u1,u2]
      [--type T] [--cos UUID] [--password P] [--gh-owner O --gh-number N [--gh-repo R]]
  aimaestro-teams.sh update <teamId> [--name N] [--description D]
      [--agents u1,u2] [--orchestrator UUID|null] [--gh-owner O --gh-number N [--gh-repo R]]
  aimaestro-teams.sh delete <teamId> [--password P] [--delete-agents]
  aimaestro-teams.sh add-agent <teamId> <agentUUID> [--password P]
  aimaestro-teams.sh remove-agent <teamId> <agentUUID> [--password P]
  aimaestro-teams.sh kanban-config <teamId> --get | --set <columns-json> | --set-file <path>
```

---

## aimaestro-trdd.sh  ·  aimaestro-trdd.sh v1.0.0

Verbs: search · read · verify · edit · promote · archive

```text
AI Maestro TRDD CLI

Stable command-line wrapper around the AI Maestro TRDD-file API. Plugins (the
janitor, MANAGER, ARCHITECT, every governance agent) call THIS script, never
the HTTP API directly: the skill-facing CLI here is immutable, while the server
API behind it may change freely.

Operates on a project's `design/{proposals,tasks,archived,refused}/*.md` corpus
— the SSOT of the 3-pillars task system. The lifecycle verbs perform the real
`git mv` + frontmatter edit + `## Approval log` append the TRDD overlay rules
require; they do NOT commit. Commit the result yourself.

Which project? `--agent <uuid|name>` selects that agent's `<workdir>/design`.
Omit it and the server's own repo is used.

Auth: agent callers export AID_AUTH (Bearer); the local owner needs none.
Every mutating verb (edit/approve/refuse/promote/archive) hits a strict route:
a USER caller must supply AIMAESTRO_SUDO_TOKEN, an AGENT caller authorizes by
AID + governance title (the R32 dual-path) and needs none.

Usage:
  aimaestro-trdd.sh search [--column C] [--id I] [--keyword K] [--zone Z] [--agent A]
  aimaestro-trdd.sh read <trdd-id> [--agent A]
  aimaestro-trdd.sh edit <trdd-id> --set key=value [--set key=value ...] [--agent A]
  aimaestro-trdd.sh approve <trdd-id> [--approver W] [--rationale R] [--agent A]
  aimaestro-trdd.sh refuse  <trdd-id> [--approver W] --reason R      [--agent A]
      --reason is REQUIRED for refuse (ai-maestro#71): it must name the defect, not the
      verdict. A bare "denied" is rejected. `approve` keeps it optional.
      --tier is DEPRECATED on both verbs and is NOT sent (ai-maestro#69): the approval
      requirement is read from the card's own `min-approval-requirement:`, never from
      the approver. Still accepted so existing calls keep working.
  aimaestro-trdd.sh promote <trdd-id> --column C [--note N] [--approver W]      [--agent A]
  aimaestro-trdd.sh archive <trdd-id> --state completed|cancelled|superseded
      [--reason R] [--superseded-by ID] [--approver W] [--agent A]

<trdd-id> is the 8-char UPPERCASE base36 id (matched case-insensitively).

The three lifecycle verbs are NOT interchangeable:
  approve  proposal → planned   (design/proposals/ → design/tasks/)
  promote  advance `column` forward in place, inside design/tasks/
  archive  once-approved → terminal (→ design/archived/); `failed` is retryable
           and is deliberately NOT an archive state.
```
