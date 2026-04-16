# SCENARIOS_TESTS_RULES Audit — 2026-04-17

**Source file:** `tests/scenarios/SCENARIOS_TESTS_RULES.md` (1,097 lines)
**Canonical copy:** tracked at `tests/scenarios/SCENARIOS_TESTS_RULES.md`
**Loaded copy:** `.claude/rules/SCENARIOS_TESTS_RULES.md` — verified to be a **symlink** to `../../tests/scenarios/SCENARIOS_TESTS_RULES.md` (they cannot drift).
**Purpose:** verify each rule reflects current implementation, flag outdated examples, confirm cross-references, and check scenario compatibility.

**Summary of verdicts:**
- ✅ OK: 6 rules (Rules 1, 2, 4, 7, 10, 11)
- ⚠️  Outdated examples / minor drift: 5 rules (Rules 3, 5, 6, 9, 12)
- ❌ Structural drift: 2 rules (Rule 8 DEV-BROWSER scenarios still reference chrome-devtools-mcp; Rule 13 depends on scenarios following Rule 8)

**Top-level issue:** Rule 8 was switched to `dev-browser` on 2026-04-15 (commit `4d6ea4b4`), but **every scenario file still lists `mcp__chrome-devtools__*` in its `required_tools` frontmatter**. Also, the "Scenario File Format" section (lines 363-369) still documents the chrome-devtools MCP tools as the canonical `required_tools` list. This is a silent contradiction: Rule 8 forbids chrome-devtools-mcp while the scenario file format and the 22 existing scenarios still mandate it.

---

## Rule 1: CLEAN-AFTER-YOURSELF

**Status:** ✅
**Line range in source:** L32-L42

### Observations
- Accurately describes cleanup as a mandatory phase of every scenario.
- "Undo efficiently, not step-by-step" guidance is correct and consistent with how scenarios actually clean up.
- Final visual-compare screenshot requirement is consistent with Rule 10 (PHOTOSTORY).
- The cross-references to STATE-WIPE (Rule 3) are implicit but accurate.

### Recommended updates
- None. Keep as-is.

---

## Rule 2: 0-IMPACT

**Status:** ✅
**Line range in source:** L44-L55

### Observations
- Consistent with the `scen-test-*` / `scen018-*` naming pattern used by actual scenarios (SCEN-018 uses `scen018-manager`, `scen018-maint-alpha`, etc.).
- The "read existing state is allowed" exception is correct and matches current practice.

### Recommended updates
- None.

---

## Rule 3: STATE-WIPE

**Status:** ⚠️
**Line range in source:** L58-L94

### Observations
- The list of config files to back up (line 65-72) is canonical and correct:
  `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.aimaestro/governance.json`, `~/.aimaestro/agents/registry.json`, `~/.aimaestro/teams/teams.json`, `~/.aimaestro/teams/groups.json`.
- The UI-first cleanup order (line 79-91) is accurate — matches current production practice and is also reiterated at the bottom of the file (L1056+).
- `tests/scenarios/state-backups/` path is plausible but **no such directory exists on the branch** yet (`git ls-tree -r --name-only fork/feature/team-governance tests/scenarios/state-backups/` returns nothing). This is fine for a runtime-only directory but should be documented as "gitignored runtime artifact" like Rule 13 does for the state file.
- The rule never mentions `tests/scenarios/state/` (where Rule 13's `autonomous-batch-state.json` lives). These two runtime locations should be cross-referenced.

### Recommended updates
- **(low)** Add a sentence after the file list: *"Backup directory is git-ignored; purge at will between runs."*
- **(low)** Add a sentence linking to Rule 13's `tests/scenarios/state/` for the autonomous-batch state file.
- **(optional)** Mention that per-agent `.claude/settings.local.json` backups are only needed when the scenario intentionally edits that agent's config.

---

## Rule 4: FIX-AS-YOU-GO

**Status:** ✅
**Line range in source:** L97-L112

### Observations
- The 7-step diagnose→fix→rebuild→retry→loop pattern is sound and matches current practice.
- Line 111 **explicitly** references Rule 13's two-phase protocol: "This is Phase 1 of the two-phase protocol. Rule 4 bug fixes are IMMEDIATE and land in place on the current branch — never in a worktree, never as a PR." This is the critical cross-reference that was added in commit `28fc2d65` (2026-04-15) and it is correct.
- Line 111 also correctly states that "Delayed work (improvements, redesigns, governance changes) goes into Rule 11, NOT here." — this is the Phase 1 vs Phase 2/3 separation the protocol depends on.

### Recommended updates
- None. The rule is tight and consistent.

---

## Rule 5: TRACK-AND-REPORT

**Status:** ⚠️
**Line range in source:** L115-L146

### Observations
- The report structure (step table, bugs-found/fixed section, issues-noticed, report header) matches the actual reports on disk (e.g., `tests/scenarios/reports/SCEN-009_20260406T030830.report.md`).
- Rule 5's "Report header" lists the required front-matter fields but **does not list the newer field** `screenshots_purged: true|false` that Rule 10 (line 543) introduces in the context of auto-purge. This means a scenario report that follows Rule 5's header verbatim would be missing the auto-purge flag.
- Rule 5 does not mention the Rule 9 full YAML frontmatter format (line 242+) — Rule 9 is where the exhaustive header list is documented. Rule 5 should cross-reference Rule 9 for the full header.

### Recommended updates
- **(medium)** Add `screenshots_purged: true|false` to Rule 5's "Report header" list (or cross-reference Rule 9's fuller list).
- **(low)** Add a link from Rule 5 to Rule 9 for the authoritative front-matter shape.

