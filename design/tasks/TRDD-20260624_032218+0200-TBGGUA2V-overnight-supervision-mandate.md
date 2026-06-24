---
trdd-id: TBGGUA2V
title: Overnight autonomous supervision — token validation, universal rules, ai-maestro API/UI/governance/install, cross-repo coordination
column: dev
created: 2026-06-24T03:22:18+0200
updated: 2026-06-24T03:22:18+0200
current-owner: claude-opus-session
assignee: claude-opus-session
priority: 1
severity: HIGH
effort: XL
labels: [tokens, scenarios, api, ui, governance, install, coordination, overnight]
task-type: infra
parent-trdd: null
npt: []
eht: []
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
must-pass-tests-before-merge: true
test-requirements: [typecheck, lint, integration]
audit-requirements: [security-scan]
review-requirements: [human-review]
runtime-targets: [macos]
impacts: [public-api, install-script]
attempts: 0
last-test-result: not-run
implementation-commits: []
external-refs: []
---

# TRDD-TBGGUA2V — Overnight autonomous supervision mandate

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-06-24T03:22+0200

**Context.** User went to sleep ~03:20 and gave a broad `/go-on-yourself`-style
overnight mandate (verbatim list in §Mandate). Overriding constraint, stated
twice across the session: **ZERO risk of another week-of-tokens blowup.** The
week-13B-token blowup was an **Opus** scenario batch (vision + snapshot
accumulation + no cap). The fix shipped this session is the L1–L9 curated
Sonnet[1m] runner (commit `c4d65da6`).

**Hard constraints (do NOT violate):**
- ai-maestro repo = **commit only, NEVER push** (wait for user). Other repos =
  issues / fork-PRs, **no unsupervised publish/release**.
- Never `git add -A/.`/`--all` — stage by name. git id Emasoft /
  713559+Emasoft@users.noreply.github.com.
- Never edit another project's source directly (ai-maestro-plugin, role-plugins,
  scenario-tester plugin live in their own repos → PR or issue).
- Keep security STRICT — never relax a gate. Integrate, don't delete. TRDD per
  change. Commit often with WHY.
- governance_password: mYkri1-xoxrap-gogtan (only if a UI flow needs it).

**Current state of each component:**
- Token levers L1–L9: ✅ built + committed (`c4d65da6`, `70266bde`, `ea32110a`).
  NOT yet validated in a live run.
- Universal token rule: ✅ written → `~/.claude/rules/token-economy-agents-and-scenarios.md`.
- Batch kill-switch: ✅ built → `tests/scenarios/scripts/lean/batch-budget-guard.sh`
  + `tests/scenarios/state/batch-budget.json` (enabled=false, validated=false —
  two gates closed; fail-closed verified).
- Dashboard server: ❌ DOWN at start (`/api/sessions` http=000). No scenario
  cron armed → zero scenarios firing. Scenario testing is therefore BLOCKED on
  bringing the server up — do that only with validation + caps.

**NEXT ACTION (the one concrete next step):** Commit this TRDD + the kill-switch
(by name, NO push). Then proceed through the phases below in priority order,
each as its own bounded unit. Do the cheap/safe engineering (install security,
API additions) via bounded Sonnet agents (write-guarded, commit-not-push)
BEFORE touching scenarios. Bring up the server + validate ONE scenario + record
its token cost + flip the two budget gates BEFORE any batch.

**SUPERSEDED — do NOT carry forward:** the earlier "Phase 2 gate / batch HALTED,
awaiting explicit go" status is LIFTED — the user authorized completing the
scenario testing, but CONDITIONED on validated low per-scenario cost + caps. The
gate is now the budget guard, not a manual hold.

**Durable artifacts to read before acting:**
- `design/tasks/TRDD-…-N1FYP2AW-…md` — the token architecture + L1–L9 + the
  full-week ledger (scenarios are 7%; main sessions 59%; harness floor ~27%).
