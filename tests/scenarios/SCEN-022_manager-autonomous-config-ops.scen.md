---
number: 22
name: MANAGER performs full config ops on AUTONOMOUS agent via skills/scripts
version: "1.0"
description: >
  Tests the plugin abstraction layer (skills + scripts) end-to-end: a
  MANAGER agent, acting entirely autonomously without user help, creates
  an AUTONOMOUS agent via the `aimaestro-agent.sh` CLI, installs a plugin
  via the ChangePlugin API, enables/disables it, queries its config via
  the `agent-local-config` scanner, and finally deletes the agent. No
  user clicks are performed after the initial MANAGER wake — all config
  operations happen inside the MANAGER's tmux session via natural-language
  prompts that trigger the agent-management and team-governance skills.
  The user (test executor) only watches the MANAGER's terminal, reads the
  AMP report, and verifies via API at each step.
client: claude
interhosts: false
device: desktop
subsystems:
  - aimaestro-agent.sh CLI (agent lifecycle)
  - element-management-service ChangePlugin pipeline
  - /api/agents/[id]/local-config (scanner)
  - /api/agents (create/delete AIO)
  - ai-maestro-plugin bundled skills (agent-management, team-governance)
  - AMP messaging (MANAGER → user report)
  - AID authentication via $AID_AUTH
ui_sections:
  - Login page
  - Dashboard → MANAGER agent terminal (prompt builder)
  - MessageCenter → user inbox for MANAGER's final report
  - Sidebar → verify the created/deleted test agent appears/disappears
data_produced:
  - 1 AUTONOMOUS test agent "scen022-autobot" created and deleted by MANAGER
  - 1 AMP message from MANAGER to user (the completion report)
  - All artifacts removed during cleanup
required_tools:
  - mcp__chrome-devtools__navigate_page
  - mcp__chrome-devtools__take_snapshot
  - mcp__chrome-devtools__take_screenshot
  - mcp__chrome-devtools__click
  - mcp__chrome-devtools__fill
  - mcp__chrome-devtools__wait_for
prerequisites:
  - AI Maestro server running at http://localhost:23000
  - Governance password set
  - MANAGER agent exists (if not, create one as setup step)
  - `aimaestro-agent.sh` installed at `~/.local/bin/`
  - $AID_AUTH exported in MANAGER's environment (auto-populated on wake)
  - Small test plugin available in a registered marketplace
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
---

## Phase 0: SAFE-SETUP

### S001: Health + backup
- **Action:** `curl /api/v1/health`; backup registry/teams/governance to
  `tests/scenarios/state-backups/SCEN-022_<timestamp>/`.
- **Goal:** Pre-test state captured.
- **Verify:** Health OK; backups exist.

### S002: Login + verify MANAGER exists
- **Action:** Navigate to `/`, login. Confirm a MANAGER agent is visible in
  the sidebar (red TITLE badge).
- **Goal:** MANAGER available for test.
- **Verify:** If no MANAGER, create one (not counted as scenario step but
  documented in prerequisites).

### S003: Wake MANAGER if hibernated
- **Action:** Click MANAGER card in sidebar; if hibernated, click Wake.
- **Goal:** MANAGER is online with a terminal session.
- **Verify:** Terminal shows Claude prompt.

---

## Phase 1: MANAGER creates an AUTONOMOUS agent (step-1 — via script)

### S004: Send instruction to MANAGER via prompt builder
- **Action:** In MANAGER's prompt builder, send:
  ```
  Create a new AUTONOMOUS agent named "scen022-autobot" with role-plugin
  "ai-maestro-programmer-agent", program "claude", working directory
  "~/agents/scen022-autobot". Use the aimaestro-agent.sh CLI (NOT the
  web UI). Report success to me via AMP when done.
  ```
- **Goal:** MANAGER executes `aimaestro-agent.sh create --name
  scen022-autobot --title AUTONOMOUS --program claude ...`.
- **Creates:** test agent in registry (by MANAGER, not user)
- **Verify:** Watch MANAGER's terminal for the command invocation. After
  ~20s, check `GET /api/agents` and confirm scen022-autobot is present
  with title `autonomous`.

### S005: Verify the test agent appears in the sidebar
- **Action:** Refresh sidebar or wait for useAgents polling.
- **Goal:** New agent visible.
- **Verify:** Screenshot shows the new card.

---

## Phase 2: MANAGER installs a plugin into the new agent at LOCAL scope

