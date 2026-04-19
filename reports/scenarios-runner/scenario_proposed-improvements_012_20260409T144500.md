# SCEN-012 Post-Scenario Improvement Proposals

**Based on:** SCEN-012 R17 Core Plugin Enforcement (Claude run, 2026-04-09)
**Report:** All steps PASS after BUG-001 fix

---

## BUG-001: Start Session bypasses wakeAgent R17 gate (FIXED)

- **Discovered at:** S029 (Phase 6)
- **Symptom:** Plugin was NOT reinstalled when clicking "Start Session" in the profile panel after removing it from settings.local.json
- **Root cause:** `handleStartSession` in `app/page.tsx` called `POST /api/sessions/create` directly, which goes through `sessions-service.ts:createSession()` — a different path from `wakeAgent()` in `agents-core-service.ts`
- **Fix:** Changed `handleStartSession` to call `POST /api/agents/{id}/wake` instead
- **Commit:** `2e1e0ae6`
- **Priority:** P0 — without this fix, agents woken via the UI bypass all R17 enforcement
- **Verified at:** Build passes, type check clean

---

## PROPOSAL-001: Audit ALL session creation paths for R17 compliance

- **Problem:** The bug shows that `sessions-service.ts:createSession()` is a second code path for waking agents. The AIO principle (Rule 1: One function per operation) is violated — `wakeAgent` should be the ONLY way to create an agent session.
- **Root cause:** `createSession` was written before `wakeAgent` existed and was never consolidated
- **Proposed solution:**
  1. Make `createSession` a helper that `wakeAgent` calls (not the other way around)
  2. Remove `POST /api/sessions/create` route or redirect it to `POST /api/agents/{id}/wake`
  3. Search for other callers of `createSession` and redirect them through `wakeAgent`
  4. Add R17 gate to `createSession` as defense-in-depth (in case any caller slips through)
- **Files:** `services/sessions-service.ts`, `app/api/sessions/create/route.ts`, `app/page.tsx`
- **Priority:** P0 — fundamental architectural violation

## PROPOSAL-002: Add R17 pre-check to createSession as defense-in-depth

- **Problem:** Even after PROPOSAL-001, someone could call `createSession` directly in the future
- **Proposed solution:** Add an `InstallElement` call at the top of `createSession()` that installs the core plugin before session creation, mirroring the wakeAgent R17 gate
- **Priority:** P1

## PROPOSAL-003: Periodic enforcement should attempt install, not just flag

- **Problem:** The 5-minute periodic enforcement in `server.mjs` runs `claude plugin install` to reinstall missing plugins, but this may fail silently if the Claude CLI is busy or the agent directory has issues
- **Proposed solution:** Use `InstallElement` AIO instead of raw `execSync` in the periodic enforcement. This gives the full gate pipeline with verification (PG01) and registry flag updates (PG02).
- **Priority:** P2

## PROPOSAL-004: Trust auto-accept should use a more specific pattern match

- **Problem:** The trust detection looks for "Yes, I trust this folder" in the pane output. If Claude changes this wording in a future version, the auto-accept breaks silently.
- **Proposed solution:** Also check for the `❯` selector character pattern + "trust" as a fallback. Log a warning if the trust prompt is detected but the exact wording doesn't match.
- **Priority:** P3

## PROPOSAL-005: Add corePluginMissing warning badge to sidebar agent cards

- **Problem:** When an agent is flagged with `corePluginMissing: true`, the user has no visual indication in the sidebar. They only discover it when the agent fails to function.
- **Proposed solution:** Add a small warning icon (triangle with !) next to the agent name in the sidebar when `corePluginMissing` is true. Tooltip: "Core plugin missing — wake the agent to reinstall."
- **Priority:** P2

## PROPOSAL-006: New scenario — SCEN-013 Codex client R17 enforcement

- **Problem:** SCEN-012 only tests the Claude client path. The Codex path (cross-client conversion via Universal Plugin IR) is untested.
- **Proposed solution:** Create SCEN-013 that repeats the same steps with Codex selected at Step 1. This tests: `convertAndStorePlugin()`, `emitForClient()`, the `[Codex]` variant gate in InstallElement, and the Codex trust prompt handling.
- **Priority:** P1

## PROPOSAL-007: "Start Session" button shows R17 error if wake fails

- **Problem:** After the fix (BUG-001), if wakeAgent returns 503 (plugin install failed), the error is shown via `alert()` — but the error message is very long (includes CLI output, manual fix commands). An alert box is not the right UX for multi-line diagnostic output.
- **Proposed solution:** Replace `alert()` with a proper error modal that shows the error in a scrollable, monospace-formatted panel. Include a "Copy to clipboard" button so the user can share the diagnostic output.
- **Priority:** P2
