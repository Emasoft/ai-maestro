---
name: edit-scenario
description: >-
  Use when modifying an existing scenario file. Trigger with "edit SCEN-N" or
  "add a step to scenario N". Adds/removes/reorders steps, tightens
  verifications, fixes Rule 6, bumps version.
argument-hint: scenario-number-or-filename [what-to-edit]
disable-model-invocation: false
model: opus
---

# Edit Scenario — targeted modifications

## Overview

You are the scenario editor. Find an existing scenario file, apply the user's requested edit, and re-validate that the result still passes the 12 scenario rules. You do NOT create new scenario files — direct users to `create-scenario` for that.

## Prerequisites

- Target scenario file at `${CLAUDE_PROJECT_DIR}/tests/scenarios/SCEN-<padded-id>_*.scen.md`
- Scenario rules file (bundled or project override)

## Instructions

### Checklist

Copy this checklist and track your progress:

- [ ] Parse `$ARGUMENTS` to get scenario identifier and edit description
- [ ] Resolve scenario file via glob; report failure if not found
- [ ] Read the full file: frontmatter, phases, steps, version
- [ ] Apply the edit with the Edit tool
- [ ] Re-validate rule compliance (Rules 1, 2, 6, 10, 12)
- [ ] Bump `version:` if numbering or verifications changed
- [ ] Return 3-line summary

### Workflow

1. Parse `$ARGUMENTS` to get the scenario identifier and edit description.
2. Resolve the scenario file via glob; report failure if not found.
3. Read the full file: frontmatter, phases, steps, current version.
4. Apply the edit with the Edit tool; preserve field ordering and blank lines.
5. Re-validate: Rule 6 forbidden tokens, Rule 1 cleanup, Rule 2 naming, Rule 10 screenshot, Rule 12 sudo.
6. Bump `version:` if numbering, verifications, or prerequisites changed.
7. Return a 3-line summary.

### Rules reference

1. **Plugin-bundled:** `references/SCENARIOS_TESTS_RULES.md` at the plugin root
2. **Project override (preferred if present):** `${CLAUDE_PROJECT_DIR}/tests/scenarios/SCENARIOS_TESTS_RULES.md`

See [Edit Procedure](references/edit-procedure.md) for the full edit-type table (6 types), Rule 6 forbidden token list, and step-by-step procedure.

## Output

```
SCENARIO_EDITED SCEN-<padded-id> <version-old>-><version-new>
Edits applied: <count> | Violations caught: <count> | Violations fixed: <count>
File: <absolute-path-to-.scen.md>
```

## Error Handling

| Error | Action |
|-------|--------|
| Scenario file not found | List existing files; tell user to use `create-scenario` for new ones |
| Ambiguous edit request | Ask user for clarification; do not guess intent |
| Forbidden token found post-edit | Report it with suggested UI-only replacement; await approval |
| Edit adds `Creates:` without cleanup step | Flag as Rule 1 violation; propose cleanup step |

## Examples

```
/edit-scenario 18 add a step after S014 verifying task ID is shown in the card
/edit-scenario SCEN-009 fix Rule 6 violation in Step S022
/edit-scenario 16 update prerequisites to require Codex CLI
```

## Resources

- [Edit Procedure](references/edit-procedure.md) — full 6-step procedure with renumbering rules, Rule 6 forbidden token table, and violation reporting format
  - Step 1 — Find the scenario file
  - Step 2 — Read the current scenario
  - Step 3 — Understand the requested edit
  - Step 4 — Apply the edit
  - Step 5 — Re-validate rule compliance
  - Step 6 — Bump the version
- `references/SCENARIOS_TESTS_RULES.md` at the plugin root — canonical 12-rule spec
