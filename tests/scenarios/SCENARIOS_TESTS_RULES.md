# Scenario Tests Rules

All UI scenario tests in AI Maestro MUST follow these rules. No exceptions.

---

## Rule 1: CLEAN-AFTER-YOURSELF

The **last phase** of every scenario MUST revert the system to the exact state it was in before the test started. Every team created, title changed, plugin installed, agent created, group added, or setting modified during the test MUST be undone.

**Undo efficiently, not step-by-step.** If you created a plugin in 30 steps (selecting skills, subagents, MCP, rules, hooks, etc.), you undo it in ONE step: delete the plugin. The goal is to reach the original state, not to reverse-replay every action. Find the shortest path to cleanup.

The cleanup phase steps are numbered and verified just like test steps — they are NOT optional. If a cleanup step fails, it MUST be fixed before the scenario is considered complete.

**Verification:** After cleanup, take a screenshot and compare with the pre-test screenshot. The UI must look identical.

---

## Rule 2: 0-IMPACT

**Never use existing user-created resources** (agents, teams, groups, plugins) for testing. Instead:

1. Create NEW elements specifically for the test (with clearly test-prefixed names, e.g. `scen-test-agent-01`, `scen-test-team-alpha`)
2. Use those test elements for all test operations
3. Remove them completely during cleanup (Rule 1)

This prevents test runs from corrupting the user's real configuration, data, or agent state. After a scenario completes, the system must be indistinguishable from one where the test never ran.

**Exception:** Reading existing state is allowed (e.g., checking how many agents exist). Only MUTATION of existing resources is forbidden.

---

## Rule 3: STATE-WIPE

Configuration files can be modified by side effects (settings.json, settings.local.json, governance.json, etc.). These must be captured and restored.

**Two mandatory checkpoints:**

1. **CHECKPOINT-SAVE (before test begins):** Backup the following files:
   - `~/.claude/settings.json`
   - `~/.claude/settings.local.json`
   - `~/.aimaestro/governance.json`
   - `~/.aimaestro/agents/registry.json`
   - `~/.aimaestro/teams/teams.json`
   - `~/.aimaestro/teams/groups.json`
   - Any agent `<agentDir>/.claude/settings.local.json` that will be touched

   Backups are saved to `tests/scenarios/state-backups/<scenario-name>_<timestamp>/`

2. **CHECKPOINT-RESTORE (during cleanup):**

   **IMPORTANT: Cleanup MUST use the UI, not file restoration.**

   The correct cleanup order is:
   1. **Delete teams via UI** (Teams page → Delete Team → password → Delete Agents Too)
   2. **Remove governance titles via UI** (Profile → title badge → AUTONOMOUS → password)
   3. **Delete remaining agents via UI** (Profile → Danger Zone → Delete Agent → check "Also delete agent folder" → type name → Delete Forever)
   4. **Verify via API** that all test artifacts are gone
   5. **THEN restore config files** from backup — ONLY for files that may have been modified by side effects (settings.json, settings.local.json, governance.json). Do NOT restore registry.json or teams.json — the UI deletions already cleaned those.

   **Why UI-first:** Restoring registry.json removes agents from the registry but leaves their tmux sessions running. These orphan sessions cause resource leaks and phantom entries on the next server poll. The UI Delete button correctly kills both the registry entry AND the tmux session.

   After restoration, verify file contents match the backup byte-for-byte.

The scenario report MUST include the backup file list and restoration verification.

---

## Rule 4: FIX-AS-YOU-GO

When a step fails due to a bug or unexpected behavior:

1. **STOP** the scenario at that step
2. **DIAGNOSE** the issue (read logs, check state, inspect DOM)
3. **FIX** the code immediately
4. **REBUILD** (`yarn build`) and restart the server if needed
5. **RETRY** the failed step from the exact same state
6. **LOOP** steps 2-5 until the step passes — no limit on attempts
7. **RESUME** the scenario from the next step

Every fix attempt is logged in the report (Rule 5). The scenario is never abandoned — it either completes fully or runs out of context window.

---

## Rule 5: TRACK-AND-REPORT

The scenario report (`tests/scenarios/reports/<scenario-name>_<timestamp>.report.md`) records:

### For every step:
- Step ID and description
- PASS / FAIL / FIXED status
- Screenshot filename (if taken)
- Timestamp

### For every bug found and fixed:
- Step ID where discovered
- Description of the bug
- Root cause analysis
- Files modified to fix
- Fix verified by: (step ID that passed after fix)

### For every issue noticed but not blocking:
- Step ID where noticed
- Description and severity (WARN / INFO)
- Potential impact if left unfixed
- Suggested fix or investigation

### Report header:
- Scenario name and version
- Commit hash at start
- Commit hash at end (if fixes were committed)
- Start/end timestamps
- Total steps: passed / failed / fixed / skipped
- CLEAN-AFTER-YOURSELF verification: PASS / FAIL
- STATE-WIPE verification: PASS / FAIL

