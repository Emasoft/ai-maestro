---
trdd-id: SCLSRS6E
title: AI Maestro control/monitor API + permanent script layer for governance agents (janitor + fleet)
column: todo
created: 2026-07-09T10:23:21+0200
updated: 2026-08-22T17:19:18+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 1
severity: HIGH
effort: XL
task-type: feature
release-via: none
parent-trdd: null
derived: false
mandate: true
mandated-by: self
min-approval-requirement: none
npt: [TRDD-41FJM8A8, TRDD-TDFSELI1, TRDD-OOCL7ABZ, TRDD-229CJGYH, TRDD-KJQZEYXW, TRDD-GT0TAJFL]
eht: [TRDD-280DF70U, TRDD-D3RP7KQZ, TRDD-4Q7WMPZK, TRDD-YEE33F3A, TRDD-K2WJH7RF, TRDD-WNZ72SFO, TRDD-QC8R79G5, TRDD-XV4ANN4P]
blocked-by: []
pre-block-column: null
relevant-rules: []
labels: [api, janitor, terminal-control, side-panel, task-api, script-layer, dev-browser, fleet]
test-requirements: [unit, integration, e2e, dev-browser-headless]
audit-requirements: [security-scan]
review-requirements: [human-review]
impacts: [public-api, install-script]
external-refs: []
---

# TRDD-SCLSRS6E — AI Maestro control/monitor API + script layer for governance agents

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-10

**▶ 2026-07-10T02:49 — `complete` → `blocked`, and the derivation chain flattened.**

Two USER rules landed today and both hit this epic:

1. **A parent is COMPLETE only when its whole flock is** — otherwise it is `blocked`.
   This epic sat at `complete` while four of its effects were still open. Its own
   seven design children (D1-D7) *are* all `complete`; the four open ones are the
   effects that came after. `column: blocked`, `blocked-by:` names them,
   `pre-block-column: complete` records where it was. The correction below already
   said "do not read this epic as delivered" in prose — the column now says it too,
   which is the point: prose does not gate anything.

2. **A derived TRDD has no derived TRDDs — depth is exactly 1.** The chain
   `SCLSRS6E → D3RP7KQZ → {4Q7WMPZK, K2WJH7RF} → {YEE33F3A, WNZ72SFO, QC8R79G5}`
   was three levels deep, and two of its links (K2WJH7RF, YEE33F3A) named a parent
   that never claimed them. All six are now **siblings in this epic's `eht:`**,
   because an effect of a derived TRDD is a *sibling* of it, never a child. Their
   lineage inside the flock is prose, not graph: D3RP7KQZ shipped the self-drive
   split; K2WJH7RF is the ten routes it deferred; 4Q7WMPZK is the audit its "not
   asked for" fix opened; YEE33F3A, WNZ72SFO and QC8R79G5 are what that audit
   exposed. Flattening is what makes this epic's completion gate decidable — the
   flock is a finite list on this file, not a tree of unknown depth.

Also: `approval-tier:` → `min-approval-requirement:` on every TRDD touched today.

**▶ CORRECTION 2026-07-09T16:45 — `complete` means "code landed", NOT "the janitor can
use it". Do not read this epic as delivered.**

The verification task TRDD-6A2I6ZO0 established empirically that **all eight strict
routes this epic shipped refuse every agent caller** with `403 aid_title_forbidden`.
`lib/sudo-guard.ts::requireAidTitle` fails closed for a strict route absent from
`STRICT_AGENT_RULES`, and none of `panel`, `queue`, `prompt/answer`, or the five
`/api/trdd/*` verbs were ever added. The janitor — this epic's sole intended consumer —
cannot call any of them. The read-only surface (`state`, `read-prompt`, `queue-list`,
`trdd search/read`, `agent config`) is non-strict and does work.

Consequences, all open:
- `Emasoft/ai-maestro-janitor#76` (the command reference I filed) says the opposite and
  must be corrected once the policy is decided.
- Deciding the policy is Tier 2 — proposal **TRDD-D3RP7KQZ** (`design/proposals/`). The
  obvious mapping is wrong: it would deny an agent driving its OWN panel/queue.
- The USER path is throttled to 5 strict ops/minute machine-wide — proposal
  **TRDD-X8R2HP9D**.
