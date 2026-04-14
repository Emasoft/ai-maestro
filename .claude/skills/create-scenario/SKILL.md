---
name: create-scenario
description: >-
  Use when adding a new scenario. Trigger with "create a new scenario", "write
  a scenario for X", or "author SCEN-N". Assigns the next number, drafts
  frontmatter/phases/steps, saves the file.
argument-hint: slug-or-description
disable-model-invocation: false
model: opus
---

# Create Scenario — interactive authoring

## Overview

You are the scenario author. Interview the user, draft a complete scenario file that passes all 12 scenario rules, and save it into the project's `<project>/tests/scenarios/` folder.

## Prerequisites

- `${CLAUDE_PROJECT_DIR}/tests/scenarios/` folder (created on first use via `init-scenarios-folder.sh`)
- AI Maestro server running (or target app)
- Chrome browser accessible via CDP
- Governance password from the user (if the project uses governance)

## Instructions

### Checklist

Copy this checklist and track your progress:

- [ ] Ensure `<project>/tests/scenarios/` folder exists (run `init-scenarios-folder.sh` if missing)
- [ ] Read `NEXT_SCEN_NUMBER` and zero-pad to 3 digits
- [ ] Interview user for 12 required fields (see below)
- [ ] Draft frontmatter with all required fields
- [ ] Draft phases and steps using the exact step format
- [ ] Enforce rules 1, 2, 6, 10, 12 on every Action field
- [ ] Write file to `SCEN-<padded-id>_<slug>.scen.md`
- [ ] Bump `NEXT_SCEN_NUMBER` to `NEXT_N + 1`

### Workflow

1. Verify `${CLAUDE_PROJECT_DIR}/tests/scenarios/` exists (run init script if missing).
2. Read `NEXT_SCEN_NUMBER` and zero-pad to 3 digits (e.g. `7` → `SCEN-007`).
3. Interview the user for the 12 required frontmatter fields.
4. Draft the frontmatter with exact field ordering and quoting.
5. Draft phases and steps using the exact step format.
6. Enforce rules 1, 2, 6, 10, 12 on every Action field.
7. Write the file to `tests/scenarios/SCEN-NNN_<slug>.scen.md`.
8. Bump `NEXT_SCEN_NUMBER` to `NEXT_N + 1`.

### Rules reference

Canonical rules file: `${CLAUDE_PROJECT_DIR}/tests/scenarios/SCENARIOS_TESTS_RULES.md` — tracked in git, single source of truth for the 12 rules.

See [Authoring Walkthrough](references/authoring-walkthrough.md) for the full interview question list (12 fields), step format template, frontmatter template, and rule enforcement checklist.

## Output

```
SCENARIO_CREATED SCEN-<padded-id> <slug>
File: <absolute-path-to-.scen.md>
Next number: <NEXT_N + 1>
```

## Error Handling

| Error | Action |
|-------|--------|
| `tests/scenarios/` missing | Run `init-scenarios-folder.sh ${CLAUDE_PROJECT_DIR}` |
| `NEXT_SCEN_NUMBER` missing | Create with content `1` |
| User can't provide governance password | Stop; tell user to check their governance config |
| Action field contains forbidden token | Rewrite as UI-only sequence before saving |

## Examples

```
/create-scenario title-change-lifecycle
/create-scenario "a scenario for SCEN-23 testing marketplace install"
```

## Resources

- [Authoring Walkthrough](references/authoring-walkthrough.md) — full 8-step procedure with interview questions, frontmatter template, step format, and rule enforcement
  - Step 1 — Ensure the scenarios folder exists
  - Step 2 — Assign the next scenario number
  - Step 3 — Interview the user
  - Step 4 — Draft the frontmatter
  - Step 5 — Draft the phases and steps
  - Step 6 — Enforce the rules while drafting
  - Step 7 — Save the scenario file
  - Step 8 — Bump NEXT_SCEN_NUMBER
- `${CLAUDE_PROJECT_DIR}/tests/scenarios/SCENARIOS_TESTS_RULES.md` — canonical 12-rule spec (tracked in git)
