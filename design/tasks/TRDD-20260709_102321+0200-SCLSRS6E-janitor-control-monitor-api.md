---
trdd-id: SCLSRS6E
title: AI Maestro control/monitor API + permanent script layer for governance agents (janitor + fleet)
column: dev
created: 2026-07-09T10:23:21+0200
updated: 2026-07-09T10:23:21+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 1
severity: HIGH
effort: XL
task-type: feature
release-via: none
parent-trdd: null
npt: [TRDD-41FJM8A8, TRDD-TDFSELI1, TRDD-OOCL7ABZ, TRDD-229CJGYH, TRDD-KJQZEYXW, TRDD-GT0TAJFL]
eht: [TRDD-280DF70U]
relevant-rules: []
labels: [api, janitor, terminal-control, side-panel, task-api, script-layer, dev-browser, fleet]
test-requirements: [unit, integration, e2e, dev-browser-headless]
audit-requirements: [security-scan]
review-requirements: [human-review]
impacts: [public-api, install-script]
external-refs: []
---

# TRDD-SCLSRS6E — AI Maestro control/monitor API + script layer for governance agents

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-09

**Origin (USER directive 2026-07-09):** give the **janitor** (and every governance
agent) the full API + permanent `aimaestro-*`/`amp-*` script surface to MONITOR and
CONTROL the whole fleet: inject any command (`/compact`, `/reload-plugins`) into any
agent terminal; read+answer AskQuestion/permission menus; monitor agent state; ENQUEUE
commands that fire when a busy/hibernated agent is next idle/online; read full agent
config (launch args, teams, github repo, docker-clone, pending tasks); control the
terminal HTML side panel (open/close/refresh + feedback callback) so visualizer plugins
can drive it; strong dev-browser integration + dev-browser as a CORE-plugin dependency;
and a 3-pillars task API (search/read/edit/approve/promote/archive every TRDD + kanban
task) exposed through the permanent script layer. THEN write to the janitor with the
command reference and instruct its Claude to adopt it.

**Gap analysis DONE 2026-07-09** (5 parallel readers → `reports/api-gap-analysis/`):
much of the terminal-control surface ALREADY EXISTS; the real gaps are the queue, the
AskQuestion read/answer exposure, the consolidated config, the HTML panel (greenfield),
and the TRDD-file task tooling. Verdict per area (✅ exists · ◑ partial · ❌ missing):

- **Command injection** ✅ — `PATCH /api/agents/[id]/session` takes `{command}` (arbitrary
  text) or `{commandKey}` (allowlist incl. `compact`, `reload-plugins`); deprecated
  `POST /api/sessions/[id]/command`; WS `/term` PTY bridge. `lib/agent-commands.ts` is the
  curated allowlist. → only needs allowlist additions + a script wrapper.
- **Live state** ✅ — hook writes `~/.aimaestro/chat-state/<hash>.json`;
  `getHookState()` (sessions-service.ts:174) + `/api/sessions/activity` WS +
  `lib/agent-status.ts` 8-priority ladder (exited/rate_limited/api_error/permission/
  waiting±subagents/active/idle/hibernated) + `GET /api/sessions/[id]/pane-status`. Minor:
  the `activity/update` POST may drop `subagentCount` — trace/fix.
- **Read AskQuestion/permission** ◑ — the hook (`ai-maestro-hook.cjs`, in the
  ai-maestro-plugin repo) CAPTURES rich permission data (toolName, description, options[])
  into the chat-state file, but **no API exposes it** (`getHookState` drops it) and there is
  **no AskUserQuestion-specific extraction** (that tool fires `idle_prompt`, not
  `permission_prompt`; its question text + choices are not captured). → D2 + D7.
- **Answer prompt** ◑ — only a hardcoded `y` via the Approve button; no option-index /
  free-text answering. → D2.
- **Command queue** ◑ — `useRestartQueue` is CLIENT-side, restart-only, in-memory,
  no hibernation handling, no persistence. → D1 (server-side, generic, persistent,
  idle+hibernation aware).
- **Full agent config** ✅/◑ — `GET /api/agents/[id]` returns the full record (launch
  `program`/`programArgs`, title, workdir, hooks, `deployment.cloud` = agent-as-container).
  Missing: reverse team-lookup, unified github-repo for non-MAINTAINER (a repos-scan
  endpoint `/api/agents/[id]/repos` EXISTS), **repo-uses-docker** detection, agent→tasks
  reverse-lookup, AID pubkey. → D3.
- **HTML side panel** ❌ 0/5 — fully greenfield; this IS campaign gate **G4**
  (TRDD-903b7a20). Build-on: the `app/page.tsx` tab-switcher + the `companionWss` (voice
  WS) per-agent client-registry pattern as the template for a NEW panel-content channel. → D4.
- **Task API** ✅/❌ — kanban CRUD EXISTS (GitHub-Projects-backed via teams-service;
  `amp-kanban-{list,create-task,move,archive}.sh`). Missing: `GET .../tasks/[taskId]`
  route (service fn `getTeamTask` exists — trivial), keyword search, full-field edit
  script, and ALL TRDD-file tooling (`findtrdd`/`get-prrd`/`prrd-edit` absent; no PRRD.md
  in this repo) + the TRDD lifecycle (approve/promote/archive = 100% manual git-mv). KEY:
  kanban `status` and TRDD `column:` are TWO PARALLEL disconnected state machines. → D5.
