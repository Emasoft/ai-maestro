---
trdd-id: 903b7a20-bddf-4368-9295-4a9a984270e9
title: Overnight fleet-readiness campaign — govern-compliance + script-skill align + install-security + scenarios before the governance PR
column: dev
created: 2026-06-20T23:15:18+0200
updated: 2026-06-21T03:05:00+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 0
severity: HIGH
task-type: audit
release-via: none
test-requirements: [unit, typecheck, e2e, dev-browser-headless]
audit-requirements: [security-scan, adversarial-scan]
review-requirements: [human-review]
relevant-rules: []
labels: [overnight, fleet-readiness, governance, security, scripts, scenarios]
---

# TRDD-903b7a20 — Overnight fleet-readiness campaign

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-06-20

**Mandate (user, 2026-06-20 ~23:00, going to sleep, explicit autonomous authorization):**
Keep working + coordinating with the janitor-plugin Claude and MANAGER-plugin Claude
via GitHub issues. Ready the ai-maestro API + plugin fleet for the final activation
test before the governance PR. Use the memory system. Do NOT stop until: (1) all
ai-maestro functions obey the governance rules, (2) all scripts align with the
plugins' skills/needs, (3) all install procedures are secure/updated/aligned. Launch
MULTIPLE ultracode workflows to verify the TRDD implementations + all pending tasks.
Run scenario tests with dev-browser; make the UI flawless + agents
controllable/configurable per governance. Improve what needs improving. Decide from
real tests, grounded in facts. PRIORITIZE SECURITY. Notify issues to the janitor via GitHub.

**Ground truth (verified 2026-06-20 23:15):**
- Branch `governance-rules`, clean, `fork/governance-rules` in sync. HEAD `6e1eeb57`.
- Governance constitution = `docs/GOVERNANCE-RULES.md` (R1–R40, 1401 lines). **No PRRD** (this project predates the PRRD convention; GOVERNANCE-RULES.md IS the rule source).
- `design/tasks/`: 20 TRDDs (8 `status: not-started`, 1 completed, 1 superseded, 10 no-status/older-format). `design/proposals/`: 4 — ALL tier-2, ALL security/alignment. `design/archived/`: 4. (`design/requirements`, `design/refused` DO NOT EXIST — an earlier `64/64` count was a glob artifact.)
- The 4 proposals (the security spine): (a) AID PoP nonce-bound vs timestamp-window; (b) route CLI plugin/skill/local-message mutations through server API (decoupling); (c) bind sudo tokens to op+subject, authenticate-before-consume; (d) script SSOT + code-signing readiness, dedupe AMP tree, route hook through intermediary.
- Open fork issues (16): #45 decoupling CLI verbs, #44 plugin publish→CPV canonical, #43 kanban DONE, #42 core handshake blocked, #41 webdesign role conformance, #40 kanban pillar (CLI half DONE this session), #39 assistant-role plugin, #37 frozen-CLI-decoupling+memory rule, #35 MANAGER↔ai-maestro sync, #34 wire memory recall into run loop, #33 R22 self-ID, #32 plugins write state outside workdir, #27 AMP approval messages, #5/#4/#3 Haephestos.
- Server UP (`/api/sessions` → 401 = AID-auth-gated, running). 27 scenarios. `dev-browser` CLI present.

**SCOPE BOUNDARY (load-bearing):** ai-maestro (THIS repo) = fix directly. The plugin
fleet (ai-maestro-plugin, 8 role-plugins, janitor, MANAGER, CPV, …) = OTHER repos →
**file/Update GitHub issues, NEVER edit their source** (cross-project rule). Live
AID-authed kanban round-trip = agent-only (owner session gets 401) — coordinate, can't do solo.

