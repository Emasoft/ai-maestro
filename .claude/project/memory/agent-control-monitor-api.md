---
name: agent-control-monitor-api
description: "how does the janitor / a governance agent CONTROL or MONITOR another agent's Claude Code terminal — inject a command like /compact or /reload-plugins, read+answer an AskQuestion or permission menu, watch agent state (idle/busy/permission/hibernated), QUEUE a command until the agent is next idle/online, read an agent's full config (launch args / teams / github repo / docker clone / pending tasks), drive the terminal HTML side panel, or search/read/edit/approve/promote/archive a TRDD or kanban task — the API endpoints + the permanent aimaestro-*/amp-* script layer"
ocd: 2026-07-09
lmd: 2026-07-09
metadata:
  node_type: memory
  type: project
  tier: component
---

# AI Maestro agent control + monitor API (and the permanent script layer)

The surface a governance agent (esp. the **janitor**) uses to monitor and control the
fleet. **Decoupling invariant** (project CLAUDE.md "Plugin Abstraction Principle"): plugins
call the **script layer** (`~/.local/bin/aimaestro-*.sh` / `amp-*.sh` / `aid-*.sh`), NEVER
the HTTP API directly. So each capability below has (ideally) an API route AND a script
wrapper; where the wrapper is missing, it is being added under TRDD-SCLSRS6E (D6). The full
build epic + gap analysis: `design/tasks/TRDD-…-SCLSRS6E-janitor-control-monitor-api.md`
(gap reports under `reports/api-gap-analysis/`).

## What ALREADY EXISTS (verified 2026-07-09)

- **Inject any command / slash-command into an agent terminal** — `PATCH /api/agents/[id]/session`
  with `{command: "<literal text or /slash>"}` (arbitrary) or `{commandKey: "compact"|"reload-plugins"|…}`
  (allowlist in `lib/agent-commands.ts`). Gated on `requireIdle` (409 when busy) + `authorize('send-command')`.
  Also: deprecated `POST /api/sessions/[id]/command`; the WS `/term` PTY bridge writes raw keystrokes.
- **Read live agent state** — the hook writes `~/.aimaestro/chat-state/<sha256(cwd)[:16]>.json`;
  `getHookState(workingDir)` (services/sessions-service.ts) returns `{status, notificationType, subagentCount}`;
  `lib/agent-status.ts` resolves the 8-priority ladder (exited/rate_limited/api_error/permission/waiting±subagents/
  active/idle/hibernated); `GET /api/sessions/[id]/pane-status` is the cheap tmux-only poll; the `/status` WS
  broadcasts activity. `lib/session-safe-state.ts evaluateExitGate` is the subagent-safety gate for stop/restart.
