---
trdd-id: O8NCNRWO
title: Harden the stop/restart safe-state gate for CC ≥2.1.198 background subagents
column: ai_review
created: 2026-07-08T19:34:50+0200
updated: 2026-08-02T15:49:10+0200
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
implementation-commits: [47676228, c88ffda8, 3f47dce4]
external-refs: ["github.com/Emasoft/ai-maestro-plugin/issues/17 (CLOSED 2026-07-16, plugin v2.10.0)"]
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

## Progress

- 2026-07-08T19:42 — **Phase 1 landed (47676228)**: fix-plan items 1+2+6 — `lib/session-safe-state.ts`
  (readSubagentCount / evaluateExitGate / looksLikeAbandonPrompt), the 409 gate in both routes with
  `?force=true`, the restart poll's half-timeout abandon-dialog probe + hinted 504, 12 unit tests.
  Gate: tsc 0 · eslint 0 · 26 tests green.
- 2026-07-08T19:55 — **item 5 landed (c88ffda8)**: fifth compat-audit pass 2.1.190–204 in the
  tracked doc + CLAUDE.md safe-state premise corrected + doc-index range fixed.
- 2026-07-08T20:05 — **Phase 2 landed (3f47dce4)**: items 3+4 — `subagentCount` threaded
  getHookState → /api/sessions/activity → `useSessionActivity` (WS handler now MERGES over the
  prev entry — a replace would drop the counter on the first status_update), the
  "Waiting (N subagents)" flavor in `resolveAgentStatus` + all four display consumers, and the
  `useRestartQueue` courtesy hold. **All 6 fix-plan items complete.** Parked at `ai_review`:
  the positive-path live e2e (an actual 409 + UI flavor with a REAL background subagent) is
  observable only after the hook stops dropping the counter — gated on ai-maestro-plugin#17.
  The negative path (unknown counter never blocks) is what ships today and is unit-proven.

## ⏱ UNBLOCKED 2026-08-02 — the external blocker closed 17 days ago and nothing noticed

`ai-maestro-plugin#17` is **CLOSED**, shipped in plugin **v2.10.0** on **2026-07-16**: `writeState`
now carries `subagentCount` forward when an event omits it (explicit values still win, so
SessionStart's reset to 0 still works — commit `4a9966e`), plus atomic temp-file+rename writes
closing the torn-read side door (`34443db`).

So the ONE thing parking this card at `ai_review` — *"observable only after the hook stops dropping
the counter"* — has been observable since 2026-07-16. The card sat unchanged for 17 days after its
blocker cleared, which is the failure the kanban rule names: a card sitting still is stalled unless
its blocker is *itself still open*. Nothing re-checks an external blocker, because `blocked-by:`
cannot name one (the vocabulary gap, [[5YRLA53W]]).

**Before running the e2e, verify the installed plugin is ≥ v2.10.0** — the fix is in the plugin, not
in this repo, so a host still on an older cached version reproduces the old behaviour exactly.

## Acceptance

Derived from this card's own 6-item fix plan and its Progress log — every box below is a commitment
the card already made, not a criterion invented at closing time.

- [x] 1 — stop/restart routes read `subagentCount` and refuse with 409 `subagents_running`;
      `?force=true` preserves the old behaviour (`lib/session-safe-state.ts`, `47676228`)
- [x] 2 — the restart poll detects `/exit`'s abandon-confirmation prompt instead of timing out
      blind (`looksLikeAbandonPrompt` + the half-timeout probe + hinted 504, `47676228`)
- [x] 3 — `resolveAgentStatus` surfaces a distinct "Waiting (N subagents)" flavor, threaded
      `getHookState` → `/api/sessions/activity` → `useSessionActivity`, all four consumers (`3f47dce4`)
- [x] 4 — `useRestartQueue` holds while `subagentCount > 0` (`3f47dce4`)
- [x] 5 — CLAUDE.md's safe-state premise corrected + the compat audit extended to 2.1.204 (`c88ffda8`)
- [x] 6 — unit tests for the 409 gate (>0 / =0 / absent) and the abandon-prompt branch; tsc 0,
      eslint 0, 26 green
- [ ] the POSITIVE-path live e2e — with a REAL background subagent: Stop returns 409 without
      `force`, the UI shows the subagents-running flavor, and with `force` the abandon prompt is
      handled. **Unblocked since 2026-07-16**; only the negative path (an unknown counter never
      blocks) is proven today, and that is the half that ships

## Approval log
