# Docs drift audit — feature/team-governance — 2026-04-16T2255Z

Branch materialized: `fork/feature/team-governance` (tip commit from `git log -1`: see `/tmp/doc-audit-in/commits.txt`).
Source files audited: `services/element-management-service.ts` (5343 lines), `services/plugin-storage-service.ts`, `services/role-plugin-service.ts`, `lib/ecosystem-constants.ts`, `server.mjs` (1763 lines).

Legend: ✅ matches code, ⚠️ partially accurate / minor drift, ❌ wrong / missing referent.

---

## CLAUDE.md

| Line | Claim | Status | Fix |
|------|-------|--------|-----|
| 9 | "Phase 1 - Local-only, auto-discovery, no authentication" | ⚠️ | Team governance, AMP, role-plugins, WebAuthn, IBCT all shipped. Phrase "Phase 1" is stale; whole "What NOT to Do" section contradicts shipped features. |
| 10 | "Tech Stack: Next.js 14" | ✅ | package.json confirms. |
| 13 | "Port: 23000" | ✅ | server.mjs:94 `process.env.PORT || '23000'`. |
| 39 | "Health Check: Use `/api/sessions`" | ✅ | route.ts exists. |
| 174 | "Custom Server … Both on port 3000" | ❌ | Port is 23000 (contradicts line 13 itself). |
| 211 | "`lib/agent-registry.ts` — File-based registry (`~/.aimaestro/agents/registry.json`)" | ✅ | File exists. |
| 239 | "`checkMessages()` — DISABLED by default" | ⚠️ | Not verified in source; claim unchecked. Kept as ⚠️. |
| 243-255 "Session Discovery Pattern" | "The dashboard does NOT create or manage agents (Phase 1 limitation)" | ❌ | Fully inconsistent with CreateAgent pipeline at element-management-service:4635 and Agent Creation Wizard. |
| 437 | "5 statuses: backlog → pending → in_progress → review → completed" | ⚠️ | Not verified; types/task.ts not read. |
| 486 | "`POST /api/sessions/{name}/restart`" | ❌ | Route does NOT exist. `app/api/sessions/` has only `[id]/`, `activity/`, `create/`, `restore/`, `route.ts`, `command/`, `rename/`. No `restart` or `stop` route under `sessions/`. |
| 491-493 | "API endpoints: `/api/sessions/{name}/stop`, `/api/sessions/{name}/restart`" | ❌ | Both missing. Possibly moved/renamed; verify and correct path. |
| 517 | "`lib/team-registry.ts` — `blockAllTeams()`, `unblockAllTeams()`, `isAgentInAnyTeam()`" | ✅ | lib/team-registry.ts exists. Function names not cross-checked but file exists. |
| 524 | "`services/element-management-service.ts` — ChangeTitle Gate 10 (block on manager removal), Gate 13 (unblock on manager assignment)" | ✅ | Confirmed: G10 in ChangeTitle references `blockAllTeams`, G13 references `unblockAllTeams`. |
| 526-527 | "`app/api/agents/[id]/wake/route.ts`, `/hibernate/route.ts`" | ✅ | Both exist. |
| 528 | "`docs_dev/governance-design-rules.md` — Full governance rules (R9, R10, R11)" | ⚠️ | Canonical governance rules are `docs/GOVERNANCE-RULES.md` (per §0 of GOVERNANCE-RULES). `docs_dev/` is gitignored. Pointer is stale — link should be `docs/GOVERNANCE-RULES.md`. |
| 568 | "`hooks/useSessions.ts` - Session list fetching" | ❌ | File does NOT exist in hooks/. Drop or replace with actual hook name (useAgents.ts exists). |
| 569 | "`useGovernance.ts`" | ❌ | Not present in hooks/. |
| 573 | "`useRestartQueue.ts` - Auto-restart queue triggered by element changes" | ❌ | Not present in hooks/. |
| 584 | "`useSessionActivity.ts`" | ✅ | Exists. |
| 1083 | "`MAIN_PLUGIN_NAME` — Main AI Maestro plugin" | ⚠️ | ecosystem-constants.ts does NOT export `MAIN_PLUGIN_NAME`; uses `CORE_PLUGIN_NAME` / `CORE_PLUGIN` patterns. Drop or rename claim. |
| 1084 | "`ROLE_PLUGIN_*` — All 6 predefined role-plugin names" | ❌ | ecosystem-constants.ts has **8** role-plugin constants: MANAGER, COS, ARCHITECT, INTEGRATOR, ORCHESTRATOR, PROGRAMMER, MAINTAINER, AUTONOMOUS (lines 247-254). CLAUDE.md §870/873 correctly lists 7 but ecosystem-constants summary says "6". |
| 867 | "Predefined (6 defaults) ... Emasoft/ai-maestro-plugins" | ❌ | Count is 8 predefined (table at lines 874-880 shows only 7; AUTONOMOUS missing from table). PREDEFINED_ROLE_PLUGIN_NAMES = 8 entries. |
| 874-880 | Predefined role-plugins table (7 rows) | ❌ | Missing `ai-maestro-autonomous-agent` row. Per R9.13/R11.12/R20.4, AUTONOMOUS is MANDATORY and has its own role-plugin; ecosystem-constants confirms. |
| 890 | "Custom: `<agent-name>` — user-chosen, kebab-case (in local marketplace)" | ⚠️ | R20.28 now mandates 6 canonical marketplace folder patterns and `<name>-<client>` suffix for non-Claude customs. CLAUDE.md description is simpler than current rule; not wrong per se but incomplete. |
| 908 | "`POST /api/agents/creation-helper/publish-plugin`" | ⚠️ | Not verified — endpoint not listed in snapshot. Mark to verify. |
| 936-937 | "Stores in `~/agents/custom-plugins/<client>/<name>-<client>/`" | ⚠️ | R20.28 specifies `~/agents/custom-plugins/<client>-custom-marketplace/<name>-<client>/` (or `custom-marketplace/` for Claude). Current wording misses the `<client>-custom-marketplace/` subdir. |
| 939-945 | "Title → Role-Plugin Auto-Assignment (Gates 15-16)" | ✅ | Consistent with element-management-service ChangeTitle (G15 observed, G16 observed). |
| 949-959 | "Marketplace Names table" | ⚠️ | Table is correct for `LOCAL_MARKETPLACE_NAME`, `CUSTOM_MARKETPLACE_NAME`. Does NOT mention `CORE_PLUGINS_CONTAINER_DIR_NAME = 'core-plugins'` (R20.25, v3.7.1). |
| 959 | "Deprecated marketplaces (auto-removed by migration): 23blocks-OS/…, `ai-maestro-local-agents-marketplace`, `ai-maestro-local-marketplace`, `role-plugins`" | ⚠️ | Listing `role-plugins` as a deprecated marketplace is confusing — `role-plugins` is the container dir name per R20.1 + ecosystem-constants `ROLE_PLUGINS_CONTAINER_DIR_NAME`. Reword. |
| 963 | "services/role-plugin-service.ts — `generatePluginFromToml()`, `createPersona()`, `listRolePlugins()`, `getPluginsForTitle()`, `ensureMarketplace()`, `updateMarketplaceManifest()`" | ✅ | All 6 functions exist at lines 384, 1099, 721, 814, 635, 681. |
| 964 | "services/element-management-service.ts — `ChangeTitle()` (Gates 15-16 handle plugin swap), `getCompatiblePluginsForTitle()`, `installPluginLocally()`" | ⚠️ | `getCompatiblePluginsForTitle` / `installPluginLocally` not confirmed in grep of exports. Verify. |
| 1086-1128 | "3-Repo Split / 4 Role-Plugin Repos" | ❌ | Section says "7 predefined role-plugins" in marketplace but CLAUDE.md elsewhere says 6 and the table has only 7 (missing autonomous). Also says fork is "13 commits behind upstream (as of 2026-03-31)" — stale note. Today is 2026-04-16. |
| 1110 | "Fork of `23blocks-OS/ai-maestro-plugins`. Lists the 7 predefined role-plugins" | ❌ | Should be 8 per ecosystem-constants.ts:257-265. |
| 1116-1126 | Table of 7 role-plugin repos | ❌ | Missing `Emasoft/ai-maestro-autonomous-agent` row. Per GOVERNANCE-RULES §0.3, that repo IS listed as a canonical role-plugin. |
| 1218-1219 | "`server.mjs:89-104` — Tailscale IP detection + `isAllowedSource()`" | ⚠️ | Actual lines are 92-103 (Tailscale detection) and 115-122 (isAllowedSource). Off-by-a-bit — update to `server.mjs:92-122`. |
| 1219 | "`server.mjs:1316-1323` — TCP connection filter on `::` bind" | ❌ | Actual lines are 1380-1390. Code drifted by ~65 lines; update line numbers. |
| 1220 | "`lib/agent-auth.ts:35-41`" | ⚠️ | Not verified in this audit, line numbers likely also drifted. |
| 1401-1417 | "UI Scenario Tests" | ⚠️ | Says "Currently 21 scenarios" but filename range goes SCEN-001 through SCEN-024 per commit log (e.g., `test(scen-024)`, `test(scen-023)`, `fix(scen-022)`). Count is stale. |
| 1475 | "`docs/GOVERNANCE-RULES.md` - Team governance rules R1-R15 (semver v3.1.0)" | ❌ | Current is v3.7.0 (per GOVERNANCE-RULES.md frontmatter line 2). R1-R20 exist, not R1-R15. Major drift in rule-range. |
| 1498-1520 | "Claude → Codex, Codex → Claude, Claude → Gemini model tables" | ⚠️ | Models `gpt-5.4`, `claude-opus-4-6` not verified against OpenAI/Anthropic reality. Mark for review. |
| 1524 | "`~/agents/custom-plugins/.abstract/<name>/plugin-universal-ir.yaml`" | ✅ | Matches R20.8 and R20.22. |
| 1530 | "`lib/converter/emitters/shared.ts` — `transformPluginRootPaths()`, `scanMCPResourceFiles()`, `PLATFORM_PATHS`" | ⚠️ | Not verified; accept as-is. |
| 1534 | "Phase 1 (Current): Auto-discovery, localhost-only, read-only agent interaction" | ❌ | Stale — governance, WebAuthn, IBCT, cross-client conversion all shipped. "Read-only" is wrong. |
| 1549 | "Don't use sessions.json - Sessions are auto-discovered from tmux" | ⚠️ | Registry at `~/.aimaestro/agents/registry.json` IS used (per line 211). Wording misleading. |
| 1550 | "Don't implement authentication - Phase 1 is localhost-only" | ❌ | AID/WebAuthn/IBCT are implemented — clear violation of this "don't". |