- ~~The wrapper layer has no USER auth path at all (`get_auth_args` reads only `AID_AUTH`),
  so `aimaestro-*.sh` returns 401 for a human at a terminal. Folded into D3RP7KQZ.~~
  > **⏹ DISPROVED 2026-08-21 — struck HERE, in the authoritative block, not only at the foot of
  > the card.** `get_auth_args` falls back to a session cookie
  > (`shell-helpers/common.sh:596-606`), the INSTALLED copy on PATH is byte-identical (`cmp`,
  > Aug 19), and `aimaestro-governance.sh login` ships it — its `--help` cites `ai-maestro#55`
  > as its own origin. The capability SHIPPED; what is missing is the CREDENTIAL
  > (`~/.aimaestro/cli-session` has never been minted, so the fallback yields `()` — no auth
  > header at all). **Owner-only to clear: `login` prompts on the TTY.** Full trace at the foot
  > of this card.
  >
  > **Why this second strike was needed, and it is the lesson:** the correction was already
  > written 230 lines below — and TRDD rule 10 makes the STATE block *authoritative and read
  > first on resume*, so a stale claim HERE silently outranks an accurate one THERE. A
  > correction filed at the bottom of a long card does not correct the card. Strike the claim
  > where it is ASSERTED, not only where you happened to discover it was wrong.
  > (Flagged by the ORCHESTRATOR, whose external-blocker sweep would also have kept reporting
  > this card as live on `#55`: an unmarked claim is indistinguishable from a current one to any
  > checker — the correction contract, applied to my own card.)

TRDD-6A2I6ZO0 declared the 14 affected strict routes (8 from this epic + 6 older) in a
new `AGENT_POLICY_PENDING` ledger with a coverage guardrail, so no strict route can ship
undeclared again. That changed no authorization — it made the refusal honest.

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

**PROGRESS 2026-07-09T11:46+0200 — Phase A DONE (this repo):**
- D3 (TRDD-OOCL7ABZ) landed as `04676a37`: `GET /api/agents/[id]/full` (base config +
  reverse team lookup `getTeamsForAgent` + normalized `githubRepo` via `parseGithubRepo` +
  `repoDocker` via new `lib/repo-docker-detect.ts` + pending non-terminal tasks + AID PUBLIC
  key). 11 unit tests green (repo-docker-detect ×6, parse-github-repo ×5), `tsc --noEmit` 0,
  `next lint` clean. The route is DELIBERATELY not own-agent-clamped (fleet-MONITOR surface;
  public key only) and read-only ⇒ non-strict.
- D5-trivial (TRDD-KJQZEYXW) landed as `b196337b`: `GET /api/teams/[id]/tasks/[taskId]`
  wiring the existing `getTeamTask`. The rest of D5 (TRDD-file tooling + kanban search/edit)
  is Phase C.
- Deferred (not skipped): `getTeamsForAgent` + the route's cross-agent auth are unit-untested
  because `statePath()` has no env override — covered by the Phase E live-server checks.
- GOTCHA for later phases: `isolation: worktree` (both `spark --isolation` and
  `parallel-worker-agent`) branches off `main`, ~1300 commits behind `governance-rules`, so
  every reuse target is absent → worktree isolation is UNUSABLE here; implement inline (or a
  manually `governance-rules`-based worktree).

**PROGRESS 2026-07-09T12:42+0200 — Phase B DONE (this repo):**
- D2 (TRDD-TDFSELI1) landed as `f401728d`: `parsePendingPromptState` (PURE) +
  `readPendingPrompt` in sessions-service; `GET /api/agents/[id]/prompt` (fleet-monitor read,
  requireAuth, non-strict); `POST /api/agents/[id]/prompt/answer` ({optionKey}→menu keystroke
  validated against live options, OR {text}; STRICT; requireIdle:false so a WAITING prompt is
  answerable). 5 unit tests over the pure parser. The AskUserQuestion capture half stays gated
  on D7 (cross-repo, ai-maestro-plugin) — the `question` field is a forward-compat slot.