- **Script layer** ✅ — families well-established (`aimaestro-agent/governance/teams/hook`,
  `amp-*` ×29, `aid-*` ×7); auth = AID_AUTH bearer / per-agent api-key / sudo-token, base
  `localhost:23000`. New wrappers slot in cleanly. → D6 (the EHT: every new endpoint gets
  its permanent script wrapper — the decoupling layer between skills and the API).
- **dev-browser** ✅ consumed by scenario agents; core plugin.json (v2.8.0) has **NO
  dependencies field**. Adding dev-browser as a core dep + the hook AskUserQuestion capture
  = the **ai-maestro-plugin REPO** (cross-project → issue/PR). → D7.

**NEXT ACTION:** derived TRDDs D1..D7 authored (see `npt:`/`eht:`); then implementation
phased (see `## Phasing`). Cross-repo items (D7 + janitor adoption) are GitHub issues, not
in-repo edits. Final EHT after all land: write the janitor its command reference + adopt
instruction (Emasoft/ai-maestro-janitor issue) — the whole point of this epic.

**Load-bearing facts / gotchas:**
- The decoupling invariant (project CLAUDE.md "Plugin Abstraction Principle"): plugins call
  the SCRIPT layer, never the API directly. So EVERY new endpoint MUST get a script wrapper
  (D6) or the janitor cannot use it rule-compliantly.
- The hook lives in the **ai-maestro-plugin** repo (`~/Code/AI-MAESTRO-PLUGIN/…`), not here.
  Its AskUserQuestion enhancement is cross-project (D7).
- Strict routes need `X-Sudo-Token`; agent callers need AID proof-of-possession. New
  control routes (inject/answer/queue/panel/trdd-mutate) are destructive → classify strict.
- The source repo must NEVER enable any ai-maestro plugin at project/local scope
  ([[feedback_no_plugin_in_source_repo]]).

## Derived tasks (the epic breakdown)

| TRDD | Title | Kind | Where |
|---|---|---|---|
| **D1 TRDD-41FJM8A8** | Server-side persistent command queue (generic, idle+hibernation aware) | NPT | this repo |
| **D2 TRDD-TDFSELI1** | AskQuestion/permission read+answer API (expose captured options; option-index/free-text answer) | NPT | this repo (+ D7 hook) |
| **D3 TRDD-OOCL7ABZ** | Consolidated agent-config endpoint (teams + normalized github-repo + repo-docker detect + pending tasks + AID) | NPT | this repo |
| **D4 TRDD-229CJGYH** | HTML side-panel subsystem — open/close/refresh + feedback callback (campaign G4) | NPT | this repo |
| **D5 TRDD-KJQZEYXW** | 3-pillars task API — TRDD-file tooling (search/read/edit/approve/promote/archive) + kanban gaps | NPT | this repo |
| **D6 TRDD-280DF70U** | Permanent `aimaestro-*`/`amp-*` script wrappers for every new endpoint (the decoupling layer) | EHT | this repo |
| **D7 TRDD-GT0TAJFL** | dev-browser as core-plugin dependency + hook AskUserQuestion capture | NPT | **ai-maestro-plugin repo** (issue/PR) |
| (final EHT) | Janitor adoption — command reference + instruct its Claude to use the new surface | EHT | **ai-maestro-janitor repo** (issue) |

## Phasing (implementation order — matches dependency chain)

1. **Phase A (foundations, this repo):** D3 (consolidated config — read-only, safest first)
   + the trivial kanban `GET .../tasks/[taskId]` route from D5. Ship with tests.
2. **Phase B (control, this repo):** D2 (prompt read+answer API) + D1 (command queue). These
   are the janitor's core control primitives. D2's hook half is gated on D7.
3. **Phase C (task lifecycle, this repo):** D5 rest (TRDD-file search/read/edit/approve/
   promote/archive + kanban keyword search + full-field edit).
4. **Phase D (panel, this repo):** D4 (HTML side-panel subsystem — closes campaign G4).
5. **Phase E (script layer, this repo):** D6 — wrap EVERY endpoint from A-D as a permanent
   `aimaestro-*`/`amp-*` script. This is what the janitor actually calls.
6. **Phase F (cross-repo):** D7 (ai-maestro-plugin: dev-browser dep + hook capture) filed as
   issues; land there on their own cadence.
7. **Phase G (adoption):** write the janitor its full command reference + instruct its Claude
   to adopt (ai-maestro-janitor issue). The final deliverable.

Each phase: `npx tsc --noEmit` + `npx vitest run` (new suites) + `npx eslint` on touched
files + `node --check server.mjs`; commit per logical unit with the TRDD-id in the subject;
push to `fork governance-rules`.

## Test strategy (applies to every derived TRDD)

Every new endpoint/script/panel behavior ships with a test that FAILS before and PASSES
after: unit (service fns, queue state machine, docker-detect, TRDD-file mutators), API
integration (route contract + auth/sudo gating), and — for D4 — a dev-browser headless
scenario. No mocked-away core behavior; the queue's idle/hibernation transitions and the
panel's push/callback round-trip are tested against the real code paths.

## Reports (evidence)
- `reports/api-gap-analysis/20260709_102142+0200-terminal-session-queue.md`
- `reports/api-gap-analysis/20260709_101055+0200-agent-config-github-docker.md`
- `reports/api-gap-analysis/20260709_101109+0200-html-side-panel.md`
- `reports/api-gap-analysis/20260709_101133+0200-task-system-api.md`
- `reports/api-gap-analysis/20260709_101857+0200-cli-layer-devbrowser-coredeps.md`

## Approval log
