---
trdd-id: B7G2R0SX
title: Harness-readiness acceptance criteria + un-gated verification pass (make the spec-first authority trustworthy)
column: design
created: 2026-07-22T20:59:43+0200
updated: 2026-07-23T00:05:00+0200
current-owner: session
task-type: audit
scope: project
project-id: ai-maestro
min-approval-requirement: none
relevant-rules: [41, 42]
eht: []
npt: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-22

**▶ USER DEFINED "READY" (2026-07-22) — AUTHORITATIVE; supersedes the proposed A-F bar below as the
DEFINITION.** "Harness ready" = **scenario `SCEN-031` (zipsearcher end-to-end) RUNS and PASSES.** The user
gives the MANAGER ONE directive ("build zipsearcher — search files inside zips without decompressing") and
the fleet self-organizes to ship it: MANAGER writes the requirements TRDD → creates an AUTONOMOUS developer
+ a MAINTAINER → delegates → approves/refuses the AUTONOMOUS's TRDDs → drives a real GitHub PR-review
workflow (repo-from-template + branch rules, fork/clone, PRs, MAINTAINER reviews + bug-back-and-forth,
iterate) → v1.0.0 release → install+smoke-test → notify user → user installs + verifies on a sample zip.
Exercises the 3 no-team host titles. **AUTHORED + committed `4623dc83`** (`tests/scenarios/SCEN-031_*.scen.md`
+ setup wrapper + sample-zip fixture + NEXT_SCEN_NUMBER→32). The A-F bar below is now SUPPORTING EVIDENCE
(it proves the governance/enforcement substrate SCEN-031 depends on is sound — enforcement 378 green,
invariants boot-active, spec authoritative), NOT the definition. **NEXT = RUN SCEN-031** (via the
`run-scenario-test` skill) — but it has REAL GitHub side effects (creates `Emasoft/zipsearcher` + PRs +
release), runs long (agents build real software), and needs prereqs (gh auth, a template repo, MANAGER-
capable) → needs the USER's explicit go-ahead + a prereq check before the run.

**▶ 2026-07-22 (SCEN-031 EXPANDED + prereq-gated).** USER added requirement sets, ALL folded in + committed
`a129a0b1`: (1) **NEVER-STOP** — the whole run must self-sustain via the janitor heartbeat cron + the
ai-maestro server continuity daemon (auto-resume / rate-limit recovery / resurrection), ZERO runner
keep-alive; any agent that stops-and-stays-stopped, or only continued because the runner nudged it, = FAIL;
(2) correct **DERIVED TRDDs** (depth-1, siblings via `blocked-by:`, parent gated on all-EHT-terminal);
(3) **MAINTAINER creates the CI workflow** (PRs gated on green CI); (4) **MANAGER monitors** the 2 agents via
ai-maestro-plugin status scripts / `aimaestro-agent.sh` (read-only status = monitoring, NOT driving/R42).
**PREREQ GATE ran (read-only):** ✓ server up (401), ✓ gh authed @Emasoft, ✓ `zipsearcher` absent, ✓ 3
role-plugins cached; ✗ **NO Emasoft template repo exists** (step-6 blocker — USER must create one, OR allow a
public/3rd-party template, OR from-scratch), ✗ **AIM_GOVERNANCE_PASSWORD unset in shell** (likely in
gitignored `.env.local` which the runner sources — confirm). **NEXT = resolve the 2 blockers with the USER,
then RUN SCEN-031 via the `run-scenario-test` skill.** SCEN-031 file: `tests/scenarios/SCEN-031_zipsearcher-end-to-end-fleet-ship.scen.md`.

**▶ 2026-07-22 (SCEN-031 v1.1 — shared board + column ownership).** USER added: the two worker agents build the
SAME project → they SHARE one project `design/` kanban board (git-tracked zipsearcher TRDD corpus, NOT siloed
per-agent design trees); and the MANAGER assigns each agent its own kanban columns — AUTONOMOUS owns the build
side (`todo`/`dev`/`testing`), MAINTAINER owns the ship side (`ai_review`/`human_review`/`publish`). Folded in +
committed `a19eb0e4`: description + subsystems(kanban) + ui_sections(design board); new **S008b** (MANAGER sets up
the shared board + column split — the split is the PASS CRITERION, deliberately NOT dictated to the MANAGER in chat
so it stays a spontaneous-behaviour test per Rule 0.b; if the surface offers no way to assign an agent to columns
that becomes an 11th-HOUR capability-gap proposal); S010 verify (AUTONOMOUS cards move only through its owned
columns on the shared board); S014 verify (MAINTAINER advances review→publish). NEXT unchanged = resolve the 2
prereq blockers (template repo + password confirm) with the USER, then RUN.

