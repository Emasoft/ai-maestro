---
trdd-id: TBGGUA2V
title: Overnight autonomous supervision — token validation, universal rules, ai-maestro API/UI/governance/install, cross-repo coordination
column: dev
created: 2026-06-24T03:22:18+0200
updated: 2026-06-24T04:11:18+0200
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

## ⏵ STATE UPDATE — 2026-06-24T03:52+0200 — environmental saturation halts heavy autonomous work (READ THIS FIRST)

**DECISIVE FINDING: 3/3 background agents thrashed** (aegis×2 install audits + spark×1 P5 code task) — identical signature "autocompact thrashing: context refilled to the limit within 3 turns, 3× in a row"; P5 ran ~10 min / 20 tools then died with no output. Root cause = **ENVIRONMENTAL CONTEXT SATURATION** (dozens of connected MCP servers + hundreds of skills + the harness floor inflate every agent's BASE past the window, so any real read tips it into a thrash loop). This is the SAME root cause as the week-of-tokens blowup. The main session is also compacting nearly every turn.

**CONSEQUENCE:** heavy autonomous engineering (P2/P3/P5/plugin-port — anything needing an agent or a large read) is NOT safely doable in this environment tonight; retrying just burns tokens (violates the prime directive). DETERMINISTIC tools (shellcheck, grep) do NOT thrash and were the only viable execution mode — so I stopped launching agents after 3/3 failures.

**DONE + verified tonight (committed, no push):**
- P0 (commit `a5cffe3a`): token kill-switch `batch-budget-guard.sh` (fail-closed; verified) + `~/.claude/rules/token-economy-agents-and-scenarios.md` (universal rule) + this TRDD.
- L1–L9 token levers (commit `c4d65da6`, earlier this session).
- **P1 install security ("above all") — VERIFIED CLEAN on the high-risk surfaces** (deterministic): shell installers shellcheck-clean (0 err/warn, 9 style notes); TS install/session routes (`role-plugins/install`, `[id]/session`, `global-elements/install-skill`, `[id]/install-skills`) have NO command-interpolation injection, ARE auth-gated (`lib/route-auth` `enforceSystemOwner`/`enforceMaestro`), name-validated + path-traversal-guarded. A grep "auth=0" scare was a FALSE POSITIVE (disproved by reading). Evidence: `reports/install-security-audit/*`. DEFERRED: deep audit of `element-management-service.ts` (7303 lines) install-gates (needs an agent → thrash).
- Scenario-tester plugin (`f181a4ae`): publish HOLD **CLEARED** (CPV is now 2.145.1 > the 2.141.1 gate). Port L1–L9 → /tmp clone → `publish.py` is READY but NOT done (needs agents/large work → blocked by saturation).
- **P2 API curated-command injection — DONE** (commits `3bf491bb` allowlist+test, `27d17e03` route `commandKey` wiring, `aede643d` docs). Done DETERMINISTICALLY in-session (no agents): `lib/agent-commands.ts` allowlist (8 keys: reload-plugins/compact/clear/janitor-*) → PATCH `/api/agents/[id]/session` accepts a KEY → sends only the fixed literal slash-command (injection-proof by construction). tsc 0 / vitest 5/5 / eslint 0.
- **P3 API richer agent-state — DONE** (this turn): hook `classifyStopFailure` on StopFailure → writes `notificationType: rate_limited|api_error` (reuses the fully-plumbed channel, no new fields); `resolveAgentStatus` gains the 2 visual states (purple/red, ranked above permission/idle). Made the hook `require`-safe (main-guard + export) so the classifier is unit-tested; removed a dead `os` require. Context-usage(%) honestly DEFERRED (no non-fabricated hook signal; PreCompact→'compacting' is the existing pressure signal). tsc 0 / vitest 9/9 / eslint 0. Docs in API-CHANGES.md.

**KEY METHOD CORRECTION (supersedes the 03:52 "BLOCKED-BY-ENVIRONMENT" verdict for scoped work):** small, bounded backend work IS safely doable in-session via DETERMINISTIC self-authored edits gated by tsc/vitest/eslint. The thrash verdict applies to AGENT-based broad work (3/3 thrashed), NOT to scoped main-session edits. P2 + P3 prove the pattern (each ~a handful of edits + green gates + commit, no blowup).

**PHASE STATUS:** P0/P1/P2/P3 = ✅ DONE. P4/P5/P6/P7 = pending (P5 + any broad multi-file refactor still want a lean env or a careful deterministic plan; P4/P6/P7 partly doable in-session). P8 scenarios = still GATED (server down + kill-switch enabled=false/validated=false).

**RECOMMENDATION (the real #1 token lever):** the env's MCP/skill/rule load is the root cause of BOTH the blowup AND the agent thrash. Trimming it (disable unused MCP servers; prune the skill/rule set loaded per session) is the highest-impact token fix AND the precondition for reliable autonomous agent work. Until then: do heavy work in fresh lean sessions; deterministic tools first.

**NEXT ACTION on resume:** P2 + P3 DONE. Continue the deterministic in-session pattern: (1) P4 — install/extensions API vs latest Claude changelog (scoped reads, additive edits); (2) P6 — UI surfacing of the P2 curated commands + the P3 states in AgentProfile/AgentBadge (UI files are larger — scope carefully, gate by build); (3) P5 — other-client graceful degradation (lib/converter emitters: hard-throw → `warnings.lossyField` pattern, like emitters/kiro.ts); (4) scenario-tester plugin port+publish (heavy/multi-file → best with user available); (5) P8 LAST, with the kill-switch validated+armed + server up.

---

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
