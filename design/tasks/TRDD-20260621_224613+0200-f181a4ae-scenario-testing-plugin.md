---
trdd-id: f181a4ae-36a2-4524-abb1-3eab554999d9
title: Package scenario-UI-testing as the ai-maestro-web-scenario-tester role-plugin (dev-browser integrated)
column: blocked
pre-block-column: published
created: 2026-06-21T22:46:13+0200
updated: 2026-07-10T06:23:25+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 2
severity: MEDIUM
task-type: feature
release-via: publish
delivery: pull-request
publish-target: ai-maestro-plugins
published-version: 0.1.3
published-at: 2026-07-08T18:48:08+0200
relevant-rules: []
parent-trdd: TRDD-903b7a20
eht: [TRDD-91LLU879, TRDD-44RGLOO8]
blocked-by: [TRDD-44RGLOO8]
labels: [scenario-testing, plugin, dev-browser, reusable-harness]
impacts: [install-script]
external-refs: []
---

# TRDD-f181a4ae — Standalone scenario-UI-testing plugin

## ⏵ STATE — READ THIS FIRST ON RESUME — 2026-06-21

### ⏵ UPDATE 2026-07-10T06:23 — the first hole closed; a second, worse one opened

`TRDD-91LLU879` (the repoint EHT) is **done and archived**. Its part 3 settled as
**keep the copy** — the plugin duplicates 6 of this repo's 106 tracked scenario
files, is not installed here, and may never be enabled at project scope. The reason
is written down in that TRDD; nothing was moved.

Closing it did **not** unblock this TRDD, because settling part 3 required diffing
the plugin's shipped rules doc against ours, and that diff found the publish had
carried the **live governance credential** into a public, installable, tagged
artifact — `references/SCENARIOS_TESTS_RULES.md` at `v0.1.3`, in the public repo
`Emasoft/ai-maestro-web-scenario-tester`. The literal is deliberately not quoted
anywhere in this corpus.

That is a hole this TRDD's own change opened, so it is this TRDD's platelet:
**`TRDD-44RGLOO8`** (`design/proposals/`, Tier 3, blocked on the USER's rotation via
`TRDD-E9BZ5P7S`). `blocked-by:` moves from 91LLU879 to 44RGLOO8; `eht:` keeps both,
because the derivation edge is history and is never erased.

`pre-block-column: published` is unchanged. This TRDD does not reach `completed`
while its publish is shipping a live credential — that is precisely the false
completion the flock gate exists to catch.

### ⏵ UPDATE 2026-07-10T05:45 — PUBLISHED as v0.1.3, and therefore BLOCKED, not done

**The plugin shipped. This TRDD did not.** Verified against the repo, not against a
STATE block: `Emasoft/ai-maestro-web-scenario-tester` has releases v0.1.1–v0.1.3, the
latest published `2026-07-08T16:48:08Z`. The restructure of TRDD-74ZS7P9U is *in* that
tag — `cd68adb...v0.1.3` compares `behind=0`, and the tag's tree carries the split-agent
`amwst-scenario-proposer`, 14 skills, `pyproject.toml` and `.python-version`. So
`published-version: 0.1.3` / `published-at:` are recorded here as fact.