---

## Rule 6: STICK-TO-UI

**Status:** ⚠️
**Line range in source:** L149-L160

### Observations
- Core rule ("NEVER bypass the UI") is still correct.
- Line 153 says **"via Chrome DevTools CDP or Claude-in-Chrome"** — this is **stale** as of the 2026-04-15 switch to `dev-browser`. Rule 8 (line 187) explicitly marks chrome-devtools MCP as "deprecated for production scenario runs", so Rule 6 contradicts Rule 8.
- TRDD-f79f6047 §9a (2026-04-14 amendment) extended Rule 6 to forbid direct `/api/*` calls from plugin cleanup scripts. Rule 6 does not mention this explicitly — the ban on `fixture-helpers.sh` direct deletes is only enforced by prose convention.
- The "Exception" for state verification (reading API responses) is correct and matches current practice, but the rule does not mention the Rule 13 cleanup subagent pattern (cleanup-runner drives the UI via aim-helpers).

### Recommended updates
- **(HIGH)** Line 153: replace "via Chrome DevTools CDP or Claude-in-Chrome" with **"via `dev-browser` per Rule 8. Legacy chrome-devtools-mcp support is deprecated."**
- **(medium)** Add a sub-bullet: "Plugin scripts (including fixture-helpers.sh) also fall under this rule — no direct `/api/*` DELETE calls from cleanup scripts. Ever." (Per TRDD-f79f6047 §9a.)
- **(low)** Cross-reference Rule 13's cleanup-runner pattern.

---

## Rule 7: SAFE-SETUP

**Status:** ✅
**Line range in source:** L164-L181

### Observations
- Commit-build-serve-verify-killorphan sequence is correct.
- `pm2 restart ai-maestro` / `yarn dev` match current practice.
- Orphan-session patterns `^scen-` and `^cos-scen-` are the correct kill targets for this branch's scenarios.
- The worktree optionality is consistent with TRDD-1222f06a §9 and Rule 13's in-place-bug-fix invariant.

### Recommended updates
- None.

---

## Rule 8: DEV-BROWSER

**Status:** ❌ (structural drift between rule and scenarios)
**Line range in source:** L185-L233

### Observations
- Rule body is clean and well-written — mandates `dev-browser` with `--browser ai-maestro-scenarios --headless --timeout 60` flags.
- Correctly delegates API details to the `dev-browser:dev-browser` skill.
- `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh` is **verified present** (lands at commits 252e06f8 + 7c0c8a3f).
- `aim_login`, `aim_screenshot`, `aim_sudo_modal`, `aim_create_agent`, `aim_delete_agent` helper names match the actual `aim-helpers.sh` exports.
- Device viewport note (line 217) is correct.
- Daemon lifecycle note (line 223-225) is correct — no `daemon start/stop` subcommand, auto-spawn.

