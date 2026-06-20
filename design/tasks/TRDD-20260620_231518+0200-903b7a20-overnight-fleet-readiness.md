---
trdd-id: 903b7a20-bddf-4368-9295-4a9a984270e9
title: Overnight fleet-readiness campaign — govern-compliance + script-skill align + install-security + scenarios before the governance PR
column: dev
created: 2026-06-20T23:15:18+0200
updated: 2026-06-21T00:50:00+0200
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

**NEXT ACTION:** Phase A verification workflow is launching (read-only ultracode
sweep): governance-compliance (R1–R40 + gov issues), script↔skill alignment (#45/#35),
install-security, TRDD-implementation verification. Reports → `reports/overnight-verify/`.
On completion: synthesize → Phase C (ai-maestro fixes, worktree-isolated) + Phase E
(file plugin-fleet issues) + Phase D (scenario tests). Each phase commits + updates this STATE block.

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

## NEXT ACTION
Phase B (synthesize): read `reports/overnight-verify/*.findings.json` (10 dims, ~93 findings). Triage HOT (gap|partial AND CRITICAL|HIGH) first, security before all; CONFIRM each against current code (the workflow's findings are LLM-judgment — cross-check before acting); split ai-maestro-fixable vs plugin-fleet. Then Phase C per ai-maestro gap (security-ordered): per-area TRDD → verify→fix→test→docs→commit (NO push). Carry the `server.mjs hasCredential()` presence-check finding into Phase C as its own TRDD. Plugin-fleet gaps → GitHub issues + notify the janitor (Phase E). Security fix #1 (a11d1bfb) DONE.