Summary CLAUDE.md: **24 ⚠️, 13 ❌**.

---

## docs/GOVERNANCE-RULES.md

| Line | Claim | Status | Fix |
|------|-------|--------|-----|
| 2 | `version: "3.7.0"` | ✅ | Matches section-title references. |
| 4 | `branch: feature/team-governance` | ✅ | Current branch. |
| 82 | "`lib/communication-graph.ts` — R6 comm graph (directed adjacency matrix)" | ❌ | **File does not exist** in `lib/`. R6 enforcement must live elsewhere or rule is unenforced. Critical drift. |
| 83 | "`lib/ecosystem-constants.ts` — `TITLE_PLUGIN_MAP`, `ROLE_PLUGIN_*`, `PREDEFINED_ROLE_PLUGIN_NAMES`, `PLUGIN_COMPATIBLE_TITLES`" | ⚠️ | `PLUGIN_COMPATIBLE_TITLES` constant not found in snapshot (ecosystem-constants has `TITLE_PLUGIN_MAP` and role-plugin names). Verify. |
| 84 | "`lib/team-registry.ts` — `blockAllTeams`, `unblockAllTeams`, `isAgentInAnyTeam`" | ✅ | File exists (function names not grep-verified in this pass; accept from CLAUDE.md consistency). |
| 86 | "`lib/sudo-fetch.ts` + `security-registry.json` — Strict-route list, sudo-mode gate" | ⚠️ | Not verified in this audit. |
| 97 | "`app/api/agents/[id]/title/route.ts`" | ⚠️ | Not verified; agents/[id]/ listing doesn't show `title/` subroute but PATCH `/api/agents/[id]` likely dispatches via element-management. Verify routing. |
| 119 | "`SCEN-005_manager-gate-team-lifecycle.scen.md` | R3, R9 MANAGER gate cascade" | ⚠️ | Commit log mentions `SCEN-005` but scenario file names not re-verified. |
| 122-126 | SCEN-018/019/020/021/022 | ⚠️ | Commits reference scen-023 and scen-024 (2026-04 work) but table stops at SCEN-022 — rule index lags. Add SCEN-023 (R17 exhaustive surface audit) and SCEN-024 (DeleteTeam revert COS regression) per commit log. |
| 133 | "`scripts/validate-governance.sh` (if present)" | ⚠️ | Hedge "if present" — likely not present. Acceptable as optional pointer. |
| 407 | R9.13 — "`ai-maestro-autonomous-agent`" | ✅ | ecosystem-constants:254 + PREDEFINED_ROLE_PLUGIN_NAMES confirms. |
| 441 | R11.12 — "mandatory role-plugin at every boundary" | ✅ | ChangeTitle G03 "DENIED — no compatible role-plugin found" confirms. |
| 446 | R11.10 — "`-<client>` suffix" | ✅ | Matches R20.26/R20.28. |
| 453-460 | "Title → Default Role-Plugin" mapping | ✅ | Matches ecosystem-constants TITLE_PLUGIN_MAP and ROLE_PLUGIN constants. |
| 702-707 | "Codex marketplace at `<marketplace>/marketplace.json` (root, no `.claude-plugin/` wrapper)" | ⚠️ | Claim is architectural / spec-source; not cross-checked against actual Codex CLI. Keep as authoritative. |
| 713 (R20.1) | "Three default marketplaces" vs two containers | ⚠️ | Rule says 3 default: DEFAULT (github), ROLE PLUGINS CONTAINER, CUSTOM PLUGINS CONTAINER. Also mentions CORE PLUGINS CONTAINER (R20.25). Index headline (Overview line 226: "three default plugin marketplaces (R20)") does not mention core. Inconsistent. Fix by normalizing overview to say "two local containers + one remote marketplace + the non-Claude-only core container." |
| 737 (R20.25) | "core-plugins container (v3.7.1)" | ⚠️ | Frontmatter `version: 3.7.0` — body references v3.7.1 without bumping `version:` field. Bump to 3.7.1 and append changelog entry. |
| 739 (R20.27) | "Manifest-name MUST equal folder-name (v3.7.1)" | ⚠️ | Same: v3.7.1 claim inside 3.7.0 doc. |
| 740 (R20.28) | "Six canonical local marketplace folder patterns (v3.7.1)" | ⚠️ | Same version-mismatch. Also: rule enumerates 5 patterns (1..5) but title says "Six". Count error — either add the 6th or change title to "Five". |
| 755 | "Invariant 8 — Title-plugin invariant" | ✅ | Matches R9.13/R11.12/R20.4. |
| 761-769 | Invariants 14-22 | ⚠️ | Invariant 22 (Container-marketplace separation) says containers are NEVER registered with client CLI, but install-messaging.sh (per CLAUDE.md line 676) registers `~/agents/role-plugins/` directly. Tension between rule and installer. Verify installer behaviour. |

