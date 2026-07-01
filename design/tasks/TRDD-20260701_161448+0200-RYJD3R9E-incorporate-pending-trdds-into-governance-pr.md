---
trdd-id: RYJD3R9E
title: Incorporate ALL pending TRDDs into the governance PR — decisions, scope, exclusions
column: dev
created: 2026-07-01T16:14:48+0200
updated: 2026-07-01T16:14:48+0200
current-owner: main
assignee: main
priority: 1
severity: MEDIUM
effort: XL
labels: [governance-pr, incorporation, meta, security, planning]
task-type: infra
parent-trdd: null
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
release-via: none
delivery: pull-request
target-branch: main
feature-branch: governance-rules
merge-strategy: squash
test-requirements: [typecheck, unit]
audit-requirements: []
review-requirements: [human-review]
impacts: [public-api, ci-pipeline]
runtime-targets: [macos, linux]
external-refs: []
---

# TRDD-RYJD3R9E — Incorporate all pending TRDDs into the governance PR

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-01

This TRDD is the DURABLE RECORD of the USER's 2026-07-01 directives (per "write
everything I said down in TRDD"). It governs the incorporation program.

### USER directives captured (2026-07-01, verbatim intent)

1. **Incorporate EVERYTHING into the governance PR now.** "all the changes needs to be
   merged into the governance PR anyway. Because it is useless to review code that will
   change. it is better to incorporate ALL the changes now. So, with the exception of the
   TRDD about signed code verification, all pending TRDD must be done and merged into the
   governance PR main branch and become part of the PR." → destination = branch
   `governance-rules` (the PR). No more separate feature-branch/review for these.
2. **Scenario calibration token-safety gate.** "the calibration will risk wasting tokens?
   if yes, then unless you put some safeguards and caps to token usage, do not go on. if
   not, then proceed." → ANSWER (mine): YES it is token-expensive (measured ~63M tokens ≈
   $40 PER scenario, SCEN-020/TBGGUA2V). Therefore per the USER's own rule + Message 1's
   logic ("useless to review/test code that will change"): **DEFER all scenario testing
   until AFTER the incorporation is complete + the PR is stable; then run it ONCE, hard-
   capped.** Do NOT run calibration or any scenario now.
3. **Plan-mode, no questions, decide myself, security first.** "be sure to write everything
   i said down in TRDD and be sure to use plan mode to do all those implementations. but
   without any ask question to me. you must evaluate the best choice by yourself. you know
   the target, find the best way to achieve it. security is always king." → I use plan mode
   for the implementation plan (presented via ExitPlanMode, not AskUserQuestion), make ALL
   decisions myself, and let SECURITY be the tie-breaker on every choice.

### Exclusions (NOT part of this incorporation)

- **`c94c60e9`** (design/proposals/, "script SSOT + signing-readiness") = the "signed code
  verification" TRDD the USER named. **EXCLUDED** — stays a proposal.