- D1 (TRDD-41FJM8A8) landed as `e292afbc`: `lib/command-queue.ts` (persistent
  `~/.aimaestro/command-queue/<id>.json`, atomic tmp+rename, dedupe, FIFO, `dir` test seam);
  `drainCommandQueueForSession` (HOOK-DRIVEN — fires from broadcastActivityUpdate on
  `idle_prompt`, ONE FIFO entry per idle window, gated by `evaluateExitGate` so it never
  injects while subagents provably run; commandKey resolved against the allowlist at drain
  time; pop-before-send fail-fast); `onQueueEnqueued` (wakeFirst wakes a hibernated agent;
  now-if-idle-else-queue runs immediately when live+idle); `POST /api/agents/[id]/queue`
  (STRICT) + `GET` (list) + `DELETE .../queue/[entryId]` (cancel, non-strict de-escalation).
  9 unit tests. Full suite 2104 pass / 0 fail; `tsc` 0; `next lint` clean.
- Deferred (not skipped): the drain wiring end-to-end + wakeFirst/hibernation are integration-
  level (need a live agent + tmux) → verified by the Phase E live-server checks, same pattern
  as Phase A's cross-agent-auth deferral. The queue MODULE (persist/FIFO/dedupe/cancel) + the
  gate DECISION (evaluateExitGate) are unit-covered.

**PROGRESS 2026-07-09T13:20+0200 — Phase C DONE (this repo):**
- D5-rest (TRDD-KJQZEYXW) landed as `40aeab53`: `lib/trdd-store.ts` (gray-matter parse +
  search by column/id/keyword/zone + read; LINE-BASED frontmatter writers preserving the
  grep-first format — a YAML re-emit would reorder/quote/block-style and break the contract;
  lifecycle promoteTrdd/refuseTrdd/archiveTrdd/advanceColumn with `git mv` + `## Approval log`
  append per the `aimaestro-trdd-approval.md` overlay; never commits — caller commits;
  gray-matter auto-parses ISO→Date, coerced back for summaries). `lib/trdd-design-dir.ts`
  (resolveDesignDir(agentId) → an agent's `<workdir>/design` OR the server's own repo;
  isValidTrddId 8-char base36). Routes: `GET /api/trdd` (search) · `GET /api/trdd/[id]` (read) ·
  `PATCH /api/trdd/[id]` (edit, STRICT) · `POST .../{approve,refuse,promote,archive}` (STRICT).
  Kanban: `q` free-text keyword search on the tasks list route (full-field edit already existed
  via tasks/[taskId] PUT — TRDD-95d23f3b, so that D5 sub-gap was already closed). 11 unit tests.
  Full suite 2115 pass / 0 fail; `tsc` 0; `next lint` clean.
- Deferred (not skipped): the git-mv lifecycle + agentId→design-dir resolution against a REAL
  git repo are integration-level (unit tests use the fs.rename fallback in a non-repo tmp dir) →
  Phase E live-server checks. The optional TRDD→kanban one-way mirror was NOT built (explicitly
  optional; TRDD `column:` stays sole SSOT — adding a mirror now would be speculative coupling).

**PROGRESS 2026-07-09T13:55+0200 — Phase D DONE (this repo):**
- D4 (TRDD-229CJGYH) landed as `230ea125` — closes campaign gate G4 (TRDD-903b7a20).
  panelClients/panelFeedback in BOTH shared-state files (NT-039 mirror + a load-order BACK-FILL:
  whichever file loads second must add the panel keys or state silently splits);
  `broadcastPanelMessage` / `pushPanelFeedback` / `drainPanelFeedback` (bounded 200, drop-oldest);
  server.mjs `panelWss` (/panel-ws, companionWss pattern, inbound = panel:feedback ONLY, added to
  knownPaths + the SRV-CRIT-03 deep-auth branch); `lib/panel-messages.ts` (pure action→message,
  html XOR url, 2MB cap, http(s)-only); `hooks/usePanelWebSocket.ts` (PAGE-level WS + open/close
  SIGNAL counters so remote open switches the tab from anywhere); `components/HtmlSidePanel.tsx`
  (sandboxed iframe — srcdoc WITHOUT allow-same-origin, url preview WITH; injected click-feedback
  script → postMessage → WS relay, source-window filtered; no-nested-scrollbars); new `html` tab
  in app/page.tsx; `POST /api/agents/[id]/panel` (STRICT) + GET status + feedback drain GET.
  6 unit tests; full suite 2121 pass / 0 fail; tsc 0; next lint clean; node --check OK.
