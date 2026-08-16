# CLAUDE.md

Guidance for Claude Code working in this repository.

**This file is deliberately small.** It rides the cached prefix of every turn of every session, so
its cost is `bytes × turns × sessions` — and editing it invalidates that prefix, re-billing the
whole prompt. The project's knowledge therefore lives in the wiki, loaded **on demand by symptom**
instead of always. What stays here is only what you need before you can do anything at all.

## What this is

**AI Maestro** — a browser dashboard for running and governing many coding agents at once. Agents
live in tmux sessions; the dashboard streams their terminals over WebSocket and layers on identity
(AID), governance (titles, teams, a directed communication graph), inter-agent messaging (AMP),
kanban boards, and a role-plugin marketplace. It drives Claude Code, Codex, Gemini, OpenCode and
Kiro agents.

Next.js 14 · React 18 · xterm.js · node-pty · Tailwind, behind a custom server on **port 23000**.
macOS 12+, **Node 22**, tmux 3.0+.

## Read the wiki, not this file

```bash
memgrep overview .claude/project/memory                       # the front door
memgrep recall "<the symptom you have>" .claude/project/memory # search by symptom
```

Pages are indexed by the **question**, not the answer — search with the words you have when the
problem hits ("terminal duplicating every character", "why did my agent's rule file come back"),
not the jargon of the fix. The full topic index is at the bottom of this file.

Three memory scopes exist and are not interchangeable. **PROJECT** (`.claude/project/memory/`) is
git-tracked and **pushed** — it must never carry a home path, a hostname, or anything
machine-private. **LOCAL** (`~/.claude/projects/<slug>/memory/`) never leaves this machine.
**USER** is global across all projects. On a name conflict the more specific scope wins — **LOCAL
beats PROJECT** — but that is a rule for deciding which fact to BELIEVE, **not** a search filter:
`memgrep recall` over several roots returns pages from all of them, ranked by relevance only.
Measured 2026-08-02 — a duplicated page returns TWICE, and the older, thinner copy can outrank the
authoritative one. Duplicate a page into LOCAL and you get two answers to reconcile, not one.

## Repositories

| what | repo |
|---|---|
| **this app — upstream** | `23blocks-OS/ai-maestro` (remote `origin`) |
| **this app — the fork work lands on** | `Emasoft/ai-maestro` (remote `fork`) |
| marketplace (fork of `23blocks-OS/ai-maestro-plugins`) | `Emasoft/ai-maestro-plugins` |
| core plugin | `Emasoft/ai-maestro-plugin` |
| AMP messaging plugin | `Emasoft/claude-plugin` |
| Agent Identity plugin | `Emasoft/agent-identity` |
| janitor plugin | `Emasoft/ai-maestro-janitor` |
| observability CLI dependency (npm, not a plugin) | `Emasoft/AgentlensPro` |
| plugin validator | `Emasoft/claude-plugins-validation` |

**Role-plugins — 8 predefined, each its own repo under `Emasoft/`:**
`ai-maestro-assistant-manager-agent` · `ai-maestro-chief-of-staff` · `ai-maestro-architect-agent` ·
`ai-maestro-orchestrator-agent` · `ai-maestro-integrator-agent` · `ai-maestro-programmer-agent` ·
`ai-maestro-maintainer-agent` · `ai-maestro-autonomous-agent`

A ninth, `Emasoft/ai-maestro-assistant-role-agent`, is published and in the marketplace manifest but
is deliberately **not** in `PREDEFINED_ROLE_PLUGIN_NAMES` — consumers assume a set of exactly 8.
Open on ai-maestro#86; **do not "fix" the count to 9.**

Repo names are hardcoded nowhere but `lib/ecosystem-constants.ts` and its shell mirror
`scripts/ecosystem-config.sh`. Change them there and nowhere else.

## Build, run, test, publish

**Node 22 is a hard ABI constraint, not a preference.** `node-pty` is built for
NODE_MODULE_VERSION 127 and `better-sqlite3` caps at Node 25, so an unsupported Node does not
degrade the app — it crash-loops it, and PTY streaming is the core feature. Yarn enforces `engines`
*before any script runs*, so on a Node-26 machine even `yarn build` aborts. If your shell does not
already select Node 22, prefix every command:

```bash
bash scripts/with-node.sh yarn <anything>
```

