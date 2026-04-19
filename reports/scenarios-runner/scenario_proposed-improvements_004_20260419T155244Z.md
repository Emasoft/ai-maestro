# SCEN-004 Proposed Improvements — Haephestos Role-Plugin Creation Pipeline

**Run ID:** 20260419T155244Z
**Source report:** `tests/scenarios/reports/SCEN-004_20260419T155244Z.report.md`
**Scenario:** SCEN-004 — Haephestos Role-Plugin Creation Pipeline
**Verdict:** PARTIAL (27 pass / 0 fail / 8 adapted / 1 skipped)
**Authored:** 2026-04-19T16:35:23Z

## Executive Summary

The Haephestos pipeline end-to-end WORKS — a role-plugin can be published, registered, discovered, and cleaned up. **But the user-facing Haephestos agent is effectively unusable** for real work: the purple HELPERS button does nothing, PSS fails with "Unhandled node type: string", and the agent stalls for 3+ minutes on context overflow at every step. A successful plugin creation took 17+ minutes via aggressive coaching (6 `/clear` cycles, hand-written TOML, manual publish API call). The scenario was completable only because the underlying pipeline APIs work — without them, a user could not produce a plugin via Haephestos today.

---

## P0 Proposals (blocking — must fix before Haephestos is usable)

### P0-001: Fix Haephestos "purple card" navigation

**File:** `components/AgentList.tsx:1041` + `app/page.tsx:296-334`
**Problem:** Clicking the purple `<button title="Haephestos — Create a role-plugin">` in the HELPERS section does nothing visible. URL stays at `/`, main content stays empty. The `window.location.href = '/?agent=haephestos'` assignment fires but the page.tsx `useEffect` doesn't complete the bootstrap or the URL is stripped before the effect runs.
**Root cause (suspected):** The `useEffect` at `app/page.tsx:301` depends on `agents` state. If `agents.length === 0` when the page loads (before `useAgents` fetches), the effect returns early. The next render has agents but `haephestosQueryHandled.current === false` should allow re-processing — but by then `window.location.search` has already been stripped by a prior render cycle.
**Proposed fix:**
```tsx
// Option A: trigger the bootstrap before useAgents finishes
useEffect(() => {
  if (typeof window === 'undefined') return
  if (haephestosQueryHandled.current) return
  const params = new URLSearchParams(window.location.search)
  if (params.get('agent') !== 'haephestos') return
  haephestosQueryHandled.current = true
  // Fire bootstrap immediately, don't wait for agents to load
  ;(async () => {
    const res = await fetch('/api/agents/creation-helper/session', { method: 'POST' })
    if (!res.ok) return
    const data = await res.json()
    setPendingActiveAgentId(data.agentId)  // set a separate ref/state that activates once agents load
    window.history.replaceState({}, '', '/')
  })()
}, [])  // run once on mount
// Then separately, when agents load AND pendingActiveAgentId is set, activate it
```
**Verification:** Click HELPERS Haephestos card → Haephestos view appears with video animation within 5 seconds.
**Priority rationale:** P0 because without this, the documented entry point for creating role-plugins is broken. Users must know the `POST /api/agents/creation-helper/session` endpoint to bootstrap Haephestos manually, which defeats the purpose of a UI.

### P0-002: PSS binary fails with "Unhandled node type: string"

**File:** External (perfect-skill-suggester plugin)
**Problem:** `pss-darwin-arm64 --agent <file> --top 12` returns `Unhandled node type: string` on a simple 1-line role description file.
**Root cause:** PSS's TOML/AST serialization bug — unknown node type in output pipeline.
**Proposed fix:** Report this issue upstream to perfect-skill-suggester maintainers. Haephestos's Step 2 should have a fallback path: if PSS fails, write a minimal hand-crafted `.agent.toml` directly from the uploaded agent-description.md content, bypassing PSS. Add to `agents/haephestos-creation-helper.md`:
```
If PSS returns "Unhandled node type" error, fall back to writing a minimal
.agent.toml with [agent].name, [description].text, and empty skills/deps
directly. Users can improve later via "Prune and Refine" step.
```
**Verification:** Reproduce the PSS error with any simple .md file; confirm Haephestos's fallback triggers.
**Priority rationale:** P0 because without PSS working, Haephestos's Step 2 is a dead end that blocks the entire pipeline.

### P0-003: Haephestos context overflow on every step

