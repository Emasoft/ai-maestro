# Create Scenario — Authoring Walkthrough

## Table of contents

- [Step 1 — Ensure the scenarios folder exists](#step-1--ensure-the-scenarios-folder-exists)
- [Step 2 — Assign the next scenario number](#step-2--assign-the-next-scenario-number)
- [Step 3 — Interview the user](#step-3--interview-the-user)
- [Step 4 — Draft the frontmatter](#step-4--draft-the-frontmatter)
- [Step 5 — Draft the phases and steps](#step-5--draft-the-phases-and-steps)
- [Step 6 — Enforce the rules while drafting](#step-6--enforce-the-rules-while-drafting)
- [Step 7 — Save the scenario file](#step-7--save-the-scenario-file)
- [Step 8 — Bump NEXT_SCEN_NUMBER](#step-8--bump-next_scen_number)

## Step 1 — Ensure the scenarios folder exists

Check for `${CLAUDE_PROJECT_DIR}/tests/scenarios/`. If it does not exist, run the bundled initializer:

```
${CLAUDE_PLUGIN_ROOT}/scripts/init-scenarios-folder.sh ${CLAUDE_PROJECT_DIR}
```

This creates `tests/scenarios/`, `tests/scenarios/reports/`, `tests/scenarios/screenshots/`, `tests/scenarios/state-backups/`, `tests/scenarios/state/`, and seeds `tests/scenarios/NEXT_SCEN_NUMBER` with `1`. If the initializer script is missing, create the directories manually via Bash `mkdir -p`.

If `${CLAUDE_PROJECT_DIR}/tests/scenarios/SCENARIOS_TESTS_RULES.md` is missing, copy the bundled rules file (`references/SCENARIOS_TESTS_RULES.md` at the plugin root) into the project and inform the user.

## Step 2 — Assign the next scenario number

Read `${CLAUDE_PROJECT_DIR}/tests/scenarios/NEXT_SCEN_NUMBER`. The content is a plain integer (e.g. `19`). Store this as `NEXT_N`.

Zero-pad to 3 digits: `NEXT_N=7` → `SCEN-007`. This padded form is the scenario ID.

Do NOT bump the file yet — wait until the scenario file is saved in Step 7.

## Step 3 — Interview the user

Ask the user a structured set of questions. Do not dump them all at once — interleave questions with what you already know from `$ARGUMENTS`. The 12 fields you need to lock down before drafting:

1. **name** — short, kebab-case or human-readable (e.g. `title-change-lifecycle`)
2. **description** — 2-4 sentences telling the story: what the user does, what they see, what gets verified
3. **client** — which AI client(s) under test (`claude`, `codex`, `gemini`, or a list)
4. **interhosts** — true if remote hosts participate, false otherwise
5. **device** — `desktop`, `tablet`, or `smartphone`
6. **subsystems** — list of backend modules exercised (pick from the project's actual modules — ask the user, do not guess)
7. **ui_sections** — list of UI areas touched, in `Section -> Tab -> Element` arrow notation
8. **data_produced** — every artifact created during the test, with lifecycle notes
9. **prerequisites** — testable preconditions (server up, password set, CLI binary installed, etc.)
10. **governance_password** (if applicable) — the actual password string in quotes
11. **phases** — the sequence of test phases (always start with Phase 0 SAFE-SETUP and end with Phase CLEANUP)
12. **steps** — the numbered sequence of steps within each phase (S001, S002, ...)

If the project has a governance concept, ask the user for the password verbatim. Do not invent or guess — the password must be referenced verbatim in steps.

## Step 4 — Draft the frontmatter

Use the exact field set from the rules file. Required fields: `number`, `name`, `version`, `description`, `client`, `interhosts`, `device`, `subsystems`, `ui_sections`, `data_produced`, `required_tools`, `prerequisites`, `governance_password` (if the project uses one), `commit`, and optionally `author`.

Always include the 6 standard CDP tools in `required_tools`:

```yaml
required_tools:
  - mcp__chrome-devtools__navigate_page
  - mcp__chrome-devtools__take_snapshot
  - mcp__chrome-devtools__take_screenshot
  - mcp__chrome-devtools__click
  - mcp__chrome-devtools__fill
  - mcp__chrome-devtools__wait_for
```

Set `commit: TBD` and `version: "1.0"` for new scenarios.

## Step 5 — Draft the phases and steps

Phases use `##` heading level and start at Phase 0. The last phase is always `Phase CLEANUP: Restore Original State`. Between phases, use `---` horizontal rules.

Each step is a `####` heading with this exact structure:

```markdown
#### S<NNN>: <imperative action description>
- **Action:** <exact UI sequence — button labels, field values, passwords verbatim>
- **Goal:** <one verifiable assertion>
- **Creates:** <list of artifacts or "nothing">
- **Modifies:** <list of state changes or "nothing">
- **Verify:** <how to confirm — API check, screenshot match, snapshot text>
```

Number steps sequentially **across all phases** (S001, S002, ..., never restarting). Do not add non-standard fields (Timeout, Note, Failure handling) inside step blocks — put context in a blockquote before the step or phase.

## Step 6 — Enforce the rules while drafting

Every step you draft must comply with:

- **Rule 1 CLEAN-AFTER-YOURSELF** — the last phase reverts everything created
- **Rule 2 0-IMPACT** — use test-prefixed names (`scen-test-*`, `scen-<name>-*`) for all created artifacts; never mutate existing user resources
- **Rule 6 STICK-TO-UI** — every Action must be a UI interaction (click, fill, wait). No `rm`, `mv`, `tmux kill-session`, `curl -X POST|PUT|DELETE|PATCH`, or `echo ... >` in Action fields. Read-only state verification via API or `cat` is allowed in Verify fields only.
- **Rule 10 PHOTOSTORY** — every step must have a screenshot saved; the Verify field references the screenshot filename
- **Rule 12 SUDO-MODE** — if the step hits a destructive operation (delete agent, delete team, change password, etc.), the Action must include the password re-entry sub-step

Scan every Action field you draft for forbidden tokens before saving. If you find any, rewrite the Action as a UI-only sequence.

## Step 7 — Save the scenario file

Write the file to:

```
${CLAUDE_PROJECT_DIR}/tests/scenarios/SCEN-<padded-id>_<slug>.scen.md
```

The slug is derived from the `name` field (lowercase, kebab-case, 2-5 words). Example: `SCEN-019_marketplace-install-uninstall.scen.md`.

## Step 8 — Bump NEXT_SCEN_NUMBER

After the file is written, write `NEXT_N + 1` to `${CLAUDE_PROJECT_DIR}/tests/scenarios/NEXT_SCEN_NUMBER`. This reserves the next integer for the next scenario author.