**PROBLEM:** **None of the 24 scenario files follow this rule.** Verified by inspecting `SCEN-001_title-change-lifecycle.scen.md`, `SCEN-014_manager-poem-translation-mobile.scen.md`, `SCEN-018_maintainer-lifecycle.scen.md`, `SCEN-024_delete-team-revert-cos.scen.md`:
```
required_tools:
  - mcp__chrome-devtools__navigate_page
  - mcp__chrome-devtools__take_snapshot
  - mcp__chrome-devtools__take_screenshot
  - mcp__chrome-devtools__click
  - mcp__chrome-devtools__fill
  - mcp__chrome-devtools__wait_for
```
No scenario declares `browser_stack: dev-browser` (the field TRDD-f79f6047 §4.3 proposed). The "Scenario File Format" block in the rules file (line 363-369) also still documents `mcp__chrome-devtools__*` as canonical required_tools.

**The net effect:** a scenario-runner that faithfully follows Rule 8 will load the dev-browser skill, but the scenario file will tell it to use chrome-devtools MCP tools. The mismatch is unresolved.

### Recommended updates
- **(HIGH)** Decide the migration path. Options:
  1. **Bulk rewrite** all 24 scenarios to drop `mcp__chrome-devtools__*` and either omit `required_tools` entirely or use a new `browser_stack: dev-browser` field. (Per TRDD-f79f6047 §4.3, preferred.)
  2. **Introduce backward compat**: keep the `required_tools` list in current scenarios but add Rule 8 text saying "scenarios with `required_tools: mcp__chrome-devtools__*` are legacy; new scenarios MUST declare `browser_stack: dev-browser`". Update the Scenario File Format section (L363-L369) accordingly.
- **(HIGH)** Update the Scenario File Format block (Rule 9 section, line 363-369 and line 400) so the example `required_tools` is either absent or `browser_stack: dev-browser`.
- **(medium)** Add a line to Rule 8: "New scenarios MUST declare `browser_stack: dev-browser` in their frontmatter. Scenarios without this field will be treated as legacy chrome-devtools-mcp scenarios until migrated."

---

## Rule 9: REPORT-FORMAT

**Status:** ⚠️
**Line range in source:** L237-L478

### Observations
- Frontmatter fields (L242-258) are authoritative — scenarios' existing reports match this format (SCEN-001, SCEN-005, SCEN-006, SCEN-009 reports all conform).
- The extended Scenario File Format block (L313-L478) documents required frontmatter fields for scenario `.scen.md` files.
- **Line 363-369 duplicates Rule 8's conflict:** the example `required_tools` still lists chrome-devtools-mcp tools as "Always include all 6 below." This directly contradicts Rule 8.
- Line 400 in the field-rules table says: "Always include the 6 standard CDP tools." — same contradiction.
- Line 247: `result: PASS | FAIL | PARTIAL` — Rule 13 adds `STUCK` as a verdict (L936). Rule 9 should include `STUCK` in its result enum.
- Line 258: `cleanup_verified: true | false` + `state_wipe_verified: true | false` are good, but the Rule 10 `screenshots_purged` field is NOT listed here.
- Step format is correct and matches what scenarios use.
- The "Do NOT add non-standard fields" enforcement (line 447) is correct and consistent with current scenarios.

### Recommended updates
- **(HIGH)** Line 247: expand result enum to `PASS | FAIL | PARTIAL | STUCK` (match Rule 13).
- **(HIGH)** Line 363-369: replace the chrome-devtools `required_tools` example with either `browser_stack: dev-browser` or omit required_tools and let Rule 8 dictate.
- **(HIGH)** Line 400 (field-rules table): change "Always include the 6 standard CDP tools" → "Set `browser_stack: dev-browser` per Rule 8, or omit `required_tools` for dev-browser scenarios. `required_tools` listing chrome-devtools-mcp tools is legacy."
- **(medium)** Add `screenshots_purged: true|false` to the frontmatter list (line 258) to match Rule 10 and Rule 13.
- **(low)** Consider adding an `improvements_path: <path>` frontmatter field so the Rule 11 companion file is auto-linked from the report.

---

## Rule 10: PHOTOSTORY

**Status:** ✅
**Line range in source:** L482-L545

### Observations
- Timestamped dir + file convention is correct and supported by commit 4d6ea4b4+.
- JPEG 97% requirement with `sips` conversion example is still accurate for macOS.
- `tests/scenarios/scripts/compress-screenshots.sh` is **verified present** in the repo.
- Auto-purge rule (line 527-545) is internally consistent and matches the cron prompt in Rule 13 (line 781).
- The "Exceptions where screenshots MUST be kept" list (line 537-541) is explicit and testable.
- Current screenshots in `tests/scenarios/screenshots/SCEN-002/` are `.txt` files (text snapshots, not JPEGs). This is fine as a fallback but should be noted — the rule says JPEG 97% canonical, but the actual directory has `.txt` files. Possibly text fallbacks from an older chrome-devtools run.

