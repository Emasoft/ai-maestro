---
trdd-id: LT5N2JA4
title: One agent-state probe for MANAGER and COS, aggregating every source that already knows
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-06T12:47:47+0200
updated: 2026-08-16T16:51:06+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-06T12:47:47+0200
severity: high
effort: medium
npt: []
eht: []
blocked-by: []
release-via: none
labels: [unblock, observability, manager, chief-of-staff, script-layer, plugin-facing]
external-refs: [Emasoft/ai-maestro-plugin#58, Emasoft/ai-maestro-plugin#59]
---
# One agent-state probe for MANAGER and COS, aggregating every source that already knows

## Problem

USER directive (2026-08-06, immediately after TRDD-89LVZSQ0 landed the pane read):

> *"a specific function to probe the agent state (idle, blocked, permission prompt, api error,
> etc) along with all the other data about it should be added to give the MANAGER and the
> CHIEF-OF-STAFF [the ability] to track the state of any agent and to read the last error
> message… Be sure to harvest all those data from all those sources and to make them available
> as a simple skill to the MANAGER and the CHIEF-OF-STAFF."*

Four sources were named. Each was MEASURED before this card was written, because two of the
four turned out not to be what the directive assumed, and building on the assumed version
would have produced a probe that either duplicates a working tool or breaks one.

## What each source actually is (measured 2026-08-06)

**1. ai-maestro's own state — HAVE IT.** `GET /api/agents/[id]` plus `lib/agent-status.ts`'s
8-priority ladder (`exited / rate_limited / api_error / permission / waiting(±subagents) /
active / idle / hibernated`). This is the spine the rest hangs off.

**2. The pane — JUST BUILT (TRDD-89LVZSQ0), and already landed.** `GET /api/agents/[id]/block-state`
(TRDD-89LVZSQ0) returns `{blocked, reason, field{visible,empty,text}, choices[], excerpt[],
hookDisagreed, sessionName}` and, with `?match=<regex>`, matching lines. Strict, mapped to
`unblock-prompt`, so MANAGER-any / COS-own-team / never-ASSISTANT / self-always.

**3. The ai-maestro-plugin hook — the statusline is NOT one of its events.**
`scripts/ai-maestro-hook.cjs` (579 lines) handles **11 Claude Code events** —
`PermissionRequest`, `Notification`, `Stop`, `StopFailure`, `SessionStart`, `SessionEnd`,
`SubagentStart`, `SubagentStop`, `PreCompact`, `PostCompact` — and contains **zero**
statusline handling (`grep -c statusline` → 0). That is correct, not a gap: there is no
statusline *hook event* in Claude Code. The statusline is a single configured COMMAND, and
ai-maestro captures it by a different mechanism entirely — source 3b.
What the hook does write, into `~/.aimaestro/chat-state/<sha256(cwd)[:16]>.json`, is
`status` / `notificationType` / `options[]` / timestamps — and, measured across 419 live
files, `question` **never** (0/419). That gap is exactly why TRDD-89LVZSQ0 exists.

**3b. ai-maestro's OWN statusline pipeline — BUILT, INSTALLED, and simply NOT IN THE CHAIN.**
This card's first draft said the statusline data was agentlenspro's alone. That was wrong, and
the correction matters because it turns "integrate someone else's tool" into "re-attach our
own". Measured: TRDD-D8OYFG35 already shipped the whole path —
`scripts/aimaestro-statusline-capture.sh` (a **pass-through wrapper**: reads stdin once, forks
a detached ingest, relays the identical bytes and exit code to an inner command) and
`scripts/aimaestro-statusline.sh` (`ingest` / `get <sessionId>` / `list`, the immutable CLI in
front of the endpoints). **Both are installed at `~/.local/bin/`.** Its own header notes the
payload carries the **5h and 7d rate-limit windows at ZERO API cost**.

What is missing is only the wiring: the live `statusLine` slot does not include it (source 4),
so nothing is being ingested and `get` has nothing to serve.