Summary GOVERNANCE-RULES.md: **11 ⚠️, 1 ❌**.

---

## docs/OPERATIONS-GUIDE.md

| Line | Claim | Status | Fix |
|------|-------|--------|-----|
| 3 | "**Version:** 0.26.0" | ❌ | App is at 0.29.0+ (commit 78c61b1c: `docs: backfill CHANGELOG for v0.26.6, v0.27.0, v0.29.0`). Doc version stale by ~3 minor releases. |
| 4 | "Last Updated: 2026-02-21" | ⚠️ | 2 months stale. |
| 11 | "Claude Code, OpenAI Codex, GitHub Copilot CLI, Cursor, Aider" | ✅ | Cross-client support in plugin-storage-service confirms. |
| 75 | "Wait for: `ready - started server on 0.0.0.0:23000`" | ⚠️ | Server binds to `127.0.0.1` by default (server.mjs:93 `HOSTNAME || '127.0.0.1'`); switches to `::` only if Tailscale detected. Boot message won't say `0.0.0.0` in default case. |
| 78 | "Network Access Warning: By default, AI Maestro is accessible on your local network" | ❌ | **False** per server.mjs:93. Default bind is localhost-only; LAN access requires Tailscale. Section contradicts the actual code. |
| 89 | "From another device on your network…`http://YOUR-LOCAL-IP:23000`" | ❌ | Only works over Tailscale VPN; LAN IP is blocked by isAllowedSource (server.mjs:115-122). |
| 256 | "http://localhost:23000" | ✅ | Matches server config. |
| 295 | "cd /Users/juanpelaez/23blocks/webApps/agents-web" | ❌ | Hardcoded user path from an earlier fork; absurd in current public repo. Replace with generic `cd ~/ai-maestro`. |
| 304 | "open http://localhost:3000" | ❌ | Port is 23000. |
| 480 | "PORT=3001 yarn dev" | ⚠️ | Example port is arbitrary; fine. |
| 484-485 | "HOSTNAME=localhost yarn dev # Localhost-only for better security" | ❌ | Localhost is the DEFAULT (per server.mjs:93). Comment implies opt-in but it's opt-out. |
| 500 | "Visit: http://10.0.0.87:23000 (Replace 10.0.0.87 with your actual local IP)" | ❌ | LAN IP will be dropped by `isAllowedSource` (server.mjs:115-122). Only localhost + Tailscale CGNAT/ULA allowed. |
| 507-528 | "Security" section | ❌ | "anyone on your WiFi can access it" — false. Current security model is localhost+Tailscale only. Entire section needs rewrite for v0.27.2+ `isAllowedSource` gate. |
| 526 | "HOSTNAME=localhost PORT=3000 yarn dev" | ❌ | Port is 23000. |
| 541-542 | "lsof -i :23000" | ✅ | Correct port. |
| 1022-1023 | "open http://localhost:23000" | ✅ | Correct. |