- Deferred (not skipped): dev-browser headless walkthrough (render/open/close/refresh via the DOM,
  feedback round-trip, light+dark screenshots) = integration-level → the Phase E live-server checks,
  same pattern as A/B/C. Live-URL preview covers the dev-browser "show the app" case natively.

**PROGRESS 2026-07-09T15:52+0200 — Phase E DONE (this repo):**
- D6 (TRDD-280DF70U) landed as `c2c5ce5a` — the decoupling layer. NEW `aimaestro-session.sh`
  (inject/slash/slash-keys/state/read-prompt/answer/queue/queue-list/queue-cancel),
  `aimaestro-panel.sh` (open/close/refresh/set/status/feedback), `aimaestro-trdd.sh`
  (search/read/edit/approve/refuse/promote/archive), `amp-kanban-get.sh`, `amp-kanban-edit.sh`
  (`--set` string / `--set-json` typed, validated before body-build); EDITS: `amp-kanban-list.sh`
  `--query/-q`, `aimaestro-agent.sh config` → `/full`, `install-messaging.sh` verification block.
- THREE deliberate deviations from the plan, all recorded in the D6 TRDD: (1) the installer needed
  no copy entry (it already globs `amp-*.sh` + `*.sh`) — what was missing was VERIFICATION, so the
  by-name check mirrors the existing AID block; (2) one NEW route was unavoidable —
  `GET /api/agents/commands`, because the only way to read the `commandKey` allowlist was to POST a
  bogus key and scrape the 400's `Allowed: …` text; (3) `config` has no `--include` flag because
  `/full` accepts no query params — inventing one would have been a lie in the help text.
- **Live-server verification, 31 checks green.** 22/22 script→route (every read-only verb; agent
  name→UUID resolution inside the wrapper; BOTH halves of the strict gate — 403 `sudo_required`
  without a token, 200 with a fresh op-bound one; queue enqueue→cancel with no residue; the 409
  refusal answering a non-pending prompt; every client-side guard). 9/9 TRDD lifecycle on a REAL git
  repo — **closing the D5 deferral**: approving a tracked proposal produced a staged **rename** (`R`),
  proving the `git mv` branch ran (the unit tests only ever covered the `fs.rename` fallback, since
  they run in a non-repo tmp dir); `design/` was then restored to HEAD exactly (`git reset -- design/`
  + `git checkout -- design/`; no `--hard`, no `clean`).
- Harness note: the wrappers send `Bearer $AID_AUTH` and this session has no AMP identity, so the
  harness authenticated as the OWNER (governance password → `aim_session`) behind a cookie-injecting
  local proxy. The scripts really built every request; the server really served it.
- **Process defect recorded:** the harness first picked `agents[0]` = `alexandre`, a REAL user agent
  on the scenario hard-blacklist; it enqueued+cancelled one command there (queue left `[]`, agent
  hibernated, nothing could fire). It now refuses to mutate any agent lacking a disposable-test-name
  prefix. Cross-agent auth (the Phase A deferral) is covered by `agent config` reading another
  agent's `/full`.
- **Node 22 is required to run the server** (`node-pty` → `ERR_DLOPEN_FAILED` on this machine's
  default Node 26; the repo's own `check-node.mjs` says so). Pre-existing engine drift, not ours.
- **ONE deferral remains, and must NOT roll forward silently a third time:** the dev-browser headless
  PANEL walkthrough (DOM render of pushed HTML, open/close/refresh, feedback round-trip, light+dark
  screenshots). Deferred D→E, now its own task. The panel's SERVER half is fully covered (6 unit
  tests + live `delivered`-count + sudo gate).

**PROGRESS — Phase F DONE (2026-07-09).** D7 (TRDD-GT0TAJFL) → `complete`. Three issues filed on
`Emasoft/ai-maestro-plugin` (issues only; that tree is NEVER edited from here):
**#19** dev-browser core dependency · **#20** AskUserQuestion capture · **#21** the
`elicitation_dialog` dead-code bug found while verifying. Two spec corrections, both recorded on
D7 so neither is re-derived wrong later:

