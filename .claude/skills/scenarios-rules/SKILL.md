---
name: scenarios-rules
description: >-
  The 12 mandatory scenario rules every runner MUST follow.
  Use when running, editing, or implementing a scenario. Trigger
  with "run scenario NNN" or "execute SCEN-NNN", or preloaded via
  subagent skills frontmatter.
disable-model-invocation: true
---

# Scenarios Rules — 12 Mandatory Constraints

## Overview

Project-scoped scenario rules for ai-maestro. Every scenario runner and improvement implementer MUST follow them. Preloaded into subagents via the `skills:` frontmatter field, so the rules are always in context before the runner opens the scenario file.

Single source of truth: `${CLAUDE_PROJECT_DIR}/tests/scenarios/SCENARIOS_TESTS_RULES.md` (git-tracked canonical 806-line text). The skill's [references/rules.md](references/rules.md) is a **symlink** to that file so the two can NEVER drift. Update only the canonical path.

## Rule 0 — read this before any other rule (CRITICAL)

Rule 0 has two halves, and it governs everything below it:

- **0.a** — YOU ARE THE HUMAN USER of AI Maestro, never an agent. You click, fill forms, and type only into an agent's **chat** section — its **terminal** section is a read-only observation stream, never an input surface.
- **0.b** — YOU MUST NOT ARTIFICIALLY CONTROL THE AGENTS. Brief the MANAGER through the UI, then STOP and observe whether the agents invoke their skills spontaneously — that is the single most important thing the suite measures. Never nudge, prod, hint at a skill, or do an agent's work for it. A PASS bought by intervening is worse than a FAIL; the correct verdict is FAIL.

**Rule 0.b and Rule 4 (FIX-AS-YOU-GO) are NOT in tension — they are the same loop.** Rule 0.b forbids fixing an agent's behaviour *at runtime, by talking to it*. Rule 4 REQUIRES fixing the **cause** of that behaviour, in code, and retrying. An agent that stalls or forgets a skill is **a bug**, as much as a 500 from an API — not something to note and shrug at:

**THE SCENARIO LOOP — for each step:**

1. **IMPERSONATE THE USER**, with MAESTRO privileges (owner of the dashboard; no agent identity).
2. **ACT** using the means of the USER — **always through the UI**, never a tool/script/API that bypasses it. *You are testing the UI and the harness's reaction to UI interactions*; a step done any other way tests nothing.
3. **VERIFY** the step's expected result **by ANY means, provided it is READ-ONLY** — the UI, the filesystem, logs, a console debugger, a read-only API GET, `tmux capture-pane`. Unrestricted and encouraged: the truth usually lands on disk before it reaches the UI.
4. **Did it NOT happen? STOP — you found a bug. FIX IT NOW**, no procrastinating, no working around it. **Hot-swap** the fixed part where possible; else **rebuild + restart the server**, then resume or restart the scenario. **RETRY the same act, VERIFY again.** Correct now? go on. **Still wrong → try a DIFFERENT fix and iterate. No attempt limit.**
5. **NEXT STEP** → repeat from 1.

**Fix ONLY when you cannot go on** — a missing/wrong expected result blocks the next step, and that is the sole trigger. And **never** fix an agent by typing the answer into its chat: the bug lives in what made it behave that way (its plugin prompt, its skill's description, the server's enforcement), never in your chat window.

Every rule and checklist item after this one operates under Rule 0 — a step, edit, or "improvement" that has the user hand-hold an agent is a violation, not a shortcut.

## Prerequisites

- Project with `tests/scenarios/SCEN-NNN_*.scen.md` files
- A running app under test with a browser MCP available (CDT preferred, claude-in-chrome fallback)

## Instructions

### Checklist

Copy this checklist and track your progress:

- [ ] Read the full rules at startup
- [ ] Brief the MANAGER once, then STOP and observe — never puppet or nudge agents (Rule 0)
- [ ] CLEAN-AFTER-YOURSELF at end of scenario
- [ ] Never mutate existing user resources (0-IMPACT)
- [ ] Backup configs at start (STATE-WIPE CHECKPOINT-SAVE)
- [ ] Fix bugs on the fly (FIX-AS-YOU-GO loop)
- [ ] Log every step and fix (TRACK-AND-REPORT)
- [ ] Never bypass the UI (STICK-TO-UI)
- [ ] Timestamp every screenshot (PHOTOSTORY)
- [ ] Do 11th-hour analysis at the end