**File:** `agents/haephestos-creation-helper.md` + Haephestos's auto-loaded context
**Problem:** Haephestos loads `CLAUDE.md` (86.2k chars — warns >40k), `SCENARIOS_TESTS_RULES.md` (62.1k chars — warns >40k), and numerous rules files on every session start. Any tool output (file read, bash output) then pushes it over the 200k context window, causing "A file being read or a tool output is likely too large for the context window" errors and 3+ minute stalls.
**Root cause:** Haephestos runs in `~/ai-maestro` as its working dir, inheriting the full project CLAUDE.md. Also, the `.claude/rules/` symlink exposes all project rules to every agent in this repo.
**Proposed fix:**
1. **Immediate (persona-level):** Update `agents/haephestos-creation-helper.md` to add a mandatory `/clear` between Steps 2, 3, 5, 6, 7, 8. Document: "Context limit is 200k — after each step, run `/clear` before proceeding to free memory."
2. **Structural (workdir):** Change Haephestos's working directory from project root to `~/agents/haephestos/` (ephemeral) so it doesn't auto-load the big project CLAUDE.md. `services/creation-helper-service.ts` already has the workdir — verify it's being used.
3. **Rules-level:** Add `.claudeignore` or equivalent mechanism to prevent Haephestos from loading `SCENARIOS_TESTS_RULES.md` and other huge files.
**Verification:** Start Haephestos, confirm CLAUDE.md warning does NOT appear. Run a multi-step plugin creation, confirm no context overflow.
**Priority rationale:** P0 because every Haephestos step takes 3+ minutes, making the 8-step protocol take 25+ minutes. Users will abandon.

---

## P1 Proposals (serious UX/integrity issues)

### P1-001: No UI path to uninstall local-scope role-plugins

**File:** `services/marketplace-registry.ts` + `components/settings/MarketplaceManager.tsx`
**Problem:** The `ai-maestro-local-roles-marketplace` (directory-based local marketplace at `~/agents/role-plugins/`) is registered with Claude CLI but is NOT returned by `GET /api/settings/marketplaces`. Users who publish a plugin via Haephestos have no UI path to remove it.
**Root cause:** `/api/settings/marketplaces` only scans `~/.claude/plugins/marketplaces/` (GitHub-backed), not `~/agents/role-plugins/` (local directory-backed).
**Proposed fix:**
```ts
// lib/marketplace-registry.ts — add a scanner for local directory marketplaces
export async function getAllMarketplaces() {
  const github = await scanGitHubMarketplaces()
  const local = await scanLocalDirectoryMarketplaces(['~/agents/role-plugins', '~/agents/custom-plugins'])
  return [...github, ...local.map(m => ({ ...m, source: 'local' }))]
}
```
Then `MarketplaceManager.tsx` renders `source: 'local'` entries with an uninstall button per plugin.
**Verification:** Publish a plugin via Haephestos, open Settings → Plugins Explorer → Marketplaces, verify `ai-maestro-local-roles-marketplace` appears and lists scen-test-agent with a "Remove" button.
**Priority rationale:** P1 because it's a real user-facing gap (plugins pile up in the local marketplace with no cleanup UI) but users can still remove via API call manually.

### P1-002: Haephestos persona Step 8 fragile — `jq`/`curl` approach often fails

**File:** `agents/haephestos-creation-helper.md:189-201`
**Problem:** Step 8 requires Haephestos to run:
```bash
curl -s -X POST http://localhost:23000/api/agents/creation-helper/publish-plugin \
  -H 'Content-Type: application/json' \
  -d "$(jq -n --arg pd "$OUTPUT_DIR" '{pluginDir: $pd}')"
```
After context overflow, Haephestos struggles to reason about JSON escaping and jq args, and the curl command silently fails.
**Root cause:** Heavy reliance on bash + jq for an operation that could be a single slash command.
**Proposed fix:** Add a slash command to AI Maestro plugin (`/aim-publish-plugin <plugin-dir>`) that wraps the API call. Update Haephestos persona to use:
```
/aim-publish-plugin ~/agents/haephestos/build/$PLUGIN_NAME
```
**Verification:** Run Haephestos with a pre-built plugin; confirm `/aim-publish-plugin` slash command publishes successfully without any curl/jq bash.
**Priority rationale:** P1 because it's a real source of pipeline failures AND a general UX improvement (easier to teach, debug).

### P1-003: Scenario S030 mis-specifies which DELETE endpoint is strict