- `tests/scenarios/state/OVERNIGHT-RESUME.md` + `autonomous-batch-state.json` —
  prior batch infra (dormant).
- `~/.claude/rules/token-economy-agents-and-scenarios.md` — the universal rule.

## Mandate (user's words, 2026-06-24 ~03:20, paraphrased to a checklist)

1. **Validate** the token-saving techniques (L1–L9).
2. **Update the rules** + **make the token-saving techniques universal rules**.
3. **Update the scenario-tester plugin** with the L1–L9 changes.
4. **Complete the scenario testing** — only once SURE there's no week-of-tokens risk.
5. **Coordinate with the MANAGER claude and JANITOR claude via GitHub issues.**
6. **Supervise `ai-maestro-plugin`** (core, second only to the janitor).
7. **Keep security strict.** Improve **UI**, **governance**, **API**, **agent controls**:
   - API: inject arbitrary commands into tmux (reload-plugins, compact,
     janitor-arm, janitor-disarm, …).
   - API: richer agent state — not just idle/waiting/ask, but **api-error,
     rate-limited, context-usage**, etc.
   - Install/extensions API current with latest Claude changelog + Anthropic specs.
   - Make other clients (codex, gemini, kilo, opencode, …) work even when not all
     Claude features are available (surrogates later).
   - **Above all: make the install flawless and secure** (signed binaries
     deferred to a future PR — out of scope tonight).

## Phases (priority order; each is its own bounded unit + sub-TRDD where non-trivial)

- **P0 — Safety scaffold (DONE this turn):** universal token rule; budget
  kill-switch (guard + config, fail-closed); this TRDD. Commit (no push).
- **P1 — Install flawless + secure ("above all"):** audit the install path
  (`install-messaging.sh`, remote-install, scope/secret handling) → fix safe
  issues, FLAG anything needing human (rotation/destructive). Bounded Sonnet
  agent, write-guarded, commit-not-push. Sub-TRDD.
- **P2 — API: tmux command injection** (reload-plugins/compact/janitor-arm/…)
  via the immutable CLI script layer (NOT raw API in plugins). Sub-TRDD.
- **P3 — API: richer agent state** (api-error / rate-limited / context-usage).
  Sub-TRDD.
- **P4 — Install/extensions API ↔ latest Claude changelog + Anthropic specs**
  (use the claude-api skill as source of truth). Sub-TRDD.
- **P5 — Other-client graceful degradation** (codex/gemini/kilo/opencode feature
  gaps degrade, not crash). Sub-TRDD.
- **P6 — UI + governance polish**, security strict throughout. Sub-TRDD(s).
- **P7 — Cross-repo coordination via GitHub issues:** MANAGER (#35,#45) +
  JANITOR; supervise `ai-maestro-plugin`; update scenario-tester plugin (locate
  it; PR). Issues/PRs only — no unsupervised publish.
- **P8 — Scenario testing (LAST, GATED):** bring server up; run ONE scenario
  through the curated runner; record token cost; `batch-budget-guard.sh validate
  <toks>` + `arm <hours>`; only then run a capped, throttled batch. If cost is
  not provably low, STOP and leave a report.

## Safety stance (why the order)

The mandate's biggest line items by token cost are NOT the scenario-runner (7%
of the week). Engineering work (P1–P6) is editing + committing — bounded,
delegatable to fresh Sonnet agents, no blowup risk. Scenario execution (P8) is
the ONLY blowup vector, so it is gated behind the budget guard's two closed
gates + a measured per-scenario cost. The marathon main session is itself the
most expensive thing running (it re-reads its huge transcript every turn), so
heavy code work is delegated to clean-base bounded agents, not done inline.

## Approval log
- 2026-06-24T03:22:18+0200 — Authored under the overnight `/go-on-yourself`
  mandate. Tier-0 self-authored coordination TRDD. ai-maestro = commit, no push.