### Recommended updates
- **(low)** Add a note: "If the automation tool only produces text snapshots (e.g., `take_snapshot` accessibility tree), save as `.txt` next to the JPEG. The `.jpg` is canonical; `.txt` is a searchable supplement."

---

## Rule 11: 11th-HOUR

**Status:** ✅
**Line range in source:** L549-L583

### Observations
- The 5-category analysis matrix (line 553-558) is well-aligned with actual improvement proposal files (`scenario_proposed-improvements_*.md`) on disk.
- The proposed-solutions-categories table (line 562-573) covers every improvement category actually observed in reports.
- Line 582 **correctly** states: "Rule 11 proposals are DELAYED — they wait for explicit user approval before ANY implementation. During the overnight run (Phase 1), the scenario runner MUST ONLY write these proposals to disk. It MUST NOT implement them, MUST NOT create worktrees for them, MUST NOT open PRs for them." This is the critical Phase 1 vs Phase 2/3 invariant and it is correctly phrased.
- Line 582 cross-references Rule 13's `CONSOLIDATED_PROPOSALS_<batch_id>.md` mechanism. Consistent with Rule 13 (L846+).

### Recommended updates
- None. Rule 11 is the strongest rule in the file.

---

## Rule 12: SUDO-MODE

**Status:** ⚠️
**Line range in source:** L586-L670

### Observations
- The core sudo-mode description (X-Sudo-Token, 60s window, one-shot) matches `security-registry.json` and `lib/sudo-fetch.ts`.
- `contexts/SudoContext.tsx` reference is accurate.
- **Strict-route table (line 622-633) has 3 issues against `security-registry.json` ground truth:**

| Rule 12 claim | Actual route in security-registry.json | Verdict |
|---|---|---|
| `DELETE /api/agents/[id]` | `DELETE_/api/agents/[id]`: strict | ✅ matches |
| `DELETE /api/teams/[id]` | `DELETE_/api/teams/[id]`: strict | ✅ matches |
| `DELETE /api/agents/cemetery/[id]` | `DELETE_/api/agents/cemetery`: strict (no `[id]`) | ❌ wrong shape — registry uses `DELETE_/api/agents/cemetery`, no per-id route |
| `POST /api/governance/password` | `POST_/api/governance/password`: strict | ✅ matches |
| `DELETE /api/settings/marketplaces` | `DELETE_/api/settings/marketplaces`: strict | ✅ matches |
| `DELETE /api/agents/role-plugins/install` | `DELETE_/api/agents/role-plugins/install`: strict | ✅ matches |
| `PATCH /api/agents/[id]/title` | `PATCH_/api/agents/[id]/title`: strict | ✅ matches |
| `POST /api/agents/[id]/stop` | `POST_/api/sessions/[id]/stop`: strict (`/sessions/` not `/agents/`) | ❌ wrong path — stop endpoint lives under `/api/sessions/`, not `/api/agents/` |
| `POST /api/sessions/[id]/restart` | `POST_/api/sessions/[id]/restart`: strict | ✅ matches |
| (not listed in Rule 12) | `PATCH_/api/settings/security`: strict | ❌ missing from Rule 12 table |

- Line 638: "Sudo modal recognition pattern for Chrome DevTools MCP" — should generalize to dev-browser per Rule 8.
- Line 661-670: Team-delete inline-password exception is correct.

### Recommended updates
- **(HIGH)** Fix the strict-route table:
  - `DELETE /api/agents/cemetery/[id]` → `DELETE /api/agents/cemetery` (and update the "Used by scenarios" column).
  - `POST /api/agents/[id]/stop` → `POST /api/sessions/[id]/stop` (critical — the registry has always been under `/api/sessions/`).
  - Add a row for `PATCH /api/settings/security`.
- **(medium)** Line 638: replace "Sudo modal recognition pattern for Chrome DevTools MCP" with "Sudo modal recognition pattern (applies to both dev-browser and legacy chrome-devtools-mcp)" and document the equivalent dev-browser invocation.
- **(medium)** Reconfirm `DELETE /api/agents/cemetery` route shape — the rule's "SCEN-019 cleanup" column may need updating too.

---

## Rule 13: AUTONOMOUS-PROTOCOL