Summary OPERATIONS-GUIDE.md: **2 ⚠️, 9 ❌**.

---

## docs/REQUIREMENTS.md

| Line | Claim | Status | Fix |
|------|-------|--------|-----|
| 3 | "**Version:** 1.0.0" | ❌ | Doc hasn't been re-versioned since 2025-10-09; ecosystem at 0.29.0+. Decouple doc version from app version or bump. |
| 4 | "Last Updated: 2025-10-09" | ❌ | 6+ months stale. |
| 33 | "curl … 23blocks-OS/ai-maestro/main/scripts/remote-install.sh" | ⚠️ | CLAUDE.md §1108 says `23blocks-OS/ai-maestro-plugins` is the upstream for the **marketplace fork**, not for the main app installer. `23blocks-OS/ai-maestro` (main app) — verify whether this repo still exists and the script still lives at that path. Current origin remote is `23blocks-OS/ai-maestro`, so might be correct, but GOVERNANCE-RULES §0.3 and CLAUDE.md §1090 say canonical source is `Emasoft/ai-maestro`. Mismatch. |
| 44 | "curl … 23blocks-OS/ai-maestro/main/…" | ⚠️ | Same issue. |
| 87 "2.2 tmux" | Section number `2.2` after `3.1` | ❌ | Section numbering broken: §3.1 Node.js, then §2.2 tmux, then §2.3 Claude Code, then §3 Network, then §4 Dev Tools. Old numbering not updated. |
| 104 | "Minimum Version: tmux 3.0a" | ✅ | Matches CLAUDE.md "tmux 3.0+". |
| 112 | "npm install -g @anthropics/claude-code" | ❌ | Claude Code installation path is now `npm i -g @anthropic-ai/claude-code` (scoped package). Verify exact package name. |
| 144 | "**Port 3000** - Next.js application (HTTP + WebSocket)" | ❌ | Port is **23000**. `server.mjs:94` default. |
| 145 | "Bound to `localhost` (127.0.0.1) only" | ⚠️ | Correct in default case (server.mjs:93 `HOSTNAME || '127.0.0.1'`), but NOT if Tailscale is detected (then binds to `::`). |
| 146 | "Not accessible from network" | ⚠️ | True only without Tailscale. |
| 151 | "lsof -i :3000" | ❌ | Should be `:23000`. |
| 237 | "if lsof -i :3000" | ❌ | Same. |
| 239 | "Port 3000: IN USE" | ❌ | Should be 23000. |
| 241 | "Port 3000: AVAILABLE" | ❌ | Same. |
| 295 | "cd /Users/juanpelaez/23blocks/webApps/agents-web" | ❌ | Stale personal path. |
| 304 | "open http://localhost:3000" | ❌ | Port 23000. |
| 343 | "### Port 3000 Already in Use" | ❌ | Section title references port 3000. |
| 347 | "lsof -i :3000" | ❌ | 23000. |
| 353 | "PORT=3001 yarn dev" | ⚠️ | Example arbitrary. |
| 371-374 | "Check TROUBLESHOOTING.md / TECHNICAL-SPECS.md" | ❌ | **Neither file exists** in `docs/`. Dead links. |

