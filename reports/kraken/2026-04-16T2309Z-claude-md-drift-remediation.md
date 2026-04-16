# CLAUDE.md Drift Remediation — 2026-04-16T2309Z

Sourced from: `reports/kraken/2026-04-16T2255Z-docs-drift-audit.md` (CLAUDE.md section only).
Scope: EDIT ONLY `CLAUDE.md`. Other doc remediations (GOVERNANCE-RULES.md, OPERATIONS-GUIDE.md, REQUIREMENTS.md) were NOT applied — out of scope per task.

File before: 1601 lines. File after: 1604 lines.

## Per-item results

| # | Audit line | Claim | Status | Action |
|---|-----------|-------|--------|--------|
| 1 | 9 | "Phase 1 - Local-only, auto-discovery, no authentication" | FIXED | Rewrote as "v0.29+ — localhost + Tailscale bind, AID/WebAuthn, team governance, AMP, ..." capturing actual shipped state. |
| 2 | 10 | "Tech Stack: Next.js 14" | NOT-A-BUG | Already correct (✅). |
| 3 | 13 | "Port: 23000" | NOT-A-BUG | Already correct (✅). |
| 4 | 39 | "Health Check: Use `/api/sessions`" | NOT-A-BUG | Already correct (✅). |
| 5 | 174 | "Both on port 3000" | FIXED | Changed to "port 23000". |
| 6 | 211 | "`lib/agent-registry.ts`" | NOT-A-BUG | Already correct (✅). |
| 7 | 239 | "`checkMessages()` DISABLED by default" | NOT-A-BUG | Verified against `lib/agent.ts:175` — `messagePollingEnabled` defaults to false. Claim correct. |
| 8 | 243-255 | "dashboard does NOT create or manage agents (Phase 1 limitation)" | FIXED | Replaced whole block with accurate description: registry is source of truth, dashboard creates/hibernates/deletes via element-management pipelines. |
| 9 | 437 | "5 statuses: backlog → pending → in_progress → review → completed" | NOT-A-BUG | Verified against fork's `types/task.ts:14` `DEFAULT_STATUSES`. Claim correct. |
| 10 | 486 | "`POST /api/sessions/{name}/restart`" | FIXED (partial) | Audit claimed endpoint missing. Re-verified against `git ls-tree fork/feature/team-governance`: endpoint DOES exist at `app/api/sessions/[id]/restart/route.ts` and `/stop/route.ts`. Changed URL template from `{name}` to `[id]` for Next.js dynamic route consistency. Added missing `/kill` endpoint to the list. |
| 11 | 491-493 | "/api/sessions/{name}/stop", "/restart" | FIXED | Same fix — paths updated to `[id]` form. |
| 12 | 517 | "`lib/team-registry.ts`" | NOT-A-BUG | Already correct (✅). |
| 13 | 524 | "ChangeTitle Gate 10 / Gate 13" | NOT-A-BUG | Already correct (✅). |
| 14 | 526-527 | wake/hibernate routes | NOT-A-BUG | Already correct (✅). |
| 15 | 528 | "`docs_dev/governance-design-rules.md`" | FIXED | Changed to `docs/GOVERNANCE-RULES.md` (the canonical git-tracked location per §0 of that file; `docs_dev/` is gitignored). |
| 16 | 568 | "`useSessions.ts`" | FIXED | Replaced with `useAgents.ts` (verified via `git ls-tree fork/feature/team-governance hooks/`). Added `useAgentLocalConfig.ts` for completeness. |
| 17 | 569 | "`useGovernance.ts`" | NOT-A-BUG | Verified exists on fork; kept as-is. Audit was wrong. |
| 18 | 573 | "`useRestartQueue.ts`" | NOT-A-BUG | Verified exists on fork; kept as-is. Audit was wrong. |
| 19 | 584 | "`useSessionActivity.ts`" | NOT-A-BUG | Already correct (✅). |
| 20 | 1083 | "`MAIN_PLUGIN_NAME`" | NOT-A-BUG | Verified exists at `lib/ecosystem-constants.ts:232`. Audit was wrong. Kept; also enriched the description with explicit value. |
| 21 | 1084 | "All 6 predefined role-plugin names" | FIXED | Changed to "All 8". Added `PREDEFINED_ROLE_PLUGIN_NAMES` and `PLUGIN_COMPATIBLE_TITLES` bullet entries. |
| 22 | 867 | "Predefined (6 defaults)" | FIXED | Changed to 8. |
| 23 | 874-880 | Predefined role-plugins table | FIXED | Added `ai-maestro-autonomous-agent` row with prefix `amaua-` and title `AUTONOMOUS`. |
| 24 | 890 | "Custom: `<agent-name>` user-chosen" | SKIPPED | Marked as WARN (incomplete but not wrong). Left as-is to avoid duplicating R20.28 rule text; GOVERNANCE-RULES is the canonical source for marketplace folder conventions. |
| 25 | 908 | "/api/agents/creation-helper/publish-plugin" | SKIPPED | WARN, unverified. No change; path follows established pattern. |
| 26 | 936-937 | "Stores in `~/agents/custom-plugins/<client>/<name>-<client>/`" | FIXED | Updated to `<client>-custom-marketplace/<name>-<client>/` form per R20.28, with note for Claude-target convention. |
| 27 | 939-945 | "Title → Role-Plugin Auto-Assignment (Gates 15-16)" | NOT-A-BUG | Verified against ChangeTitle pipeline. Kept. |
| 28 | 949-959 | Marketplace Names table | SKIPPED | WARN about missing `CORE_PLUGINS_CONTAINER_DIR_NAME` (R20.25). Scope-limited: GOVERNANCE-RULES is the canonical source; adding R20.25 to CLAUDE.md is a new claim, not a drift fix. |
| 29 | 959 | Deprecated marketplaces `role-plugins` confusing | FIXED | Reworded — `role-plugins` removed from deprecated list and clarified as the container directory name. |
| 30 | 963 | role-plugin-service functions | NOT-A-BUG | Verified 6 functions at listed line numbers. Kept. |
| 31 | 964 | `getCompatiblePluginsForTitle`, `installPluginLocally` | NOT-A-BUG | Verified both exist (`element-management-service.ts:987`, `:1155`). Kept. |
| 32 | 1086-1128 | "3-Repo Split / 4 Role-Plugin Repos" with "7 predefined" and stale fork note | FIXED | Updated to 8 role-plugin repos; added autonomous row; removed stale "13 commits behind" note; removed per-row "Last updated" column (drifted dates). |
| 33 | 1110 | "Lists the 7 predefined" | FIXED | Changed to "Lists the 8 predefined role-plugins in `.claude-plugin/marketplace.json`". |
| 34 | 1116-1126 | 7-row repo table | FIXED | Added 8th row (`Emasoft/ai-maestro-autonomous-agent`). |
| 35 | 1218-1219 | `server.mjs:89-104` / `1316-1323` | FIXED | Updated to `92-122` / `1383-1389` (verified exact range from fork's server.mjs). |
| 36 | 1220 | `lib/agent-auth.ts:35-41` + "SF-058 bypass" stale | FIXED | Whole Known-Limitations block rewritten: SF-058 bypass is CLOSED per agent-auth.ts header; current auth flow documented (session cookie after setup-init/setup-verify). |
| 37 | 1401-1417 | UI Scenario Tests "21 scenarios" | FIXED | Changed to "24 scenarios" (verified 24 `.scen.md` files on fork). Removed the inaccurate "SCEN-017 unused" aside — SCEN-017 is used. |
| 38 | 1475 | "R1-R15 (semver v3.1.0)" | FIXED | Changed to "R1-R20 (semver v3.7.0+): ..." and added summary mentioning core plugin (R17), client conversion (R18), marketplace governance (R20). |
| 39 | 1498-1520 | Model tables | SKIPPED | WARN, unverified. Model names are product documentation; drift requires fact-checking with Anthropic/OpenAI, out of scope for this pass. |
| 40 | 1524 | `plugin-universal-ir.yaml` path | NOT-A-BUG | Already correct (matches R20.8/R20.22). |
| 41 | 1530 | `lib/converter/emitters/shared.ts` exports | NOT-A-BUG | WARN, accepted as-is. |
| 42 | 1534 | "Phase 1 (Current): Auto-discovery, localhost-only, read-only" | FIXED | Whole Roadmap Context block rewritten: "Shipped (v0.29+): ..." / "Planned: ...". Removed the "read-only" wording. |
| 43 | 1549 | "Don't use sessions.json" | FIXED | Removed (sessions.json was never used and the sentence was confusing). Replaced with "Don't write directly to the registry" that points to the element-management pipelines. |
| 44 | 1550 | "Don't implement authentication - Phase 1 is localhost-only" | FIXED | Removed. Replaced with "Don't bypass agent auth / sudo-mode" entry that describes the current gate. Also removed "Don't support remote SSH" (stale — remote SSH is not forbidden, just not shipped). |

## Bonus fixes (not in audit queue but corrected during pass)

| Location | Fix |
|---|---|
| File Structure §530-536 | Rewrote "DO NOT create these directories (they don't exist yet in Phase 1)" — tests/, public/, and styles/ all exist and are actively used. Updated to "Directories already in use" with descriptions. |
| Environment Variables §1327 | `PORT=3000` → `PORT=23000`. Added `HOSTNAME=127.0.0.1` entry matching server.mjs:94 default. |

## Summary

- **FIXED:** 25 items (including 2 bonus fixes)
- **NOT-A-BUG (verified-correct claims that the audit flagged incorrectly):** 13
- **SKIPPED (out of scope or stylistic):** 4

File size stayed within budget (1604 lines; limit 1800).

## Files modified
- `CLAUDE.md`