**4. agentlenspro — holds the slot today, and COMPOSES with ours rather than competing.**
Installed at `/opt/homebrew/bin/agentlenspro`. It currently **owns the single `statusLine`
slot**, itself wrapping the user's own python statusline:

```
"statusLine": {"type":"command","command":"agentlenspro statusline --inner '<user's python>'"}
```

Claude Code has **one** statusLine slot, so a naive "install ours" would **evict agentlenspro
AND the user's inner statusline** — which is why this was worth measuring before building.
But both wrappers are pass-through BY DESIGN (`--inner` there, a trailing command here), so
they chain:

```
aimaestro-statusline-capture.sh agentlenspro statusline --inner '<user's python>'
```

That is a change to the USER's own `~/.claude/settings.json`, which our script deliberately
never edits itself — so it is the USER's call, not ours to make. Propose it; do not do it.

Independently, `agentlenspro statusline-history` is worth READING: views
`sessions | subagents | windows | peaks | raw`, and its help calls `subagents` *"the ONLY
source of a live agent's tokenCount vs contextWindowSize (+ effort, model, and the cwd that
marks a worktree agent)"*. It reads DISK, so it answers with its server down. Sampled live:
`subagents` gives `task / model / effort / status / peak tok / fill% / last / cwd`; `sessions`
gives `session / samples / peak% / peak ctx / cost $ / span / last`, current to **1 second**.

**5. The janitor's HTML global report — NOT FOUND, so ASK rather than guess.** The directive
says the janitor already surfaces last-error information there. Searched
`~/.claude/plugins/data/ai-maestro-janitor-*`, the 2.4.1 plugin cache, and `~/.claude` +
`~/ai-maestro` for any `*.html` modified in 30 days: **nothing**. Either it is generated
on demand somewhere unsearched, or it is a different artifact than its name suggests. The
USER's own instruction is the right move — ask the janitor how it builds that report and
whether it can share the underlying data with the server. Filed as a cross-repo issue rather
than reverse-engineered.

## The join key is the open design question — do NOT invent one

The sources key their rows differently and this is the one thing that decides whether the
aggregate is correct or merely plausible:

| source | keyed by | joins to our agent how |
|---|---|---|
| ai-maestro registry | agent UUID | — (it is the spine) |
| chat-state | `sha256(workingDirectory)[:16]` | via `agent.workingDirectory` |
| pane / block-state | `computeSessionName(agent.name, index)` | via name+index |
| agentlenspro `subagents` | `cwd` | plausibly `agent.workingDirectory` — **unverified** |
| agentlenspro `sessions` | Claude Code session id (e.g. `b03f0742`) | **no known mapping** to an ai-maestro agent |

The last row is a genuine unknown. A probe that silently guesses the mapping would attribute
one agent's context-fill and cost to another — a wrong number that looks authoritative. Either
establish the mapping (does the hook see a Claude session id it could record?) or OMIT the
`sessions`-derived fields and say in the response WHICH fields are unavailable and why.

## Proposed shape

One aggregating read verb, built on the block-state pattern, with per-source degradation made
VISIBLE rather than smoothed over:

```
GET /api/agents/[id]/probe →
  { agent: {...registry spine...},
    status: <the 8-state ladder verdict>,
    block: {blocked, reason, field, choices, excerpt, hookDisagreed},   // block-state
    hook:  {notificationType, options, updatedAt, ageSeconds},          // chat-state
    usage: {model, effort, tokens, contextWindow, fill, lastSample},    // agentlenspro
    lastError: {text, at, source},
    sources: {registry:'ok', pane:'ok', hook:'stale:17h', usage:'unavailable: no join key'} }
```

`sources` is not decoration. Every one of these feeds can be absent, stale, or unreadable, and
the failure that this whole line of work exists to fix is precisely a supervisor reading
"nothing is wrong" off a source that was never consulted. A field that could not be resolved
is reported as unresolved; it is never defaulted.

