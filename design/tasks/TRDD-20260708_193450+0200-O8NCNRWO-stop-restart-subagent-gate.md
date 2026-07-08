---
trdd-id: O8NCNRWO
title: Harden the stop/restart safe-state gate for CC ≥2.1.198 background subagents
column: planned
created: 2026-07-08T19:34:50+0200
updated: 2026-07-08T19:34:50+0200
current-owner: main-session
assignee: main-session
priority: 1
severity: HIGH
effort: M
labels: [fleet-readiness, session-control, cc-compat]
task-type: bugfix
parent-trdd: TRDD-903b7a20
npt: []
approval-tier: 0
release-via: none
test-requirements: [unit, typecheck]
impacts: []
relevant-rules: []
implementation-commits: []
external-refs: ["github.com/Emasoft/ai-maestro-plugin/issues/17"]
---

# Harden the stop/restart safe-state gate for CC ≥2.1.198 background subagents

Source: the 2.1.133→2.1.204 Claude Code compatibility audit
(`reports/cc-compat-audit/20260708_193122+0200-cc-2.1.133-204-audit.md`, FINDING 1 — HIGH,
the only non-additive risk out of 1107 changelog entries reviewed).

## Problem

CC 2.1.198 made **background subagents the default**: a main session reaches an idle input
prompt WHILE subagents keep running, and 2.1.203's changelog confirms `/exit` warns/confirms
when background agents are genuinely running. ai-maestro's safe-state premise —
"`idle_prompt` ⟹ no subagents running, safe to stop/restart" (CLAUDE.md §Session Control
Architecture) — is broken:

1. `app/api/sessions/[id]/stop/route.ts:84-86` + `restart/route.ts:145-147` send
   `C-c` + `/exit` + `Enter` with NO server-side subagent gate. With live background
   subagents, `/exit` lands on Claude's abandon-confirmation prompt instead of exiting →
   the restart route's shell-detect poll times out → 504, and the session is left sitting
   on a modal prompt.
2. `lib/agent-status.ts:63-64` maps `notificationType==='idle_prompt'` straight to the
   amber "Waiting (safe)" state with no subagent awareness — the UI enables Stop/Restart
   on a session that is not actually safe.
3. (Cross-repo NPT) `ai-maestro-plugin/scripts/ai-maestro-hook.cjs:379-394` writes the
   `idle_prompt` state UNCONDITIONALLY and `writeState` (:99-126) REPLACES the state file
   without merging — an interleaved `idle_prompt` DROPS `subagentCount` even while
   `SubagentStart` counted up, corrupting the counter (`SubagentStop` then floors at 0).
   Filed as a GitHub issue on Emasoft/ai-maestro-plugin (link added to `external-refs:`
   when filed); this repo's fix must tolerate BOTH hook versions (subagentCount may be
   absent or stale until the plugin ships).

## Fix plan (this repo)

1. Stop/restart routes: read the chat-state's `subagentCount` (when present) before sending
   the exit sequence; if >0, refuse with 409 + a machine-readable reason
   (`subagents_running`) so the UI can explain instead of 504ing. Include an explicit
   `force=true` escape hatch preserving today's behavior.
2. After sending `/exit`, detect the abandon-confirmation prompt in the poll loop (pane
   text probe) and answer it deterministically (or abort + report) instead of timing out.
3. `lib/agent-status.ts` / `useSessionActivity`: surface a distinct "waiting (subagents
   running)" flavor when `subagentCount > 0` so the safe-state affordances (Stop/Restart
   enablement, auto-restart queue `useRestartQueue`) key off genuine safety.
4. `useRestartQueue` gate: do not fire the auto-restart while `subagentCount > 0`.
5. Docs: update CLAUDE.md §Session Control Architecture premise; extend
   `docs/CLAUDE-CODE-COMPATIBILITY-AUDIT.md` coverage 2.1.133→2.1.204 from the audit
   report's verdict table.
6. Tests: unit tests for the 409 gate (subagentCount >0 / =0 / absent) + the
   abandon-prompt poll branch.

## Verification

`npx tsc --noEmit` + targeted vitest suites green; manual: wake an agent, spawn a
long-running background subagent, verify Stop returns 409 without force and the UI shows
the subagents-running flavor; with force, verify the abandon prompt is handled.

## Approval log
