---
trdd-id: EZ4B12B9
title: Terminal control is open-loop — an agent can inject a command but no API can read what it produced
column: todo
created: 2026-08-04T23:34:08+0200
updated: 2026-08-04T23:34:08+0200
current-owner: governance-rules
assignee: governance-rules
created-by: governance-rules
task-type: feature
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
min-approval-requirement: manager
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
priority: 2
severity: medium
effort: medium
release-via: none
labels: [agent-control, terminal, api-gap, observability]
---

# Terminal control is open-loop — an agent can inject a command but no API can read what it produced

## ⏵ STATE — READ THIS FIRST ON RESUME — 2026-08-04

- **MEASUREMENT COMPLETE. Nothing implemented.** This card is a filed FINDING, not started work.
- **`min-approval-requirement: manager`, `approved: false`** — deliberately NOT a self-mandate.
  Exposing pane content is a new READ of potentially secret-bearing data, so it crosses the
  objective floor for MANAGER. It sits in `todo` awaiting that decision; do not start it as a
  Tier-0 chore.
- **NEXT ACTION:** get the approval, then design the redaction/authorization contract BEFORE
  writing the route. The route is the easy part; what may be read, by whom, is not.

## Problem

The USER's `/code-review --fix` brief named *"missing api/scripts functionalities to inject
arbitrary commands and detect terminal output"*. Measured first-hand, those two halves are in
completely different states:

**INJECT — fully built.** Three routes reach the pane (`PATCH /api/agents/[id]/session`,
`POST …/queue` which drains into it, `POST …/chat`), plus `POST …/prompt/answer`, plus the
`aimaestro-session.sh` wrapper with `inject` / `slash` / `answer` / `queue` / `queue-list` /
`queue-cancel`. All of TRDD-SCLSRS6E's D1-D6 shipped (verified: every route file and every
wrapper script exists).

**DETECT OUTPUT — absent from every external surface.** `AgentRuntime.capturePane(name, lines)`
exists in `lib/agent-runtime.ts:361` — full-history capture with a visible-pane fallback — and
at least five internal modules consume it (`lib/fleet-continuity.ts`, `lib/session-restart.ts`,
`services/agents-chat-service.ts` ×2, `services/creation-helper-service.ts`,
`lib/agent-runtime.ts` itself). But:

- **no file under `app/` calls it** — measured, zero hits;
- **no verb in `aimaestro-session.sh` returns pane content.**

`state <agent> --pane` looks like it might and does not: it merges
`GET /api/agents/[id]/session` with `GET /api/sessions/[name]/pane-status`, and the latter
returns `getPaneCommand(sessionName)` — the pane's COMMAND/STATUS, not its text. Checked
precisely because the flag's name implies otherwise.

## Root cause

The control epic was scoped around *acting on* an agent (inject, queue, answer, configure) and
around a coarse STATE ladder (idle / busy / permission / hibernated). Reading the terminal was
never a deliverable, because every internal consumer that needed it already had `capturePane`
in-process. The capability exists; only its EXPOSURE is missing, which is why nothing looked
broken from inside.

## Why it matters

**Every remote control action is open-loop.** A governance agent can inject `/compact`,
`/janitor-arm`, or `/reload-plugins` into another agent and then cannot read what happened. It
can observe that the agent went busy and came back idle — which is equally true of a command
that errored, was rejected, hit a rate limit, or was typed into a prompt that was not the one
expected. "Did it work?" is answerable only by inference from a status ladder.

This is the same defect class this repo already has lessons for, one level up: an instrument
that cannot distinguish *worked* from *silently did nothing* reports success either way.

## Proposed fix

`GET /api/agents/[id]/pane` returning the captured text, `{lines?: number}` bounded, plus an
`aimaestro-session.sh output <agent> [--lines N]` verb, and a `--since`/tail form so a caller
can diff before/after an injection.

**The route is the easy part. The contract is not, and it is why this is not a Tier-0 chore:**

- A terminal pane can contain **anything the agent has seen** — file contents, tokens echoed by
  a command, an `.env` dump, another agent's message. This is a materially wider read than
  anything the existing control routes grant.
- It must be classified **strict** in `security-registry.json` AND declared on the agent branch
  of `lib/sudo-guard.ts` — classifying strict alone fails closed with a 403 that reads like
  policy (the exact trap recorded on the `agent-control-monitor-api` wiki page, where 8 routes
  403'd every agent for the life of an epic that shipped `complete`).
- The self-drive question needs an explicit answer: `SELF_DRIVE_ACTIONS` currently lets an agent
  drive its own surface. Reading your OWN pane is harmless; reading a PEER's is the sensitive
  case, and mapping this to `send-command` would inherit the self-target exemption that
  TRDD-D3RP7KQZ showed is wrong for anything but a drive verb.

## Verification

- A test that injects a known sentinel through the existing inject route and reads it back
  through the new one — which is the whole point: it closes the loop, and no current test can.
- A refusal test per authorization case, asserting the REASON, not merely `success === false`.
- Neuter: remove the route's authorization and confirm exactly the refusal tests redden.

## Estimated risk

**MEDIUM to build** (small route, real authorization design). **MEDIUM to leave** — nothing is
broken today, but every governance automation built on injection is guessing at its own effect,
and that is the kind of gap that gets papered over with sleep-and-hope.

## Provenance

Measured 2026-08-04 while working the last of the three areas the USER's `/code-review --fix`
brief named and both review fleets skipped. Every claim above was checked first-hand: the route
files, the wrapper verbs, `capturePane`'s callers, and `pane-status`'s actual return value.

## Approval log

- 2026-08-04T23:34:08+0200 — FILED as a proposal-tier finding, NOT self-mandated. The objective
  floor is `manager`: a new read surface over potentially secret-bearing data.

## Acceptance

- [ ] MANAGER (or USER) decides whether the pane-read surface should exist at all
- [ ] if approved: the authorization contract is decided BEFORE the route — strict + declared on
      the agent branch, and an explicit self-vs-peer rule rather than inheriting `send-command`
- [ ] `GET /api/agents/[id]/pane` + an `aimaestro-session.sh output` verb
- [ ] a closed-loop test: inject a sentinel, read it back
- [ ] refusal tests assert the REASON, with a recorded neuter