### S006: Send instruction to MANAGER
- **Action:** Prompt builder:
  ```
  Install the plugin "rechecker-plugin" (or another small utility) into
  agent scen022-autobot at --scope local using the agent-management
  skill / ChangePlugin API. Do not touch my user-scope plugins.
  ```
- **Goal:** MANAGER calls `PATCH /api/agents/<id>` with
  `{ plugins: [{ name: 'rechecker-plugin', scope: 'local' }] }` or uses
  the `aimaestro-agent.sh install-plugin` subcommand.
- **Creates:** Local-scope plugin install in scen022-autobot
- **Verify:** `GET /api/agents/<id>/local-config` returns plugin in the
  local plugin list; user-scope settings.json unchanged.

### S007: Verify via Config tab
- **Action:** Click scen022-autobot → Profile → Config → Plugins section.
- **Goal:** The installed plugin is visible in the agent's local list.
- **Verify:** Screenshot.

---

## Phase 3: MANAGER disables then re-enables the plugin

### S008: Disable
- **Action:** Prompt:
  ```
  Disable the rechecker-plugin in scen022-autobot without uninstalling.
  ```
- **Goal:** MANAGER sets enabled=false via API.
- **Verify:** Config tab shows disabled state; local-config API confirms.

### S009: Re-enable
- **Action:** Prompt:
  ```
  Re-enable the rechecker-plugin in scen022-autobot.
  ```
- **Goal:** Plugin enabled=true again.
- **Verify:** Config tab shows enabled state.

---

## Phase 4: MANAGER reports via AMP

### S010: Wait for AMP message to user
- **Action:** Open the human user card in the sidebar, watch the inbox
  for a message from MANAGER summarizing what was done.
- **Goal:** Verify the MANAGER sent a final completion report with
  step-by-step details.
- **Verify:** Inbox contains a recent message from MANAGER subjected
  something like "scen022 complete" or similar.

---

## Phase 5: MANAGER deletes the test agent

### S011: Send delete instruction
- **Action:** Prompt:
  ```
  Delete agent scen022-autobot. Use the aimaestro-agent.sh delete
  subcommand with --delete-folder. Confirm to me when done.
  ```
- **Goal:** MANAGER calls DELETE /api/agents/<id>?deleteFolder=true.
  **Expected to FAIL on current behavior:** DELETE /api/agents/[id] is
  classified "strict" in security-registry.json (Rule 12), which means
  the caller must present an X-Sudo-Token earned by re-entering the
  governance password via POST /api/auth/sudo-password. Agents CANNOT
  obtain sudo tokens (sudo-mode is system-owner only) — so the MANAGER's
  direct DELETE call returns 403 sudo_required. When this happens:
    1. Record the failure in the scenario report as the EXPECTED result
       of Rule 12 enforcement (agents cannot bypass sudo-mode).
    2. Fall back to the user performing the delete manually via the UI
       in the S013 cleanup step — OR promote the issue as a governance
       design question: "should DELETE /api/agents/[id] be normal for
       AID callers if the caller is MANAGER?" (currently: no).
- **Removes:** intentionally blocked — the MANAGER is not allowed to
  perform sudo-gated deletes.
- **Verify:** 403 response captured in MANAGER terminal log with
  `sudo_required`. `GET /api/agents` still lists scen022-autobot.

### S012: Verify cemetery handling
- **Action:** If the delete was soft, navigate to Settings → Cemetery and
  check the entry. MANAGER should purge it in a follow-up instruction.
- **Verify:** Cemetery state matches expectation.

---

## Phase 6: CLEANUP

### S013: Force-cleanup any MANAGER-created residue
- **Action:** Verify via API that scen022-autobot is fully gone from
  registry, filesystem, tmux. If not, delete via UI as fallback.
- **Removes:** Any residual state
- **Verify:** Clean.

### S014: STATE-WIPE restore
- **Action:** Compare config files with S001 backups; restore any that
  still differ.
- **Verify:** File hashes match.

### S015: Post-test screenshot
- **Action:** Dashboard screenshot.
- **Verify:** UI matches pre-test baseline.

---

## Success Criteria (R23 proposal)

This scenario tests that a MANAGER agent can **operate AI Maestro
autonomously via the plugin abstraction layer** (skills + scripts) for
create → configure → delete without the human user touching the UI. If
the MANAGER needs to ask the user for confirmation at any step (other
than the initial "go" prompt), or if any step requires the user to
click a button, the scenario FAILS and the issue is logged for
R20/plugin-abstraction refinement.
