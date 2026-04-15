# Scenario Tests Rules

## Purpose

The ultimate aim of UI scenario tests is NOT just to verify that features work. The real value is the **11th-HOUR analysis** (Rule 11): after each scenario run, a deep investigation produces **concrete improvement proposals** — bug fixes, API redesigns, governance rule changes, workflow optimizations, and new scenarios. These proposals are the primary deliverable. The test steps are the instrument; the improvements are the product.

Every scenario run should produce a `scenario_proposed-improvements_<NNN>_<datetime>.md` report with actionable proposals. These proposals are then reviewed, prioritized, and implemented before the next scenario batch. Over time, this creates a virtuous cycle: tests find issues, issues get fixed, fixes get verified by re-running the same scenarios.

All UI scenario tests in AI Maestro MUST follow these 11 rules. No exceptions.

---

## Table of Contents

1. [Rule 1: CLEAN-AFTER-YOURSELF](#rule-1-clean-after-yourself) — Revert system to pre-test state
2. [Rule 2: 0-IMPACT](#rule-2-0-impact) — Never use existing user resources
3. [Rule 3: STATE-WIPE](#rule-3-state-wipe) — Backup and restore config files
4. [Rule 4: FIX-AS-YOU-GO](#rule-4-fix-as-you-go) — Fix bugs immediately during test
5. [Rule 5: TRACK-AND-REPORT](#rule-5-track-and-report) — Record every step and bug
6. [Rule 6: STICK-TO-UI](#rule-6-stick-to-ui) — All actions through the browser
7. [Rule 7: SAFE-SETUP](#rule-7-safe-setup) — Commit, build, verify before test
8. [Rule 8: DEV-BROWSER](#rule-8-dev-browser) — Use the `dev-browser` CLI (sandboxed JS) for ALL UI automation
9. [Rule 9: REPORT-FORMAT](#rule-9-report-format) — Structured markdown report
10. [Rule 10: PHOTOSTORY](#rule-10-photostory) — Screenshot at every critical step + auto-purge after fix verification
11. [Rule 11: 11th-HOUR](#rule-11-11th-hour) — Post-scenario deep analysis and improvement proposals
12. [Rule 12: SUDO-MODE](#rule-12-sudo-mode) — Password re-entry for destructive operations
13. [Rule 13: AUTONOMOUS-PROTOCOL](#rule-13-autonomous-protocol) — How a long unattended overnight batch is structured
14. [How-To: Running a Scenario](#how-to-running-a-scenario) — Practical guidance for the test executor

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
   1. **Delete teams via UI** (Teams tab → Delete Team → enter governance password → check "Delete Agents Too" → Delete Team)
   2. **Remove governance titles via UI** (Profile → title badge → AUTONOMOUS → password)
   3. **Delete remaining agents via UI** (Profile → Advanced → Danger Zone → Delete Agent → check "Also delete agent folder" → type name → Delete Forever)
   4. **Purge cemetery entries via UI** (Settings → Cemetery → Purge for each test agent)
   5. **Verify via API** that all test artifacts are gone (no test agents in registry, no test teams in teams.json, no test entries in cemetery)
   6. **THEN restore config files** from backup — ONLY for files that may have been modified by side effects (settings.json, settings.local.json, governance.json). Do NOT restore registry.json or teams.json — the UI deletions already cleaned those.

   **Why UI-first:** Restoring registry.json removes agents from the registry but leaves their tmux sessions running and agent folders on disk. These orphan sessions cause resource leaks and phantom entries on the next server poll. The UI Delete button correctly kills the tmux session, removes the registry entry, AND deletes the agent folder (when "Also delete agent folder" is checked).

   **NEVER use bash/CLI to delete agent folders.** That is a Rule 6 violation. The "Also delete agent folder" checkbox in the Delete Agent dialog handles folder cleanup. If agent folders remain after UI deletion, that is a BUG to report — not a reason to use bash.

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
7. **KILL ORPHAN TEST SESSIONS:** Kill any tmux sessions from previous test runs:
   ```bash
   tmux list-sessions | grep '^scen-' | cut -d: -f1 | xargs -I{} tmux kill-session -t {}
   tmux list-sessions | grep '^cos-scen-' | cut -d: -f1 | xargs -I{} tmux kill-session -t {}
   ```
   This prevents dead sessions from interfering with the test or cluttering the UI.

If running in a worktree, all scenario artifacts (screenshots, reports, backups) are saved inside the worktree, then copied to the main tree on completion.

---

## Rule 8: DEV-BROWSER

**Scenario tests MUST use the `dev-browser` plugin and its inner `dev-browser:dev-browser` skill for ALL browser automation.** This replaces the previous chrome-devtools MCP requirement (deprecated 2026-04-15). The `chromedev-tools` MCP plugin is allowed only as an interactive debugging tool — production scenario runs use dev-browser exclusively.

### Mandatory entry point — load the skill FIRST

At the very start of every scenario run, before any `dev-browser` CLI call, the runner MUST invoke the skill via the Skill tool:

```
Skill(skill: "dev-browser:dev-browser")
```

This loads the official skill content from the `dev-browser` plugin (delivered via the marketplace `dev-browser-marketplace`). The skill content points at the `dev-browser` CLI binary, so AFTER the skill is loaded the runner uses Bash to drive the CLI (see "How to invoke" below). Loading the skill via the Skill tool is mandatory because (a) it ensures the runner is using the canonical plugin API as resolved by Claude Code's plugin manager (the actual on-disk path is an internal implementation detail and may change between Claude Code versions or plugin updates — never reference it directly), and (b) it triggers any plugin-side initialization. **A scenario run that calls `dev-browser` from Bash without first invoking the skill is non-compliant — the runner must self-correct by invoking the skill, then re-doing the prior Bash call. Never hardcode any path under `~/.claude/plugins/cache/` — that directory is ephemeral and may be cleared at any time by a plugin reload.**

### Why dev-browser

| Concern | dev-browser | chrome-devtools MCP (deprecated) |
|---------|-------------|----------------------------------|
| Persistent state across scripts | YES — named pages stay alive between invocations | NO — each MCP call spawns a fresh page |
| Shared Chromium across scenarios | YES — one daemon, many scripts | NO — every fork spawns a private Chromium |
| Memory footprint per batch | ~300 MB | ~4 GB (45 orphan watchdog processes) |
| Browser extension dependency | NO (Playwright-launched Chromium) | NO |
| Sandbox safety | YES (QuickJS, no host access) | NO (raw CDP) |
| Speed (22-scenario batch) | ~3m 53s, $0.88 | ~12m 54s, $2.81 |
| Tool-loading cost | ZERO (CLI, no MCP schemas) | ~30k tokens of MCP schema per fork |

### How to invoke

The runner uses Bash heredoc to pipe a JavaScript blob into `dev-browser`. The script runs in a QuickJS sandbox with a pre-connected `browser` global. Top-level `await` is supported.

```bash
dev-browser <<'EOF'
const page = await browser.getPage("main");        // persistent named page
await page.goto("http://localhost:23000/");
const buf = await page.screenshot({ type: "jpeg", quality: 97 });
await saveScreenshot(buf, "S001_baseline");        // saves to ~/.dev-browser/tmp/
console.log(JSON.stringify({ url: page.url() }));
EOF
```

### Sandbox API (the only globals available inside the script)

| Symbol | Purpose |
|---|---|
| `browser.getPage(name)` | Get/create a named page. Persists across invocations. |
| `browser.newPage()` | Anonymous page (cleaned up on script exit). |
| `browser.listPages()` | List all open tabs `[{id, url, title, name}]`. |
| `browser.closePage(name)` | Close a named page. |
| `page.goto(url)` | Navigate. |
| `page.click(selector)` | Click an element. |
| `page.fill(selector, text)` | Type into an input. |
| `page.waitForSelector(selector)` | Wait for element to appear. |
| `page.evaluate(fn)` | Run JS in the page context. |
| `page.screenshot({type, quality})` | Returns a Uint8Array buffer. Pass to `saveScreenshot()`. |
| `page.title()` / `page.url()` | Read page metadata. |
| `console.log/warn/error/info` | Routed to CLI stdout — the runner reads these for return values. |
| `setTimeout / clearTimeout` | Timers. |
| `saveScreenshot(buf, name)` | Persist a screenshot to `~/.dev-browser/tmp/<name>.jpg`. |
| `writeFile(name, data)` / `readFile(name)` | Sandbox file I/O (within `~/.dev-browser/tmp/`). |

**NOT available** (this is QuickJS, NOT Node.js): `require()`, `import()`, `process`, `fs`, `path`, `os`, `fetch`, `WebSocket`, `__dirname`, `__filename`. If you need any of these, do them OUTSIDE the heredoc via Bash.

### Persistent named-page pattern (the magic)

The KEY advantage over chrome-devtools MCP is that `browser.getPage("dashboard")` returns the SAME tab across multiple `dev-browser` invocations. The tab keeps its URL, cookies, login state, scroll position, etc. This means:

```bash
# Step 1: log in (once, in the master setup)
dev-browser <<'EOF'
const page = await browser.getPage("dashboard");
await page.goto("http://localhost:23000/");
await page.fill('input[type=password]', "<PASSWORD>");
await page.click('button[type=submit]');
await page.waitForSelector('[data-testid=agent-list]');
EOF

# Step 2..N: every subsequent dev-browser call reuses the SAME logged-in page
dev-browser <<'EOF'
const page = await browser.getPage("dashboard");  // same page, still logged in
await page.click('[data-testid="create-agent-btn"]');
EOF
```

No re-login. No fresh cookies. No new Chromium. The runner relies on this for shared state across scenarios.

### Required helpers (`tests/scenarios/scripts/dev-browser-helpers/`)

To avoid every scenario reimplementing the AI Maestro login flow, sudo modal handling, screenshot path generation, etc., the runner pre-loads helper functions from `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh`. This file is sourced by the runner BEFORE every `dev-browser` heredoc and exports shell functions like `aim_login`, `aim_screenshot`, `aim_sudo_modal`, `aim_create_agent`, `aim_delete_agent`. Each helper wraps a `dev-browser <<'EOF' ... EOF` call. See the helpers directory for the canonical implementations and add new ones there as scenarios need them.

### Snapshot-equivalent — DOM dump for assertions

Without chrome-devtools' accessibility-tree snapshot, the runner uses `page.evaluate` to dump the relevant DOM state for inspection:

```bash
dev-browser <<'EOF'
const page = await browser.getPage("dashboard");
const buttons = await page.evaluate(() => {
  return Array.from(document.querySelectorAll('button')).map(b => ({
    text: b.textContent.trim(),
    disabled: b.disabled,
    visible: b.offsetParent !== null
  }));
});
console.log(JSON.stringify(buttons));
EOF
```

The runner parses the JSON output to drive subsequent decisions.

### Device emulation (for `device: tablet` and `device: smartphone` scenarios)

dev-browser's underlying Playwright supports viewport + touch emulation via `page.evaluate` calling Chromium's CDP method, OR (preferred) the runner spawns the daemon with the right viewport flags from the start:

```bash
# Smartphone test — start daemon with iPhone 14 viewport
dev-browser daemon stop 2>/dev/null
PLAYWRIGHT_VIEWPORT_WIDTH=390 PLAYWRIGHT_VIEWPORT_HEIGHT=844 \
  PLAYWRIGHT_DEVICE_SCALE_FACTOR=3 PLAYWRIGHT_IS_MOBILE=1 \
  dev-browser daemon start

# Now every dev-browser call uses the mobile viewport
dev-browser <<'EOF'
const page = await browser.getPage("dashboard");
await page.goto("http://localhost:23000/");
EOF
```

**Always revert to desktop in the CLEANUP phase** by restarting the daemon without the env vars. Subsequent scenarios start with desktop viewport.

| `device` value | Viewport | Scale | Touch | Component set |
|---------------|----------|-------|-------|---------------|
| `desktop` | 1280×800 | 1x | no | Standard (AgentList, TerminalView, AgentProfile) |
| `tablet` | 1024×768 | 2x | yes | TabletDashboard, TouchScrollbar |
| `smartphone` | 390×844 | 3x | yes | MobileDashboard, MobileKeyToolbar, MobileChatView, MobileMessageCenter, GlobalTouchScrollbars |

**Caveat (same as before):** multi-finger gestures, long-press with sub-second precision, native mobile browser chrome, and the hardware back button cannot be tested via dev-browser/Playwright — these are accepted limitations.

### Daemon lifecycle (master setup/cleanup level, NOT per-scenario)

In the autonomous overnight protocol (Rule 13), the master setup phase starts ONE dev-browser daemon for the whole batch, and the master cleanup phase stops it. Per-scenario subagents NEVER call `daemon start/stop` themselves — they assume a running daemon and just send scripts to it.

```bash
# master setup (run-scenarios-batch master phase)
dev-browser daemon start

# per-scenario runner (do NOT touch daemon lifecycle)
dev-browser <<'EOF'
const page = await browser.getPage("dashboard");
...
EOF

# master cleanup
dev-browser daemon stop
```

### Reading agent terminal history (unchanged)

Claude Code uses the xterm alternate screen buffer — `tmux capture-pane` only captures the visible pane (not scrollback from Claude's session). To read what an agent actually did:

1. Find the conversation log: `ls -lt ~/.claude/projects/-Users-<user>-agents-<name>/*.jsonl | head -1`
2. Analyze with LLM Externalizer: `code_task` with instructions to extract actions, errors, and outcomes
3. This is the **authoritative source** — not terminal screenshots (which may only show the final idle prompt)

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
description: >                      # Multi-line. Tell the user's story: what they
  <What the user does step by step> # do, what they see, what gets verified.
client: claude                      # AI client(s) under test. One of:
                                    # "claude", "codex", "gemini", or a list
                                    # for multi-client scenarios: [claude, codex]
interhosts: false                   # true if agents from remote hosts participate.
                                    # Requires Tailscale + hosts.json with peers.
device: desktop                     # Browser viewport: "desktop", "tablet", or
                                    # "smartphone". Controls window size and which
                                    # component set is tested (standard vs touch).
                                    # desktop=1280x800, tablet=1024x768, smartphone=390x844
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
# NOTE: `client` goes between `description` and `subsystems` (see above).
# For multi-client scenarios use YAML list: client: [claude, codex]
---
```

**Field rules:**

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| `number` | integer | yes | Must match `SCEN-<NNN>` in filename. Unique, never reused. |
| `name` | string | yes | Short, descriptive. Used in report headers. |
| `version` | string | yes | Always quoted (`"1.0"`). Bump on step changes. |
| `description` | multiline | yes | Use `>` folded scalar. Tell the user's story. |
| `client` | string or list | yes | AI client(s) under test: `claude`, `codex`, `gemini`, or `[claude, codex]`. |
| `interhosts` | boolean | yes | `true` if scenario involves agents on remote hosts (Tailscale mesh). |
| `device` | string | yes | Browser viewport: `desktop` (1280x800), `tablet` (1024x768), or `smartphone` (390x844). Determines which component set is tested (standard vs touch-friendly). |
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

**Naming convention (timestamped — both directory and file):**

At the very start of each scenario run, the runner MUST generate a single run identifier in ISO 8601 basic format:

```
RUN_ID=$(date -u +%Y%m%dT%H%M%SZ)
# example: RUN_ID=20260414T143000Z
```

Every screenshot for that run is then saved under a **timestamped per-run subdirectory** AND the file itself **also carries the same timestamp**, so both the dir and the file are unambiguous even if someone moves or copies them:

```
tests/scenarios/screenshots/SCEN-<NNN>_<RUN_ID>/S<NNN>_<RUN_ID>_<short-desc>.jpg
```

Examples (for a scenario run started at 2026-04-14T14:30:00Z):

```
tests/scenarios/screenshots/SCEN-009_20260414T143000Z/S014_20260414T143000Z_task-sent.jpg
tests/scenarios/screenshots/SCEN-009_20260414T143000Z/S033_20260414T143000Z_manager-removed.jpg
```

**Format: JPEG 97%** — not PNG. UI screenshots compress well as JPEG 97% with no visible quality loss, and saves ~50 MB per 22-scenario batch vs PNG. If your browser automation MCP only produces PNG, convert each file immediately after capture using `sips -s format jpeg -s formatOptions 97 <file>.png --out <file>.jpg && rm <file>.png`, or call `tests/scenarios/scripts/compress-screenshots.sh` at the end of your run to batch-convert. The canonical on-disk format is `.jpg`.

**Why both dir AND filename carry the timestamp:**

- The directory ensures each run has its own isolated namespace — no overwrite, no mixing, no cruft from old runs
- The filename carries the same timestamp as a safety net for when someone moves, copies, or extracts a single file outside its dir (the file still self-identifies)
- Sorting by filename puts all steps of a given run next to each other chronologically
- Multiple runs of the same scenario are trivially comparable (diff their run dirs)

**When to capture:**
- **After** the step's action is completed and the expected result is visible
- For steps that modify UI state: capture the UI showing the new state
- For API-verification steps: capture the profile panel or sidebar showing the verified data
- For cleanup steps: capture the UI confirming the artifact is removed

**The screenshot is part of the step's verification.** A step without a screenshot is considered incomplete. The report's step table must include the screenshot filename for every row.

**Why:** Screenshots create an unambiguous audit trail. When reviewing scenario results weeks later, screenshots prove what actually happened at each step, preventing false PASS claims AND preventing cross-run contamination when the same scenario is run multiple times.

### Auto-purge after fix verification (added 2026-04-15)

Screenshots are heavyweight (~50 MB per 22-scenario batch even at JPEG 97%). Once a scenario PASSES (its bugs are fixed AND verified by a re-run that landed on the same fixed code), its screenshots have served their purpose: the audit trail can be reconstructed from git history alone if needed. **In an autonomous overnight batch (Rule 13), the runner MUST auto-purge per-run screenshot directories after the scenario's fixes are confirmed verified.**

**The exact rule:** at the END of every scenario run, the runner inspects the verdict. If the verdict is `PASS` AND every bug found during the run was fixed AND the fix was verified (the previously failing step now passes), the runner deletes its own per-run screenshot directory:

```bash
rm -rf "${CLAUDE_PROJECT_DIR}/tests/scenarios/screenshots/SCEN-${NNN}_${RUN_ID}"
```

**Exceptions where screenshots MUST be kept** (do NOT delete in any of these cases):
- Verdict is `FAIL`, `PARTIAL`, or `STUCK` — the screenshots are evidence for the postmortem
- The scenario found a bug it could NOT fix (deferred to a P0 proposal) — screenshots are evidence for the proposal
- The verification re-run was NOT performed (single-pass run only) — keep until the next batch confirms
- The scenario is a smoke test or baseline run with no bugs found — screenshots are baseline evidence and stay

**The runner reports the deletion in its summary line** so the parent batch conductor can verify (the report's `screenshots_purged: true|false` field). The conductor logs total disk reclaimed at the end of the batch.

**Why this is safe:** the per-run screenshot directory uses the timestamped naming convention from earlier in this rule (`SCEN-NNN_<RUN_ID>/...`). A purge of one run's directory cannot ever affect a different run's screenshots, even for the same scenario. The git-tracked report file (`tests/scenarios/reports/SCEN-NNN_<timestamp>.report.md`) survives the purge — it records every step, every bug, every fix, and the path to the (now-deleted) screenshots, so the audit trail is intact even if a future investigation needs to re-create the visual evidence (which can be done by re-running the scenario).

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

## Rule 12: SUDO-MODE

AI Maestro implements a **sudo-mode** layer (SEC-PHASE-3..5, v3.5.0+). Every
API route classified `strict` in `security-registry.json` rejects requests
that don't carry a fresh `X-Sudo-Token` earned by re-entering the governance
password within the last 60 seconds. The token is one-shot — it's consumed
on the first request that uses it.

### What this means for scenarios

Whenever a scenario step performs a destructive operation (delete agent,
delete team, uninstall plugin, change title, stop session, restart session,
change password, etc.), the **UI will pop a sudo password modal** the first
time you click the destructive button within a 60-second window. The modal
is implemented by `contexts/SudoContext.tsx` and handled transparently by
`lib/sudo-fetch.ts`. Every `fetch(...)` call that targets a strict route
MUST be routed through `sudoFetch` so the retry loop works.

### Scenarios MUST include the sudo step

Any step that hits a strict operation MUST also include a
**password re-entry sub-step** in its action list:

> **Action:** Click "Delete Agent" in the Danger Zone. When the sudo
> password modal appears, enter the governance password
> `mYkri1-xoxrap-gogtan` and click Confirm. Then type the agent name
> in the confirmation field and click Delete Forever.

If the scenario does NOT show the sudo modal appearing, that is a BUG
(Rule 4: fix it immediately) — either the caller is not using sudoFetch,
or the route is not classified as strict when it should be.

### List of routes classified strict

Canonical source: `security-registry.json` at the project root. At
v3.6.0 the strict routes are:

| Route | Used by scenarios |
|-------|-------------------|
| `DELETE /api/agents/[id]` | Every scenario's cleanup phase |
| `DELETE /api/teams/[id]` | SCEN-001, SCEN-002, SCEN-005, SCEN-009, SCEN-010, SCEN-014 |
| `DELETE /api/agents/cemetery/[id]` | Cleanup phase of every scenario that deletes an agent |
| `POST /api/governance/password` | SCEN-001 governance password setup |
| `DELETE /api/settings/marketplaces` | SCEN-019 cleanup |
| `DELETE /api/agents/role-plugins/install` | SCEN-019, SCEN-020, SCEN-021 cleanup |
| `PATCH /api/agents/[id]/title` | SCEN-001 title lifecycle |
| `POST /api/agents/[id]/stop` | SCEN-011 stop session tests |
| `POST /api/sessions/[id]/restart` | Element restart queue tests |

When a NEW strict route is added to `security-registry.json`, update
this table AND every scenario that touches that route.

### Sudo modal recognition pattern for Chrome DevTools MCP

```
take_snapshot          → find modal with text "Confirm with password"
click (password input) → focus
fill (password input)  → type governance password
click "Confirm" button → submit
wait_for               → modal disappears
```

The modal has `role="dialog"` and `aria-modal="true"` so it is reliably
locatable via accessibility tree.

### 60-second window caveat

If a scenario performs multiple strict operations in a row, only the
FIRST one triggers the modal — subsequent operations within 60 seconds
of the previous sudo-token acquisition re-prompt because sudo tokens are
**one-shot**. Each strict operation needs its own fresh token. If you
batch 10 deletes in a cleanup phase, expect to see 10 modals. This is
by design (sudo-mode rejects replayed tokens) and the scenario should
plan for it accordingly.

### Team delete uses an inline password — no modal

`DELETE /api/teams/[id]` is the one exception: the existing Delete Team
dialog already collects the governance password inline before any
destructive action (because team deletion pre-dates sudo-mode and uses
the password in the request body for the governance-service layer). The
client code in `components/sidebar/TeamListView.tsx` exchanges that
inline password for a sudo token BEFORE the DELETE call, so the sudo
modal does NOT appear on top of the team delete dialog. The inline
dialog IS the sudo check.

---

## Rule 13: AUTONOMOUS-PROTOCOL

This rule defines how a long unattended scenario batch is structured so it can run for 6-12 hours without human supervision and survive every API rate-limit window the user's Pro Max 20× subscription throws at it. **It supersedes the previous Option B (FileChanged + bot) design from TRDD-1222f06a, which was empirically disproven 2026-04-15.** The protocol below is the proven 3-component cron architecture documented in TRDD-1222f06a §9.

### Background — the mental model

Claude Code does NOT exit on rate-limit / API errors. Only the current TURN ends. The Node.js event loop, the in-memory cron scheduler, the shared dev-browser daemon, the Chromium pages — all keep running. When the rate-limit window clears (or the account switcher rotates to a fresh OAuth token), the next scheduled cron fire becomes a fresh API call that succeeds, and work resumes from where state.json left off.

### The 3 components of an autonomous run

1. **Passive account switcher** — at least 2 OAuth tokens stored in `~/.claude/account-switcher/`. When the active token hits a 429, the switcher rotates instantly. The switcher does NOT wake claude — it just makes the next API call use a fresh token.

2. **Recurring durable cron** — created via `CronCreate` with `durable: true` at a 5-20 min interval. **The cron IS the wake-up mechanism.** Every fire becomes a fresh user turn. Fires that hit 429 cooldown queue and deliver in batch when the REPL goes back to idle. The cron persists in `.claude/scheduled_tasks.json` so it survives `claude --continue` restarts.

3. **Idempotent state file + run-one-step prompt** — the state file at `tests/scenarios/state/autonomous-batch-state.json` tracks which scenarios are pending / in-progress / done / failed, plus the list of fix branches and PR URLs. The cron prompt is short and idempotent: "read state, run the next pending scenario via the run-scenario-test skill, update state, exit". Each cron fire executes ONE scenario (or one fix iteration). If the same fire is delivered twice (rate-limit queue artifact), the idempotent state read makes the second fire a no-op.

### The autonomous batch state file

Path: `tests/scenarios/state/autonomous-batch-state.json` (gitignored — runtime artifact)

```json
{
  "batch_id": "auto-2026-04-15T12-00-00Z",
  "started_at": "2026-04-15T12:00:00Z",
  "completed_at": null,
  "scenario_list": ["SCEN-001", "SCEN-002", ..., "SCEN-022"],
  "current_index": 0,
  "phase": "master_setup | running | master_cleanup | consolidated | failed",
  "scenarios": {
    "SCEN-001": {
      "status": "pending | in_progress | passed | failed | partial | stuck",
      "started_at": null,
      "completed_at": null,
      "verdict": null,
      "report_path": null,
      "improvements_path": null,
      "bugs_found": 0,
      "bugs_fixed": 0,
      "fix_branch": null,
      "fix_commits": [],
      "pr_url": null,
      "pr_state": null,
      "screenshots_purged": false
    },
    ...
  },
  "consolidated_pr_list_path": null,
  "rate_limit_events": []
}
```

The runner mutates this file atomically (write to `.tmp`, then rename) at every transition.

### The cron fire prompt (verbatim — this IS the autonomous loop)

```
Read tests/scenarios/state/autonomous-batch-state.json.

If phase == "consolidated" or phase == "failed": Stop. Do nothing.

If phase == "master_setup":
  1. Run the master setup script (yarn build, dev-browser daemon start, login once).
  2. If setup fails, set phase="failed", write reason, stop.
  3. Otherwise set phase="running", write state, fall through to "running" branch.

If phase == "running":
  1. Find the first scenario in scenario_list with status="pending".
  2. If none, set phase="master_cleanup", fall through.
  3. Otherwise mark that scenario in_progress, write state.
  4. Spawn the run-scenario-test skill via the Skill tool with that scenario number.
  5. When the skill returns, parse the verdict, update the scenario's entry in state.
  6. If verdict is PASS and bugs were fixed, create a fix branch via git, push to fork, draft a PR via gh, record PR url.
  7. If verdict is PASS and screenshots are purgeable per Rule 10, delete the per-run screenshot dir.
  8. Stop. The next cron fire will pick up the next scenario.

If phase == "master_cleanup":
  1. Run dev-browser daemon stop, master cleanup script, kill any orphan scen* tmux sessions.
  2. Set phase="consolidated", write state.
  3. Generate the consolidated PR list at tests/scenarios/reports/CONSOLIDATED_PRS_<batch_id>.md.
  4. Stop.

NEVER call any other skill or tool except as instructed above. NEVER attempt to drive the UI yourself — that is the run-scenario-test skill's job. NEVER run multiple scenarios in one fire — one fire = one scenario, period. NEVER push to the user's main branch — only push fix branches to the user's personal fork.
```

The cron prompt is intentionally rigid. Every cron fire is one atomic step in the state machine. Idempotent. Resumable. Inspectable.

### Master setup phase (one-time, per batch)

1. `git status` baseline + `git commit` any uncommitted state
2. Backup config files per Rule 3 STATE-WIPE
3. `yarn build` once
4. `pm2 restart ai-maestro` once
5. `dev-browser daemon start` once
6. `dev-browser <<EOF ... aim_login(...) ... EOF` once — login the dashboard, persist the cookie in the dev-browser's named "dashboard" page
7. Take a baseline screenshot of the logged-in dashboard
8. Set `phase="running"` in state.json
9. Exit the cron fire — the next fire starts running scenarios

This phase runs ONLY ONCE per batch. Per-scenario runners assume the daemon is up and the dashboard is logged in.

### Per-scenario runner (one cron fire = one scenario)

The cron fire spawns the `run-scenario-test` skill with the next pending scenario. The skill:
1. Loads the dev-browser:dev-browser skill (Rule 8 mandate)
2. Reads the scenario .md file
3. Connects to the existing dev-browser daemon (via `browser.getPage("dashboard")` which returns the master-setup logged-in page)
4. Runs the scenario steps, applying FIX-AS-YOU-GO per Rule 4
5. Writes its report + improvements files
6. Returns the 2-line verdict + report path

The cron fire then:
7. Updates the scenario's entry in state.json with the verdict
8. If verdict==PASS and fixes were made, git commits each fix with a clear message, pushes to the user's fork, drafts a PR via `gh pr create --draft --base main --head <branch>`, records the PR URL in state.json
9. If verdict==PASS and per-Rule-10 conditions are met, deletes the per-run screenshot directory
10. Exits

### Master cleanup phase (one-time, at end of batch)

1. `dev-browser daemon stop` (cleanly shuts down Chromium)
2. Run the project's cleanup script (kill scen* tmux sessions, restore registry/teams)
3. STATE-WIPE restore from backups
4. Generate `tests/scenarios/reports/CONSOLIDATED_PRS_<batch_id>.md` with the format below
5. Set `phase="consolidated"` in state.json — this is the terminal state, the cron will see it and stop firing
6. Optionally delete the durable cron via CronDelete (the cron prompt detects `phase=="consolidated"` and does nothing, so leaving it is also safe)

### CONSOLIDATED_PRS file format

```markdown
# Autonomous Batch <batch_id> — Consolidated PR List

**Started:** <iso-ts>
**Completed:** <iso-ts>
**Total scenarios:** <N>
**Pass:** <N>  Fail:** <N>  Partial:** <N>  Stuck:** <N>
**Rate-limit events survived:** <N>

## PRs ready for review (sorted by scenario number)

| # | Scenario | Verdict | Fix branch | PR URL | Bugs fixed | Risk |
|---|----------|---------|------------|--------|-----------|------|
| 1 | SCEN-001 | PASS | fix/scen-001-... | https://github.com/.../pull/1234 | 2 | LOW |
| 2 | SCEN-005 | PASS | fix/scen-005-... | https://github.com/.../pull/1235 | 1 | MED |
...

## Scenarios with no fixes (no PR generated)

- SCEN-003 PASS — no bugs found
- SCEN-019 PARTIAL — bug found but deferred to P0 proposal (see scenario_proposed-improvements_019_*.md)

## Detailed fix index

### fix/scen-001-... (PR #1234)
- **Files**: components/X.tsx, lib/Y.ts
- **Description**: <one-paragraph fix summary>
- **Verification**: scenario re-ran step S012 successfully after the fix
- **PR draft URL**: https://github.com/.../pull/1234
- **Approve command**: `gh pr ready 1234 && gh pr merge 1234 --squash`

### fix/scen-005-... (PR #1235)
...

## Failed / stuck scenarios

### SCEN-018 FAIL
- **Reason**: <one-line>
- **Report**: tests/scenarios/reports/SCEN-018_<ts>.report.md
- **Screenshots**: tests/scenarios/screenshots/SCEN-018_<RUN_ID>/ (kept because verdict != PASS)

## Rate-limit events during this batch

| Time (UTC) | Token rotated to | Recovery delay (min) |
|---|---|---|
| 2026-04-15T14:23 | <account> | 8 |
...

## Next steps for the user

1. Open each PR in the table above
2. Review the fix and the verification report
3. Approve with `gh pr ready <N> && gh pr merge <N> --squash` (or via the GitHub UI)
4. After all approved fixes are merged, run `git pull origin main` to sync
```

This file is what the user reads when they wake up. One file, all PR URLs, all approve commands ready to copy-paste. No hunting through reports or git logs.

### Hard rules for autonomous batches

1. **One cron fire = one atomic state machine step.** Never run multiple scenarios in one fire. Never run setup AND a scenario in one fire. Cron fires must be short and idempotent.
2. **Read state.json before EVERY action.** Never assume the previous fire left the system in a known state.
3. **Write state.json AFTER every action atomically** (write to `.tmp`, then rename). Concurrent fires (during rate-limit recovery batch delivery) must not corrupt the file.
4. **Never push to the user's main branch.** Only fix branches to the user's personal fork.
5. **Never use `gh pr ready` or `gh pr merge` automatically.** Drafts only. The user approves.
6. **Never delete a scenario's screenshots if the scenario didn't pass.** Rule 10 auto-purge applies only to verified-fixed PASS runs.
7. **If the dev-browser daemon dies mid-batch**, the next cron fire detects it (via `dev-browser daemon status` or a trivial `getPage` call) and re-runs master setup from a "phase=master_setup" recovery state. The state machine has a "daemon-died" recovery branch.
8. **The cron interval is 5-20 minutes.** Shorter wastes API calls during rate-limit recovery; longer adds wall-clock latency. Default: 13 minutes (off-minute schedule).
9. **The cron is durable.** `CronCreate` MUST be called with `durable: true` so it survives `claude --continue`.
10. **The cron's recurring task auto-expires after 7 days** (Claude Code default). For batches running longer than 6 days, schedule a refresh task at day 5 to re-create the cron.

### Failure modes and recovery

| Failure | Detection | Recovery |
|---|---|---|
| Rate limit hits mid-scenario | run-scenario-test returns `STUCK` or with an explicit rate-limit error | next cron fire's idempotent read sees the scenario still in_progress, retries it from S001 (or from the in-scenario MEMORY.md checkpoint if the runner was able to write one) |
| dev-browser daemon crashes | `dev-browser daemon status` returns dead | cron sets phase=master_setup_recovery, next fire restarts daemon and resumes |
| pm2 ai-maestro crashes | `curl /api/sessions` 5xx | cron sets phase=master_setup_recovery, next fire restarts pm2 |
| State file corruption | JSON parse fails | cron writes corrupted state to state.json.corrupted-<ts>, sets phase=failed, alerts in next consolidated report |
| All scenarios complete but cleanup failed | phase=master_cleanup persists across many fires | after 5 fires in master_cleanup without progress, set phase=consolidated_with_warnings |
| GitHub fork rate limit | `gh pr create` returns 429 | log and continue, the fix is committed locally, the PR draft will be created on the next attempt |
| User's both accounts hit weekly quota | every cron fire fails for hours | wait it out — when one weekly quota resets, the cron picks up exactly where it left off |

### One last hard rule

**Never include a `claude --print` or `claude -p` invocation in the cron prompt.** The cron prompt runs INSIDE an existing claude session. Shelling out to a NEW claude process from a cron fire would be the kind of recursive nightmare we're explicitly trying to avoid. The whole architecture works because the cron is in-process.

---

## How-To: Running a Scenario

These are practical instructions for the AI assistant executing a scenario test.

### You ARE the user

In a scenario test, you are **impersonating the user**. You sit in front of the browser and interact with the dashboard exactly as a human would. This means:

- You click buttons, fill forms, read what's on screen, and make decisions based on what you see.
- When the scenario says "Create an agent", you use the wizard in the browser — not an API call.
- When you need to verify something, you look at the Profile panel, the sidebar, or the terminal output — not a curl response.

### Talk to your agents

Agents are live Claude Code instances running in tmux sessions. They can read your messages and act on them. When a scenario requires an agent to perform an action:

1. **Select the agent** in the sidebar (click its name)
2. **Type into the terminal** — click the terminal area to focus it, then type. Use arrow keys to navigate menus, Enter to confirm choices, and type text to give instructions.
3. **Or use the Prompt Builder** — the text area at the bottom of the dashboard. Type your instruction and click Send. The Prompt Builder is recommended for longer messages but is not mandatory.
4. **Read the terminal output** to see what the agent is doing and whether it succeeded
5. **Respond to the agent** if it asks questions or needs clarification — type your answer directly into the terminal or use the Prompt Builder

You interact with agents the same way a human user would: typing instructions, accepting plans, approving tool use, pasting URLs or information, navigating CLI menus with arrow keys, and pressing Enter to confirm.

If an agent refuses to do its job, pushes back, or sits idle — **talk to it**. Give it clearer instructions. Push it to act. Don't let agents slack. You are the manager of the test.

### Read what agents write

The terminal shows the agent's real-time output. **Read it.** The agent may:

- Ask for permission (approve it if appropriate for the test)
- Report errors (diagnose and fix per Rule 4)
- Request clarification (answer via the Prompt Builder)
- Show progress (wait for completion before moving to the next step)

Don't blindly move to the next step without confirming the agent completed the current action.

### Read-only monitoring is allowed

Rule 6 forbids **actions** outside the UI. But **read-only operations** to monitor agent behavior are allowed:

- **Read agent working directories** to check if files were created/modified
- **Read conversation logs** (`~/.claude/projects/.../*.jsonl`) to understand what the agent actually did
- **Read config files** to verify state after a UI action
- **Use `tmux list-sessions`** to check which agents are running
- **Use `ls`, `cat`, `grep`** on agent output files

What remains forbidden:
- Calling API endpoints with `curl` to **perform actions** (create, delete, modify)
- Running `tmux send-keys` to bypass the dashboard terminal (type via CDP instead)
- Editing config files directly (use the UI)
- Killing sessions with `tmux kill-session` (use the UI hibernate/delete)

The distinction is: **read = monitoring (allowed), write/action = must go through the browser UI**.

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

---

## WARNING: Cleanup Order Is Non-Negotiable

**The #1 most common scenario test failure is wrong cleanup order.** This has caused orphan tmux sessions, orphan agent folders, and corrupt registry state.

**MANDATORY cleanup order (memorize this):**

```
STEP 1: Delete test AGENTS via UI
         Profile → Advanced → Danger Zone → Delete Agent
         ☑ Check "Also delete agent folder"
         Type agent name → Delete Forever
         (repeat for each test agent)

STEP 2: Delete test TEAMS via UI
         Teams tab → click team → Delete team
         Enter governance password
         ☑ Check "Also delete agents in this team"
         Click Delete Team
         (this also handles agents if Step 1 was skipped)

STEP 3: Purge CEMETERY entries via UI
         Settings → Cemetery tab → Purge (for each test entry)

STEP 4: Verify via API
         Check registry, teams.json, cemetery — no test artifacts

STEP 5: STATE-WIPE restore
         Compare config files with backups
         Restore ONLY files that still differ after UI cleanup
         (usually settings.json, governance.json — NOT registry/teams
          since UI delete already cleaned those)

STEP 6: Post-test screenshot
         Navigate to dashboard, compare with baseline
```

**NEVER use bash/CLI to:**
- Delete agent folders (`rm -rf ~/agents/scen-*`) — Rule 6 violation
- Kill tmux sessions (`tmux kill-session`) — use UI hibernate/delete instead
- Edit registry.json or teams.json directly — use UI or API

**If agent folders remain after UI deletion, that is a BUG (Rule 4: fix it), not a reason to bypass the UI.**