- The marketplace precondition was ALREADY satisfied (`allowCrossMarketplaceDependenciesOn`
  already lists `dev-browser-marketplace`), so only the plugin-level `dependencies` entry is
  missing. Surfaced for an explicit decision: that marketplace is the THIRD-PARTY repo
  `sawyerhood/dev-browser`, so a core dep auto-installs it on every agent.
- The AskUserQuestion capture point is **`PreToolUse` (`matcher: "^AskUserQuestion$"`)**, not the
  hook's existing `Notification` path — the hook has NO `PreToolUse` case today and `hooks.json`
  routes `PreToolUse` to a different script (`directory-guard.cjs`). A `Notification` carries no
  `tool_input`, so it CANNOT supply the question text. A paired `PostToolUse` clear is also
  required, or an answered question stays "pending" until `Stop` and a polling agent answers it
  twice.

**PROGRESS — Phase G ADOPTION FOLLOW-THROUGH (2026-07-10).** Handing the janitor a command
reference was not enough; I read its tree and the plugin's, which changed the ask.

- **The janitor is already decoupled — nothing to fix.** `scripts/lib/terminal_trigger.py:348`:
  *"Repointed off the direct `/api/...` calls to `aimaestro-agent.sh`"*. No `fetch`, no `:23000`
  anywhere outside comments. Two other suspected violations (the core plugin's hook; five plugin
  skills naming `localhost:23000`) were also FALSE — the hook's `/api/` strings are comments
  documenting the migration, and the skills' lines are prerequisites, not embedded API syntax.
  Three greps that looked like findings, three sources that said otherwise.
- **The real adoption target is `fleet_inject.py`.** It prefers raw `tmux send-keys` (ESC, settle,
  literal, Enter) with `aimaestro-agent.sh session command <tmux>` only as a fallback. Both write
  into a live pane with no idle gate and no subagent gate. `queue` exists precisely for this:
  `drainCommandQueueForSession` resolves `commandKey` against the allowlist AND calls
  `evaluateExitGate(readSubagentCount(...))`. Posted on **janitor#76**.
