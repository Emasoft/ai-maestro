---
trdd-id: FUYUP38L
title: Add aimaestro-agent.sh session command verb over POST /api/sessions/[id]/command
column: cancelled
created: 2026-07-17T17:32:12+0200
updated: 2026-07-17T17:36:00+0200
current-owner: ai-maestro
task-type: infra
scope: project
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-17T17:32:12+0200
relevant-rules: [42]
labels: [janitor-absorption, frozen-cli, integration, scen-none]
external-refs: [Emasoft/ai-maestro-janitor#100]
release-via: none
---

# Add aimaestro-agent.sh session command verb over POST /api/sessions/[id]/command

## ⏵ STATE — CANCELLED (deliverable already existed) — 2026-07-17

**CANCELLED — the verb already exists AND is deployed; this task was based on a wrong grep.**
Verification (claim-verification discipline) found `cmd_session_command()` at
`~/.local/bin/agent-session.sh:210` (dispatched line 29, help line 40), landed in commit
`77883371`, doing exactly `POST /api/sessions/<name>/command` with `{command, requireIdle,
addNewline}` — matching the janitor's `fleet_inject.py:143` argv byte-for-byte, and LIVE on this
machine today. The task's premise ("the CLI verb does not exist, build it") was false: I had grepped
`aimaestro-session.sh` (a *separate* standalone CLI: inject/queue/state/…) instead of the
`agent-session.sh` module that `aimaestro-agent.sh` sources. Nothing to build. The wrong claim was
posted to and then CORRECTED on janitor#100 (comment 5004880793). Rev-2 convergence item #2 is
WITHDRAWN; the only residual is deploying `aimaestro-continuity.sh` (a DIFFERENT, real install gap).
No code was written for this TRDD; it is kept as the audit record of the self-correction.

---

### Original (superseded) premise

Rev-2 convergence item #2 of the janitor co-ratification ([[KCRMSNL7]] STATE block,
janitor#100). The janitor's shipped v0.50.0 soft-self-send channel
(`fleet_inject.py:143`, `aimaestro_command_argv`) builds:

```
aimaestro-agent.sh session command <tmux-session> --newline -- <command>
```

The **route `POST /api/sessions/[id]/command` EXISTS** (`app/api/sessions/[id]/command/route.ts`,
body `{command: string (required), requireIdle?: bool, addNewline?: bool}`, auth via
`checkSessionAuthz`), but the **CLI verb `aimaestro-agent.sh session command` DOES NOT** — so the
janitor's Phase-D channel targets a missing verb and silently fails. Add the thin wrapper so the
janitor's shipped code runs unchanged; do NOT ask the janitor to retarget.

**Contract to implement (match the janitor argv byte-for-byte):**
`aimaestro-agent.sh session command <session-name> [--newline] [--require-idle] -- <command text…>`
→ `POST /api/sessions/<session-name>/command` with body
`{ "command": "<text>", "addNewline": <true iff --newline>, "requireIdle": <true iff --require-idle> }`.
- `--` terminates flags; everything after it is the command text (join with spaces, preserve as one string).
- `--newline` → `addNewline: true` (the janitor always passes it — presses Enter).
- `--require-idle` → `requireIdle: true` (janitor's soft-send omits it; support it for parity with
  `aimaestro-session.sh inject --require-idle`).
- Reuse the script's existing `_api POST <path> <json>` helper and its AID_AUTH handling — the route
  is agent-authenticated, so the wrapper adds no new auth path.
- Add a usage/help line under the `session` verb.

**Auth / governance:** the route already enforces `checkSessionAuthz`; the CLI adds no bypass. Per
R42, cross-agent injection is server-gated at the route — the CLI is a thin transport, not a new
capability. No governance change.

**NEXT ACTION:** implement the sub-verb in the repo source of `aimaestro-agent.sh` (find the module
that owns `cmd_session`), `bash -n` clean, dry-verify the argv→route→body mapping, commit citing
TRDD-FUYUP38L. Deployment to `~/.local/bin` is via `install-messaging.sh`'s `scripts/*.sh` glob
(same install gap as `aimaestro-continuity.sh`, convergence item #3 — a joint verify step, NOT done
here). Do NOT push (this is the app, not a plugin).

## Verification
- `bash -n` on the edited script → 0.
- The verb builds exactly `POST /api/sessions/<name>/command` with the 3-field body above.
- A live end-to-end check (inject a harmless command into a test session and confirm it lands) is
  part of the joint "#J local install exercised inside a live agent" step with the janitor — noted,
  not a blocker for landing the verb.

## Approval log
- 2026-07-17T17:32:12+0200 — Tier-0 self-mandate: in-scope frozen-CLI glue, reversible, local; the
  contract is FIXED by the janitor's already-shipped `fleet_inject` argv, so no design ambiguity.