---

## Rule 6: STICK-TO-UI

**NEVER bypass the UI** to achieve a step's goal. All interactions must go through the browser:

- Click buttons, fill forms, select options — via Chrome DevTools CDP or Claude-in-Chrome
- Do NOT call API endpoints directly with `curl` (except for state verification AFTER a UI action)
- Do NOT modify settings files directly
- Do NOT run CLI commands to achieve what the UI should do

If the UI cannot accomplish a step, that is a **BUG** — fix it (Rule 4), don't bypass it.

**Exception:** State verification (reading API responses, checking files) is allowed after a UI action to confirm the backend state matches what the UI shows.

---

## Rule 7: SAFE-SETUP

Before starting a scenario:

1. **COMMIT** all uncommitted changes: `git add <files> && git commit -m "pre-scenario: <name>"`
2. **RECORD** the commit hash in the scenario report
3. **OPTIONALLY** run in a git worktree for full isolation: `git worktree add ../scen-<name> HEAD`
4. **BUILD** the project: `yarn build`
5. **START** the server: `pm2 restart ai-maestro` (or `yarn dev`)
6. **VERIFY** the server is healthy: check `GET /api/sessions` returns 200

If running in a worktree, all scenario artifacts (screenshots, reports, backups) are saved inside the worktree, then copied to the main tree on completion.

---

## Rule 8: CHROME-TOOL

Scenario tests use **Chrome DevTools Protocol (CDP)** via the `mcp__chrome-devtools__*` MCP tools. These are preferred over Claude-in-Chrome because:
- CDP works without the Chrome extension installed
- CDP provides reliable element targeting via accessibility tree UIDs
- CDP screenshots capture the actual rendered state

### Required tools:
| Tool | Purpose |
|------|---------|
| `navigate_page` | Navigate to URLs |
| `take_snapshot` | Get accessibility tree (element UIDs) |
| `take_screenshot` | Visual capture for verification |
| `click` | Click buttons, links, cards |
| `fill` | Type into text inputs |
| `wait_for` | Wait for text/state to appear |
| `select_page` | Switch between browser tabs |

### Best practices:
- Always `take_snapshot` before interacting to get fresh UIDs
- Always `take_screenshot` after critical state changes for the report
- Use `wait_for` after actions that trigger async operations (API calls, plugin installs)
- Use `bringToFront: false` on `select_page` to avoid desktop switching

---

## Rule 9: REPORT-FORMAT

The scenario report file follows this exact structure:

```markdown
---
scenario: <scenario-name>
version: <scenario-version>
commit_start: <git-hash>
commit_end: <git-hash-or-same>
started_at: <ISO-timestamp>
completed_at: <ISO-timestamp>
result: PASS | FAIL | PARTIAL
steps_total: <N>
steps_passed: <N>
steps_failed: <N>
steps_fixed: <N>
bugs_found: <N>
bugs_fixed: <N>
issues_noticed: <N>
cleanup_verified: true | false
state_wipe_verified: true | false
---

# Scenario Report: <scenario-name>

## Summary
<1-3 sentence summary of what was tested and the outcome>

## Environment
- Server: http://localhost:23000
- Build: <yarn build output summary>
- Browser: Chrome via CDP

## Steps

### Phase N: <phase-name>

| Step | Action | Expected | Actual | Status | Screenshot |
|------|--------|----------|--------|--------|------------|
| S001 | ... | ... | ... | PASS | scen-001.png |

## Bugs Found & Fixed

### BUG-001: <title>
- **Discovered at:** Step S<NNN>
- **Symptom:** ...
- **Root cause:** ...
- **Fix:** <file>:<lines> — <description>
- **Verified at:** Step S<NNN> (retry)

## Issues Noticed (Non-Blocking)

### ISSUE-001: <title>
- **Noticed at:** Step S<NNN>
- **Severity:** WARN | INFO
- **Description:** ...
- **Suggested fix:** ...

## Cleanup Verification

| Action | Expected | Actual | Status |
|--------|----------|--------|--------|
| Remove test team | Team deleted | Confirmed via API | PASS |
| ... | ... | ... | ... |

## State-Wipe Verification

| File | Backup hash | Restored hash | Match |
|------|-------------|---------------|-------|
| ~/.claude/settings.json | abc123 | abc123 | YES |
| ... | ... | ... | ... |
```

---

## Scenario File Format

Scenario files are saved in `tests/scenarios/` with the naming convention:

```
SCEN-<NNN>_<scenario-name>.scen.md
```

Where `<NNN>` is a zero-padded unique number (001, 002, ...). This allows referencing scenarios by number: "run scenario 14" → `SCEN-014_*.scen.md`.