```bash
yarn install                 # dependencies
yarn dev                     # dev server, hot reload    → http://localhost:23000
yarn build                   # production bundle
yarn start                   # production server
yarn headless                # API-only mode, no UI (yarn headless:prod for production)
yarn test                    # unit tests (vitest); yarn test:watch to watch
pm2 restart ai-maestro       # restart the production server
```

**A restart does NOT rebuild.** `server.mjs` and `lib/*.mjs` are loaded at runtime and go live on
`pm2 restart` alone. Everything in `lib/*.ts`, `app/`, `services/`, `components/` is bundled into
`.next` and needs **`yarn build` first**. Verify a fix by its **effect**, never by `git log` — a
committed fix running against a stale bundle has already caused live data corruption here.

**Is it up?** `GET /api/sessions` — it returns the agent list, so it proves the server is serving.
There is no `/api/health`. (`/api/v1/health`, `/api/agents/health` and `/api/hosts/health` exist and
answer different questions.)

### Governance / task tooling

`trddgrep` (`query` · `lint` · `validate` · `fix` · `env`) · `yarn trdd:doctor` (`:fix`, `:board`) ·
`yarn pillars:lint`. Exit codes are grep's trichotomy — **`0` clean · `1` findings · `2` COULD NOT
RUN**. Never write `trddgrep validate || …`: that collapses *could-not-run* into *found-findings*.

### Publishing

```bash
./scripts/bump-version.sh patch|minor|major|1.2.3   # updates EVERY version reference
```

Never edit a version by hand. **Every PR to `main` must include a version bump**, in this order:
`yarn test` → `bump-version.sh` → `yarn build` → commit the bump with the change.

### Keeping this file honest

```bash
node scripts/wikimem-index.mjs --check                          # every page carries a topic?
node scripts/wikimem-index.mjs --write CLAUDE.md \
                               --write .claude/project/memory/ai-maestro-overview.md
```

The index below is **generated** — edit a page's `description:` or `metadata.topic:`, then re-run.
Editing between the fences is pointless; the next run overwrites it.

## Project map

<!-- TODO(TRDD-K8VC7J71): the janitor's repomap_generate.py discovers `*.py` ONLY — its
     discover_sources() is `git ls-files -- "*.py"` and the sole registered extractor is
     extract_python. On this TypeScript codebase it maps 18 peripheral script files and none of
     lib/, app/, services/, components/, hooks/. Blocked on a decision: file a janitor issue /
     author the PR / generate it here with tldr / ship it labelled scripts-only. A map of the
     wrong 1% under the heading "project map" is worse than no map. -->

## The project wiki — index by topic

<!-- WIKIMEM-INDEX-START (generated by scripts/wikimem-index.mjs — do not edit between the fences) -->

### Architecture and Runtime

- **`custom-server-and-websocket-pty`** — why does server.mjs exist / Next.js WebSocket same port
- **`dashboard-ui-patterns`** — how are agent category colors assigned in the sidebar
- **`model-context-window-classification`** — the context percentage is wrong
- **`nextjs-full-route-cache-freezes-api-responses`** — an API endpoint returns stale or frozen data
- **`pm2-boot-persistence`** — server did not come back after a reboot
- **`repo-file-structure`** — where should I put a new component or hook in this repo
- **`runtime-install-tree`** — where does ai-maestro store data on a host
- **`single-active-agent-rendering`** — why does switching agents lose my terminal scrollback
- **`terminal-rendering-and-pty`** — terminal duplicating every character
- **`two-server-modes-the-headless-router-reimplements-routes`** — I added the guard in lib / and the tests are green — but is it actually enforced? the same request behaves…

### Agents

- **`agent-control-monitor-api`** — how does the janitor / a governance agent CONTROL or MONITOR another agent's Claude Code terminal — inject a…
- **`agent-deletion-all-in-one-pipeline`** — I deleted an agent but its folder keeps coming back
- **`agent-first-architecture`** — why is data.governanceTitle always undefined
- **`agent-launch-preconditions`** — an ai-maestro agent starts, shows up healthy in the dashboard, but says 'Not logged in'
- **`agent-title-role-persona`** — TITLE vs ROLE vs PERSONA in ai-maestro
- **`agent-workdir-invariants-and-policy`** — why did my agent's shipped rule file come back
- **`folder-adoption-import`** — wizard 'Browse existing project folder' 400s
- **`prompt-provenance-and-the-injection-path`** — fleet recovery keeps deferring
- **`restart-conversation-continuity`** — restarted agent came back blank
- **`session-control-5-state-model`** — agent badge shows the wrong color
- **`session-control-subagent-gate`** — restart API times out 504 / stop refused with subagents_running