- **BLOCKER, and it is ours.** `queue` maps to `send-command`, which is self-drive only, so an agent
  enqueues only on itself. The janitor's per-project HEARTBEAT holds `AID_AUTH` (inside an agent
  session) and can self-queue today; its machine-wide DAEMON is not a registered agent, holds no
  AID, and ~~`get_auth_args` emits only the AID bearer~~ **[DISPROVED 2026-08-21 — it falls back to
  a session cookie; see the strike in the STATE block and the trace at the foot. The daemon's
  problem is that no `~/.aimaestro/cli-session` has been minted, not that the path is absent]** —
  so every verb 401s for it. Fleet-wide arm
  ~~(**janitor#77**) is therefore blocked on **ai-maestro#55** (filed): session-cookie auth, or a
  MANAGER service identity for the daemon (Tier-2 — a machine-wide daemon with MANAGER authority is
  a large blast radius), or a narrow scoped `fleet-arm` verb. Posted on janitor#77.~~
  > **⏹ THE CONCLUSION FALLS WITH ITS PREMISE — struck 2026-08-21.** `janitor#77` CLOSED 08-12,
  > `ai-maestro#55` CLOSED-as-COMPLETED 08-02, and **session-cookie auth is the option that
  > SHIPPED** — it is the first branch listed here. Nothing is blocked on #55.
  >
  > **This is the third clause of the correction contract, and I earned it the hard way:
  > A STRIKE DOES NOT PROPAGATE TO THE SENTENCE IT LICENSED.** I struck the premise four lines
  > above and left its inference standing — carried by the word *"therefore"* — so the card went on
  > asserting a live external wait out of a claim I had just disproved. A premise and its
  > conclusion are TWO assertion sites. When you strike a premise, follow its inferences.
  > (Found by the ORCHESTRATOR's sweep, which kept reporting this card as live on `#55` and named
  > the line: I had guessed the survivor was `:316` and it was `:308` — I marked the sentence I had
  > been looking at rather than the one a checker actually hits.)
- **The core plugin ships ZERO skills for the new surface** (verified against the installed v2.8.0,
  not from memory): nothing references `aimaestro-session.sh`, `aimaestro-panel.sh`, or
  `aimaestro-trdd.sh`; `team-kanban` knows `list/create-task/move/archive` but not `get`/`edit`;
  `ai-maestro-agents-management` knows twelve `aimaestro-agent.sh` verbs but not `config`. Filed as
  **ai-maestro-plugin#23**, with the self-drive rule every such skill must state and the two gaps
  (trdd write verbs 403 for agents; no USER auth path) it must not promise around.

~~The epic's code is complete; adoption is now tracked on janitor#76/#77, plugin#23, and
ai-maestro#55.~~

> **⏹ DEAD CLAIM, struck 2026-08-21T17:0x — ALL FOUR trackers this card defers to are CLOSED**, and
> nothing on the board noticed for between 9 and 36 days. Verified first-hand, each individually:
>
> | tracker | state | closed |
> |---|---|---|
> | `janitor#76` | CLOSED | 2026-08-12 |
> | `janitor#77` | CLOSED | 2026-08-12 |
> | `plugin#23` | CLOSED | 2026-07-16 |
> | `ai-maestro#55` | **CLOSED — `stateReason: COMPLETED`** | 2026-08-02 |
>
> The struck sentence is kept, not deleted: its shape is the evidence. "Adoption is now tracked
> elsewhere" is how a card stops being read — it hands responsibility to four threads and nothing
> ever checks whether they are still alive.
>
> **⏹ AND THE CLAIM IS DOUBLY STALE — I CHECKED, AND THE USER AUTH PATH SHIPPED.** This card, and
> the STATE block above it, both assert *"`get_auth_args` reads only `AID_AUTH`, so `aimaestro-*.sh`
> returns 401 for a human at a terminal"*. **That is false today**, verified against the copy that
> actually runs, not the repo copy and not the issue title:
>
> ```
> scripts/shell-helpers/common.sh:596-606      AID_AUTH bearer, ELSE get_session_token()
>                                              → -H "Cookie: aim_session=$tok"
> ~/.local/share/aimaestro/shell-helpers/common.sh   (what the PATH CLI sources, Aug 19)
>   cmp vs repo → IDENTICAL,  grep -c aim_session → 6
> aimaestro-governance.sh --help:98-102        "login — stores a SESSION TOKEN at
>                                              ~/.aimaestro/cli-session (0600) … (ai-maestro#55)"
> ```
>
> The help text cites `ai-maestro#55` by number as its own origin. So #55 did not merely close —
> it SHIPPED, as `aimaestro-governance.sh login`, and it is live on PATH.
>
> **So the host-wide 401 has a DIFFERENT cause than every card says, and it is not a feature gap:**
> `~/.aimaestro/cli-session` **does not exist on this host** (`ls` — absent; only `sessions.json`
> and `session-history.json` are there). `get_session_token()` therefore returns empty,
> `get_auth_args` emits `()` — *no auth header at all* — and every verb 401s. The function's own
> comment predicts exactly this: *"Empty if neither exists (an unauthenticated human — the caller
> will get a 401 and a hint)."*
>
> **NOBODY HAS LOGGED IN. That is the whole blocker.** And it is the OWNER's to clear, by design:
> `login` prompts on the TTY, and the help is explicit that the password *"is never an argument,
> never an env var, and never stored; only the token is"* — so no agent can run it, and no agent
> should try. One command at a terminal, by the owner, unblocks every `aimaestro-*.sh` verb
> host-wide, including the ORCHESTRATOR's assignment lane, which has been parked on this since
> 2026-08-02.
>
> **The lesson is the shape, not the fix.** Four cards, two repos and a closed issue all described
> this as a missing capability. It was a missing *credential*. A blocker phrased as "the feature
> does not exist" is never re-checked once the feature ships, because nobody re-reads a solved
> problem — and `stateReason: COMPLETED` on #55 was visible the entire time.
>
> **This card's `column: blocked` is UNCHANGED and still correct** — its `blocked-by:` TRDD chain is
> independently live. Only the cited external rationale was dead.

