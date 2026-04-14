# Scenarios Rules — Full Reference

## Table of Contents

- [Rule 1: CLEAN-AFTER-YOURSELF](#rule-1-clean-after-yourself)
- [Rule 2: 0-IMPACT](#rule-2-0-impact)
- [Rule 3: STATE-WIPE](#rule-3-state-wipe)
- [Rule 4: FIX-AS-YOU-GO](#rule-4-fix-as-you-go)
- [Rule 5: TRACK-AND-REPORT](#rule-5-track-and-report)
- [Rule 6: STICK-TO-UI](#rule-6-stick-to-ui)
- [Rule 7: SAFE-SETUP](#rule-7-safe-setup)
- [Rule 8: CHROME-TOOL](#rule-8-chrome-tool)
- [Rule 9: REPORT-FORMAT](#rule-9-report-format)
- [Rule 10: PHOTOSTORY](#rule-10-photostory)
- [Rule 11: 11th-HOUR](#rule-11-11th-hour)
- [Rule 12: SUDO-MODE](#rule-12-sudo-mode)

## Rule 1: CLEAN-AFTER-YOURSELF

The last phase of every scenario MUST revert the system to the exact state it was in before the test started. Every team created, title changed, plugin installed, agent created, group added, or setting modified MUST be undone.

Undo efficiently, not step-by-step. If you created a plugin in 30 steps (selecting skills, subagents, MCP, rules, hooks), you undo it in ONE step: delete the plugin. The goal is to reach the original state, not to reverse-replay every action.

Cleanup phase steps are numbered and verified just like test steps — they are NOT optional. If a cleanup step fails, fix it before the scenario is considered complete. After cleanup, take a screenshot and compare with the pre-test screenshot. The UI must look identical.

## Rule 2: 0-IMPACT

NEVER use existing user-created resources (agents, teams, groups, plugins) for testing. Create NEW test-prefixed elements for the test (e.g., `scen-test-agent-01`, `scen-test-team-alpha`), use them, remove them during cleanup.

This prevents test runs from corrupting the user's real configuration. After a scenario completes, the system must be indistinguishable from one where the test never ran. Reading existing state is allowed; MUTATION is forbidden.

## Rule 3: STATE-WIPE

Backup these files at start (CHECKPOINT-SAVE):

- `~/.claude/settings.json`
- `~/.claude/settings.local.json`
- `~/.aimaestro/governance.json`
- `~/.aimaestro/agents/registry.json`
- `~/.aimaestro/teams/teams.json`
- `~/.aimaestro/teams/groups.json`

Backups go to `tests/scenarios/state-backups/<scenario-name>_<timestamp>/`.

Cleanup MUST use the UI, not file restoration. Correct order: delete agents via UI → delete teams via UI → purge cemetery → verify via API → THEN restore config files from backup ONLY for files that still differ (usually `settings.json` and `governance.json`; do NOT restore `registry.json` or `teams.json` — UI delete already cleaned those).

NEVER use bash/CLI to delete agent folders. That is a Rule 6 violation. The "Also delete agent folder" checkbox in the Delete Agent dialog handles folder cleanup.

## Rule 4: FIX-AS-YOU-GO

When a step fails: STOP → DIAGNOSE the issue → FIX the code → REBUILD and restart the server → RETRY the failed step from the exact same state → LOOP until the step passes → RESUME the scenario from the next step.

No abandonment. The scenario either completes fully or runs out of context window. Every fix attempt is logged in the report.

## Rule 5: TRACK-AND-REPORT

Log every step, bug, and issue in the scenario report. Per step: ID, description, PASS/FAIL/FIXED, screenshot filename, timestamp. Per bug fixed: discovery step, description, root cause, files modified, verification step. Per issue noticed but not blocking: step ID, severity, description, suggested fix.

## Rule 6: STICK-TO-UI

NEVER bypass the UI. All interactions must go through the browser. Click buttons, fill forms, select options via the browser MCP.

Do NOT call API endpoints directly with `curl` for mutations (state verification AFTER a UI action is allowed). Do NOT modify settings files directly. Do NOT run CLI commands to do what the UI should do.

If the UI cannot accomplish a step, that is a BUG — fix it per Rule 4, do not bypass it. This rule applies to cleanup scripts too — the `fixture_delete_agents_by_prefix` helper was tombstoned because it called a DELETE endpoint directly, bypassing the sudo-mode gate.

## Rule 7: SAFE-SETUP

Before starting: commit uncommitted changes, record the commit hash, optionally run in a git worktree, build the project, start the server, verify health, kill orphan test sessions from previous runs.

## Rule 8: CHROME-TOOL

Use Chrome DevTools Protocol (CDP) tools when available, with fallback to the Chrome extension. At the start of each phase, verify tools are loaded by taking a snapshot; reload via ToolSearch if they fail.

Required tools: navigate_page, take_snapshot, take_screenshot, click, fill, wait_for, select_page. Always take_snapshot before interacting for fresh element UIDs. Use bringToFront false on select_page to avoid desktop switching.

For tablet or smartphone scenarios, activate device emulation before any UI interaction. Revert to desktop in the CLEANUP phase.

Read agent terminal history via the conversation log, NOT tmux capture-pane — tmux capture only sees the visible pane, missing the alternate screen buffer.

## Rule 9: REPORT-FORMAT

The scenario report follows a structured markdown template: frontmatter with metadata (scenario name, version, commit hashes, timestamps, result, step counts, bug counts, cleanup verification, state-wipe verification), then Summary, Environment, Steps by phase, Bugs Found and Fixed, Issues Noticed, Cleanup Verification, State-Wipe Verification sections.

## Rule 10: PHOTOSTORY

Every step MUST have a screenshot saved as proof of completion. Generate ONE run identifier at the start using UTC ISO 8601 basic format. Save screenshots to a timestamped per-run subdirectory with the same timestamp in the filename, so both the directory and the file self-identify.

Format: JPEG 97%. If the browser MCP produces PNG, convert via sips. Both directory AND filename carry the timestamp so runs never mix. NEVER compress screenshots mid-session — compression rewrites file mtimes and destroys provenance.

## Rule 11: 11th-HOUR

After the scenario completes, execute a deep analysis of the results. Think about unsolved problems and propose concrete solutions covering: bugs still unfixed, pre-existing issues that interfered with the test, workflow inefficiencies observed in agent behavior, governance rule gaps exposed by the test, API design issues.

Proposed solutions use one or more methods: bug fixes, API improvements, script improvements, plugin improvements, role-plugin improvements, workflow rule changes, governance proposals, test infrastructure improvements, new scenarios.

Save to the proposals file with each proposal including problem description, root cause, proposed solution with specific files and changes, and priority (P0 through P3).

This is the PRIMARY DELIVERABLE of every scenario run. The test steps are the instrument; the improvements are the product.

## Rule 12: SUDO-MODE

Destructive operations trigger a sudo password modal that must be entered and confirmed. The modal is locatable via role dialog and aria-modal true. Each strict operation needs its own sudo token since tokens are one-shot.

If the modal does NOT appear for a strict operation, that is a BUG — either the route is not classified as strict in the security registry, or the client is not using the sudoFetch wrapper.

Team delete uses an inline password instead of a modal — the Delete Team dialog exchanges the inline password for a sudo token before the DELETE call. This is by design and is NOT a violation.
