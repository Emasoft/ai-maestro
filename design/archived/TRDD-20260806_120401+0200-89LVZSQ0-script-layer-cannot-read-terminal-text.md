---
trdd-id: 89LVZSQ0
title: The script layer cannot read terminal text, so three plugin-facing capabilities are unbuildable
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-06T12:04:01+0200
updated: 2026-08-22T02:11:23+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
priority: 1
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-06T12:04:01+0200
severity: high
effort: medium
npt: []
eht: []
blocked-by: []
release-via: none
labels: [script-layer, decoupling, terminal, plugin-facing]
external-refs: [Emasoft/ai-maestro-plugin#58, Emasoft/ai-maestro#110, Emasoft/ai-maestro#125]
---
# The script layer cannot read terminal text, so three plugin-facing capabilities are unbuildable

## Problem

USER directive (2026-08-06): plugins must reach every capability through the SCRIPT layer, never
`/api/*`; the scripts must be "good enough to cover all the functionalities accessible to the
plugins" — naming local-scoped extension install, terminal-text parsing by regex, prompt-field
injection, an **empty-input-field** check, and detection of **red messages** (rate limit, API
error, permission prompts).

Measured against the tree today, two of those are covered and the rest rest on one missing
primitive.

**COVERED:** local-scope install (`plugin install --scope local`, and `local` is already the
default; `skill install` likewise) · injection (`aimaestro-session.sh inject/slash/queue`,
`aimaestro-agent.sh session command`) · prompt read+answer (`read-prompt`/`answer`) ·
red-state AS A LABEL (`state` carries `notificationType`, resolved by `lib/agent-status.ts`'s
8-priority ladder — read, not executed; confirmation requested on plugin#58).

**THE MISSING PRIMITIVE.** `AgentRuntime.capturePane(name, lines = 2000)` exists in
`lib/agent-runtime.ts` (real `tmux capture-pane -p -S -<lines>`, visible-pane fallback) and
**no API route calls it** — verified by grepping `capturePane` across `app/api/**/route.ts`,
which returns nothing. No route ⇒ no script ⇒ a plugin cannot read terminal text at all.
`state --pane` returns `paneCommand`/`paneCurrentPath` — process metadata, not the buffer.

Three asks collapse onto that one gap:

1. **regex parsing of terminal text** — no text to parse;
2. **empty-input-field detection** (ai-maestro#110) — the janitor's three injection rules
   (inject only when EMPTY, stop on user keypress, re-read before submitting) are enforceable on
   tmux and iTerm and on NO ai-maestro channel, because ours is write-only;
3. **live red-message detection** — the classifier regex lives hook-side in
   `scripts/ai-maestro-hook.cjs` and answers "what did the hook conclude at the last event",
   never "what is on screen now".

## ⏵ USER DIRECTIVE 2026-08-06 ~12:20 — the shape is DECIDED, and the reason is sharper than "convenience"

> *"it is very important that the MANAGER and the CHIEF-OF-STAFF are able to detect an agent
> session that is blocked by some AskUser question, and to send the correct answer in the terminal
> of the agent to make it resume the work, otherwise it will be blocked forever… we need to provide
> to the MANAGER a way to search the terminal text to understand what it is happening and why it is
> blocked, so it can send the right answer."*

**MEASURED, and it inverts the priority of this card.** Across **419 live
`~/.aimaestro/chat-state/*.json` files**:

| signal | files carrying it |
|---|---|
| `status: waiting_for_input` | 21 |
| `notificationType` | 21 |
| permission `options` | **1** |
| `question` (AskUserQuestion) | **0 — never** |

So the hook captures PERMISSION prompts (rarely — 1 of 419) and **captures AskUserQuestion not at
all**. The structured path the MANAGER would prefer *does not exist for the exact case the USER
names*. Terminal-text search is therefore not a nicer alternative to structured capture — it is the
**only** mechanism that can unblock an AskUserQuestion today, and it stays the fallback afterwards
for every prompt shape the hook does not model. That is the argument for building it first.

**Chosen shape** (answers the question this card deliberately left open, and #58 asked the consumer):
a **structured verdict PLUS a search predicate**, not a raw buffer dump —

- `{ blocked: bool, reason: 'ask_user'|'permission'|'rate_limited'|'api_error'|'idle'|…,
   fieldVisible: bool, fieldEmpty: bool, fieldText: string, excerpt: string[] }`
- a `--match <regex>` form that evaluates SERVER-side and returns only matching lines, so a caller
  can ask *"why is it blocked"* without the whole buffer crossing the boundary;
- raw-buffer access kept as a separate, more-restricted verb — a pane can hold anything the agent
  was shown, secrets included, so the default surface must be the narrow one.

**The heuristic is a merge, not a scrape.** The hook's `notificationType` stays the fast path and
the fallback is the regex over `capturePane`. The classifier regex already exists and is
field-proven — `scripts/ai-maestro-hook.cjs`:
`/rate.?limit|temporarily limiting|overloaded|too many requests|quota|\b429\b|\b529\b/` — so the
red-state half is a REUSE, not a new invention. Reuse it from one shared module rather than
copying it, or the two copies drift (this repo has that bug already, twice).

**Cross-repo half (theirs):** the hook should ALSO capture AskUserQuestion text + choices into
chat-state, so the structured path eventually covers the case too. Filed to the plugin repo. Ours
must not block on it — that is the whole point of the fallback.

## Why it is not just "add a route"

The verb's SHAPE is the design question, and getting it wrong ships a primitive that does not fit
the consumer. Candidates: full buffer · last-N-lines · a match/no-match predicate (regex evaluated
SERVER-side, so the pane text never crosses the boundary) · a structured
`{fieldEmpty, fieldText, redState}`. The predicate form is the most privacy-preserving and the
least useful for debugging; the full buffer is the reverse. **Deliberately not chosen here** —
plugin#58 asks the consumer which shape fits `inject_until_sent`, and that answer should land
before code.

Security is not incidental: a pane buffer can contain anything the agent has typed or been shown,
including secrets. Any route must be authorization-gated like the other control verbs (`send-command`
family, `STRICT_AGENT_RULES` registration — and note that classifying a route strict is only half
the job; an unregistered strict route 403s every agent silently), and a GET that emits a buffer is a
danger-not-mutation case of exactly the kind that made `export` leak private keys.

## Proposed fix

Not decided. Sketch only: expose `capturePane` behind one authorization-gated route, wrap it in
`aimaestro-session.sh` (e.g. `capture` / `field-state` / `match`), and derive the
empty-field and live-red-state verbs from it. Shape and split await plugin#58.

## Verification

- a plugin-side skill can answer "is the input field empty?" and "is there a red error on screen?"
  through the script layer only, with zero `/api/*` calls;
- ai-maestro#110's three injection rules become enforceable on the ai-maestro channel;
- the route is registered in `STRICT_AGENT_RULES` (or the human-only set) — asserted by
  `tests/unit/sudo-guard-strict-agent-coverage.test.ts`;
- a neuter of the authorization gate reds a named test.

## Estimated risk

MED. New route reaching a dangerous primitive (pane contents). Depends on no other work; blocks
ai-maestro#110 and the janitor's injection-rule compliance.

## Acceptance

**All seven verified 2026-08-22, first-hand, against the working tree.** The work landed on
2026-08-21 (route, service and script all mtime `Aug 21 16:07`) and the card was never advanced —
so this closes as a card that was DONE and still reading `todo`, not as work performed today.

- [x] `AgentRuntime.capturePane` is reachable from at least one authorization-gated API route (verified by grep — no route calls it today)
      → `app/api/agents/[id]/block-state/route.ts` (3173 B). Its own header names this card:
      *"Until this route existed there was NO path to that at all — `capturePane` lived in
      `lib/agent-runtime.ts` with zero API callers … (TRDD-89LVZSQ0)"*.
- [x] The route returns the structured verdict `{blocked, reason, fieldVisible, fieldEmpty, fieldText, excerpt}`, not a raw buffer, as the default surface
      → `lib/agent-block-state.ts` defines the verdict type: `blocked: boolean`, a `reason` enum
      (`'idle'` = *"at an empty prompt, healthy, NOT blocked"*, etc.), and a nested `field`
      carrying `visible` / `empty` / `text`. **Shape note, recorded rather than silently
      accepted:** the delivered surface nests the three field members under `field{}` where this
      box spelled them flat (`fieldVisible`/`fieldEmpty`/`fieldText`). Same information, one
      level deeper — the requirement was *structured verdict, not a raw buffer*, and that holds.
- [x] A `--match <regex>` form evaluates server-side and returns only matching lines
      → route reads `request.nextUrl.searchParams.get('match')` and hands it to `getBlockState`;
      `scripts/aimaestro-session.sh:56` documents `block-state <agent> [--match "<regex>"]` and
      `cmd_block_state()` URL-encodes it (`jq -sRr @uri`) precisely so a regex full of `+ & #`
      and spaces is not silently truncated into one that matches the WRONG lines.
- [x] The route is registered in `STRICT_AGENT_RULES` (or the human-only set), asserted by `tests/unit/sudo-guard-strict-agent-coverage.test.ts`
      → `lib/sudo-guard.ts:471` — `'GET /api/agents/[id]/block-state': { action: 'unblock-prompt',
      targetFromPathId: true }`, and `security-registry.json:60` carries it as `"strict"`. The
      test asserts **generically** (it iterates the strict-route ledger: *"every strict route is
      DECLARED — mapped, owner-only, or explicitly pending"*), so `grep block-state` on the test
      file returns 0 — the coverage is by construction, not by name. The neuter below is what
      proves that assertion actually binds this route rather than merely being able to.
- [x] A neuter of the authorization gate reds a named test
      → **OBSERVED via `scripts/dev/neuter`, restore verified by blob hash, 2026-08-22:**
      `s|'GET /api/agents/\[id\]/block-state'.*|// NEUTERED: mapping removed|` → **1 red / 9
      green**, the red being *"every strict route is DECLARED — mapped, owner-only, or explicitly
      pending"*. Exactly one, as predicted — the mutation changed 1 line (the tool aborts if it
      hits more), so the red set is about the gate aimed at and nothing else.
- [x] The red-state classifier regex is reused from one shared module (not copied) between `scripts/ai-maestro-hook.cjs` and the new route
      → **The requirement is met and its named counterparty no longer exists.**
      `scripts/ai-maestro-hook.cjs` is **absent from the repo** — `find . -name '*ai-maestro-hook*'`
      returns nothing, positive-controlled (`find scripts -maxdepth 1 -type f` = 122, `-name
      '*.sh'` = 91, and `.cjs` files do exist elsewhere, e.g. `lib/ecosystem-state-paths.cjs`), so
      this is a verified absence and not a broken search. What the box asked for — ONE shared
      classifier rather than a copy — is what shipped: the pure logic is `lib/agent-block-state.ts`,
      wrapped by `services/block-state-service.ts`, and consumed from five sites
      (`lib/fleet-askuser-autoanswer.ts:46`, `lib/oauth-rotator/model-fallback-deps.ts:18`,
      `services/agents-core-service.ts:1609`, `services/sessions-service.ts:40`, and the route).
      There is no second literal to drift.
- [x] `aimaestro-session.sh` exposes the capability so a plugin-side skill answers "is the input field empty?" / "is there a red error on screen?" with zero `/api/*` calls
      → `cmd_block_state()` wraps `_api GET /api/agents/${id}/block-state[?match=…]`, dispatched
      as the `block-state` verb and documented at `:16`, `:56`, `:170-198`. The `/api/*` call is
      the SCRIPT's, which is the whole point of the decoupling layer — the plugin caller makes
      none.

## Approval log

- 2026-08-06T12:04:01+0200 — MANDATE issued by USER (directive: "the scripts must be intermediaries between the api
  and the plugins… be sure the functions are good enough to cover all the functionalities
  accessible to the plugins"). Tier 0 / `min-approval-requirement: none` — in-scope server work
  on our own tree.
- 2026-08-22T02:11:23+0200 — COMPLETED by ai-maestro-hub (min-approval-requirement: none). All
  seven acceptance boxes verified first-hand against the tree, including a `scripts/dev/neuter`
  run on the authorization mapping (1 red / 9 green, restore blob-hash verified). The work itself
  landed 2026-08-21; this card simply never advanced — found by the board triage of 2026-08-22,
  which is the class of stale record that makes `todo` overstate the open board.
