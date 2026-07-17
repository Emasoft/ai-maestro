---
trdd-id: QZL828OD
title: Server-owned harness global-control + settings.json env-key enforcer + auto-restart on plugin update
column: dev
created: 2026-07-17T02:37:00+0200
updated: 2026-07-17T02:58:00+0200
current-owner: ai-maestro
task-type: feature
parent-trdd: KCRMSNL7
relevant-rules: [42, 17, 20]
implementation-commits: [4c8b7cb8]
scope: project
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-17

**Origin:** USER directive (2026-07-17), clarifying the Family-A daemon absorption. The ai-maestro
server IS the janitor daemon for **harness agents**; a set of daemon responsibilities that were NOT
in the continuity NPT chain (OAuth `1GGQ4HWY` / resurrection `JAU1ES1C` / continuity-CLI `DXJZM3BW`)
must be added to the server directly.

**PROGRESS (2026-07-17):**
- **D2 (user-scope settings.json carve-out) — ✅ RATIFIED by USER 2026-07-17** (*"it is a narrow
  exception, but it is important. ai-maestro cannot function without those settings."*).
- **Capability #3 (Claude settings enforcer) — ✅ DONE + LIVE (`4c8b7cb8`).**
  `lib/claude-settings-enforcer.ts` (fixed allowlist, merge-never-replace, fail-closed on corrupt,
  atomic tmp+rename + `.aim-bak`, idempotent, restore-on-drift watchdog) + boot-enforce + watchdog
  wired in `server.mjs` beside the agent-invariants sweep. 9 0-IMPACT tests; tsc + `yarn build`
  clean. The carve-out is recorded in the IRON-guard memory note (`feedback_ai_maestro_never_installs_user_scope`
  + its wikimem twin) with a `[^1]` guardrail lesson so a future audit will not delete it.
- **Multi-client (codex/gemini/opencode/kiro/kimi) enforcement — SPLIT OUT to [[TRDD-D0SI66XM]]**
  (USER-mandated, DELAYED: *"this other TRDD can be delayed. only the one with claude must be done now."*).

**STILL BLOCKED ON USER — D1 (R42 wording extension, IRON, USER-only):** R42's exception today =
the janitor's *machine-wide switches* (disarm/re-arm, pause/unpause, global reload), explicitly
*"NOT commands aimed at an agent."* A per-agent **restart** is agent-aimed. Until D1 is ratified,
capability #3 writes+restores settings but does NOT restart running agents (new sessions pick the
keys up at launch); capabilities **#1** (auto-restart-all-harness-agents on `ai-maestro-plugins`
update) and **#2** (in-process global control ops) CANNOT proceed — both depend on the daemon-as-
server restarting agents. Draft wording is in "Governance drafts" below.

**NEXT ACTION:** get USER sign-off on **D1** (the R42 restart extension). THEN build capability #1
(auto-restart-on-plugin-update) + capability #2 (in-process global control ops), reusing the seams
`services/auto-update-service.ts`, `hooks/useRestartQueue.ts`, `POST /api/sessions/[id]/restart`.

## Problem / Goal

Two janitor daemons, **two disjoint agent domains, NO overlap**:

| Domain | Owner | Mechanism |
|---|---|---|
| **ai-maestro-harness agents** | the ai-maestro **server** (the absorbed daemon) | **in-process (API / direct function calls) — NO CLI scripts** |
| **agents OUTSIDE the harness** ("global" = non-harness) | the **standalone janitor plugin** daemon (unchanged) | its existing daemon process |

The non-ai-maestro plugin retains the old daemon and owns the global commands for non-harness agents.
The server owns everything for harness agents. Neither touches the other's agents.

## Scope — three server capabilities (harness domain only)

