---
trdd-id: 903b7a20-bddf-4368-9295-4a9a984270e9
title: Overnight fleet-readiness campaign — govern-compliance + script-skill align + install-security + scenarios before the governance PR
column: dev
created: 2026-06-20T23:15:18+0200
updated: 2026-06-21T01:55:00+0200
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
Phase A (verify) + B (synthesize) + E (MANAGER coordination #35) DONE. **4 fixes LANDED
+ committed on `governance-rules`, NOT pushed; full suite 1857/0:** `a11d1bfb`
sessions-browser auth+traversal, `d53b03d9` ChangeFolder ~/agents confine, `5512e9cb`
kanban TRDD-v2 field-drop, `41697ca5` #45 teams CLI verbs. DEFERRED-COMPLEX (designed,
high-blast-radius governance core → fresh context): #5 ChangeTitle R9.13, #6 registerAgent
AIO. NEXT: a deferred-complex governance fix in fresh context OR Phase D scenarios — full
remaining queue + designs in the `## Phase B synthesis` + `## NEXT ACTION` sections below.

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
- 2026-06-21T00:45 — **SECURITY FIX #1 LANDED — commit `a11d1bfb`, NOT pushed.** sessions-browser auth-bypass + path-traversal SSOT. Implemented TRDD-9e1e4b29 (presence-only `hasSessionCookie` let a forged `aim_session` read any agent's transcript → now validates via `hasValidSession`→`validateSession`; 401 on forged/absent; login round-trip verified, no legit-user lockout) + TRDD-5df6f7da (`confineToProjectsStore` triplication → single shared export; **DISCOVERED + fixed a headless-mode `?path=` traversal hole that had NO guard**). 9 Next routes + headless (8 gates + 3 confine) + service. Full loop honored: `tsc` clean + full unit suite **1851 passed / 0 failed** + docs (API-CHANGES §7) + both TRDDs → completed. Method note: did it in-main-tree (not parallel fix-agents) — security transparency + tonight's throttle + the concurrent finder reads made single-writer atomic edits the right call.
- **NEW FINDING for Phase C: `server.mjs` `hasCredential()` (~L609/L1036) uses its own inline presence-only `aim_session` regex — same auth weakness, broader full-mode surface. `.mjs` can't import the TS validator → its own TRDD/fix needed.**
- 2026-06-21T01:50 — **FIX #4 LANDED — commit `41697ca5`, NOT pushed (TRDD-fb75c4d1, #45).** scripts-align: added FROZEN CLI verbs `aimaestro-teams.sh tasks <id>` (GET /api/teams/<id>/tasks) + `reassign-cos <id> <uuid> --password P` (POST chief-of-staff) — additive, mirroring cmd_add_agent/cmd_kanban_config; v1.1.0→v1.2.0. Verified: bash -n clean, --version/help/arg-validation correct, LIVE WIRING proven (`tasks <uuid>`→"HTTP 401 auth_required" = reached the real endpoint). Functional 200 round-trip is agent-only. The 3rd #45 verb `presence` (in aimaestro-agent.sh — delegates to agent-*.sh modules) DEFERRED. Deployed ~/.local/bin needs install-messaging.sh re-run (outside-project deploy, flagged).
- 2026-06-21T01:30 — **Full unit suite re-run after all 3 fixes: 106 files, 1857 passed / 0 failed (2 pre-existing skips).** Zero regressions.
- 2026-06-21T01:35 — **PHASE E (coordination) — posted fleet-readiness status to MANAGER on issue #35** (https://github.com/Emasoft/ai-maestro/issues/35#issuecomment-4760203607). Reported: the 3 fixes (SHAs); answered the MANAGER's Q1/Q2 (sync state); flagged that fix #3 (`5512e9cb`) advances their **keystone #1** (parentTask/npt/eht/supersedes linkage now carried end-to-end → epic→child tree data model in place; attachments+due-dates+first-class `epic` type still open); verified-evidence for #37 decoupling (.cjs 6 direct /api calls, aimaestro-hook.sh ready, pending proposal c94c60e9); #45 verbs still missing; deployed-CLI drift (unconfirmed, will diff). Offered the MANAGER a choice: (a) extend Task model for rest of #1, (b) land #37 .cjs rewrite, (c) build #45 verbs. R22 self-ID applied.
- 2026-06-21T00:35 — **FIX #3 LANDED — commit `5512e9cb`, NOT pushed (TRDD-67f8b9bd).** Kanban TRDD-v2 field-drop (fix-queue #9). The Next.js POST tasks route validated the 8 TRDD-v2 fields but never spread them into createTeamTask — pure FULL-vs-headless drift (headless already forwarded them). Spread the 8 end-to-end fields (severity/effort/parentTask/npt/eht/supersedes/relevantRules/releaseVia) matching headless. TDD RED-then-GREEN: `tests/unit/api-team-tasks-trddv2-fields.test.ts` 2/2; tsc clean; docs API-CHANGES §9. Serves the kanban pillar (#40/#2). 6 further fields (reviewResult/supersededBy/implementationCommits/lastTestResult/publishedVersion/liveSince) accepted-but-not-carried in BOTH modes → uniform follow-up (not a drift).
- 2026-06-21T00:25 — **SECURITY FIX #2 LANDED — commit `d53b03d9`, NOT pushed (TRDD-35af6b13).** ChangeFolder `~/agents/` confinement (fix-queue #2). G01b gate (before the existsSync probe) rejects any workingDirectory outside `~/agents/`, mirroring CreateAgent G03-ENFORCE + DeleteAgent G09 — closes the workdir-write escape (the PATCH route already documented this as the intended-but-missing "Gate 3"). TDD: `tests/integration/change-folder-confinement.test.ts` 4/4 (real ChangeFolder, isSystemOwner ctx); `tsc` clean; docs API-CHANGES §8. Authority-gated → MEDIUM, but defense-in-depth on the load-bearing "every agent under ~/agents/" invariant.