### Teams and Governance

- **`an-unenforced-rule-produces-a-success-not-an-error`** — the scenario passed / the tests are green
- **`governance-enforcement-ratchet`** — I added / edited a governance rule and the build went red — what is the enforcement map
- **`governance-rules-layering`** — where do the aimaestro governance rules live
- **`manager-gated-team-governance`** — why are all my teams blocked / team agents got hibernated after removing MANAGER
- **`scen031-manager-role-violation-not-substrate`** — SCEN-031 fleet-ship FAILs — MANAGER builds the project solo instead of creating+delegating to fleet personas;…
- **`team-creation`** — how is a team created / who creates the 5 base members — the MANAGER or the COS
- **`team-meeting-and-kanban`** — how does the team meeting state machine work
- **`three-role-initial-test-not-a-title-restrict`** — does 'we need a version running with only 3 role plugins (MANAGER

### Messaging

- **`amp-communication-graph`** — which governance titles can message which
- **`amp-messaging`** — how do agents send messages to each other

### Plugins and Marketplaces

- **`cross-client-conversion`** — how do I move an agent from claude to codex
- **`ecosystem-constants-and-repos`** — where are the marketplace repo names defined
- **`element-management-service`** — where do plugin and agent-property mutations go through
- **`marketplace-manifest-format`** — claude plugin install fails 'Plugin not found in marketplace' — marketplace manifest plugin source must be {…
- **`marketplace-plugin-registration`** — how to register / publish a new plugin into the ai-maestro-plugins marketplace
- **`plugin-abstraction-and-script-layer`** — why can't a plugin call the ai-maestro API directly
- **`plugin-architecture-source-vs-install-target`** — where does a plugin actually live
- **`plugin-install-no-git-tag-satisfying`** — a plugin install fails with 'has no git tag satisfying >=X <Y' even though the tags exist — role-plugins…
- **`role-plugins`** — what is a role-plugin / fourfold identity rule

### Security and Auth

- **`env-var-security-delete-not-gate`** — adding a new process.env read / env var — is it safe? does a security-weakening env var get deleted or gated?…
- **`env-vars-and-the-governance-password`** — which env vars does ai-maestro actually read
- **`governance-password-invalidation`** — how does the user rotate / revoke
- **`network-security-tailscale-bind`** — why does a LAN IP get dropped / 192.168.x.x cannot reach the dashboard
- **`public-repo-personal-data`** — this repo is PUBLIC and a personal email

### Design System

- **`pillar-tooling-scale-and-index`** — trddgrep / trdd-doctor got slow or ran out of memory on a big corpus
- **`three-pillars-conformance-spec`** — where is the 3-pillars (TRDD / PRRD
- **`trdd-conventions`** — How to author a TRDD in this project: the trdd-id is now an 8-char UPPERCASE base36 id (NOT a UUID) —…
- **`trdd-d4-watchdog`** — why does the server log [trdd-watchdog] sweep ran

### Reliability Patterns

- **`agent-claims-the-api-was-never-delivered`** — a capability is reported MISSING (an agent says 'the verbs were never delivered', or an issue asks to build…
- **`aio-pipeline-rollback-transactions`** — a pipeline failed halfway and left two stores disagreeing
- **`family-a-continuity-absorption-plan`** — the implementation decomposition (NPT map) for absorbing the janitor's continuity daemon into the ai-maestro…
- **`janitor-chore-absorbability`** — can the ai-maestro server take over this janitor chore
- **`lenient-json-reader-destroys-the-file`** — my settings.json / registry / config got replaced by a nearly-empty object
- **`model-scoped-window-fallback`** — the Fable window is exhausted but the account still has 5h
- **`server-oauth-token-continuity-design`** — how does the ai-maestro server keep agents running across OAuth
- **`settings-file-watcher-ledger`** — who changed my settings.json / a settings file changed and nothing recorded it

### Tooling and Testing

- **`code-analysis-tooling`** — what is tldr / fastedit / distill
- **`nul-byte-makes-a-file-invisible-to-grep`** — grep returns no match for a file I KNOW contains the string
- **`project-long-form-docs`** — where is the long-form documentation
- **`release-and-marketing`** — do I need to draft an X twitter post when opening a PR
- **`testing-and-scenarios`** — how do I run a UI scenario test
- **`token-optimization`** — Why a UI scenario run could cost 130M+ tokens and how to keep token usage low: the 8 mandatory token-saving…

<!-- WIKIMEM-INDEX-END -->
