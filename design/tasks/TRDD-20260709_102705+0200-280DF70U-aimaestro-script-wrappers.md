---
trdd-id: 280DF70U
title: Permanent aimaestro and amp script wrappers for every new control monitor and task endpoint
column: dev
created: 2026-07-09T10:27:08+0200
updated: 2026-07-09T10:27:08+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 1
severity: HIGH
effort: M
task-type: infra
release-via: none
parent-trdd: TRDD-SCLSRS6E
npt: []
eht: []
relevant-rules: []
labels: [script-layer, cli, decoupling, janitor, install]
test-requirements: [integration]
review-requirements: [human-review]
impacts: [install-script]
external-refs: []
---

# TRDD-280DF70U — Permanent script wrappers (the decoupling layer)

This is the EHT for D1-D5: every new endpoint they introduce MUST get a permanent
`aimaestro-*`/`amp-*` script wrapper, because per the project's Plugin Abstraction
Principle, plugins (including the janitor) are never allowed to call the AI Maestro
API directly — they call the immutable CLI script layer, which is the only boundary
allowed to touch the API.

## What exists today

- Established script families: `aimaestro-agent.sh` (plus its `agent-*.sh`
  modules), `aimaestro-governance.sh`, `aimaestro-teams.sh`, `aimaestro-hook.sh`,
  `amp-*.sh` (29 scripts), `aid-*.sh` (7 scripts).
- Auth pattern: `agent-helper.sh` resolves `AIMAESTRO_API_BASE` + `AID_AUTH` bearer
  token; `amp-helper.sh` resolves `AMP_MAESTRO_URL` + a per-agent API key; strict
  routes additionally require an `X-Sudo-Token`.
- `install-messaging.sh` installs `scripts/*.sh` to `~/.local/bin/`, putting them on
  `PATH` for every agent.
- This script layer is the PERMANENT interface the janitor (and every other
  governance agent) MUST use — never the API directly — per the Plugin Abstraction
  Principle documented in the project's `CLAUDE.md` / `docs/PLUGIN-ABSTRACTION-PRINCIPLE.md`.

## What to build

One script wrapper per new endpoint introduced by D1-D5, following the existing
naming and auth pattern:

1. **Terminal/session control (D1, D2):** a new `aimaestro-session.sh` family (or
   new subcommands added to `aimaestro-agent.sh`) covering: inject-command,
   send-slash, read-state, read-prompt, answer-prompt, queue-command, queue-list,
   queue-cancel.
2. **Agent config (D3):** `aimaestro-agent.sh config <id> [--include teams,repos,docker,tasks,aid]`.
3. **Side panel (D4):** new `aimaestro-panel.sh` — open/close/refresh/set-html/
   set-url/feedback.
4. **Task API (D5):** new `aimaestro-trdd.sh` (search/get/edit/approve/promote/
   archive) plus new `amp-kanban-get.sh` and `amp-kanban-edit.sh` (full-field
   edit), plus a keyword-search flag added to the existing `amp-kanban-list.sh`.
5. Wire every new script into `install-messaging.sh` — extend the existing
   `amp-*.sh` install loop and add explicit copy entries for the new
   `aimaestro-*.sh` scripts so `install-messaging.sh` places them on `PATH` like
   every other script in these families.
6. Each new script sources the appropriate existing helper (`agent-helper.sh` or
   `amp-helper.sh`) for base-URL + auth resolution, and adds `X-Sudo-Token`
   handling wherever the target route is strict-classified.

## Files to touch

- NEW `scripts/aimaestro-session.sh`.
- NEW `scripts/aimaestro-panel.sh`.
- NEW `scripts/aimaestro-trdd.sh`.
- NEW `scripts/amp-kanban-get.sh`.
- NEW `scripts/amp-kanban-edit.sh`.
- edit `scripts/amp-kanban-list.sh` — add keyword-search flag.
- edit `scripts/aimaestro-agent.sh` — add the `config` subcommand (or the
  session-control subcommands, depending on final split from D1/D2).
- edit `install-messaging.sh` — wire every new script onto the install path.

## Tests

- Each new script resolves the correct base URL and auth header (via the shared
  helper) without hardcoding either.
- A smoke test against a running dev server: each script's happy path hits its
  target route and returns the expected shape (exit 0, parseable output).
- `install-messaging.sh` places every new script on `PATH` at
  `~/.local/bin/` after a fresh install run.
- A strict-classified route rejects the script's call when no sudo token is
  supplied, and succeeds once one is (mirrors existing strict-route script tests).

## Approval log