**▶ 2026-07-22 (recheck found + FIXED a latent 3rd blocker).** A recheck pass (recheck-rule) on the v1.1 file
caught that SCEN-031's frontmatter did NOT parse under mikefarah `yq` v4.45.4 — the EXACT parser
`scenario-setup.sh` uses — so `setup-SCEN-031.sh` would have aborted `SETUP_FAIL` at S001 BEFORE the run, a
silent 3rd blocker (pre-existing from v1.0). Two causes, both fixed: (1) two prerequisite list items whose value
STARTED with a backtick (`` `gh` ``, `` `tests/...` ``) — YAML rejects a plain scalar starting with the reserved
`` ` ``; rephrased to start with a word. (2) a prerequisite item containing `: ` (colon-space) —
`CONTINUITY SUBSTRATE ACTIVE: …` + `(KCRMSNL7 Family-A: …` — which yq parses as a nested map whose value then
starts with a backtick; swapped both `: ` to ` — `. yq now parses all 18 keys + resolves rewipe-list/dir-fixtures/
git-fixtures. NOTE: 4 of 31 scen files carry the same backtick-in-frontmatter pattern — the other 3 are a latent
setup-failure risk (follow-up, not this run).

**▶ 2026-07-22 (BOTH BLOCKERS RESOLVED by USER → SCEN-031 LAUNCHED).** USER resolved both prereqs: (A) template =
`fannijako/repo_template` (verified public + `isTemplate:true`) — wired into S002/S006/prereq, committed `04a3c8e1`;
(B) `AIM_GOVERNANCE_PASSWORD` confirmed present in `.env.local` (the forked runner sources it; I stay walled off per
Rule 12). **SCEN-031 is now RUNNING** — launched via the `scenario-runner` agent (background, isolated context) with
the full constraint set: Rule 0.b (brief MANAGER once, observe, never drive the workers), NEVER-STOP (fleet
self-sustains via janitor cron + server continuity daemon; runner forbidden any keep-alive), Rule 12 (password never
through a model), shared design/ board + column ownership, real GitHub side effects + full cleanup. **This run IS the
readiness proof** (USER's definition: ready = SCEN-031 runs and passes). NEXT = await the runner's verdict
(PASS/FAIL/PARTIAL/STUCK) + report path; on FAIL/PARTIAL, act on the finding at its CAUSE and rerun. The run is long
(multi-hour fleet build) and unsupervised by design — a completion notification will arrive.

**Origin.** After the governance-spec full-fidelity rewrite (TRDD-CJWC3JLU, complete), a standing
Stop-hook condition "make the ai-maestro harness ready" kept firing. "Ready" was undefined. The USER
selected "Define 'ready' criteria" (AskUserQuestion) but gave no criteria text and no confirmation is
arriving (unattended session). This TRDD is the DEFINITION the USER asked for, plus the SAFE, UN-GATED
subset of the resulting work that proceeds without further approval under the standing /go-on-yourself
mandate. **High-stakes / 🔒-gated items are NOT started here** — they stay as their own tier-appropriate
TRDDs and wait for the USER.

**The proposed "harness ready" bar (awaiting USER confirm/edit on the mutating items).** Status:
`✓`=verified · `~`=partial/by-design · `◻`=open · `?`=inferred-unverified · `🔒`=user-gated.

- **A · Governance-doc authority (spec-first inversion)**
  - `✓ A1` spec = complete authoritative source of truth (rewrite 0-miss ×6, conformance 14/14).
  - `~ A2` inversion propagated: catalog §0 ✓ + MANAGER #30 ✓; in-repo DEP overlays CLEAN. **8 cross-repo
    personas VERIFIED read-only (2026-07-22): 3 carry a STALE "GOVERNANCE-RULES.md … canonical / authoritative
    on conflict" claim** — `assistant-manager` (L116, v4.0.1), `architect` (L102, "authoritative on any
    conflict", v4.0.2), `integrator` (L449, v4.0.1); the other 5 (COS, orchestrator, programmer, maintainer,
    autonomous) CLEAN. Post-inversion the SPEC is the arbiter on conflict → those 3 name the WRONG one. (Also:
    all 3 cite catalog v4.0.1/4.0.2 vs current v4.7.1 → separately ~7 minors stale.) Correction = ISSUE/PR on
    3 repos = OUTWARD → **awaits USER go-ahead** (how-to-fix-issues-of-other-projects: state finding, wait for direction).
  - `✓ A3` conformance harness runs IN CI — `.github/workflows/ci.yml` runs `yarn test` (full vitest suite,
    incl. `governance-spec-conformance` + the 378 enforcement tests) on push **and** PR to main.
- **B · Rule enforcement ("all governance rules enforced")**
  - `✓ B1` **ENFORCEMENT VERIFIED (2026-07-22)** — the burned-lesson gap is test-enforced + passing:
    `sudo-guard-strict-agent-coverage.test.ts` **10/10** (every strict route DECLARED / owner-only / pending;
    unknown fails-CLOSED; R42 refuses cross-agent DRIVE, admits CONFIG; the 5 TRDD verbs deferred to
    `authorizeTrddVerb`); broader `sudo`+`authorization`+`portfolio` suite **378/378** green.
    `requireSudoToken`→`requireAidTitle` fails CLOSED on any undeclared strict route. No gap found.
  - `~ B2` R42 no-agent-drives-another — API-enforced; tmux hole = known honest limit (OS isolation
    TRDD-a1019073). Bar decision: accept the documented limit vs require isolation.
  - `~ B3` R41/R49 approval+refusal — server-authz + token-verify shipped; `OPERATIONS_REQUIRING_TOKEN` off
    by deliberate governance choice. Bar decision: keep off vs flip on (separate blast-radius decision).
- **C · Agent-workdir invariants ("agents safely rely on the harness")**
  - `✓ C1` agent-invariant registry + watchdog LIVE at boot — `server.mjs:1911-1962` runs a boot sweep over
    the fleet + `startAgentInvariantsWatchdog`.
  - `✓ C2` DEP rules seeded read-only + self-healing — `lib/agent-rules-seed.ts` (`ensureAgentRules`) +
    `lib/agent-invariants.ts` (dep-rules row: create·wake·periodic).
- **D/E · Fleet continuity + remote access** (separately-tracked program, NOT this TRDD): KCRMSNL7,
  CHN16JXZ, OC9ELGSO/#40, P7XKV3N9 (🔒), OAuth (🔒 R16), MAESTRO console-presence (🔒 R48).
- **F · No capability gaps** — `~ F1` coverage scan DONE (2026-07-22): 237 route files / 223 test files;
  **33 high-risk MUTATING routes (agents/teams/governance/sessions/auth) have NO test referencing their path**
  (CANDIDATE gaps — a coarse path-match; some may be covered by import-based tests → needs per-route confirm).
  Security-sensitive subset worth REAL tests: `auth/webauthn/{register,authenticate,credentials}`,
  `auth/{setup-init,setup-verify,logout}`, `governance/{password/invalidate,email/verify,email/autodetect,
  recovery-optout,user,trust}`, `sessions/{create,restore}`, `agents/{register,create-from-toml,docker/create,
  startup}`. NB: the strict-route GUARD layer IS covered (B1); this is about per-HANDLER behavior tests.
  **CONFIRMED (2026-07-22, import-based re-check):** all 17 have ZERO route-level test file (the high
  seg-mention counts are generic-word noise, not coverage). Dependency split, and WHY neither half is an
  unattended win: HIGH-VALUE routes need LIVE deps for a REAL (non-mocked) test — webauthn=crypto,
  auth-setup=OS-notify+crypto, `password/invalidate`=notify+console-peer, sessions=tmux, docker=docker → per
  the no-mocking rule these need the USER to activate services; the thin-wrapper routes (normalize-hosts →
  `agents-directory-service`, create-from-toml, email/autodetect) wrap services doing file I/O → need real
  registry/config FIXTURES. Closing F1 = a scoped test-task program, NOT blind mock-writing.
  **PARTIAL CLOSURE (2026-07-22, `be21fbc1`): 2 of 17 done** — real non-mocked tests for `normalize-hosts`
  (3 tests, `tests/unit/agents-directory-host-normalization.test.ts`) + `email/autodetect` (3 tests,
  `tests/unit/smtp-autodetect-route.test.ts`), 6/6 pass; `create-from-toml` skipped (live claude-CLI
  plugin-gen toolchain). The remaining ~14 (webauthn, auth-setup, password/invalidate, sessions, docker, …)
  need LIVE services (crypto/tmux/docker/notify) for a real test → **USER to activate the services**.

**RECOMMENDED TIGHT BAR (un-gated, high-value):** A2 (propagation issues) + A3 (verify/wire CI + coverage) +
B1 (enforcement-verification) + C1/C2 (confirm watchdog + DEP self-heal live). D/E excluded.

**✅ UN-GATED VERIFICATION DONE (2026-07-22).** B1/A3/C1/C2 all VERIFIED GREEN — evidence
`reports/harness-readiness/20260722_210500+0200-b1-a3-c1-c2-verification.md`. **No enforcement gap found,
nothing needed fixing:** the strict-route/sudo/authorization layer is test-enforced (378 green) + fails
CLOSED, the conformance test is CI-gated on every PR to main, and the invariant watchdog + DEP self-heal are
boot-active. So the spec-first authority is not just documented — its enforcement + invariants are proven.

**NEXT ACTION (the one remaining un-gated item, but OUTWARD-FACING → needs USER go-ahead):** A2 — the
inversion has not reached the 8 role-plugin personas (separate Emasoft repos). First CHEAPLY check whether
the IN-REPO DEP overlays (`rules/aimaestro/*.md`) still call the catalog canonical (read-only, safe, do
now); then, for the cross-repo personas, filing correction ISSUES is the allowed method BUT creating issues
on other repos is an outward action — **confirm with the USER before filing.** All mutating/gated items
(B2/B3 decisions, conformance-test extension, the D/E fleet program) still await the USER's confirmation of
the bar.

**SUPERSEDED — do NOT carry forward:** none yet.

## Verify
Each un-gated item lands evidence in `reports/` and, where a real defect is found, a tier-appropriate fix
TRDD. The mutating items (CI wiring, any enforcement fix) do NOT auto-apply — they wait on the USER's
confirmation of the bar.