- **Full agent config** — `GET /api/agents/[id]` returns the whole Agent record: `program`+`programArgs`
  (the LAUNCH STRING), `governanceTitle`, `workingDirectory`, `hooks`, `githubRepo` (MAINTAINER-only),
  `deployment.cloud` (= the agent's OWN process running in a docker container).
- **Answer a permission prompt** — today only a hardcoded `y` (AgentProfile "Approve" → sends `y`).
- **Kanban task CRUD** — GitHub-Projects-backed via teams-service: `GET/POST /api/teams/[id]/tasks`,
  `PUT/DELETE /api/teams/[id]/tasks/[taskId]`; scripts `amp-kanban-{list,create-task,move,archive}.sh`.
- **Script families** — `aimaestro-agent.sh` (+ `agent-*.sh` modules), `aimaestro-governance/teams/hook.sh`,
  `amp-*.sh` (×29), `aid-*.sh` (×7). Auth: `AID_AUTH` bearer (agent-helper.sh) / per-agent api-key
  (amp-helper.sh) / `X-Sudo-Token` for strict routes; base `http://localhost:23000`.

## What is BEING BUILT (TRDD-SCLSRS6E derived tasks)

- **D1 — server-side command QUEUE** (`lib/command-queue.ts`, `POST/GET/DELETE /api/agents/[id]/queue`):
  today's `useRestartQueue` is client-only, restart-only, in-memory, no hibernation. New = persistent
  (`~/.aimaestro/command-queue/<id>.json`), GENERIC (any command/commandKey), fires at `idle_prompt`+gate-pass,
  holds/optionally-wakes hibernated agents.
- **D2 — read+answer AskQuestion/permission** (`GET /api/agents/[id]/prompt`, `POST …/prompt/answer`): the hook
  already CAPTURES permission options into the chat-state file, but no API exposes them and AskUserQuestion isn't
  captured yet (that half is the hook enhancement, D7, in the ai-maestro-plugin repo). New = surface the question
  + `options[]`, answer by `optionKey` or free `text`.
- **D3 — consolidated config** (`GET /api/agents/[id]/full`): base config + reverse team lookup + normalized
  `githubRepo` (from `/api/agents/[id]/repos` which scans the workdir) + **repo-uses-docker** detection
  (`lib/repo-docker-detect.ts` — docker-compose/Dockerfile in the workdir; distinct from agent-as-container) +
  agent→pending-tasks + AID pubkey.
- **D4 — HTML side panel** (campaign gate G4; greenfield): a new `html` tab + a new panel-content WS (mirror the
  `companionWss` voice pattern) + `POST /api/agents/[id]/panel {action:open|close|refresh|set, html|url}` + a
  feedback callback channel. Lets visualizer plugins (visual-communicator) render HTML / a live site in-panel.
- **D5 — task API** (`/api/trdd` + `lib/trdd-store.ts`): search/read/edit + lifecycle approve/promote/archive over
  the `design/{proposals,tasks,archived,refused}/*.md` corpus (git-mv-aware); plus the trivial kanban
  `GET /api/teams/[id]/tasks/[taskId]` + keyword search + full-field edit. NOTE: kanban `status` and TRDD
  `column:` are TWO PARALLEL state machines — keep the TRDD the SSOT.
- **D6 — script wrappers** (the decoupling layer): `aimaestro-session.sh` (inject/slash/state/read-prompt/
  answer/queue), `aimaestro-agent.sh config`, `aimaestro-panel.sh`, `aimaestro-trdd.sh`, `amp-kanban-get/edit.sh`
  — wired into `install-messaging.sh`. **This is what the janitor actually calls.**
- **D7 — cross-repo** (Emasoft/ai-maestro-plugin): add dev-browser to the core plugin.json `dependencies` (Claude
  auto-installs plugin deps) + enhance `ai-maestro-hook.cjs` to capture AskUserQuestion text+choices.

## Gotchas

- New control routes (inject/answer/queue/panel/trdd-mutate) are destructive → classify **strict** in
  `security-registry.json`. Classifying strict is only HALF the job: the route must ALSO be declared on
  the agent branch of `lib/sudo-guard.ts`, or `requireAidTitle` fails closed and **every agent caller
  gets 403** — silently, with a message that reads like intent.[^1] Three sets exist: `STRICT_AGENT_RULES`
  (agent-callable, mapped to an `AuthAction`), `SYSTEM_OWNER_ONLY_STRICT` (human-only), and
  `AGENT_POLICY_PENDING` (undecided debt ledger). `tests/unit/sudo-guard-strict-agent-coverage.test.ts`
  fails the build if a strict route is in none of them.
- The natural mapping for the agent-control routes (`send-command` + `targetFromPathId`) would DENY an
  agent driving its OWN panel/queue, because `authorize()` universally refuses self-targeting. Deciding
  that is Tier-2 governance (proposal TRDD-D3RP7KQZ), not a mapping detail.
- The USER path is barely usable: the script wrappers carry no session-cookie support
  (`get_auth_args` reads only `AID_AUTH`, so a human gets 401), and `POST /api/auth/sudo-password` is a
  **global 5-per-60s bucket that successful mints consume** — 5 strict ops/minute machine-wide
  (TRDD-X8R2HP9D).
- The hook is in the **ai-maestro-plugin** repo, not here — its changes are cross-project (issue/PR).
- HTML panel content must obey the no-nested-scrollbars rule (sandboxed iframe, let the page expand).
- See also [[marketplace-plugin-registration]] (dev-browser cross-marketplace dependency shape) and
  [[session-control-subagent-gate]] (the idle/subagent safety gate the queue reuses).

## Notes and lessons learned

[^1]: [ocd:2026-07-09 lmd:2026-07-09] This page previously said "agent callers need AID
  proof-of-possession", implying the agent path worked. It did not. All 8 strict routes the epic
  shipped 403'd every agent — the janitor included — for the entire life of the epic, and the epic
  was marked `complete`. I read `requireSudoToken`'s R32 dual-path, saw the agent branch, and stopped;
  I never checked that the routes were registered in `STRICT_AGENT_RULES`. Verified 2026-07-09 by
  calling `requireAidTitle` directly (TRDD-6A2I6ZO0). Lesson: reading the dispatcher is not reading the
  table it dispatches on. When a doc/comment asserts a capability, exercise it — a design that is
  correct on paper can be unregistered in practice.

[^2]: [ocd:2026-07-09 lmd:2026-07-09] The HTML panel's feedback channel never worked, and every health
  signal said it did: the server reported `connectedClients: 1`, the UI rendered "Panel channel
  connected", and control messages kept arriving. `usePanelWebSocket`'s `ws.onclose` nulled
  `wsRef.current` unconditionally, so an agent switch let the OLD socket's late close wipe the ref to
  the LIVE one; `sendFeedback` — the sole reader — then no-op'd forever. It was silent because `onopen`
  restores `connected` but never restores the ref. Six unit tests passed over it; a browser found it in
  minutes. Lesson: **a health signal that does not exercise the write path can report green while the
  write path is dead.** Corollary for WS hooks: capture the socket per connection (`const sock`) and
  guard every handler on `wsRef.current === sock`; a handler that closes over a reassignable `ws`
  variable acts on whatever socket is current when it fires, not its own.