## Phase B synthesis — confirmed fix-queue (2026-06-21T00:55; from reports/overnight-verify/, 98 findings/10 hot)
Each item below: CONFIRM against current code before fixing (workflow findings are LLM-judgment). Order = security → governance → scripts-align → kanban → decoupling.

**ai-maestro-fixable (Phase C), priority order:**
1. ✅ DONE a11d1bfb — TRDD-9e1e4b29 sessions-browser auth+traversal.
2. ✅ DONE d53b03d9 — ChangeFolder `~/agents/` confinement (TRDD-35af6b13, workdir-write escape).
3. SECURITY — `server.mjs hasCredential()` (~L609/L1036) inline presence-only `aim_session` regex (.mjs, harder — own TRDD).
4. SECURITY (MEDIUM, deeper) — AID PoP replay (TRDD-15ff13ae, token reuse in 300s window); `POST /api/v1/federation/deliver` bypasses comm-graph+team-isolation.
5. GOV — ChangeTitle Gate14-before-Gate16: role-plugin install failure leaves title set + no role (R9.13). **VERIFIED + designed (2026-06-21):** G14 writes+verifies title; G16 (`element-management-service.ts:2724`) CATCHES install failure → WARN → continues; G17's final `else` (line 2805) reports "consistent" even for 0 role-plugins when a title requires one → ChangeTitle returns SUCCESS with a titled, role-less agent (R9.13 violation, undetected). FIX DESIGN: extract a shared helper `enforceRoleMissingHibernate(agentId, authContext, ops, tag)` from PG04's terminal recovery (lines 1168-1195: updateAgent roleMissing:true + hibernateAgent + `<tag>-hibernate-role-missing` ledger op — parameterize tag+source to PRESERVE PG04's exact `PG04:` log strings so existing tests pass); refactor PG04 to call it (tag='PG04'); at G17 detect `targetPluginName && activeRolePlugins.length === 0` → one direct `installPluginLocally(...).catch` reinstall → re-scan → if still 0 call the helper (tag='G17') + set a result flag (do NOT call ChangeTitle from G17 → infinite recursion). TDD: mock installPluginLocally to throw → assert roleMissing+hibernate. HIGH-blast-radius (ChangeTitle 23 gates) → do in fresh context, run FULL change-title/change-plugin suite + tsc. **DEFERRED tonight (compaction risk on the governance core).**
6. GOV — `registerAgent` uses raw createAgent primitive, bypasses CreateAgent AIO (R21/R9.13/R17). `services/agents-core-service.ts:1048,1125-1135`.
7. GOV — ChangeClient R18.4 partial-plugin-state on install-time failure.
8. ✅ DONE 41697ca5 (PARTIAL) — `aimaestro-teams.sh tasks` + `reassign-cos` verbs (TRDD-fb75c4d1). REMAINDER: the 3rd verb `presence` (GET /api/users/me/presence) belongs in `aimaestro-agent.sh` (delegates to agent-*.sh modules — verify that structure first). Deployed `~/.local/bin/aimaestro-teams.sh` needs `install-messaging.sh` re-run to pick up the new verbs (outside-project deploy step).
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
- DEFERRED-COMPLEX (high-blast-radius governance core — designs in §"Phase B synthesis" item #5; do carefully, run FULL change-title/change-plugin suite): #5 ChangeTitle R9.13 (shared `enforceRoleMissingHibernate` helper + G17 detection); #6 registerAgent AIO bypass (route through CreateAgent).
- SECURITY MEDIUM (deeper): AID PoP replay (TRDD-15ff13ae); `/api/v1/federation/deliver` comm-graph bypass.
- DECOUPLING #37: .cjs→aimaestro-hook.sh rewrite — VERIFIED ready (intermediary has activity/notify/check-messages); gated behind pending proposal c94c60e9 (tier-2) — MANAGER asked on #35, await steer OR land it.
- Phase D: scenario tests via dev-browser (UI flawless + agent controllability) — via the run-scenario-test skill (forked agent).
- DEPLOY (USER action): re-run install-messaging.sh (deployed CLI drift: aid-init.sh SH-MAJOR-04 + the new teams verbs); add installer self-heal.
- #44 (plugin repo): core ai-maestro-plugin publish-pipeline → CPV canonical.

Recommend next: a DEFERRED-COMPLEX governance fix (#5 or #6) in fresh context (highest mandate value, designs ready), OR Phase D scenarios. Service `[janitor-heartbeat]` markers between items.