- **`OZZB3DJA`** (janitor→server migration) = FUTURE, gated on the janitor's Claude
  finalizing + testing the janitor functions (the USER's own earlier directive). EXCLUDED
  from this incorporation; stays `backburner`.

### Decisions I own (no questions asked, per directive 3)

- **Branch strategy:** `feat/code-analysis-tooling` is 7 commits ahead / 0 behind
  `governance-rules` → fast-forward-clean. Merge it into `governance-rules`, then do the
  remaining actionable TRDDs directly on `governance-rules`, so everything lands in the PR.
- **Scenario testing (directive 2):** DEFERRED with hard caps (single-scenario pilot, token
  ceiling, kill-switch per SCENARIOS_TESTS_RULES.md Rule 13) — only AFTER incorporation.
- **Security first:** any pending SECURITY hardening (the 3 non-excluded proposals
  15ff13ae / a6d93b9c / bb344037, plus any security-relevant remediation) is prioritized and
  implemented with fail-fast, no relaxed gates.
- **Push:** "become part of the PR" requires pushing `governance-rules` to the fork — this is
  the authorized end-state; it is the final step of the approved plan (surfaced at
  ExitPlanMode), not a separate ask.

### Derived TRDDs (EHT) — MUST be authored alongside the primaries (USER directive 4, 2026-07-01)

Every primary change spawns Effects-Handling-Task (EHT / derived) TRDDs for its downstream
consequences — per the global "todo lists must include DERIVED tasks" rule. The plan (plan
mode) enumerates the derived TRDDs per primary and links them via the v2 `eht:` field. The
USER-named examples:

- **Governance/golden-rule update** — this project has NO PRRD; its rule source is
  `docs/GOVERNANCE-RULES.md` (R1-R40). The "update PRRD golden rules" derived task maps to
  updating GOVERNANCE-RULES.md (golden/governance rules) to adapt to every incorporated change.
- **Governance-rules adaptation** — adjust GOVERNANCE-RULES.md wherever a new feature
  (converter clients, future server-side janitor APIs, etc.) changes a rule's assumptions.
- **Scenario-test files** — update ALL 27 `tests/scenarios/SCEN-*.scen.md` to the current
  governance rules (continues the handoff's directive-B revision). Update, do NOT run yet
  (scenario RUNS are token-gated per directive 2).
- **Core-plugin skills → janitor-replacement scripts** — DERIVED of `OZZB3DJA`: when janitor
  functions become ai-maestro server APIs behind `~/.local/bin` scripts, the core
  `ai-maestro-plugin` skills must reference the new scripts. **Cross-repo** (ai-maestro-plugin
  is a separate repo) → coordinate/PR, NOT edited from here. Gated on OZZB3DJA (future).
- **Installer + distribution** — `install-messaging.sh`, `install-code-analysis-tooling.sh`,
  `distribute-code-analysis-skill.sh`, and every new-feature install step (incl. new
  `~/.local/bin` script wrappers for the future server APIs).
- **Security + approval code** — every NEW server API (esp. the janitor→server calls copied
  from the janitor) MUST be registered in `security-registry.json` (strict where destructive),
  the approval tiers, and sudo-mode; and MUST pass the 5 recurring authz-hole patterns
  (memory `governance-r26-r40-security-model`, audit `e54e2de4`): the handler
  self-authenticates (the `/api` middleware is a credential-SHAPE check only), never derive
  identity from a client body field, headless-router auth parity, no IDOR, sudo bound to
  op+subject. **Security is king — no relaxed gates, fail-fast.**
- **Cross-cutting:** docs (README, CLAUDE.md, REQUIREMENTS, API-CHANGES.md),
  `lib/ecosystem-constants.ts` + `scripts/ecosystem-config.sh`, unit/integration tests per new
  API/feature, headless-router parity for every new route.

**There are DOZENS of derived TRDDs.** The plan (plan mode) enumerates them ALL exhaustively,
grouped under their primary and linked via `eht:` — I own the enumeration (USER directive 5:
"think all the derived TRDD by yourself. there are dozens").

Each derived TRDD carries its own verification. Blocked / cross-repo / future derived TRDDs
are captured + flagged, never forced.

### NEXT ACTION

1. (running) assessment fork `a493a04e` → per-TRDD state/remaining/blocked/security/effort.
2. Enter PLAN MODE → produce the comprehensive incorporation plan (per-TRDD approach + order
   + branch merge + scenario-defer + security-first + exclusions) → ExitPlanMode for go.
3. On go: execute, tsc/vitest-gated, commit-often, then merge → governance-rules → push to
   the PR.

### Durable artifacts

- `reports/trdd-incorporation-assessment/*-assessment.md` (fork a493a04e output — read before planning).
- `reports/converter-copilot-kilocode/20260701_160307+0200-impl-spec.md` (S4YA67F5 build spec).

## Scope

Every non-terminal TRDD in `design/tasks/` + the 3 non-excluded security proposals get DONE
and merged into `governance-rules` (the PR), EXCEPT `c94c60e9` (signed-code) and `OZZB3DJA`
(janitor-future). Genuinely-blocked items (needing a live authenticated agent, an external
dependency, or a MANAGER/USER-only decision) are surfaced in the plan with exactly what
unblocks them — they are not silently dropped, but they also cannot be forced.

## Acceptance

- All actionable pending TRDDs implemented on `governance-rules`, tsc-clean + tests green.
- The 2 exclusions remain out; genuinely-blocked items are documented with their unblock path.
- Scenario testing deferred (not run) until post-incorporation, then capped.
- `governance-rules` carries the full body of work as the PR; pushed on plan approval.