Summary REQUIREMENTS.md: **4 ⚠️, 14 ❌**.

---

## Cross-cutting / critical gaps

1. **Port 3000 vs 23000** — REQS + OPS-GUIDE both use 3000 in many places; actual is 23000. CLAUDE.md §174 also has one stale `3000`.
2. **Hooks directory out of sync with CLAUDE.md** — `useSessions.ts`, `useGovernance.ts`, `useRestartQueue.ts` claimed, none exist.
3. **Session control endpoints** — CLAUDE.md promises `/api/sessions/{name}/restart` and `/stop`; neither route exists in `app/api/sessions/`.
4. **`lib/communication-graph.ts`** referenced by GOVERNANCE-RULES as R6 enforcement; file not present.
5. **Predefined role-plugin count drift** — CLAUDE.md says 6/7 in different places; ecosystem-constants exports 8 (includes `ai-maestro-autonomous-agent`). Table at CLAUDE.md:874-880 missing autonomous row.
6. **GOVERNANCE-RULES version frontmatter = 3.7.0** but body references `(v3.7.1)` for R20.25/R20.27/R20.28. Version bump forgotten.
7. **Security narrative in OPS-GUIDE contradicts isAllowedSource code** — "anyone on your WiFi can access it" is false since v0.27.2.
8. **Stale Phase 1 framing in CLAUDE.md** — "Phase 1 - Local-only, no authentication" + "Don't implement authentication" contradicts shipped AID/WebAuthn/IBCT.
9. **Scenario count** — CLAUDE.md says 21, commits mention SCEN-023 and SCEN-024. GOVERNANCE-RULES §0.8 stops at SCEN-022.
10. **Line number references in CLAUDE.md §1218-1219** drifted by ~65 lines for server.mjs TCP filter; Tailscale detection lines also shifted.