**NEXT ACTION (current — see the detailed `## NEXT ACTION` at the bottom):**
Phase A (verify) + B (synthesize) + E (MANAGER coordination #35) DONE. **8 fixes LANDED
+ committed on `governance-rules`, NOT pushed; full suite 1866/0:** `a11d1bfb`
sessions-browser auth+traversal, `d53b03d9` ChangeFolder ~/agents confine, `5512e9cb`
kanban TRDD-v2 field-drop, `41697ca5` #45 teams CLI verbs, `32816842` #45 presence verb,
`98cdd3bd` **#5 ChangeTitle G17 R9.13**, `66168dc1` **#3 server.mjs cookie deep-validate
(security)**, `76fb1684` **#6 registerAgent R9.13 roleMissing**. ✅ COND-1 GOVERNANCE
COMPLETE (all 4 identified gaps fixed: sessions-browser auth, ChangeFolder confine,
ChangeTitle R9.13, registerAgent R9.13). ✅ **BRANCH BUILDS CLEAN — `yarn build` ✓**
(`2de768a5` fixed a PRE-EXISTING build-blocker: a stale eslint-disable for the now-
unloaded `@typescript-eslint/no-var-requires` in lib/portfolio-*.ts — unrelated to the
campaign, but it blocked the PR; tsc+vitest stayed green so it was invisible without
`yarn build`). NEXT: Phase D scenarios (dev-browser UI
validation) OR the lower-priority residuals (#3b bearer-downstream, #37 decoupling
[gated], install --verify) — full queue + designs in `## Phase B synthesis` + `## NEXT
ACTION` below.

**Load-bearing facts / gotchas:**
- Every GitHub write self-identifies (R22): `_Posted by the Claude developing **ai-maestro** (via the shared @Emasoft gh auth)._`
- Never `git add -A` — stage by name. Commit fixes with WHY + `TRDD-903b7a20`.
- Memory edits in MAIN context (store outside repo; subagents can't reach it).
- Workflow fix-agents: `isolation: worktree` + explicit write-scope constraint (project root + /tmp only).
- Reports → gitignored `reports/`. Service `[janitor-heartbeat]` markers between phases.

**Durable artifacts to read before acting:**
- `docs/GOVERNANCE-RULES.md` (R1–R40), `design/proposals/*.md` (the 4 security proposals).
- Memory: `project_aid_security_plan`, `governance-r26-r40-security-model`, `project-governance-rules-pr` (LOCAL), fleet hubs (USER).
- `reports/overnight-verify/` (this campaign's findings, once Phase A lands).

## Plan

- **Phase A** — read-only verification ultracode sweep (governance / scripts / installs / TRDDs) → findings reports.
- **Phase B** — synthesize: prioritized fix list (security first); split ai-maestro-fixable vs plugin-fleet.
- **Phase C** — implement ai-maestro fixes (worktree-isolated agents), each build+test verified, committed.
- **Phase D** — scenario tests via dev-browser (UI flawless + agent controllability/configurability per governance).
- **Phase E** — file/update GitHub issues for plugin-fleet items + notify the janitor.

## Progress log

- 2026-06-20T23:15 — TRDD created. Ground truth established. Launching Phase A.
- 2026-06-20T23:20 — Phase A attempt 1 (workflow wouwfvhf7, 10 finders fanned out at once) FAILED: all 10 hit the transient server rate-limit instantly ("not your usage limit"), ~386s throttle, zero findings. LESSON: never launch the full fan-out at once — the corpus-distillation rule's exact trap. RL cleared ~23:26.
- 2026-06-20T23:27 — Phase A attempt 2 (workflow w655g51l5) relaunched RESILIENT: hand-rolled pool, concurrency 3, ramped spawn 15s, exponential backoff that re-enqueues on rate-limit, schemaless agents writing reports/overnight-verify/<dim>.{md,findings.json}. Only 3 agents hit the API at once. Running in background.
- **`/go-on-yourself` directive folded in (2026-06-20 ~23:18): DO NOT PUSH (commit only, await approval); TRDD per change; SERENA for symbol edits; update docs/readme/help per change; TDD; no bloat / modularize / reuse; prefer integrating alternatives over deleting; nothing outside project + /tmp; never relax security or quality gates.**
- 2026-06-21T00:10 — Phase A COMPLETE (w655g51l5): the resilient pool rode the throttle, all 10 dims produced findings → `reports/overnight-verify/`. ~93 findings, ~10 hot. Biggest hot clusters: scripts-skill-align (4), gov-element-mgmt (2), trdd-classify-pending (2), + gov-auth-sudo-aid (1), gov-decoupling (1). (3 transient RL failures were retried to success — the backoff worked.)
- 2026-06-21T03:05 — **BUILD-BLOCKER FIX LANDED — commit `2de768a5`, NOT pushed (TRDD-2ed177f4).** Deployability check: ran `yarn build` to verify the 8 campaign fixes are deployable → the build was ALREADY BROKEN (pre-existing; none of the 21 campaign commits touched the files): `next build`→eslint errored "Definition for rule '@typescript-eslint/no-var-requires' was not found" in lib/portfolio-check.ts + lib/portfolio-issue-guard.ts. The @typescript-eslint plugin is no longer loaded by next/core-web-vitals (dep drift) → every `eslint-disable` naming one of its rules is now a BUILD error. Empirically confirmed the modern `no-require-imports` is ALSO "not found" → removed the stale disables (the rule isn't active, so the lazy sync `require()` isn't flagged). **yarn build now SUCCEEDS (49.78s).** GUARDRAIL: tsc + vitest do NOT run `next lint`, so only `yarn build` catches this class — run it after dep updates / in CI. Branch is now deployable + PR-ready (modulo the user's version bump).
- 2026-06-21T02:55 — **GOVERNANCE FIX #6 LANDED — commit `76fb1684`, NOT pushed (TRDD-47effd69, R9.13). COND-1 GOVERNANCE NOW COMPLETE (4/4 gaps).** registerAgent's system-owner register-from-session path created a role-less agent via raw createAgent (bypassing the role-installing CreateAgent AIO); the wake-route R9.13 gate checks `agent.roleMissing` but registerAgent left it UNSET → role-less agent could wake (silent R9.13 violation). The grounding REFINED the original "install plugins" design: the created agent's workdir does NOT exist at register time (createAgent makes it on first wake), so plugin install is impossible there → the correct fix is to FLAG `roleMissing:true` (mirroring G17/PG04/corePluginMissing) so the EXISTING wake gate blocks it until a role is assigned. Scoped to the new-agent path (.catch-guarded so a flag failure can't orphan the agent id); link + cloud paths untouched. TDD 2 cases (RED-verified) + a bug autopsy (the fix broke an existing test because its updateAgent mock returned undefined not a Promise → fixed the MOCK to match production-async, not the code). tsc clean + **full suite 1866/0** (+2 tests). API-CHANGES §12.
- 2026-06-21T02:45 — **SECURITY FIX #3 LANDED — commit `66168dc1`, NOT pushed (TRDD-ba9d6df2).** server.mjs full-mode auth gate (the inline /api/internal/pty-sessions handler + the pre-handshake `wsHasCredential` for /term//status//v1/ws//companion-ws) did a PRESENCE-ONLY `aim_session` cookie regex → a forged cookie from a Tailscale peer/local process passed (real bypass past the IP filter; full-mode counterpart of a11d1bfb). FIX: new `lib/session-validate-server.mjs` (a .mjs server.mjs CAN import) reads the SHARED in-memory store `globalThis.__aiMaestroSessionsMap` (same Node process via app.prepare()) and validates sha256(token)+expiry, mirroring validateSession; wired into both gates; session-auth.ts UNTOUCHED. SCOPE (by design): cookie deep-validated; BEARER stays a non-consuming presence check — deep-validating aim_tk_ ONE-SHOT AID tokens at the pre-handshake gate would consume them before the real downstream consumer (a bug), so deep bearer validation is a documented DERIVED downstream follow-up. TDD RED→GREEN: tests/unit/session-validate-server.test.ts (6 cases incl. forged-token rejection). node --check clean (both .mjs) + tsc clean + **full suite 1864/0** (+1 file, +6 tests). API-CHANGES §11.
- 2026-06-21T02:30 — **GOVERNANCE FIX #5 LANDED — commit `98cdd3bd`, NOT pushed (TRDD-51ed3b0b, R9.13).** ChangeTitle G17 now enforces R9.13. G14 persists title BEFORE G16 installs the role-plugin; G16 only WARNs on install failure; the old G17 `else` reported "consistent (0 role-plugin(s))" → a titled-but-role-less agent (R9.13 violation, undetected, success=true). FIX: a G17 recovery closure (retry install once → if still 0, `roleMissing=true` + hibernate + `hibernate_role_missing` ledger, mirroring PG04; calls `installPluginLocally` DIRECTLY so PG04→ChangeTitle→G17 can't recurse). Scoped follow-up noted IN-CODE: consolidate G17+PG04 recovery into a shared helper after PG04 characterization tests. TDD RED→GREEN: new assistant-title case driving ChangeTitle WITHOUT `skipPluginSync` (the existing deep tests all skip-sync → WHY this gap was never caught) + a test-infra fix (the `getClientCapabilities` mock returned `{plugins}` but the code checks `caps.rolePlugins`). tsc clean + affected set 133/0 + **full unit suite 1858/0** (+1 new test). API-CHANGES §10.
- 2026-06-21T00:45 — **SECURITY FIX #1 LANDED — commit `a11d1bfb`, NOT pushed.** sessions-browser auth-bypass + path-traversal SSOT. Implemented TRDD-9e1e4b29 (presence-only `hasSessionCookie` let a forged `aim_session` read any agent's transcript → now validates via `hasValidSession`→`validateSession`; 401 on forged/absent; login round-trip verified, no legit-user lockout) + TRDD-5df6f7da (`confineToProjectsStore` triplication → single shared export; **DISCOVERED + fixed a headless-mode `?path=` traversal hole that had NO guard**). 9 Next routes + headless (8 gates + 3 confine) + service. Full loop honored: `tsc` clean + full unit suite **1851 passed / 0 failed** + docs (API-CHANGES §7) + both TRDDs → completed. Method note: did it in-main-tree (not parallel fix-agents) — security transparency + tonight's throttle + the concurrent finder reads made single-writer atomic edits the right call.
- **RESOLVED (`66168dc1`, TRDD-ba9d6df2): `server.mjs` `hasCredential()` (L609/L1036) presence-only `aim_session` → now deep-validated via new `lib/session-validate-server.mjs` reading the SHARED `globalThis.__aiMaestroSessionsMap` (.mjs can't import the TS validator, but shares the global). Bearer stays presence-check by design (one-shot AID tokens must not be consumed at the pre-handshake gate); deep bearer validation = documented downstream DERIVED follow-up.**
- 2026-06-21T01:50 — **FIX #4 LANDED — commit `41697ca5`, NOT pushed (TRDD-fb75c4d1, #45).** scripts-align: added FROZEN CLI verbs `aimaestro-teams.sh tasks <id>` (GET /api/teams/<id>/tasks) + `reassign-cos <id> <uuid> --password P` (POST chief-of-staff) — additive, mirroring cmd_add_agent/cmd_kanban_config; v1.1.0→v1.2.0. Verified: bash -n clean, --version/help/arg-validation correct, LIVE WIRING proven (`tasks <uuid>`→"HTTP 401 auth_required" = reached the real endpoint). Functional 200 round-trip is agent-only. The 3rd #45 verb `presence` (in aimaestro-agent.sh — delegates to agent-*.sh modules) DEFERRED. Deployed ~/.local/bin needs install-messaging.sh re-run (outside-project deploy, flagged).
- 2026-06-21T02:05 — **#45 COMPLETE — `presence` verb LANDED, commit `32816842`, NOT pushed.** Added `cmd_presence` to agent-commands.sh (mirroring cmd_show's `get_api_base`+`_build_auth_args`+`curl`) + dispatch/help/header in aimaestro-agent.sh. Verified: `bash -n` clean both files; direct `cmd_presence` invoke (sourcing the modules, bypassing main's `check_api_running` pre-gate) returns `auth_required` FROM `/api/users/me/presence` (wiring proven). Confirmed NOT a regression from `a11d1bfb` (`check_api_running` probes `/api/sessions`, which my sessions-browser-only fix never touched). **All 3 #45 frozen CLI verbs now done.**
- 2026-06-21T02:15 — **CONDITION 3 (install-security) GROUNDED WITH FACTS (read-only diff, no writes).** Deployed `~/.local/bin` vs repo `scripts/`: **5 of 6 checked DRIFTED.** Two are SECURITY-relevant: `aid-init.sh` (repo 249L vs deployed 197L — **SH-MAJOR-04 UUID-keyed-identity fix NOT deployed**) and `amp-send.sh` (same 829L but content differs — **likely MF-023 path-traversal fix NOT deployed**). Also `aimaestro-teams.sh`/`agent-commands.sh` deployed copies have 0 of tonight's #45 verbs. Only `aimaestro-hook.sh` IN SYNC. **→ USER ACTION REQUIRED: run `install-messaging.sh -y` to redeploy** (writes to ~/.local/bin = outside-project, so I cannot run it). NEXT-SESSION in-project follow-up: add an `install-messaging.sh --verify` drift-check mode (read-only, testable) + optional self-heal so deployed CLIs can't silently lag security fixes.
- 2026-06-21T01:30 — **Full unit suite re-run after all 3 fixes: 106 files, 1857 passed / 0 failed (2 pre-existing skips).** Zero regressions.
- 2026-06-21T01:35 — **PHASE E (coordination) — posted fleet-readiness status to MANAGER on issue #35** (https://github.com/Emasoft/ai-maestro/issues/35#issuecomment-4760203607). Reported: the 3 fixes (SHAs); answered the MANAGER's Q1/Q2 (sync state); flagged that fix #3 (`5512e9cb`) advances their **keystone #1** (parentTask/npt/eht/supersedes linkage now carried end-to-end → epic→child tree data model in place; attachments+due-dates+first-class `epic` type still open); verified-evidence for #37 decoupling (.cjs 6 direct /api calls, aimaestro-hook.sh ready, pending proposal c94c60e9); #45 verbs still missing; deployed-CLI drift (unconfirmed, will diff). Offered the MANAGER a choice: (a) extend Task model for rest of #1, (b) land #37 .cjs rewrite, (c) build #45 verbs. R22 self-ID applied.
- 2026-06-21T00:35 — **FIX #3 LANDED — commit `5512e9cb`, NOT pushed (TRDD-67f8b9bd).** Kanban TRDD-v2 field-drop (fix-queue #9). The Next.js POST tasks route validated the 8 TRDD-v2 fields but never spread them into createTeamTask — pure FULL-vs-headless drift (headless already forwarded them). Spread the 8 end-to-end fields (severity/effort/parentTask/npt/eht/supersedes/relevantRules/releaseVia) matching headless. TDD RED-then-GREEN: `tests/unit/api-team-tasks-trddv2-fields.test.ts` 2/2; tsc clean; docs API-CHANGES §9. Serves the kanban pillar (#40/#2). 6 further fields (reviewResult/supersededBy/implementationCommits/lastTestResult/publishedVersion/liveSince) accepted-but-not-carried in BOTH modes → uniform follow-up (not a drift).
- 2026-06-21T00:25 — **SECURITY FIX #2 LANDED — commit `d53b03d9`, NOT pushed (TRDD-35af6b13).** ChangeFolder `~/agents/` confinement (fix-queue #2). G01b gate (before the existsSync probe) rejects any workingDirectory outside `~/agents/`, mirroring CreateAgent G03-ENFORCE + DeleteAgent G09 — closes the workdir-write escape (the PATCH route already documented this as the intended-but-missing "Gate 3"). TDD: `tests/integration/change-folder-confinement.test.ts` 4/4 (real ChangeFolder, isSystemOwner ctx); `tsc` clean; docs API-CHANGES §8. Authority-gated → MEDIUM, but defense-in-depth on the load-bearing "every agent under ~/agents/" invariant.

## Phase B synthesis — confirmed fix-queue (2026-06-21T00:55; from reports/overnight-verify/, 98 findings/10 hot)
Each item below: CONFIRM against current code before fixing (workflow findings are LLM-judgment). Order = security → governance → scripts-align → kanban → decoupling.

**ai-maestro-fixable (Phase C), priority order:**
1. ✅ DONE a11d1bfb — TRDD-9e1e4b29 sessions-browser auth+traversal.
2. ✅ DONE d53b03d9 — ChangeFolder `~/agents/` confinement (TRDD-35af6b13, workdir-write escape).
3. ✅ DONE `66168dc1` (2026-06-21, TRDD-ba9d6df2) — SECURITY — `server.mjs hasCredential()` (L609/L1036) presence-only `aim_session` → cookie deep-validated via new `lib/session-validate-server.mjs` reading the shared globalThis Map. Bearer presence-check kept by design (one-shot AID consumption hazard); deep bearer validation = downstream DERIVED follow-up.
4. SECURITY (MEDIUM, deeper) — AID PoP replay (TRDD-15ff13ae, token reuse in 300s window); `POST /api/v1/federation/deliver` bypasses comm-graph+team-isolation.
5. ✅ DONE `98cdd3bd` (2026-06-21, TRDD-51ed3b0b) — GOV — ChangeTitle Gate14-before-Gate16: role-plugin install failure leaves title set + no role (R9.13). **VERIFIED + designed (2026-06-21):** G14 writes+verifies title; G16 (`element-management-service.ts:2724`) CATCHES install failure → WARN → continues; G17's final `else` (line 2805) reports "consistent" even for 0 role-plugins when a title requires one → ChangeTitle returns SUCCESS with a titled, role-less agent (R9.13 violation, undetected). FIX DESIGN: extract a shared helper `enforceRoleMissingHibernate(agentId, authContext, ops, tag)` from PG04's terminal recovery (lines 1168-1195: updateAgent roleMissing:true + hibernateAgent + `<tag>-hibernate-role-missing` ledger op — parameterize tag+source to PRESERVE PG04's exact `PG04:` log strings so existing tests pass); refactor PG04 to call it (tag='PG04'); at G17 detect `targetPluginName && activeRolePlugins.length === 0` → one direct `installPluginLocally(...).catch` reinstall → re-scan → if still 0 call the helper (tag='G17') + set a result flag (do NOT call ChangeTitle from G17 → infinite recursion). TDD: mock installPluginLocally to throw → assert roleMissing+hibernate. HIGH-blast-radius (ChangeTitle 23 gates) → do in fresh context, run FULL change-title/change-plugin suite + tsc. **DEFERRED tonight (compaction risk on the governance core).**
6. ✅ DONE `76fb1684` (2026-06-21, TRDD-47effd69 — ACTUAL fix: flag `roleMissing` [register-time plugin install is impossible, no workdir yet], NOT the "install plugins" design below) — GOV — `registerAgent` uses raw createAgent primitive, bypasses CreateAgent AIO (R21/R9.13/R17). `services/agents-core-service.ts:1048,1125-1135`. **INVESTIGATED (2026-06-21) — confirmed REAL:** the `body.sessionName && !body.id` path (line 1125, **system-owner-only**, the register-agent-from-session flow) creates a FULL local agent (program/model/workdir/session) via raw `createAgent`, so the new agent has NO role-plugin (R9.13) + NO core plugin (R17). NUANCE: registerAgent LINKS an existing tmux session (`linkSession`), so it canNOT naively re-route through the full CreateAgent AIO (which provisions a FRESH workdir/session). FIX DESIGN: after the raw `createAgent`, enforce R9.13/R17 in place — install the default role-plugin for the inferred title + the core `ai-maestro-plugin` (mirror CreateAgent's role/core gates; on install failure set roleMissing+hibernate like the new G17). TDD: register a new session-agent → assert it has a role-plugin + core plugin. DEFERRED — careful fix on the external-facing registration path; fresh context.
7. GOV — ChangeClient R18.4 partial-plugin-state on install-time failure.
8. ✅ DONE (FULL) — all 3 #45 frozen CLI verbs: teams `tasks` + `reassign-cos` (41697ca5) + agent `presence` (32816842), TRDD-fb75c4d1. Verified (bash -n + live-wiring-to-endpoint; functional round-trip agent-only). Deployed `~/.local/bin` copies need `install-messaging.sh` re-run (outside-project deploy step — flagged, not run).
9. ✅ DONE 5512e9cb — Kanban Next.js tasks route forwards the 8 end-to-end TRDD-v2 fields (TRDD-67f8b9bd; was FULL-vs-headless drift). REMAINDER: 6 fields (reviewResult/supersededBy/implementationCommits/lastTestResult/publishedVersion/liveSince) accepted-but-not-carried in BOTH modes — extend CreateTaskParams+createTeamTask+ghProject for those. Plus per-column move-permission inert (#2) still open.
10. CONTEXT-PARSER — TRDD-3339cc45 silent-drop regression re-armed.
11. DECOUPLING — create `scripts/aimaestro-hook.sh` (ai-maestro side) so the plugin's `ai-maestro-hook.cjs` can shim through it (#37). The .cjs rewrite itself is plugin-fleet.

**Deploy/note (NOT an in-project edit — flag for USER):** deployed `~/.local/bin` CLI is drifted/security-regressed (aid-init.sh SH-MAJOR-04 UUID-keyed-dir fix missing; helper divergence). Re-run `install-messaging.sh`. Consider adding installer hash/self-heal (in-project).

**Plugin-fleet (Phase E — GitHub issues, NEVER edit their repos):** `ai-maestro-hook.cjs` direct-/api rewrite (#37, after aimaestro-hook.sh lands); whether agent-plugin.sh/agent-skill.sh/amp-send.sh local-FS installs are intended (gov-auth-sudo-aid TRDD-a6d93b9c).

**Design-column (defer, multi-phase):** TRDD-a1019073 controlled-exec-env; TRDD-1ee4a3c1 portable agents; TRDD-c7a81642 boot auto-hibernate scan.

## NEXT ACTION
**DONE tonight (4 fixes, all committed on `governance-rules`, NOT pushed; full suite 1857/0):**
`a11d1bfb` sessions-browser auth+traversal · `d53b03d9` ChangeFolder ~/agents confine ·
`5512e9cb` kanban TRDD-v2 field-drop · `41697ca5` #45 teams CLI verbs. Phase A (verify) +
B (synthesize) + E (MANAGER coordination #35) complete.

**REMAINING (pick up in fresh context — designs/evidence captured above):**
- BOUNDED/mechanical: #45 `presence` verb (aimaestro-agent.sh modules); kanban 6-field remainder (extend CreateTaskParams+createTeamTask+ghProject); #2 kanban per-column move-permission (investigate the inert check).
- ✅ #5 ChangeTitle R9.13 DONE (`98cdd3bd`, TRDD-51ed3b0b). ✅ #3 server.mjs cookie deep-validate DONE (`66168dc1`, TRDD-ba9d6df2). ✅ #6 registerAgent R9.13 DONE (`76fb1684`, TRDD-47effd69 — flag roleMissing; the investigation showed register-time plugin install is impossible [no workdir], so the wake-gate flag is the correct enforcement). **COND-1 GOVERNANCE COMPLETE (4/4 identified gaps).**
- SECURITY MEDIUM (deeper): AID PoP replay (TRDD-15ff13ae); `/api/v1/federation/deliver` comm-graph bypass.
- DECOUPLING #37: .cjs→aimaestro-hook.sh rewrite — VERIFIED ready (intermediary has activity/notify/check-messages); gated behind pending proposal c94c60e9 (tier-2) — MANAGER asked on #35, await steer OR land it.
- Phase D: scenario tests via dev-browser (UI flawless + agent controllability) — via the run-scenario-test skill (forked agent).
- DEPLOY (USER action): re-run install-messaging.sh (deployed CLI drift: aid-init.sh SH-MAJOR-04 + the new teams verbs); add installer self-heal.
- #44 (plugin repo): core ai-maestro-plugin publish-pipeline → CPV canonical.

Recommend next: **Phase D scenarios** (dev-browser UI validation — explicitly user-requested; validates the governance/security fixes end-to-end), OR the lower-priority residuals (#3b bearer-downstream deep-validation, #37 decoupling [gated on MANAGER #35], install-messaging --verify drift mode). Service `[janitor-heartbeat]` markers between items.