**Status:** ⚠️ (soundly designed, but depends on Rule 8 scenario migration)
**Line range in source:** L674-L975

### Observations
- Phase 1 / Phase 2 / Phase 3 separation (line 682-690) is the architecturally critical invariant and it is precisely phrased.
- The "Background — why the process stays alive" note (line 692-694) is the 2026-04-15 empirical finding from TRDD-1222f06a §9. Accurate.
- The 3 components (line 696-702): passive account switcher + durable CronCreate + idempotent state file — matches TRDD-1222f06a §9.3.
- State file schema (line 708-739) is complete and the "NO fields for fix_branch/pr_url/pr_state" note (line 741) is crucial — it enforces Phase 1 vs Phase 3 separation.
- Cron fire prompt (line 747-804) is verbatim the executable loop. Internally consistent with the state machine.
- Master setup phase lists "First `dev-browser --browser ai-maestro-scenarios --headless --timeout 60` call" (line 814) — depends on Rule 8 being followed by scenarios. Currently scenarios don't follow Rule 8, so this phase works for the master daemon but each scenario subagent will still try to load `mcp__chrome-devtools__*` tools.
- Per-scenario runner block (line 821-834): accurate description of the Rule 4 FIX-AS-YOU-GO commit pattern.
- CONSOLIDATED_PROPOSALS format (line 846-947) is thorough and well-designed.
- Hard rules (line 949-960): 10 precise invariants, all correctly stated.
- Failure modes (line 962-971): well thought out.
- Line 975: "Never include a `claude --print` or `claude -p` invocation in the cron prompt" — correct and important.

