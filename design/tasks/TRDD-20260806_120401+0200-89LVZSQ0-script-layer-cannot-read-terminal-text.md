---
trdd-id: 89LVZSQ0
title: The script layer cannot read terminal text, so three plugin-facing capabilities are unbuildable
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-06T12:04:01+0200
updated: 2026-08-06T12:04:01+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
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

## Approval log

- 2026-08-06T12:04:01+0200 — MANDATE issued by USER (directive: "the scripts must be intermediaries between the api
  and the plugins… be sure the functions are good enough to cover all the functionalities
  accessible to the plugins"). Tier 0 / `min-approval-requirement: none` — in-scope server work
  on our own tree.
