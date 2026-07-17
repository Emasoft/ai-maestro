---
trdd-id: QZL828OD
title: Server-owned harness global-control + settings.json env-key enforcer + auto-restart on plugin update
column: backburner
created: 2026-07-17T02:37:00+0200
updated: 2026-07-17T02:37:00+0200
current-owner: ai-maestro
task-type: feature
parent-trdd: KCRMSNL7
relevant-rules: [42, 17, 20]
scope: project
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-17

**Origin:** USER directive (2026-07-17), clarifying the Family-A daemon absorption. The ai-maestro
server IS the janitor daemon for **harness agents**; a set of daemon responsibilities that were NOT
in the continuity NPT chain (OAuth `1GGQ4HWY` / resurrection `JAU1ES1C` / continuity-CLI `DXJZM3BW`)
must be added to the server directly.

**NEEDS USER RATIFICATION BEFORE BUILD (two governance items — both IRON, USER-only):**
1. **R42 wording extension.** R42's exception today = the janitor's *machine-wide switches*
   (disarm/re-arm, pause/unpause, global reload), explicitly *"NOT commands aimed at an agent."* A
   per-agent **restart** is agent-aimed. Extend the exception so the daemon-as-server may **restart
   same-host HARNESS agents** (draft below).
2. **User-scope settings.json exception.** The memory `feedback_ai_maestro_never_installs_user_scope`
   (IRON) forbids the service layer from ANY write to `~/.claude/settings.json`. This TRDD needs a
   NARROW carve-out: the daemon/server MAY write a fixed allowlist of Claude Code **runtime env keys**
   (NOT plugins/elements — no leakage of AI-Maestro plugins, which is the rule's actual WHY). The
   memory note must be amended to record the exception, or a future janitor audit will "fix" (delete)
   the enforcer as a rule violation.

**NEXT ACTION:** get USER sign-off on the two items above + a build go-ahead. THEN: (Phase 1) build
the settings-enforcer + auto-restart-on-plugin-update; (Phase 2) the harness global-control ops.
First build step = investigate the existing seams (`services/auto-update-service.ts`,
`hooks/useRestartQueue.ts`, `POST /api/sessions/[id]/restart`, the `/api/settings/*` writers) to wire
into, not rebuild.

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