Then wrap it in `aimaestro-agent.sh` (script layer — plugins never call `/api/*`), and ship
ONE skill to the MANAGER and CHIEF-OF-STAFF role-plugins that says: probe → read → if blocked
and you are entitled, answer via `prompt/answer`; otherwise message the agent through AMP.

## The rule the skill must carry, verbatim in its own words

USER, 2026-08-06: injecting into a terminal is permitted **only** when the agent is blocked.
Every other directive goes by AMP agent-to-agent, obeying the comm graph, *"to avoid filling
agents with broadcast messages unrelated to the job they must do."* The server already
enforces the blocked-only half (Gate 0b, two-source since TRDD-89LVZSQ0), and R42 revokes
cross-agent `send-command` outright — but a skill that does not SAY this will produce agents
that try the forbidden thing, get a 409, and treat it as a bug to route around.

## Verification

- MANAGER (and own-team COS) can answer "what is agent X doing, and if it is stuck, why" in one
  script call, with zero `/api/*` calls from the plugin;
- every unavailable source is NAMED in the response — a neuter that breaks one feed must change
  `sources`, not silently drop a field;
- an ASSISTANT-titled agent is refused, and a COS is refused outside its own team;
- the join key for any agentlenspro-derived field is either PROVEN or the field is omitted;
- the two-source Gate 0b keeps refusing a stalled-but-asked-nothing agent (already pinned).

## Estimated risk

MED. No new dangerous primitive — the pane read (the sharp one) is already gated by the NPT.
The real risk is a plausible-looking WRONG number from a guessed join, which is why the join
is called out above as a blocker for those fields rather than an implementation detail.

## Why this card has no `npt:`, though it plainly depends on TRDD-89LVZSQ0

It was authored with `npt: [89LVZSQ0]` and that was **wrong twice over**, caught by
`trdd-corpus-invariants` + `trdd-doctor` as `GRAPH-TWO-PARENTS`.

`npt:`/`eht:` are **DERIVATION** edges — "this TRDD spawned that one" — and they alone establish
parenthood. 89LVZSQ0 was not spawned by this card; it pre-existed and was already claimed as
8RVDY7ND's NPT, so a second claim gave it two parents and broke the depth-1 invariant. A pure
"I need that finished first" relationship is a **runtime** edge, `blocked-by:`.

And here not even that: the dependency is **satisfied** — the route, the service, the Gate 0b fix
and the `block-state` CLI verb all landed before this card was filed. There is nothing left to
wait on, so the honest frontmatter is empty and the relationship lives in the prose above, where
it is a reference rather than a claim on the graph.

## Acceptance
- [ ] `GET /api/agents/[id]/probe` exists, aggregating registry status + block-state + hook chat-state + (where the join key is proven) agentlenspro usage
- [ ] MANAGER (and own-team COS) can answer "what is agent X doing, and if it is stuck, why" in one script-layer call, with zero `/api/*` calls from the plugin
- [ ] Every unavailable/stale source is NAMED in the `sources` field of the response, never silently defaulted or dropped
- [ ] The join key for any agentlenspro `sessions`-derived field is either PROVEN (mapping to an ai-maestro agent id) or that field is omitted from the response
- [ ] An ASSISTANT-titled agent is refused by the probe route; a COS is refused when probing outside its own team
- [ ] The two-source Gate 0b keeps refusing an inject at a stalled-but-asked-nothing agent (regression check on already-pinned behavior)
- [ ] `aimaestro-agent.sh` wraps the probe and ships as a skill to the MANAGER and CHIEF-OF-STAFF role-plugins

## Approval log

- 2026-08-06T12:47:47+0200 — MANDATE issued by USER (directive quoted above). Tier 0 /
  `min-approval-requirement: none` — in-scope server work on our own tree, plus two cross-repo
  ASKS (janitor, MANAGER role-plugin) filed as issues rather than edits.