Example: `SCEN-001_title-change-lifecycle.scen.md`

**Numbering rules:**
- Numbers are assigned sequentially and never reused (even if a scenario is deleted)
- The current highest number is tracked in `tests/scenarios/NEXT_SCEN_NUMBER` (plain text, e.g. `4`)
- Each scenario's number is also in its YAML frontmatter (`number: 1`)

### Frontmatter (YAML):

All fields are **required** unless marked (optional).

```yaml
---
number: <unique integer>            # Matches filename SCEN-<NNN>. Never reused.
name: <human-readable scenario name> # Short title, no quotes needed
version: "1.0"                      # Semver string. Bump on breaking step changes.
description: >                      # Multi-line. Must answer: what is tested, why,
  <What this scenario tests>        # and what governance rules are validated.
subsystems:                         # Backend services/modules exercised.
  - governance                      # Pick from: governance, teams, agent-registry,
  - role-plugins                    # element-management-service, agent-messaging,
  - agent-registry                  # role-plugins, kanban, cross-client-conversion-service,
                                    # sessions-service, groups-service
ui_sections:                        # Every UI area the scenario touches.
  - Sidebar -> Agents tab           # Use arrow notation: Section -> Tab -> Element
  - Agent Profile -> Overview tab -> Governance Title
  - Title Assignment Dialog (radio cards, password prompt)
data_produced:                      # Every artifact created during the test.
  - 2 test agents (temporary)       # Format: <count> <what> (<lifecycle>)
  - 1 test team (temporary)         # Lifecycle: "temporary, created and deleted"
  - Plugin settings modifications   # or "temporary, restored via STATE-WIPE"
required_tools:                     # CDP tools used. Always include all 6 below.
  - mcp__chrome-devtools__navigate_page
  - mcp__chrome-devtools__take_snapshot
  - mcp__chrome-devtools__take_screenshot
  - mcp__chrome-devtools__click
  - mcp__chrome-devtools__fill
  - mcp__chrome-devtools__wait_for
prerequisites:                      # Conditions that must be true BEFORE Phase 0.
  - AI Maestro server running at http://localhost:23000
  - Governance password set
  - Chrome browser open with DevTools accessible via CDP
  - ai-maestro-plugins marketplace registered
  - <any scenario-specific requirements, e.g. "Codex CLI installed">
governance_password: "<password>"   # The actual password value, in quotes.
                                    # Every step that needs it must reference it
                                    # verbatim — never write just "password".
commit: <git-hash or TBD>          # Hash at time of writing. Updated after first run.
author: <who wrote the scenario>    # (optional) Person or team name.
---
```

**Field rules:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `number` | integer | yes | Must match `SCEN-<NNN>` in filename. Unique, never reused. |
| `name` | string | yes | Short, descriptive. Used in report headers. |
| `version` | string | yes | Always quoted (`"1.0"`). Bump on step changes. |
| `description` | multiline | yes | Use `>` folded scalar. Explain what and why. |
| `subsystems` | list | yes | Backend modules exercised. At least 1. |
| `ui_sections` | list | yes | UI areas touched. Use `->` arrow notation. |
| `data_produced` | list | yes | Every artifact created. Include lifecycle note. |
| `required_tools` | list | yes | Always include the 6 standard CDP tools. |
| `prerequisites` | list | yes | Testable conditions. Include CLI checks (e.g., `which codex`). |
| `governance_password` | string | yes | Actual password in quotes. Referenced verbatim in steps. |
| `commit` | string | yes | Git hash or `TBD`. Updated after first successful run. |
| `author` | string | no | Person or team. |

### Phase format:

Phases are numbered starting at 0. Use `##` heading level. Phase 0 is always `SAFE-SETUP`. The last phase is always `CLEANUP`.

```markdown
## Phase 0: SAFE-SETUP
## Phase 1: <name>
## Phase 2: <name>
...
## Phase CLEANUP: Restore Original State
```

A `---` horizontal rule separates each phase.

Between phases, you may add a `> **Note:**` blockquote to explain context, known discrepancies, or what to observe. These are documentation — not executable steps.

### Step format:

Steps are numbered sequentially across all phases: S001, S002, ... S028. Never restart numbering within a phase. Use `####` heading level.

**Regular steps (creating, modifying, or verifying):**

```markdown
#### S<NNN>: <imperative action description>
- **Action:** <exact UI actions — button names, field values, passwords verbatim>
- **Goal:** <what must be true after this step — one verifiable assertion>
- **Creates:** <list of elements created, or "nothing">
- **Modifies:** <list of existing state modified, or "nothing">
- **Verify:** <how to confirm — API check, screenshot, text match in snapshot>
```

**Rules for each field:**