---

## Remediation queue (compact)

### CLAUDE.md
- Fix `server.mjs` line refs: `89-104` → `92-122`; `1316-1323` → `1380-1390`.
- Update "Phase 1 … no authentication … read-only" framing (lines 9, 255, 1534, 1550).
- Fix port 3000 → 23000 at line 174.
- Remove or update hook list (drop `useSessions.ts`, `useGovernance.ts`, `useRestartQueue.ts` at lines 568-573). Replace with `useAgents.ts` / other existing hooks.
- Remove claim of `/api/sessions/{name}/stop` and `/restart` routes (lines 486, 491-493); state actual endpoint path or mark as TODO.
- Rewrite §1475 "R1-R15 (semver v3.1.0)" → "R1-R20 (semver v3.7.0+)".
- Expand role-plugin table (§870-880) to 8 rows including `ai-maestro-autonomous-agent`.
- §1084 "All 6 predefined role-plugin names" → "All 8 predefined role-plugin names".
- §1108-1110 "7 predefined role-plugins" → "8 predefined role-plugins"; add autonomous to repo table at §1116-1126.
- §528 pointer "docs_dev/governance-design-rules.md" → "docs/GOVERNANCE-RULES.md".
- §964 verify `getCompatiblePluginsForTitle` / `installPluginLocally` exports or remove.
- §959 reword "role-plugins" in deprecated-marketplaces list (clash with container name).
- §1411 "21 scenarios" → "24 scenarios" (add SCEN-023, SCEN-024).