**File:** `tests/scenarios/SCEN-004_haephestos-plugin-creation.scen.md:309-314` + `security-registry.json`
**Problem:** S030 says "`DELETE /api/agents/role-plugins/install` is a strict route per Rule 12" but describes deleting via the Settings UI which uses `DELETE /api/agents/role-plugins?name=...` (plugin-deletion, not install). That endpoint is NOT strict. Sudo modal will never appear.
**Root cause:** Author conflated two different DELETE endpoints with similar names.
**Proposed fix (choose one):**
- **Option A (simpler):** Fix SCEN-004 S030 to NOT expect a sudo modal. The plain auth-only DELETE is correct for local-marketplace plugins.
- **Option B (more secure):** Add `DELETE_/api/agents/role-plugins` to `security-registry.json` as strict, then update the API route to require sudo token.
**Verification:** Re-run SCEN-004; cleanup step works without sudo prompt (Option A) OR requires sudo prompt (Option B).
**Priority rationale:** P1 because scenario correctness matters — future runs will keep failing on this step otherwise.

---

## P2 Proposals (moderate — ergonomics, clarity)

### P2-001: Haephestos shouldn't be auto-removed on every session hibernation

**File:** `services/creation-helper-service.ts`
**Problem:** When user switches away from Haephestos view or the session idles, `cleanupHaephestos()` runs and DELETES the agent from the registry. This means every time the user returns, they have to re-bootstrap via the HELPERS purple card (which is broken per P0-001).
**Root cause:** Haephestos is designed to be purely ephemeral, but the UX of "re-create on every visit" is confusing — users expect partial work to be preserved.
**Proposed fix:** Keep the agent entry in the registry (don't delete) — instead, just kill the tmux session and mark `status: offline`. Next visit wakes it up from the same state. Only delete on explicit "Purge Haephestos" action.
**Verification:** Open Haephestos, leave, return — the same Haephestos workspace with uploaded files remains.
**Priority rationale:** P2 because it affects workflow friction but has a reasonable workaround (bootstrap again).

### P2-002: SCEN-004 has no "skip PSS" escape hatch

**File:** `tests/scenarios/SCEN-004_haephestos-plugin-creation.scen.md`
**Problem:** The scenario assumes PSS binary works. When it fails (P0-002), the scenario is stuck. There's no documented fallback.
**Proposed fix:** Add a scenario variant or a fallback branch in Phase 4 that handles "PSS failed, Haephestos writes hand-crafted TOML". Reference P0-002 fix.
**Verification:** Run scenario with PSS intentionally broken; the fallback path completes.
**Priority rationale:** P2 because it's an edge-case handling improvement.

### P2-003: Prompt Builder first textarea is always the xterm-helper (hidden)

**File:** `components/*` where Prompt Builder renders
**Problem:** When you query `page.locator('textarea').first()`, it matches the hidden `xterm-helper-textarea` used by xterm.js's clipboard integration. Tests must use `.nth(1)` to reach the Prompt Builder. This is a fragile pattern.
**Root cause:** xterm inserts its own textareas into the DOM for accessibility/clipboard handling.
**Proposed fix:** Add a stable `data-testid="prompt-builder-textarea"` attribute to the Prompt Builder textarea so tests can `page.locator('[data-testid="prompt-builder-textarea"]')` reliably.
**Verification:** Test selectors hit the correct textarea.
**Priority rationale:** P2 for test-infrastructure stability.

### P2-004: aim-helpers.sh aim_screenshot doesn't consume the named page correctly for screenshots with large pages

**File:** `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh:95-105`
**Problem:** `aim_screenshot` uses `fullPage: false` (default). On a page with large scroll height (e.g. Plugins Explorer with 1360 elements), the screenshot only captures the viewport — users clicking below-fold areas can't verify via screenshot.
**Proposed fix:** Add an optional 5th argument `full_page=true` that sets `fullPage: true` in the screenshot options.
**Verification:** Run `aim_screenshot ... ... ... ... true`; screenshot captures full scrolled page.
**Priority rationale:** P2 for test-infrastructure completeness.

---

## P3 Proposals (nice-to-have — cosmetic)

### P3-001: marketplace.json encoding drift

**File:** Wherever marketplace.json is written
**Problem:** Different writers (Node JSON.stringify vs Python json) serialize `—` (em dash) differently: `\u2014` vs literal character. State-wipe byte-exact match fails.
**Proposed fix:** Standardize on one writer (Node JSON.stringify with no special options) across all code paths.
**Priority rationale:** P3 cosmetic only — no functional impact.

### P3-002: useAgents error message misleading re: Tailscale URL

**File:** `hooks/useAgents.ts:102`
**Problem:** Error log shows `Failed to fetch from mac-mini-di-emanuele (http://100.99.233.43:23000)` but the actual fetch uses `baseUrl=''` (same-origin). Misleading.
**Proposed fix:** Log `baseUrl || 'same-origin'` instead of `host.url`.
**Priority rationale:** P3 — improves debug-ability only.

### P3-003: Haephestos sidebar card shows in compact mode vs normal mode

**File:** `components/AgentList.tsx`
**Problem:** Compact sidebar shows icon-only button (S009a screenshot). Normal mode shows full card. Both call `window.location.href = '/?agent=haephestos'`. Fixing P0-001 should fix both, but worth verifying both code paths in AgentList.tsx:914 and AgentList.tsx:1041.
**Proposed fix:** Add a shared handler function. `handleHaephestosClick()` that does the navigation + optionally a direct API call. Call from both places.
**Priority rationale:** P3 for code duplication / maintainability.

---

## Test Coverage Gaps Identified

1. **No scenario covers the Purple HELPERS Haephestos click path reliably.** SCEN-004 hits this issue but couldn't reproduce a consistent fix. A dedicated micro-scenario would help.
2. **No scenario for MarketplaceManager uninstall flow.** Would have caught BUG-004 (no UI path for local plugins) early.
3. **No scenario for Haephestos context overflow recovery.** `/clear` is the only path but it's not documented.
4. **No scenario for PSS binary failure.** BUG-002 should have a test that runs PSS with intentionally broken input and verifies graceful error surfacing.

---

## Summary Table

| ID | Priority | Title | File(s) | Est. effort |
|---|---|---|---|---|
| P0-001 | P0 | Fix Haephestos purple card navigation | AgentList.tsx + page.tsx | 1-2h |
| P0-002 | P0 | PSS "Unhandled node type: string" (escalate upstream + Haephestos fallback) | External PSS + haephestos-creation-helper.md | 2-4h |
| P0-003 | P0 | Haephestos context overflow | haephestos-creation-helper.md + creation-helper-service.ts | 2-3h |
| P1-001 | P1 | No UI path to uninstall local plugins | marketplace-registry.ts + MarketplaceManager.tsx | 3-5h |
| P1-002 | P1 | Haephestos Step 8 fragile (bash/jq/curl) | ai-maestro-plugin slash command + haephestos-creation-helper.md | 2-3h |
| P1-003 | P1 | SCEN-004 S030 sudo misclassification | SCEN-004 .scen.md OR security-registry.json | 30min |
| P2-001 | P2 | Haephestos auto-removed on hibernation | creation-helper-service.ts | 1-2h |
| P2-002 | P2 | SCEN-004 no "skip PSS" escape hatch | SCEN-004 .scen.md | 30min |
| P2-003 | P2 | Prompt Builder textarea selector fragility | PromptBuilder component | 30min |
| P2-004 | P2 | aim_screenshot full_page option | aim-helpers.sh | 15min |
| P3-001 | P3 | marketplace.json encoding drift | role-plugin-service.ts | 1h |
| P3-002 | P3 | useAgents misleading error log | useAgents.ts | 15min |
| P3-003 | P3 | Haephestos dup click handlers | AgentList.tsx | 30min |

**Total estimated effort: ~15-25h for all P0/P1, ~3-5h for all P2, ~2h for all P3.**

---

## Recommended Sequencing

1. **First**: Fix P0-003 (context overflow) — everything else is slow and unreliable until this is resolved. Change Haephestos's workdir to `~/agents/haephestos/` and verify no 86k CLAUDE.md warning.
2. **Second**: Fix P0-001 (navigation) — restore the documented entry point.
3. **Third**: Investigate P0-002 (PSS) — likely needs upstream escalation; add Haephestos fallback so we don't block on it.
4. **Fourth**: P1-001 (local marketplace UI) — this is a real gap, not a workaround issue.
5. **Fifth**: P1-003 (SCEN-004 sudo misclass) — trivial fix, enables clean re-runs.
6. **Then**: the remaining P1-002, P2s, P3s as capacity allows.

After P0-001, P0-002, P0-003 land, re-run SCEN-004 and target PASS (not PARTIAL) with minimal adaptations. The underlying pipeline (publish API → marketplace → filter) is solid; the surface UX is the weak link.
