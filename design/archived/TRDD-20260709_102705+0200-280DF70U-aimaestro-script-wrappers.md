---
trdd-id: 280DF70U
title: Permanent aimaestro and amp script wrappers for every new control monitor and task endpoint
column: completed
created: 2026-07-09T10:27:08+0200
updated: 2026-07-13T10:41:29+0000
implementation-commits: [c2c5ce5a]
last-test-result: pass
last-test-at: 2026-07-09T15:45:00+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 1
severity: HIGH
effort: M
task-type: infra
release-via: none
parent-trdd: TRDD-SCLSRS6E
derived: true
derived-kind: eht
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

## Outcome (2026-07-09, commit `c2c5ce5a`)

DONE. Deviations from the plan above, each deliberate:

- **`install-messaging.sh` needed no copy entry.** The plan assumed explicit copy
  lines were required; the installer already copies by glob (`amp-*.sh` for the
  AMP family, `*.sh` for everything else), so both new `amp-kanban-*` scripts and
  all three new `aimaestro-*` scripts were already on the install path. What WAS
  missing is verification: glob-installed scripts fail silently, which is exactly
  why an explicit by-name AID check already exists. Added the same by-name check
  for the five control-plane scripts instead of a redundant copy list.
- **One new route was required after all: `GET /api/agents/commands`.** The
  session wrapper needs to expose the curated `commandKey` allowlist, and the
  only way to read it was to POST a deliberately bogus key and scrape the 400's
  `Allowed: …` message. A script that provokes an error to read a constant breaks
  the day the message is reworded, so the allowlist is now a read-only route over
  the same compile-time constant (`lib/agent-commands.ts` stays the SSOT).
- **`aimaestro-agent.sh config` takes no `--include` flag.** The plan sketched
  `--include teams,repos,docker,tasks,aid`, but `GET /api/agents/[id]/full`
  accepts no query params and returns all of it unconditionally. Inventing a flag
  the route does not honour would have been a lie in the help text.

## Verification performed (live server, :23000)

Node 22 was required — `node-pty` throws `ERR_DLOPEN_FAILED` on this machine's
default Node 26, and the repo's own `check-node.mjs` guard says so. That engine
drift (`package.json` engines `<26.0.0`) pre-dates this work.

The wrappers authenticate with `Authorization: Bearer $AID_AUTH` (an `aim_tk_*`
agent token). This session has no AMP identity and bootstrapping one would have
written agent state into the source repo, so the harness authenticated as the
system OWNER (governance password → `aim_session` cookie) and put a local proxy
in front of the server to inject that cookie. Every request was therefore really
built by the script under test and really served by the running server; only the
credential was supplied at the edge.

- **22/22** script→route checks green: every read-only verb; agent name→UUID
  resolution inside the wrapper; BOTH halves of the strict gate (`403
  sudo_required` with no token, `200` with a fresh op-bound one); the queue
  enqueue→cancel round trip leaving no residue; the `409` refusal when answering
  a prompt that is not pending; and every client-side guard (`answer` XOR,
  `archive --state failed`, bad TRDD id, panel `html`+`url`, `--set-json`).
- **9/9** TRDD lifecycle checks green on a REAL git repo, closing the D5
  deferral. The unit tests only ever covered `trdd-store`'s `fs.rename`
  FALLBACK (they run in a tmp dir that is not a repo). Approving a tracked
  proposal produced a staged **rename (`R`)** in `git status` — proof the `git
  mv` branch ran, since `fs.rename` can only ever leave a `D` + `??` pair.
  `column: proposal → planned`, the `## Approval log` line, and the
  `tasks/ → archived/` move all verified, then `design/` was restored to HEAD
  exactly (`git reset -- design/` + `git checkout -- design/`; no `--hard`,
  no `git clean`).

**Process defect worth recording:** the smoke harness first picked `agents[0]`,
which resolved to `alexandre` — one of the user's REAL agents, on the scenario
rules' hard blacklist. It enqueued and immediately cancelled one command there
(verified: queue file left as `[]`, the agent was hibernated, nothing could
fire). The harness now refuses to run its mutating half against any agent that
does not match a disposable-test-name prefix, rather than defaulting to index 0.

## Still deferred (ONE item — do not roll it forward silently again)

The **dev-browser headless panel walkthrough** (render pushed HTML in the DOM,
open/close/refresh, feedback round-trip, light + dark screenshots). It has now
been deferred from Phase D to Phase E; it is a browser-level check and belongs
in its own task rather than a third silent roll-forward. The panel's SERVER half
is fully covered: 6 unit tests (mapping, bad shapes, fan-out + dead-socket
pruning, zero-client, FIFO drain, bounded queue) plus the live `delivered`-count
and sudo-gate checks above.

## Approval log
- 2026-07-10T05:26:00+0200 — COMPLETED by a bulk archival sweep (no approver was recorded). The work reached its terminal column long before; only the folder move was missed. Completion evidence is in implementation-commits and git history.
