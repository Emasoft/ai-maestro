---
name: agent-control-monitor-api
description: "how does the janitor / a governance agent CONTROL or MONITOR another agent's Claude Code terminal — inject a command like /compact or /reload-plugins, read+answer an AskQuestion or permission menu, watch agent state (idle/busy/permission/hibernated), QUEUE a command until the agent is next idle/online, read an agent's full config (launch args / teams / github repo / docker clone / pending tasks), drive the terminal HTML side panel, or search/read/edit/approve/promote/archive a TRDD or kanban task — the API endpoints + the permanent aimaestro-*/amp-* script layer"
ocd: 2026-07-09
lmd: 2026-07-17
metadata:
  node_type: memory
  type: project
  tier: component
  topic: agents
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
- **An agent may DRIVE its own surface, never RECONFIGURE itself** (USER decision, TRDD-D3RP7KQZ, shipped
  `4e507bfd`+`11cd98a6`). `SELF_DRIVE_ACTIONS = {send-command, hibernate-agent}` in `lib/authorization.ts`
  is the closed exemption to the universal self-target ban; the panel / queue / prompt-answer trio all map
  to `send-command`, so an agent drives its own panel and queue. `wake-agent` is deliberately absent — a
  sleeping agent cannot wake itself. The mechanical membership test: nothing in the set writes the agent's
  registry record.[^3]
- **The self-drive exemption makes `send-command` INSUFFICIENT for any "refuse / cancel / veto" verb.**
  `DELETE …/queue/[entryId]` proved it: mapping cancel to `send-command` closes the cross-agent hole and
  leaves the governance-evasion one open, because self-target is exempt — a MEMBER could delete the
  `/compact` its COS queued for it. Cancel is decided by OWNERSHIP: `CommandQueueEntry.enqueuedBy` (taken
  from the verified auth result, never the body; missing ⇒ not yours, fail closed). An agent retracts only
  what it queued itself. Cross-agent cancel still goes through the `send-command` matrix.
- **A hibernated agent is never waited on.** `queue` persists, so a command to a sleeping agent is HELD
  (never dropped) and drains at its next `idle_prompt`; `--wake-first` wakes it now. An enqueued
  `/janitor-arm` therefore always succeeds — armed now, or armed later. `/janitor-arm` is PER-PROJECT (its
  skill calls `CronCreate` and stamps `$CLAUDE_PROJECT_DIR/.janitor/state/heartbeat-armed-at.ts`), which is
  exactly why it must be delivered into each agent's own session rather than invoked centrally. It is NOT
  `/janitor-global-arm`, and no fleet-wide arm command exists.[^5] Fan-out across the fleet still needs
  MANAGER or the human, since `queue` maps to `send-command`.
- **There are THREE terminal-injection routes, not one.** `PATCH …/session`, `POST …/queue` (drains into
  the pane), and `POST …/chat` — the last ends in `sendKeys(msg, {literal:true, enter:true})` and was
  unguarded until `c7d9f8a7`. All three now carry `send-command`. Before adding any route that reaches
  `runtime.sendKeys`, wire the action first.[^4]