### The 12 rules (summary)

1. **CLEAN-AFTER-YOURSELF** — Revert to pre-test state. Undo efficiently, not step-by-step.
2. **0-IMPACT** — Never mutate existing user resources. Create test-prefixed elements, delete on cleanup.
3. **STATE-WIPE** — Backup config files at start, restore at end via UI first, files second.
4. **FIX-AS-YOU-GO** — STOP → DIAGNOSE → FIX → REBUILD → RETRY → LOOP → RESUME. No abandonment.
5. **TRACK-AND-REPORT** — Log every step, bug, issue in the scenario report with IDs, status, screenshots.
6. **STICK-TO-UI** — All interactions via browser. No curl mutations, no direct file edits, no bash agent deletions.
7. **SAFE-SETUP** — Commit, record hash, build, start server, verify health, kill orphans BEFORE Phase 1.
8. **CHROME-TOOL** — Use CDP first, extension fallback. Always take_snapshot before interacting.
9. **REPORT-FORMAT** — Follow the structured markdown template with frontmatter, steps, bugs, verification.
10. **PHOTOSTORY** — Every step screenshot in timestamped dir+filename, JPEG 97%, never compress mid-session.
11. **11th-HOUR** — Deep analysis + improvement proposals. This is the primary deliverable.
12. **SUDO-MODE** — Destructive ops trigger sudo password modal. Enter the governance password and confirm.

## Output

Preloaded skill — no direct output. Visible artifacts are the scenario report, timestamped screenshots, and improvement proposals file.

## Error Handling

| Violation | Action |
|-----------|--------|
| Rule 6 breach (about to use curl for cleanup) | STOP, find the UI path, or report as a BUG |
| Rule 10 breach (missing or untimestamped screenshot) | Redo the step with correct path, continue |
| Rule 4 breach (giving up on a failing step) | Re-enter the fix-retry loop, no abandonment |
| Rule 3 breach (file restore before UI delete) | Stop, delete via UI first, then compare files |
| Any rule conflicts with a faster shortcut | Rules win. Rules cannot be weakened. |

## Examples

**Example 1 — Rule 6 cleanup**:
Input: runner needs to delete a test agent at end of scenario.
Output: Profile → Advanced → Danger Zone → Delete Agent → sudo modal → governance password → Delete Forever.
Incorrect: curl DELETE /api/agents — bypasses sudo-mode, blocked by auth.

**Example 2 — Rule 10 screenshot path**:
Input: step 14 of SCEN-009 at run time 2026-04-14T14:30:00Z.
Output: reports/scenarios-runner/screenshots/SCEN-009_20260414T143000Z/S014_20260414T143000Z_task-sent.jpg
Incorrect: screenshots/SCEN-009/baseline.png — no timestamp, wrong format, cross-run contamination risk.

## Resources

- [references/rules.md](references/rules.md) — **symlink** to the canonical tracked file `tests/scenarios/SCENARIOS_TESTS_RULES.md`. Full 806-line text with frontmatter format, device emulation presets, phase templates, directory structure, scenario file format, and the non-negotiable cleanup order. Contains all 12 rules:
  - Rule 1: CLEAN-AFTER-YOURSELF
  - Rule 2: 0-IMPACT
  - Rule 3: STATE-WIPE
  - Rule 4: FIX-AS-YOU-GO
  - Rule 5: TRACK-AND-REPORT
  - Rule 6: STICK-TO-UI
  - Rule 7: SAFE-SETUP
  - Rule 8: CHROME-TOOL
  - Rule 9: REPORT-FORMAT
  - Rule 10: PHOTOSTORY
  - Rule 11: 11th-HOUR
  - Rule 12: SUDO-MODE
- `${CLAUDE_PROJECT_DIR}/.claude/rules/SCENARIOS_TESTS_RULES.md` — another symlink to the same canonical file, auto-loaded by the Claude Code harness on session start.