| Field | Required | Content |
|-------|----------|---------|
| `Action` | yes | Exact UI sequence. Spell out button labels, input values, passwords. Never write "enter password" — write `enter password \`mYkri1-xoxrap-gogtan\``. |
| `Goal` | yes | Single verifiable assertion. Not a wish — a testable fact. |
| `Creates` | yes | List of artifacts created, or `nothing`. Include where (registry, filesystem, tmux). |
| `Modifies` | yes | List of state changes, or `nothing`. Be specific (field names, file paths). |
| `Verify` | yes | How to confirm. API endpoint + expected value, screenshot filename, or snapshot text match. |

**Do NOT add** non-standard fields (Timeout, Note, Failure handling, etc.) to steps. If context is needed, put it in a blockquote before the step or phase.

**Cleanup steps (deleting, removing, restoring):**

```markdown
#### S<NNN>: Revert <what>
- **Action:** <exact UI actions to undo>
- **Goal:** <element removed / state restored>
- **Removes:** <what is being removed — replaces Creates/Modifies>
- **Verify:** <confirmation — API 404, file hash match, screenshot comparison>
```

**The last cleanup step is always STATE-WIPE:**

```markdown
#### S<LAST>: STATE-WIPE — Restore configuration files
- **Action:** Compare current config files with backups from S002. Restore any that differ.
- **Goal:** All config files match pre-test state
- **Removes:** nothing
- **Verify:** File hash comparison — all 6 files match
```

**The final step is always a post-test screenshot:**

```markdown
#### S<LAST+1>: Post-test screenshot
- **Action:** `take_screenshot` of full page
- **Goal:** UI identical to Phase 0 baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved. Visual comparison with baseline screenshot.
```

---

## Rule 10: PHOTOSTORY

**Every step MUST have a screenshot saved** as proof of completion. If a scenario has 40 steps, there must be 40 screenshots — no exceptions.

**Naming convention:**
```
tests/scenarios/screenshots/SCEN-<NNN>/S<NNN>-<short-description>.png
```

Example: `SCEN-009/S014-task-sent.png`, `SCEN-009/S033-manager-removed.png`

**When to capture:**
- **After** the step's action is completed and the expected result is visible
- For steps that modify UI state: capture the UI showing the new state
- For API-verification steps: capture the profile panel or sidebar showing the verified data
- For cleanup steps: capture the UI confirming the artifact is removed

**The screenshot is part of the step's verification.** A step without a screenshot is considered incomplete. The report's step table must include the screenshot filename for every row.

**Why:** Screenshots create an unambiguous audit trail. When reviewing scenario results weeks later, screenshots prove what actually happened at each step, preventing false PASS claims.

---

## Rule 11: 11th-HOUR

After the scenario test completes and the report is saved, execute an **in-depth analysis** of the results. Think deeply about unsolved problems and propose concrete solutions.

**The analysis must cover:**
1. Bugs found during the run that remain unfixed
2. Pre-existing issues that interfered with the test
3. Workflow inefficiencies observed in agent behavior
4. Governance rule gaps or ambiguities exposed by the test
5. API design issues that caused agents to fail or retry

**Proposed solutions must use one or more of these methods:**

| Category | Examples |
|----------|----------|
| **Bug fixes** | Fix root cause in ai-maestro code, UI, or API (no workarounds) |
| **API improvements** | New endpoints, new options on existing endpoints, better error messages |
| **Script improvements** | New options or fixes in ai-maestro CLI scripts |
| **ai-maestro-plugin improvements** | New/improved skills, hooks, scripts in the main plugin |
| **Role-plugin improvements** | Improve main-agent .md, sub-agents, skills, or other elements |
| **Workflow rule changes** | Modify/add rules for agents with specific titles |
| **Cross-title workflow changes** | Coordinated rule changes across multiple title agents |
| **Governance rule proposals** | Changes to docs/GOVERNANCE-RULES.md |
| **Test infrastructure** | New tracking/debugging methods for scenario UI tests |
| **New scenarios** | Propose new scenarios focused on investigating specific issues |

**Output:** Save the writeup to:
```
tests/scenarios/reports/scenario_proposed-improvements_<NNN>_<datetime>.md
```

The file must reference the scenario report it is based on. Each proposal must include: problem description, root cause analysis, proposed solution with specific files/changes, and priority (P0-P3).

---

## Directory Structure

```
tests/scenarios/
  SCENARIOS_TESTS_RULES.md        ← This file
  NEXT_SCEN_NUMBER                ← Next available scenario number (plain text)
  SCEN-001_<name>.scen.md         ← Scenario definition files
  SCEN-002_<name>.scen.md
  reports/
    SCEN-001_<timestamp>.report.md ← Execution reports
  screenshots/
    SCEN-001/                      ← Screenshots per scenario run
      S001-<description>.png
      S002-<description>.png
  state-backups/
    SCEN-001_<timestamp>/          ← Config file backups for STATE-WIPE
```