### Recommended updates
- **(HIGH — indirect)** Rule 13 depends on Rule 8's scenario migration. Until scenarios drop `mcp__chrome-devtools__*` from `required_tools`, Rule 13's master setup + per-scenario runner can technically still work (the master daemon is dev-browser, the sub-scenarios may try to load chrome-devtools-mcp anyway). The recommended fix is joint with Rule 8's scenario migration.
- **(medium)** Line 816: "Take a baseline screenshot of the logged-in dashboard" — specify WHICH helper (`aim_screenshot` per Rule 8's aim-helpers).
- **(low)** Line 866: the consolidated file header has a typo/odd formatting: `**Pass:** <N>  Fail:** <N>  Partial:** <N>  Stuck:** <N>` — missing the opening `**` before `Fail:`, `Partial:`, `Stuck:`. Should be `**Pass:** <N>  **Fail:** <N>  **Partial:** <N>  **Stuck:** <N>`.

---

## Scenario File Format block (part of Rule 9 but worth its own section)

**Status:** ❌
**Line range in source:** L313-L478

### Observations
- Cross-references and cross-scenario conventions match existing scenarios.
- **Line 363-369 and line 400:** the example `required_tools` listing `mcp__chrome-devtools__*` directly contradicts Rule 8 (dev-browser mandate).
- Line 370-375 prerequisites example includes "Chrome browser open with DevTools accessible via CDP" — legacy.
- All 24 scenarios in the repo follow this legacy format; none use `browser_stack: dev-browser`.

### Recommended updates
- **(HIGH)** Line 363-369: rewrite the example. Proposed:
  ```yaml
  browser_stack: dev-browser          # Canonical. See Rule 8.
  # legacy scenarios may still list:
  # required_tools:
  #   - mcp__chrome-devtools__navigate_page
  #   - mcp__chrome-devtools__take_snapshot
  #   - mcp__chrome-devtools__take_screenshot
  #   - mcp__chrome-devtools__click
  #   - mcp__chrome-devtools__fill
  #   - mcp__chrome-devtools__wait_for
  ```
- **(HIGH)** Line 400 (field-rules table): split into two rows — `browser_stack` (required) and `required_tools` (optional, legacy-only).
- **(medium)** Line 373: "Chrome browser open with DevTools accessible via CDP" → "AI Maestro server accessible at http://localhost:23000 (dev-browser master setup will handle browser launch)".

---

## Remediation queue

**Priority key:** HIGH = breaks the rules-scenarios contract or produces incorrect results. MEDIUM = misleading but recoverable. LOW = quality-of-life.

| # | File path | Line(s) | Priority | Exact edit |
|---|-----------|---------|----------|------------|
| 1 | `tests/scenarios/SCENARIOS_TESTS_RULES.md` | L153 (Rule 6) | HIGH | Replace `via Chrome DevTools CDP or Claude-in-Chrome` with `via dev-browser per Rule 8. Legacy chrome-devtools-mcp support is deprecated.` |
| 2 | `tests/scenarios/SCENARIOS_TESTS_RULES.md` | L247 (Rule 9) | HIGH | Change `result: PASS \| FAIL \| PARTIAL` → `result: PASS \| FAIL \| PARTIAL \| STUCK` |
| 3 | `tests/scenarios/SCENARIOS_TESTS_RULES.md` | L258 (Rule 9) | MEDIUM | Add `screenshots_purged: true \| false` below `state_wipe_verified` line |
| 4 | `tests/scenarios/SCENARIOS_TESTS_RULES.md` | L363-L369 (Scenario File Format) | HIGH | Replace chrome-devtools `required_tools` example with `browser_stack: dev-browser` (or make it optional/legacy-only per Rule 8) |
| 5 | `tests/scenarios/SCENARIOS_TESTS_RULES.md` | L400 (field-rules table) | HIGH | Split `required_tools` row into `browser_stack` (required) + `required_tools` (optional legacy) |
| 6 | `tests/scenarios/SCENARIOS_TESTS_RULES.md` | L373 (prereqs example) | MEDIUM | Replace "Chrome browser open with DevTools accessible via CDP" with "AI Maestro server accessible at http://localhost:23000 (dev-browser handles browser launch)" |
| 7 | `tests/scenarios/SCENARIOS_TESTS_RULES.md` | L624 (Rule 12 route table) | HIGH | Change `DELETE /api/agents/cemetery/[id]` → `DELETE /api/agents/cemetery` (path shape per security-registry.json) |
| 8 | `tests/scenarios/SCENARIOS_TESTS_RULES.md` | L631 (Rule 12 route table) | HIGH | Change `POST /api/agents/[id]/stop` → `POST /api/sessions/[id]/stop` (wrong resource group — stop lives under /api/sessions/) |
| 9 | `tests/scenarios/SCENARIOS_TESTS_RULES.md` | After L633 (Rule 12 route table) | MEDIUM | Add row for `PATCH /api/settings/security` (currently missing from the strict-route table — it's in security-registry.json) |
| 10 | `tests/scenarios/SCENARIOS_TESTS_RULES.md` | L638 (Rule 12 modal pattern heading) | MEDIUM | Retitle "Sudo modal recognition pattern (dev-browser + legacy chrome-devtools-mcp)" and list both invocations |
| 11 | `tests/scenarios/SCENARIOS_TESTS_RULES.md` | L866 (Rule 13 consolidated header) | LOW | Fix formatting: add missing `**` before `Fail:`, `Partial:`, `Stuck:` |
| 12 | (24 scenario files) | YAML frontmatter | HIGH (policy decision) | Migration: either (a) bulk-rewrite `required_tools: mcp__chrome-devtools__*` → `browser_stack: dev-browser`, or (b) formally declare chrome-devtools-mcp backward-compat with a deprecation deadline. Covered by TRDD-f79f6047 §4.3 Open Question 5. |

**Non-rule issues worth noting:**

- `tests/scenarios/state-backups/` directory is referenced at L73 but does not exist in-tree; add a note it's runtime-created.
- `tests/scenarios/state/` (autonomous-batch-state.json) is referenced at L706 but not in-tree; same note applies.
- `ai-maestro-plugins` references in prereqs examples match the current marketplace name.

---

## Summary of consistency impact

- **Rule 8 ↔ scenarios:** broken. 24 scenarios still list `mcp__chrome-devtools__*` in required_tools. Rule 8 forbids these. Either migrate the scenarios or add explicit backward-compat language to Rule 8.
- **Rule 8 ↔ Scenario File Format (Rule 9):** broken. Rule 9's example format declares chrome-devtools-mcp as canonical `required_tools`, contradicting Rule 8.
- **Rule 12 ↔ security-registry.json:** 3 mismatches (cemetery path, stop route path, missing security route).
- **Rule 13 ↔ Rule 8:** tightly coupled — Rule 13's master setup relies on dev-browser, but scenario subagents will still attempt to load chrome-devtools-mcp if they follow each scenario file's frontmatter.
- All other cross-references (Rule 3 ↔ Rule 13 state paths; Rule 4 ↔ Rule 13 Phase 1; Rule 10 auto-purge ↔ Rule 13 idempotent purge) are internally consistent.
