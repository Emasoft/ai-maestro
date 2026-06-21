---
trdd-id: f181a4ae-36a2-4524-abb1-3eab554999d9
title: Package scenario-UI-testing as the ai-maestro-web-scenario-tester role-plugin (dev-browser integrated)
column: dev
created: 2026-06-21T22:46:13+0200
updated: 2026-06-22T00:21:40+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 2
severity: MEDIUM
task-type: feature
release-via: publish
delivery: pull-request
publish-target: ai-maestro-plugins
relevant-rules: []
parent-trdd: TRDD-903b7a20
labels: [scenario-testing, plugin, dev-browser, reusable-harness]
impacts: [install-script]
external-refs: []
---

# TRDD-f181a4ae — Standalone scenario-UI-testing plugin

## ⏵ STATE — READ THIS FIRST ON RESUME — 2026-06-21

**⚠ PIVOT 2026-06-22 (USER directive) — this is now an AI-MAESTRO ROLE-PLUGIN, not a generic harness.**
The USER specified: repo `Emasoft/ai-maestro-web-scenario-tester`; a ROLE-plugin whose main-agent is
`web-scenario-tester-main-agent`; skills + subagents prefixed `amwst-`. Research done (2 opus agents) +
captured durably in the **[[role-plugin-structure-spec]]** wikimem + `reports/web-scenario-tester/`
(`*-pss-agent-toml-spec.md`, `*-real-role-plugin-anatomy.md`). Key consequences:
1. **Quad-identity forces the PLUGIN name = `web-scenario-tester`** (≠ the repo `ai-maestro-web-scenario-tester`):
   main-agent `<P>-main-agent` ⟹ `<P>` = `web-scenario-tester`. Repo name is independent of plugin name.
2. **The shipped `.agent.toml` uses the role-plugin format** (`[agent]` + `compatible-titles`/`compatible-clients`/
   `prefix`/`main_agent` + nested `[agent.persona]`/`[agent.skills].bundled`), NOT the PSS profile format
   (`[agent].path` + top-level `[skills]` tiers). The two are mutually-invalid; PSS is a creation-time artifact.
3. **`prefix = "amwst-"`** (kebab for skills/commands/subagents/hooks; `amwst_` underscore for scripts); the
   main-agent is the UNPREFIXED `web-scenario-tester-main-agent`.
4. **TITLE RESOLVED (USER 2026-06-22): `compatible-titles = ["MEMBER"]`** — "a scenario-tester agent is
   a member of the team." Build is UNBLOCKED.
Decision-1 below (dev-browser approach B) STILL HOLDS. Decision-2's 'generic harness vs project-specific'
framing is SUPERSEDED by the role-plugin shape (the dev-browser dependency + the 14 scenario rules still
apply, now bundled INTO the role-plugin as `amwst-` skills + the main-agent persona).

**PLAN (original generic-harness framing — partly SUPERSEDED by the pivot above).** From the user's request:
package the scenario-UI-testing skills into a separate plugin, integrate the dev-browser logic + all the
scenario rules. Two delegated opus design agents investigated; this TRDD records the decisions.

**BUILD METHOD (USER-specified 2026-06-22) — how to package + publish:**
- **Location:** build in a LOCAL folder `~/Code/ai-maestro-web-scenario-tester/` (USER-chosen; a real dev
  checkout, NOT /tmp). PLUGIN name = `web-scenario-tester`; REPO/dir = `ai-maestro-web-scenario-tester`.
- **Packaging recipe** (generic plugin-build method — see the [[plugin-build-from-extensions]] USER memory,
  VERIFIED against the Anthropic plugin docs): COPY every scenario extension (from BOTH `.claude/` AND
  `tests/scenarios/`, + verify nothing stranded in `~/.claude/`) into the plugin; de-path absolute paths →
  `${CLAUDE_PLUGIN_ROOT}/…` (ephemeral, read-only — bundled scripts/`bin/`); first-run dep installs →
  `${CLAUDE_PLUGIN_DATA}` (persistent); precompiled binaries → `bin/`; make cross-platform; write README +
  optional docs/; declare plugin→plugin `dependencies` in plugin.json (grep every file for other-plugin usage —
  at minimum `dev-browser`; check chrome-devtools / llm-externalizer / pss / cpv).
- **Inventory so far (`.claude/`, project-scope):** 4 agents (scenario-runner, scenario-improvement-implementer,
  parallel-tester-agent, parallel-worker-agent); 6 skills (create-scenario, edit-scenario,
  implement-scenarios-proposals, improve-scenario, run-scenarios-batch, scenarios-rules); 1 rule; 3 scripts.
  STILL TO INVENTORY: `tests/scenarios/` (SCENARIOS_TESTS_RULES.md, scripts/{state-machine-tick,scenario-setup,
  scenario-restore,compress-screenshots}.sh, dev-browser-helpers/aim-helpers.sh, example SCEN-*.scen.md) + the
  3 gaps (run-scenario-test skill, init-scenarios-folder.sh, scenarios.config.json).
