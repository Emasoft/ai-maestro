---
trdd-id: SB5I53K1
title: A fleet-wide stop and restart verb on the script layer so the janitor can cycle every agent
column: proposal
created: 2026-07-14T15:11:49+0200
updated: 2026-07-14T15:11:49+0200
current-owner: claude-opus-session
created-by: claude-opus-session
task-type: feature
min-approval-requirement: manager
approved: false
priority: 2
severity: medium
effort: medium
release-via: none
relevant-rules: [17, 23, 32]
labels: [agents, lifecycle, script-layer, janitor, fleet]
blocked-by: [D5XDT49I]
pre-block-column: proposal
---

# A fleet-wide stop and restart verb on the script layer so the janitor can cycle every agent

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-14

**BLOCKED on `TRDD-D5XDT49I` — and the block is the point, not an obstacle.** A
`restart --all` that silently wipes every agent's conversation is *worse* than having no verb
at all: it turns a recoverable annoyance (a human forgets to restart an agent) into an
irreversible, one-command, fleet-wide data loss. Do NOT ship this verb until a restart
demonstrably preserves the thread.

- **NEXT ACTION:** none until `TRDD-D5XDT49I` resolves. Then design the verb per below.
- A UI scenario covering the whole stop → restart → thread-survives loop is future work
  (USER, 2026-07-14) and is this TRDD's to author.

## Problem

**There is no way to stop or restart the fleet as a unit.** `aimaestro-agent.sh` ships
`hibernate | wake | restart`, all per-agent (an agent id is required); there is no `--all`,
and no fleet verb anywhere on the script layer:

```console
$ grep -nE '^\s+(stop|restart|kill|hibernate|wake)[a-z-]*\)' scripts/aimaestro-agent.sh
103:        hibernate) shift; cmd_hibernate "$@" ;;
104:        wake)      shift; cmd_wake "$@" ;;
105:        restart)   shift; cmd_restart "$@" ;;
$ grep -c -- '--all' scripts/agent-*.sh scripts/aimaestro-agent.sh
0
```

The gap is not theoretical — it fired on 2026-07-14. The USER changed Claude Code's
`settings.json` to stop a disk-write storm and needed every agent cycled to pick it up. With
no verb to call, the operation was hand-rolled as a `tmux send-keys` loop:

- `/exit` had to be typed into each pane individually;
- the resulting *"Background work is running → Exit anyway"* confirmation had to be detected
  and answered per-pane;
- one agent (`genny-bot`) was wedged mid-turn on a background subagent, never processed the
  queued `/exit`, and had to be SIGHUP'd by killing its tmux session;
- and because nothing carries a resume flag (`TRDD-D5XDT49I`), all four agents lost their
  conversations.

Every one of those steps is logic that belongs in the product, executed identically every
time, not improvised by whoever is at the keyboard.

## Why the janitor specifically needs it

The janitor is the machine-wide guardian: it detects drift, applies plugin updates, and
keeps the fleet consistent. A whole class of its findings is only actionable by a restart —
**a config change reaches a running Claude Code process only when that process restarts.**
That is exactly what happened here: the new `settings.json` was correct on disk and inert in
four already-running agents.

Today the janitor can detect that condition and can do nothing about it. It has no verb to
call, so its only move is to tell a human to go type `/exit` eight times. A detector whose
remedy cannot be executed is half a detector.

## Proposed shape (to design once unblocked)

A fleet verb on the script layer — the decoupling boundary, per the plugin-abstraction
principle (never the API directly):

```
aimaestro-agent.sh stop    --all [--force]   # graceful /exit; --force escalates to kill
aimaestro-agent.sh restart --all             # stop --all, then wake each, resuming its thread
```

The per-agent semantics already exist and must be reused, not reimplemented:

- graceful stop = the ratified `C-c` → `/exit` → `Enter` sequence (`POST /api/sessions/[id]/stop`);
- the *"Exit anyway"* confirmation must be **detected and answered** — the restart route
  already does this (TRDD-O8NCNRWO), and a hand-rolled loop that does not will hang forever;
- an agent that will not exit cooperatively (mid-turn, blocked on a background subagent)
  escalates to `POST /api/sessions/[id]/kill` — but only under `--force`, and the escalation
  must be **reported**, never silent;
- the R28 safe-state gate and `subagentCount` check (TRDD-O8NCNRWO) apply unchanged — a fleet
  stop must not become a way to bypass the guard that a single stop respects.

**Authorization is the load-bearing question, not the mechanics.** Stopping every agent on the
host is a fleet-wide destructive act. Today `stop`/`restart` are `strict` routes (sudo-gated).
An `--all` variant is strictly more dangerous than the per-agent one and must not be *easier*
to invoke. Who may call it — USER only, MANAGER, or the janitor under a portfolio token
(R28) — is a governance decision, and it is the reason this is a proposal rather than a
commit. Note the shape it would take: this is precisely the kind of narrow, high-blast-radius
operation `OPERATIONS_REQUIRING_TOKEN` exists to gate (see `TRDD-F1SL03CK`).

## Open questions for the approver

1. **Who may invoke `--all`?** USER only? MANAGER? The janitor with a minted mandate?
2. **Does the janitor get to invoke it autonomously**, or only surface a
   `[janitor-restart-needed]` marker for a human to action? Autonomy here means a background
   daemon can cycle the whole fleet unattended — a categorically larger promise than
   "rewrite a file", and the same line `agent-invariants.ts` already draws with
   `core-plugin: triggers: ['wake']`.
3. **Is `stop --all` even wanted separately**, or is `restart --all` the only real use case?
   (Today's incident wanted a plain stop — the USER wanted the fleet *down*, not cycled.)

## Verification

- Per-agent behavior is unchanged (the existing stop/restart tests must stay green).
- `--all` on a fleet where one agent is wedged: reports the escalation, does not hang, does
  not silently kill without `--force`.
- **Live scenario (future work, USER-deferred 2026-07-14):** stop the fleet → restart the
  fleet → every agent answers a question about what was said before the restart. That last
  clause is the whole test; without `TRDD-D5XDT49I` it cannot pass, which is why this TRDD is
  blocked on it.

## Estimated risk

**MEDIUM-HIGH.** The mechanics are a loop over verbs that already exist and are already
tested. The risk is entirely in the authorization surface: a one-command fleet stop is a
denial-of-service against the user's own fleet if it is reachable by anything that should not
reach it. Ship the gate before the verb.

## Approval log