- `middleware.ts` authenticates EVERY request globally, so a route with no auth call is still
  authenticated. It is not authorized. `enforceAuth` is worse than it looks: it authenticates and
  **discards the result**, so a route using it *cannot* authorize even if it wanted to. As of
  `f56b79f2` five agent-scoped routes still authorize nothing; `messages/[messageId]` (any agent
  deletes any agent's AMP messages) is the sharp one remaining. Ledger:
  `tests/unit/agent-route-authorization-coverage.test.ts`; audit: TRDD-4Q7WMPZK.
- **`GET …/export` shipped the target's Ed25519 PRIVATE KEY**, not "its transcripts": `exportAgentZip`
  does `archive.directory(getKeysDir(id), 'keys')`, and `lib/amp-keys.ts` calls that `private.pem`
  "NEVER shared". Any agent token → any agent's signing key → forged, genuinely-valid AMP messages
  forever. Fixed `f56b79f2`: action `export-agent`, **system-owner only** (MANAGER and COS denied —
  governing an agent never needs its key; a genuine signature cannot be told from a genuine one). The
  headless router had the same hole with *no* auth call. **Danger is not the same as mutation**: both
  guardrails scanned only `POST|PUT|PATCH|DELETE`, so a GET that exfiltrates was structurally
  invisible. `EXFIL_FUNCTIONS` in `dangerous-primitive-authorization.test.ts` now scans every verb.[^6]
- The USER path is barely usable: the script wrappers carry no session-cookie support
  (`get_auth_args` reads only `AID_AUTH`, so a human gets 401), and `POST /api/auth/sudo-password` is a
  **global 5-per-60s bucket that successful mints consume** — 5 strict ops/minute machine-wide
  (TRDD-X8R2HP9D).
- The hook is in the **ai-maestro-plugin** repo, not here — its changes are cross-project (issue/PR).
- HTML panel content must obey the no-nested-scrollbars rule (sandboxed iframe, let the page expand).
- See also [[marketplace-plugin-registration]] (dev-browser cross-marketplace dependency shape) and
  [[session-control-subagent-gate]] (the idle/subagent safety gate the queue reuses).

## Notes and lessons learned

[^1]: [id:ATOM-STRICT-AGENT-RULES-UNREGISTERED, status:valid, keywords:"agent_403_on_strict_route unregistered_STRICT_AGENT_RULES epic_marked_complete_but_broken read_dispatcher_not_the_table AID_proof_of_possession_not_working", ocd:2026-07-09, lmd:2026-07-09] This page previously said "agent callers need AID
  proof-of-possession", implying the agent path worked. It did not. All 8 strict routes the epic
  shipped 403'd every agent — the janitor included — for the entire life of the epic, and the epic
  was marked `complete`. I read `requireSudoToken`'s R32 dual-path, saw the agent branch, and stopped;
  I never checked that the routes were registered in `STRICT_AGENT_RULES`. Verified 2026-07-09 by
  calling `requireAidTitle` directly (TRDD-6A2I6ZO0). Lesson: reading the dispatcher is not reading the
  table it dispatches on. When a doc/comment asserts a capability, exercise it — a design that is
  correct on paper can be unregistered in practice.

[^2]: [id:ATOM-PANEL-WS-STALE-REF, status:valid, keywords:"panel_feedback_channel_silently_dead websocket_onclose_nulls_ref health_check_green_but_broken agent_switch_stale_socket sendFeedback_no_ops", ocd:2026-07-09, lmd:2026-07-09] The HTML panel's feedback channel never worked, and every health
  signal said it did: the server reported `connectedClients: 1`, the UI rendered "Panel channel
  connected", and control messages kept arriving. `usePanelWebSocket`'s `ws.onclose` nulled
  `wsRef.current` unconditionally, so an agent switch let the OLD socket's late close wipe the ref to
  the LIVE one; `sendFeedback` — the sole reader — then no-op'd forever. It was silent because `onopen`
  restores `connected` but never restores the ref. Six unit tests passed over it; a browser found it in
  minutes. Lesson: **a health signal that does not exercise the write path can report green while the
  write path is dead.** Corollary for WS hooks: capture the socket per connection (`const sock`) and
  guard every handler on `wsRef.current === sock`; a handler that closes over a reassignable `ws`
  variable acts on whatever socket is current when it fires, not its own.

[^3]: [id:ATOM-QUEUE-DELETE-UNGATED, status:valid, keywords:"DELETE_queue_entry_ungated authenticate_vs_authorize enforceAuth_stops_short cross_agent_command_deletion self_drive_vs_self_reconfigure", ocd:2026-07-09, lmd:2026-07-09] This page previously said the `send-command` mapping "would DENY an
  agent driving its OWN panel/queue" and that deciding it was open Tier-2 governance. The USER decided it
  on 2026-07-09 (self-drive allowed, self-reconfigure never), and the code shipped. Two lessons, and the
  second cost a real vulnerability. **(a)** `requireAuth` / `enforceAuth` AUTHENTICATE and stop — they
  prove WHO the caller is and say nothing about what they may do. "Non-strict" is a statement about the
  *sudo* gate ONLY; treating it as "no authorization needed" is what left `DELETE …/queue/[entryId]`
  ungated, where any valid agent token could delete every command the MANAGER had queued across the whole
  fleet (`4b1a9b48`, TRDD-4Q7WMPZK). A gate on the CREATE verb is worthless if the DESTROY verb is open —
  you cannot inject, but you can nullify, and the fleet lands in the same place. **(b)** Once an exemption
  exists, every later mapping must be re-checked against it: `send-command` gates cross-agent cancel
  correctly and self-cancel not at all, because self-target is exempt. Asking "does this action mean DRIVE,
  or does it mean REFUSE?" separates them — driving your own surface is allowed, vetoing an order is not.
  Always falsify the guard: strip it, and confirm the refusal tests actually fail.

[^4]: [id:ATOM-CHAT-ROUTE-AUTH-BYPASS, status:valid, keywords:"chat_route_bypasses_sendkeys_gate route_name_sounds_harmless capability_defined_by_code_not_name enforceAuth_only_no_sudo indexOf_vacuous_when_absent", ocd:2026-07-09, lmd:2026-07-09] `POST /api/agents/[id]/chat` typed arbitrary text + Enter into ANY
  agent's tmux pane with `enforceAuth` alone — a total bypass of both the `send-command` matrix and
  sudo-mode, while the openly-named `PATCH …/session` was gated by both. It survived because auditors read
  the endpoint's NAME. "chat" sounds like messaging; the code called `sendKeys(literal, enter)`. Lesson:
  **a capability is defined by what the code does, not by what the route is called** — read through to the
  service call, and enumerate routes by the dangerous primitive they reach (grep `sendKeys`, `startProgram`,
  `writeFileSync`) rather than by plausible-sounding names. Second lesson, from falsifying the fix: an
  ordering assertion `indexOf(A) < indexOf(B)` passes VACUOUSLY when A is absent (`-1 < n`), so it passed on
  the exact code it existed to reject — assert presence before order. Third: `enforceAuth` returns
  `NextResponse | null` and throws the identity away; grep for it as a SMELL, not as a guard.

[^5]: [id:ATOM-JANITOR-GLOBAL-ARM-FABRICATED, status:valid, keywords:"janitor-global-arm_does_not_enqueue fabricated_command_behavior name_supplied_by_user_is_hypothesis kill_switch_vs_agent_awareness wrote_mechanism_against_wrong_name", ocd:2026-07-09, lmd:2026-07-09] This page previously said "`/janitor-global-arm` therefore always
  succeeds — armed now, or armed later", and `docs/SCRIPT-LAYER.md` went further: "It fans out one `queue`
  call per agent and returns." Both were fabricated. `/janitor-global-arm` runs `global_control_cli.py arm`,
  which clears the machine-wide kill-switch + global-pause flags and is the exact reverse of
  `/janitor-global-disarm` — it arms no heartbeat, enqueues nothing, and contains zero agent awareness. The
  enqueue MECHANISM was right and `janitor-arm` IS a real allowlisted key (`lib/agent-commands.ts:65`); only
  the command it was attached to was wrong. Root cause: the USER's directive named `/janitor-global-arm`, and
  I wrote the mechanism against that NAME without ever reading the skill. That is the same failure as the
  `chat` route in [^4] — a capability is what the code does, not what it is called — except the name came
  from a human, which made it feel already-verified. **A name supplied by anyone, the user included, is a
  hypothesis.** Read the implementation before committing the fact, especially into PROJECT-scope memory,
  where a wrong fact is pushed to every contributor.

[^6]: [id:ATOM-EXPORT-ZIP-KEY-THEFT, status:valid, keywords:"export_route_leaks_private_keys GET_not_POST_is_dangerous impersonation_not_disclosure danger_is_not_mutation comment_describes_test_enforces", ocd:2026-07-09, lmd:2026-07-09] This page, the coverage ledger, AND TRDD-YEE33F3A all recorded
  `export` as "POST — any agent reads any agent's transcripts, confidentiality". Every part was wrong.
  The dangerous verb is **GET** (POST has zero callers), and the payload is not transcripts but
  `keys/private.pem` + `registrations/` + `agent.db`. The consequence is not disclosure but permanent,
  undetectable **impersonation**: the thief signs as the victim and every downstream governance check
  validates the signature, because it is valid. Two lessons. (1) **Danger ≠ mutation.** Both guardrails
  enumerated `POST|PUT|PATCH|DELETE`; a read that emits a secret is worse than most writes, and was
  invisible to both. Classify primitives by *what leaves the process*, not by verb. (2) A route's own
  doc comment listed "AMP keys, and AID identity" in the zip and the route still only authenticated —
  so an accurate comment beside an absent guard bought nothing. Comments describe; tests enforce. The
  `EXFIL_FUNCTIONS` net now asserts `exportAgentZip` really does archive the keys dir, so the
  justification cannot rot into a lie the way that comment did.

[^7]: [id:ATOM-SESSION-COMMAND-VERB-WRONG-GREP, status:valid, ocd:2026-07-17, lmd:2026-07-17, keywords:"session_command_verb aimaestro-agent_vs_aimaestro-session
  grep_wrong_script verb_does_not_exist agent-session_module"] DO NOT claim an `aimaestro-agent.sh
  <verb> <subverb>` command is absent by grepping `aimaestro-session.sh` (or the `aimaestro-agent.sh`
  dispatcher file alone), BECAUSE `aimaestro-agent.sh` is a thin dispatcher that SOURCES `agent-*.sh`
  modules — `agent-session.sh` owns the `session` sub-verbs (`command`→`cmd_session_command`,
  `activity-update`, `user-input`), and `aimaestro-session.sh` is a SEPARATE standalone CLI
  (`inject/queue/state/read-prompt/answer/slash`). DO grep the `agent-*.sh` MODULE that owns the verb
  (here `cmd_session_command` at `agent-session.sh:210`, landed `77883371`, → `POST
  /api/sessions/<name>/command`, LIVE in `~/.local/bin`). Cost a wrong "the `session command` verb
  doesn't exist, I'll build it" claim to the janitor on #100 (2026-07-17), retracted same day (comment
  5004880793) + a throwaway TRDD-FUYUP38L cancelled. Same shape as [^4]: a capability is what the code
  does, not what one convenient grep target shows — and the standalone CLI is not the module surface.