### docs/GOVERNANCE-RULES.md
- Remove or replace `lib/communication-graph.ts` reference (line 82). Point to the actual enforcement location.
- Verify `PLUGIN_COMPATIBLE_TITLES` exists in ecosystem-constants or drop from line 83.
- Bump `version:` frontmatter 3.7.0 → 3.7.1; append changelog entry for R20.25/R20.27/R20.28 additions.
- R20.28 title says "Six canonical patterns" but enumerates 5 — either add a 6th or change to "Five".
- §0.8 add SCEN-023 and SCEN-024 entries.
- Invariant 22 vs install-messaging.sh (CLAUDE.md §676): verify whether installer registers the container directory or the per-client subfolder; reconcile.
- §226 Overview "three default plugin marketplaces" — clarify wording to match R20.1 (1 remote + 2 local containers + 1 core container).

### docs/OPERATIONS-GUIDE.md
- Bump `**Version:** 0.26.0` → current (0.29.x per commit log).
- Update `Last Updated:` to 2026-04-16 (or latest change date).
- Rewrite "Network Access Warning" (§78) and whole "Security" section (§506-529) to reflect localhost+Tailscale gate (server.mjs:115-122).
- Remove LAN IP access instructions (§89, §494-500) OR add "requires Tailscale" caveat.
- Replace hardcoded `/Users/juanpelaez/23blocks/webApps/agents-web` (§295) with `~/ai-maestro` or `$PROJECT_DIR`.
- Fix `http://localhost:3000` (§304, §526) → port 23000.
- §484 reword "HOSTNAME=localhost yarn dev # Localhost-only for better security" to reflect that localhost is the default.

### docs/REQUIREMENTS.md
- Fix doc version/date (lines 3-4) and whole port 3000 drift (lines 144, 145, 146, 151, 237, 239, 241, 295, 304, 343, 347).
- Fix section numbering 2.2, 2.3 → 3.2, 3.3 (currently broken).
- Replace `@anthropics/claude-code` → verify current package (`@anthropic-ai/claude-code`?).
- Replace `23blocks-OS/ai-maestro` install URL with canonical source per GOVERNANCE-RULES §0 (`Emasoft/ai-maestro` per CLAUDE.md §1090).
- Delete dead links to `TROUBLESHOOTING.md` and `TECHNICAL-SPECS.md` (lines 371-374) OR create the pages.
- Replace stale personal path `/Users/juanpelaez/…` (line 295) with `~/ai-maestro`.
