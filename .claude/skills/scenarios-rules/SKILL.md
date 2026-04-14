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

Universal scenario rules bundled with scenarios-autorunner. Every scenario runner and improvement implementer MUST follow them. Preloaded into subagents via the `skills:` frontmatter field, so the rules are always in context before the runner opens the scenario file.

The canonical text is split into [references/rules.md](references/rules.md) (this skill's condensed TOC-indexed reference) and the plugin-level `references/SCENARIOS_TESTS_RULES.md` (full 595-line file).

## Prerequisites

- Project with `tests/scenarios/SCEN-NNN_*.scen.md` files
- A running app under test with a browser MCP available (CDT preferred, claude-in-chrome fallback)

## Instructions

### Checklist

Copy this checklist and track your progress:

- [ ] Read the full rules at startup
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
12. **STEP-UP-AUTH** — Destructive ops trigger sudo modal. Enter password and confirm.

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
Output: tests/scenarios/screenshots/SCEN-009_20260414T143000Z/S014_20260414T143000Z_task-sent.jpg
Incorrect: screenshots/SCEN-009/baseline.png — no timestamp, wrong format, cross-run contamination risk.

## Resources

- [references/rules.md](references/rules.md) — condensed reference. Sections:
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
  - Rule 12: STEP-UP-AUTH
- Plugin-level `references/SCENARIOS_TESTS_RULES.md` — full 595-line canonical text with frontmatter format, device emulation presets, phase templates, directory structure, and the non-negotiable cleanup order