### 1. Auto-restart ALL harness agents on an `ai-maestro-plugins` marketplace plugin update
The concrete new behavior. When the auto-update path updates any plugin from the `ai-maestro-plugins`
marketplace (core plugin, a role-plugin, a dependency plugin), the server automatically restarts
**every** harness agent so the new plugin code is live. Authorized by the R42 daemon exception (item 1).
- **Reuse, do not rebuild:** `services/auto-update-service.ts` (the update tick — the trigger point),
  `hooks/useRestartQueue.ts` (already queues restarts after element changes, fires at `idle_prompt`),
  `POST /api/sessions/[id]/restart` (exit → poll shell → relaunch with the agent's STORED args).
- Fan-out is over the registry's harness agents (under `~/agents/` + adopted workdirs), same-host only.

### 2. Server-owned GLOBAL control ops for harness agents (in-process, no scripts)
disarm/arm · pause/resume · reload — the daemon-only *global* versions, provided directly to the server.
(An agent may still do the NON-global, per-project versions itself — that stays a `/janitor-*` local skill.)
These are machine-wide-for-the-harness switches the server invokes in certain circumstances (e.g. before
a fleet restart), NOT per-agent injection.

### 3. `~/.claude/settings.json` env-key ENFORCER (set + restore-on-drift) — needs item-2 exception
The server ensures these are present-and-equal in `~/.claude/settings.json`; a **watchdog re-applies**
them if drifted (same pattern as `lib/agent-invariants.ts` + the `aimaestro-*.md` read-only rule
enforcement). After a change, restart the affected harness agents (piece 1).

Under the `env` object:
```
ENABLE_BACKGROUND_TASKS=1 · ENABLE_TOOL_SEARCH=false · CLAUDE_CODE_FORK_SUBAGENT=1 ·
CLAUDE_AUTO_BACKGROUND_TASKS=1 · CLAUDE_CODE_RETRY_WATCHDOG=1 · CLAUDE_AFK_COUNTDOWN_MS=20000 ·
CLAUDE_AFK_TIMEOUT_MS=300000 · CLAUDE_ASYNC_AGENT_STALL_TIMEOUT_MS=2000000
```
Top-level key: `askUserQuestionTimeout=60s`.

Enforcer discipline (design in): a FIXED allowlist (no arbitrary writes), atomic tmp+rename, a pre-write
backup, idempotent add-if-missing-or-different (never clobber an unrelated key), and appropriate
console/sudo gating (this changes runtime behavior of every harness agent).

## Governance drafts (for USER ratification)

**R42 extension (draft):** append to the exception clause — *"…and the daemon (the ai-maestro server,
for HARNESS agents on the SAME host only) may restart those agents automatically after a global change
(an `ai-maestro-plugins` plugin update, or a settings.json enforcement re-apply). This remains a
machine-wide-for-the-harness operation, not targeted injection into a chosen agent's pane; it never
reaches another host, nor any non-harness agent (those belong to the standalone janitor daemon)."*

**`feedback_ai_maestro_never_installs_user_scope` amendment (draft):** add a `[^N]` lesson — the iron
"no service-layer `~/.claude/settings.json` write" holds for PLUGINS/ELEMENTS (the leakage WHY); the
daemon/server MAY write the fixed runtime-env allowlist above, because these are Claude-Code behavior
settings (not plugin enablement) and the daemon owns harness-agent runtime behavior.

## Verification (design)
- Unit: the enforcer (add-if-missing / update-if-different / never-clobber-unrelated / restore-on-drift),
  all 0-IMPACT via a temp `$HOME`.
- The auto-restart trigger fires on a simulated `ai-maestro-plugins` update and enqueues every harness agent.
- tsc + `yarn test` + `yarn build` clean.

## Approval log
- 2026-07-17 — Authored from the USER's clarifying directive. Awaiting USER ratification of the R42
  extension + the user-scope settings exception, then a build go-ahead.
- 2026-07-17 — **D2 (user-scope settings.json runtime-env carve-out) APPROVED by USER.** Capability #3
  (Claude settings enforcer) built + wired live (`4c8b7cb8`); carve-out recorded in the IRON-guard
  memory note. Multi-client enforcement split to [[TRDD-D0SI66XM]] (USER-mandated, delayed).
  **D1 (R42 restart extension) NOT YET ratified** — capabilities #1 (auto-restart-on-plugin-update)
  and #2 (in-process global control) remain blocked on it.