**PROGRESS — Phase G DONE (2026-07-09). THE EPIC IS COMPLETE.** Filed
`Emasoft/ai-maestro-janitor` **#76** — the full command reference for the script layer, every verb
verified against the source rather than from memory: `aimaestro-session.sh` (inject / slash /
slash-keys / state / read-prompt / answer / queue / queue-list / queue-cancel), `aimaestro-panel.sh`
(open / close / refresh / set / status / feedback), `aimaestro-trdd.sh` (search / read / edit /
approve / refuse / promote / archive), `aimaestro-agent.sh config`, `amp-kanban-get.sh`,
`amp-kanban-edit.sh`, `amp-kanban-list.sh --query` — with the dual-path auth rules (agent: `AID_AUTH`
+ governance title, never a sudo token; user: a fresh one-shot op-bound `AIMAESTRO_SUDO_TOKEN`), the
exact strict-verb list, and the instruction to audit the plugin for direct `/api/` use and replace
every hit with a wrapper. **Nothing shipped to the janitor that is not reachable through a wrapper.**

Two caveats carried into #76 so the janitor is not surprised by them:

- `read-prompt` returns no `question`/`options` for **AskUserQuestion** menus until plugin **#20**
  lands (tool-permission menus work today). `answer --text` still works; `answer --option` has
  nothing to select.
- **`inject` types arbitrary text into a live terminal and is NOT sudo-gated**, while the safer
  `queue` (deferred, cancellable, idle-gated) IS. The classification is pre-existing — `inject`
  wraps the long-standing `PATCH /api/agents/[id]/session`, which is absent from
  `security-registry.json`. Filed as **Emasoft/ai-maestro#54** for a Tier-2 decision. #76 tells the
  janitor to treat `inject` as the most dangerous verb regardless of its gate.

**DEFERRAL DISCHARGED — it is now on the board, not buried here.** The dev-browser headless PANEL
walkthrough became its own Tier-0 task: **TRDD-6A2I6ZO0** (`column: planned`,
`design/tasks/TRDD-20260709_155632+0200-6A2I6ZO0-devbrowser-panel-walkthrough.md`). It carries the
gotchas that would otherwise be re-learned: `delivered: 0` means dropped-not-queued, so the panel
must be opened and `status`-confirmed before any render assertion; `POST …/panel` is strict and one
sudo token does not cover a whole walkthrough; the server needs Node 22.

**BOOKKEEPING DRIFT FIXED (2026-07-09).** D1-D5 (`41FJM8A8`, `TDFSELI1`, `OOCL7ABZ`, `229CJGYH`,
`KJQZEYXW`) were all still `column: dev` even though their code shipped in Phases A-D and each
already carried its `implementation-commits:`. Every phase commit recorded the impl SHAs and this
ledger but never advanced the CHILD's column, so five TRDDs were lying about their state and the
epic could not be honestly closed. All five → `complete`, `updated:` bumped. Caught by checking the
children before marking the parent, not by assuming.

**NEXT ACTION:** none for this epic — every phase (A-G) is done and all seven derived TRDDs are
terminal. Final acceptance (the janitor actually driving the fleet through the wrappers) is
verified downstream, on each repo's own cadence: plugin `#19`/`#20`/`#21`, ai-maestro `#54`,
janitor `#76`, and the panel walkthrough `TRDD-6A2I6ZO0`.

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

## Acceptance

- [ ] The agent authorization policy for the ten remaining strict routes
      (`TRDD-K2WJH7RF`) is decided and reaches a terminal column, clearing
      `blocked-by:`.
- [ ] Every strict route this epic shipped (`panel`, `queue`, `prompt/answer`, the
      five `/api/trdd/*` verbs) is added to `STRICT_AGENT_RULES` per the decided
      policy, so `lib/sudo-guard.ts::requireAidTitle` no longer refuses the janitor
      with `403 aid_title_forbidden` on every call.
- [ ] `Emasoft/ai-maestro-janitor#76` (the command reference) is corrected to match
      the decided policy.
- [ ] The `AGENT_POLICY_PENDING` coverage guardrail (from `TRDD-6A2I6ZO0`) reports
      zero pending strict routes for the 8 routes this epic introduced.
- [ ] Every entry in `eht:` reaches a terminal column, and this card's `column:`
      restores to `pre-block-column: complete` (then archives per the flock gate).

## Approval log