- **Publish (USER-gated, LAST step):** use the **CPV plugin** (`claude-plugins-validation`) for BOTH the
  publish-pipeline CONFIG (publish.py + CI workflows + git hooks — via plugin-creator / canonical-pipeline /
  setup-plugin-repo) AND the publish into the `Emasoft/ai-maestro-plugins` marketplace (CPV's publish agent).
  Do NOT hand-roll the pipeline; do NOT publish without USER approval.

**Durable evidence:**
- `reports/scenario-plugin-devbrowser/20260621_223542+0200-devbrowser-integration-options.md`
- `reports/scenario-plugin-surface/20260621_223640+0200-scenario-plugin-structure.md`

## Decision 1 — dev-browser integration: APPROACH B (depend, don't vendor)

dev-browser is **MIT-licensed**, ~7 MB / 481 files: a Node CLI (`bin/dev-browser.js`) + a
daemon (`daemon/src/*.ts`, browser-manager/protocol/lock) + a QuickJS sandbox + a
Chromium/Playwright runtime. The study recommends **B**: the new plugin **declares a dependency
on the dev-browser plugin** and bundles ONLY the scenario-specific glue (the `aim-helpers.sh`
pattern, page/headless conventions, screenshot+report rules) — NOT a 7 MB vendored copy.

- **Why not A (vendor all):** 7 MB of third-party TS + a Chromium runtime to maintain + keep in
  sync; MIT permits it but the maintenance/update-drift cost is high for no self-containment win
  (Chromium must be installed regardless).
- **Why not C (reimpl):** re-writing the sandbox/daemon is a large, bug-prone effort.
- **"Integrate the dev-browser logic"** is satisfied by B = the plugin OWNS the scenario-driving
  layer (rules + runner + helpers + report/screenshot conventions) on TOP of dev-browser as the
  browser engine, declared as a dependency so installing the scenario plugin pulls dev-browser.
  (If the USER wants true self-containment/vendoring despite the cost, that is a Tier-2 decision
  to confirm — flag it.)

## Decision 2 — GENERIC harness plugin vs PROJECT-SPECIFIC (stays in ai-maestro)

~50 assets mapped. Clean split so the plugin is reusable by ANY project while AI Maestro keeps
its own scenarios:

**GENERIC → the new plugin:**
- `SCENARIOS_TESTS_RULES.md` → `references/` canonical rules doc (the 14 rules + scenario file
  format + the autonomous-batch cron protocol).
- The 4 agents (`scenario-runner`, `scenario-improvement-implementer`, `parallel-tester`,
  `parallel-worker`) — **parameterized** (no hard-coded AI-Maestro paths/URLs).
- Skills: the existing `run-scenarios-batch` (+ the 5-6 batch/improve skills) **plus a NEW
  `run-scenario` skill** (the `run-scenario-test` one CLAUDE.md references is MISSING — gap below).
- Shared engine scripts (`state-machine-tick.sh`, `scenario-setup.sh`/`-restore.sh`,
  `compress-screenshots.sh`) + bootstrap + a write-guard TEMPLATE; 2-3 example scenarios.

**PROJECT-SPECIFIC → stays in `ai-maestro`:**
- The 27 `SCEN-*.scen.md` + their 54 setup/cleanup wrappers.
- `aim-helpers.sh` (AI-Maestro login/sudo/CRUD flow).
- The concrete write-guard allowlist.

## Gaps the design surfaced (fix as part of the build)
1. **`run-scenario-test` skill is MISSING** — CLAUDE.md references `~/.claude/skills/run-scenario-test`
   but only a stale backup exists. Recreate it as the plugin's `run-scenario` skill.
2. **`init-scenarios-folder.sh` MISSING** — referenced, never created.
3. **`scenarios.config.json` never created** — the per-project config the agents read.

## The 4 hard AI-Maestro deps to PARAMETERIZE (move to `scenarios.config.json`)
1. browser-instance name (`ai-maestro-scenarios`).
2. dashboard URL (`http://localhost:23000`).
3. the login/sudo/CRUD helper flow (project supplies `aim-helpers.sh`-equivalent).
4. the write-guard allowlist (project-specific paths).

## Hard constraint (Claude Code platform)
Plugin-shipped agents **cannot carry a `hooks:` field** (security restriction). The
subagent write-guard (the project's IRON rule) must be wired via the plugin's **plugin-scoped
`hooks/hooks.json`**, not per-agent frontmatter — OR documented as a project-scoped shadow the
consuming project installs. Carry the guard as a TEMPLATE + install instructions.

## Build plan (phased; after the audit remediation — TRDD-47a35ba2 — lands)
1. Scaffold the plugin repo (`.claude-plugin/plugin.json`, declare the dev-browser dep, MIT +
   attribution); skills/ agents/ commands/ hooks/ scripts/ references/.
2. Move+parameterize the 4 agents + the batch skills; author the new `run-scenario` skill;
   fill the 3 gaps (run-scenario-test, init-scenarios-folder.sh, scenarios.config.json).
3. Port the engine scripts generically; ship the write-guard template via `hooks/hooks.json`.
4. Ship 2-3 example scenarios; CPV `--strict` → `publish.py`.
5. In `ai-maestro`: repoint `tests/scenarios/` to consume the plugin; keep the 27 SCEN files +
   `aim-helpers.sh` + the concrete write-guard locally; add `scenarios.config.json`.

## Scope / non-goals
- Approach B (no 7 MB vendoring) unless the USER explicitly chooses A.
- Do NOT break the existing in-repo scenario flow during extraction (repoint, don't delete).
- Publish is a separate, USER-gated step (release-via: publish).