`column:` is nonetheless **`blocked`**, with `pre-block-column: published`. Publishing
opened a hole this TRDD itself named ("AFTER publish: repoint `tests/scenarios/` to
CONSUME the plugin + `scenarios.config.json` + de-path `fixture-helpers.sh`") and never
closed. Verified still open on 2026-07-10: no `scenarios.config.json` exists, four
*git-tracked* files under `tests/scenarios/` still hardcode the author's absolute
working directory, and the local harness copy is intact. That work is now
**TRDD-91LLU879**, this TRDD's `eht:` and its `blocked-by:`.

A parent whose flock is still open has not finished — its honest column is `blocked`,
on itself. Marking this `published` would have put it in `TERMINAL_DONE` and reported a
half-done change as shipped-and-closed; the corpus invariant checker (`lib/trdd-graph.ts`,
the flock gate) rejects exactly that. When 91LLU879 reaches a terminal column this
restores to `published` and archives as `completed`.

### ⏵ UPDATE 2026-06-25T00:49 (heartbeat resume) — plugin SUBSTANTIALLY RESTRUCTURED (TRDD-74ZS7P9U); publish STILL USER-gated
- A USER work-order — tracked separately as **TRDD-74ZS7P9U** (now `complete`) — restructured the plugin for token economy + a **2-agent run flow**. The "BUILD COMPLETE 2026-06-22" + "CPV-VALIDATED 2026-06-22" snapshots below are SUPERSEDED on the plugin's CONTENTS (the gating + the deps are unchanged).
- **New shape, synced to `~/Code/ai-maestro-web-scenario-tester/` @ `cd68adb` (FF, clean tree):** 6 agents (added `amwst-scenario-proposer`), **13** `amwst-` skills (added `amwst-phase-execute` / `-fixasyougo` / `-proposals` load-on-demand, `amwst-validate-scenario`, `amwst-region-capture`, `amwst-step-batch`), **11** scripts (added `amwst-leantool.py`, `amwst-scenario-step.sh`, `amwst-validate-scenario.py`). The runner is now token-disciplined and writes ONLY the Rule 9 report; the SEPARATE `amwst-scenario-proposer` writes the Rule 11 proposals (req: fix-as-you-go ≠ proposals); per-step `.scen.md` reading is greppable; README documents the 13 skills, the 2-agent flow, helper scripts, and the 14 rules. `pyproject.toml` + `.python-version` added (plugin now ships Python).
- **Re-validated 2026-06-25** — CPV `remote_validation` strict on the synced tree: **CRITICAL=0 MAJOR=0 MINOR=2 NIT=0**. The 2 MINORs are the SAME pre-existing publish-pipeline scaffolding (pre-push hook + CI workflow) noted below — still publish-eligible by the gate.
- **PUBLISH STILL USER-GATED — NOT auto-run.** All 3 standing reasons below hold (explicit do-not-publish gate; first public + effectively irreversible release; CPV publish AGENT thrash risk in a saturated env). The restructure changed nothing about the gating. → The USER publishes from the plugin folder with a clean/lean session.
- column `testing` → `complete` (engineering done + re-validated; the publish transition is the USER's, non-exempt).

### ⏵ UPDATE 2026-06-24T04:32 (heartbeat resume) — CPV-hold CLEARED, publish still USER-gated; RC-120 fixed in the ai-maestro original
- **CPV hold condition CLEARED (verified):** installed CPV is now **2.145.1** (> the 2.141.1 gate). Per the RESUME PROTOCOL the plugin is publish-eligible.
- **BUT publish was NOT auto-run — held for the USER.** Standing reasons: (1) line 84 is an explicit "do NOT publish without USER approval" gate; (2) it is a FIRST PUBLIC release → outward-facing + effectively irreversible; (3) the publish path runs the CPV publish AGENT, and agents THRASH in the current saturated env (3/3 failed this session) → high risk of a half-published/broken first release done unattended, which contradicts the "make the install flawless" mandate. → **Awaiting USER go (publish with the user available + a clean/lean session).**
- **RC-120 follow-up (line 37b) DONE EARLY:** the ai-maestro ORIGINAL `tests/scenarios/scripts/scenario-setup.sh` eval-based path expansion → safe `expand_path()` (mirrors the CPV-validated plugin helper). Independent in-project security fix (no publish dependency) so done now. Verified: bash -n OK, shellcheck rc=0, zero eval-echo calls remain, and an injection-safety test confirms `$(…)`/backtick payloads no longer execute. Committed.
- Still pending (line 37a, AFTER publish): repoint `tests/scenarios/` to CONSUME the plugin + `scenarios.config.json` + de-path `fixture-helpers.sh:21`.

**⚠ PIVOT 2026-06-22 (USER directive) — this is now an AI-MAESTRO ROLE-PLUGIN, not a generic harness.**

**✅ BUILD COMPLETE 2026-06-22 — plugin built + self-verified at `~/Code/ai-maestro-web-scenario-tester/` (local git, 4 commits, NOT pushed — publish is USER-gated).**
- Structure: 5 agents (`web-scenario-tester-main-agent` + 4 `amwst-` subagents), 7 `amwst-` skills, 8 scripts, 5 references (incl. the 1465-line `SCENARIOS_TESTS_RULES.md` verbatim), `hooks/hooks.json` + `scripts/amwst_subagent-write-guard.sh`, 2 example `.scen.md`, `.claude-plugin/plugin.json`, `web-scenario-tester.agent.toml`.
- **Write-guard design (USER directive):** PLUGIN-scoped PreToolUse hook, SENTINEL-GATED on `${CLAUDE_PROJECT_DIR}/.claude/scenario_is_running.json` — inert outside a run; run-owner skills create it at run start / delete at run end + gitignore it; `master-cleanup.sh` step 0 disarms it belt-and-braces. Verified: no-sentinel→exit0, sentinel+out-of-scope→exit2, sentinel+in-scope→exit0.
- **Gitignore:** sentinel ignored; `tests/scenarios/*.scen.md` stay git-TRACKED (per-project, not bundled — auto-discovered at `${CLAUDE_PROJECT_DIR}/tests/scenarios/`, configurable via `scenarios.config.json` `scenariosDir`).
- Self-check GREEN: all JSON parse, all 8 scripts `bash -n`, quad-identity consistent (`web-scenario-tester` / `web-scenario-tester-main-agent`; repo dir `ai-maestro-web-scenario-tester` is independent by design).
- Deps: `dev-browser` @ `dev-browser-marketplace` (hard, cross-marketplace); `llm-externalizer` (optional, doc-only).
- **✅ CPV-VALIDATED 2026-06-22 — publish gate `validate_plugin --strict` GREEN** (CRITICAL/MAJOR/MINOR/NIT = 0; the only 2 MINOR left are the pre-push-hook + CI workflow = publish-pipeline scaffolding CPV creates AT publish). 3 CRITICAL fixed (write-guard hook: explicit `bash` + `timeout:10`; `eval echo` RC-120 → safe `expand_path()`) + 6 MAJOR (MIT LICENSE, `color:` removed, SKILL desc trim, `context: fork`, `/var/folders` de-path). 26 deep-security findings = confirmed structural FALSE POSITIVES. Write-guard re-verified 6/6. Fixer report: `reports/plugin-fixer/20260622_014221+0200-web-scenario-tester-fix.md`.
- **⏸ PUBLISH ON HOLD (USER directive 2026-06-22): do NOT publish with the current CPV.** CPV is mid-update (new Claude Code specs + fixes from Anthropic). WAIT for the updated CPV to be published, THEN re-run the CPV publish agent. Current CPV = **2.141.1** (`Emasoft/claude-plugins-validation`).
  - **RESUME PROTOCOL (every resume/heartbeat):** check installed CPV version (`ls ~/.claude/plugins/cache/*/claude-plugins-validation/`). If **> 2.141.1** → new CPV is live → run the CPV publish flow for `~/Code/ai-maestro-web-scenario-tester/` → `Emasoft/ai-maestro-plugins` (its marketplace.json needs `allowCrossMarketplaceDependenciesOn: ["dev-browser-marketplace"]`). If still **2.141.1** → keep holding, stay silent. Do NOT rebuild — the plugin is DONE + validated.
- **AFTER PUBLISH** (separate ai-maestro follow-ups): (a) repoint `tests/scenarios/` to CONSUME the plugin + add `scenarios.config.json` + de-path `fixture-helpers.sh:21`; (b) ✅ **DONE 2026-06-24** (early — independent in-project security fix, no publish dependency): the ai-maestro ORIGINAL `tests/scenarios/scripts/scenario-setup.sh` eval-based path expansion → safe `expand_path()`, verified injection-safe.

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
- **Scenario files are PER-PROJECT, NOT bundled (USER 2026-06-22):** `*.scen.md` files are unique to each
  consuming project — the plugin does NOT ship them. The plugin AUTO-DISCOVERS them in the consumer's standard
  scenarios folder (default `${CLAUDE_PROJECT_DIR}/tests/scenarios/`, overridable via `scenarios.config.json`
  key `scenariosDir`). Canonical extension is **`.scen.md`** (bare `*.md` is wrong/legacy — the discovery glob
  + create-scenario must standardize on `.scen.md`). Plugin ships only 2-3 generic EXAMPLE scenarios under `examples/`.
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

## Approval log

- 2026-07-10T05:45:23+0200 — PUBLISHED as v0.1.3 (released 2026-07-08T16:48:08Z), verified
  against the repo's releases and the tag's tree. Recorded, not archived: column → blocked
  on the new EHT TRDD-91LLU879 (the post-publish repoint this TRDD deferred), with
  pre-block-column: published. Bookkeeping by ai-maestro-session; no approval was required
  (a mechanical column transition on evidence, EXEMPT category A/E).
