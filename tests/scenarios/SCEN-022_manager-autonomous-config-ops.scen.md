---
number: 22
name: MANAGER performs full config ops on AUTONOMOUS agent via skills/scripts
version: "1.1"
description: >
  Tests the plugin abstraction layer (skills + scripts) end-to-end: a
  MANAGER agent, acting entirely autonomously without user help, creates
  an AUTONOMOUS agent via the `aimaestro-agent.sh` CLI, installs a plugin
  via the ChangePlugin API, enables/disables it, queries its config via
  the `agent-local-config` scanner, and finally attempts to delete the
  agent (blocked by Rule 12 sudo-mode — agents cannot earn sudo tokens).
  The user (test executor) only watches the MANAGER's terminal, reads the
  AMP report, and verifies via API (GET requests for state verification
  per Rule 6) at each step. All UI actions other than the initial wake
  + sudo-blocked-delete observation are performed by the MANAGER agent
  via natural-language prompts that trigger the agent-management and
  team-governance skills.
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
  - Rule 12 sudo-mode enforcement on DELETE /api/agents/[id]
ui_sections:
  - Login page
  - Dashboard → MANAGER agent terminal (prompt builder)
  - MessageCenter → user inbox for MANAGER's final report
  - Sidebar → verify the created/deleted test agent appears/disappears
  - Sudo password modal (Rule 12, shown on the fallback user-driven
    cleanup delete in S013 when MANAGER's delete is blocked by sudo)
data_produced:
  - 1 AUTONOMOUS test agent "scen022-autobot" created by MANAGER, deleted
    by user fallback during cleanup
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
  - MAINTAINER role-plugin available as a title option per R19
    (not exercised in this scenario but must be picker-visible for the
    MANAGER's agent-management skill to report it accurately)
governance_password: "mYkri1-xoxrap-gogtan"
commit: TBD
---

## Phase 0: SAFE-SETUP

### S001: Health + backup
- **Action:** `curl /api/v1/health` (Rule 6 state-verification read);
  backup registry/teams/governance to
  `tests/scenarios/state-backups/SCEN-022_<timestamp>/`.
- **Goal:** Pre-test state captured.
- **Creates:** backup directory
- **Modifies:** nothing
- **Verify:** Health OK; backups exist.

### S002: Login + verify MANAGER exists
- **Action:** Navigate to `/`, enter password `mYkri1-xoxrap-gogtan`,
  click Login. Confirm a MANAGER agent is visible in the sidebar (red
  TITLE badge).
- **Goal:** MANAGER available for test.
- **Creates:** session cookie
- **Modifies:** nothing
- **Verify:** If no MANAGER, create one (not counted as scenario step
  but documented in prerequisites).

### S003: Wake MANAGER if hibernated
- **Action:** Click MANAGER card in sidebar; if hibernated, click Wake.
  If the sudo password modal appears (Rule 12 — wake on team agents is
  manager-gated per v0.27.3), enter governance password
  `mYkri1-xoxrap-gogtan` and Confirm.
- **Goal:** MANAGER is online with a terminal session.
- **Creates:** tmux session (if was hibernated)
- **Modifies:** session status
- **Verify:** Terminal shows Claude prompt.

---

## Phase 1: MANAGER creates an AUTONOMOUS agent (step-1 — via script)

### S004: Send instruction to MANAGER via prompt builder
- **Action:** In MANAGER's prompt builder, send:
  ```
  Create a new AUTONOMOUS agent named "scen022-autobot" (title AUTONOMOUS
  auto-resolves to the mandatory role-plugin `ai-maestro-autonomous-agent`
  per R9.13), program "claude", working directory "~/agents/scen022-autobot".
  Use the aimaestro-agent.sh CLI (NOT the web UI). Report success to me
  via AMP when done.
  ```
- **Goal:** MANAGER executes `aimaestro-agent.sh create --name
  scen022-autobot --title AUTONOMOUS --program claude ...`.
- **Creates:** test agent in registry with `ai-maestro-autonomous-agent`
  role-plugin installed at --scope local (by MANAGER, not user)
- **Modifies:** registry.json,
  `~/agents/scen022-autobot/.claude/settings.local.json`
- **Verify:** Watch MANAGER's terminal for the command invocation. After
  ~20s, `GET /api/agents` (Rule 6 verification read) and confirm
  scen022-autobot is present with title `autonomous` AND its
  `role-plugin` field reports `ai-maestro-autonomous-agent`. Also
  confirm via `GET /api/agents/<id>/local-config` that the plugin is
  listed in `enabledPlugins` at `--scope local`.

### S005: Verify the test agent appears in the sidebar
- **Action:** Refresh sidebar or wait for useAgents polling.
- **Goal:** New agent visible.
- **Creates:** nothing
- **Modifies:** nothing
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
- **Modifies:** `~/agents/scen022-autobot/.claude/settings.local.json`
- **Verify:** `GET /api/agents/<id>/local-config` (Rule 6 verification
  read) returns plugin in the local plugin list; user-scope
  settings.json unchanged.

### S007: Verify via Config tab
- **Action:** Click scen022-autobot → Profile → Config → Plugins section.
- **Goal:** The installed plugin is visible in the agent's local list.
- **Creates:** nothing
- **Modifies:** UI state
- **Verify:** Screenshot.

---

## Phase 3: MANAGER disables then re-enables the plugin

### S008: Disable
- **Action:** Prompt:
  ```
  Disable the rechecker-plugin in scen022-autobot without uninstalling.
  ```
- **Goal:** MANAGER sets enabled=false via API.
- **Creates:** nothing
- **Modifies:** `~/agents/scen022-autobot/.claude/settings.local.json`
- **Verify:** Config tab shows disabled state; local-config API confirms
  (Rule 6 verification read).

### S009: Re-enable
- **Action:** Prompt:
  ```
  Re-enable the rechecker-plugin in scen022-autobot.
  ```
- **Goal:** Plugin enabled=true again.
- **Creates:** nothing
- **Modifies:** `~/agents/scen022-autobot/.claude/settings.local.json`
- **Verify:** Config tab shows enabled state.

---

## Phase 4: MANAGER reports via AMP

### S010: Wait for AMP message to user
- **Action:** Open the human user card in the sidebar, watch the inbox
  for a message from MANAGER summarizing what was done.
- **Goal:** Verify the MANAGER sent a final completion report with
  step-by-step details.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Inbox contains a recent message from MANAGER subjected
  something like "scen022 complete" or similar.

---

## Phase 5: MANAGER attempts to delete the test agent (Rule 12 sudo blocks)

### S011: Send delete instruction
- **Action:** Prompt:
  ```
  Delete agent scen022-autobot. Use the aimaestro-agent.sh delete
  subcommand with --delete-folder. Confirm to me when done.
  ```
- **Goal:** MANAGER calls DELETE /api/agents/<id>?deleteFolder=true.
  **Expected outcome:** Rule 12 rejects the call. DELETE
  /api/agents/[id] is classified "strict" in security-registry.json,
  which means the caller must present an X-Sudo-Token earned by
  re-entering the governance password via POST /api/auth/sudo-password.
  Agents CANNOT obtain sudo tokens (sudo-mode is system-owner only) —
  so the MANAGER's direct DELETE call returns 403 sudo_required. When
  this happens:
    1. Record the failure in the scenario report as the EXPECTED result
       of Rule 12 enforcement (agents cannot bypass sudo-mode).
    2. Fall back to the user performing the delete manually via the UI
       in the S013 cleanup step.
- **Removes:** intentionally blocked — the MANAGER is not allowed to
  perform sudo-gated deletes.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** 403 response captured in MANAGER terminal log with
  `sudo_required`. `GET /api/agents` still lists scen022-autobot.

### S012: Verify cemetery handling
- **Action:** If the delete was soft, navigate to Settings → Cemetery and
  check the entry. MANAGER should purge it in a follow-up instruction.
  (In this scenario the MANAGER delete was blocked before any cemetery
  write — this step is a no-op in the expected path but exists as a
  safety check.)
- **Goal:** Cemetery state matches expectation.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Cemetery empty of scen022-autobot (no premature soft
  delete).

---

## Phase 6: CLEANUP

### S013: Delete scen022-autobot via UI (Rule 12 sudo — user-driven fallback)
- **Action:** Click scen022-autobot in sidebar → Profile → Advanced →
  Danger Zone → Delete Agent. Check "Also delete agent folder". Type
  `scen022-autobot`. Click Delete Forever. When the sudo password
  modal appears (Rule 12 — DELETE /api/agents/[id] strict), enter
  governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Cleanup succeeds via user-driven UI (the sudo-mode gate
  allows the user because the user can supply a fresh password; it
  does not allow the MANAGER agent).
- **Removes:** scen022-autobot from registry, `~/agents/scen022-autobot/`,
  tmux session
- **Verify:** Agent not in sidebar; `GET /api/agents` does not return it
  (Rule 6 verification read). Sudo modal appeared once.

### S014: Purge cemetery entry
- **Action:** Settings → Cemetery → find scen022-autobot row → click
  Purge → enter sudo password `mYkri1-xoxrap-gogtan` when prompted.
- **Removes:** Cemetery record
- **Verify:** Cemetery list no longer shows the entry.

### S015: STATE-WIPE restore
- **Action:** Compare config files with S001 backups; restore any that
  still differ (only settings files — registry/teams already cleaned
  by S013 UI delete).
- **Goal:** Config files match pre-test state.
- **Removes:** nothing
- **Verify:** File hashes match.

### S016: Post-test screenshot
- **Action:** Dashboard screenshot.
- **Goal:** UI matches pre-test baseline.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual match.

---

## Success Criteria (R23 proposal)

This scenario tests that a MANAGER agent can **operate AI Maestro
autonomously via the plugin abstraction layer** (skills + scripts) for
create → configure → (fail-to-delete) without the human user touching
the UI, except for the expected sudo-blocked delete fallback in
cleanup. If the MANAGER needs to ask the user for confirmation at any
step (other than the initial "go" prompt and the expected Rule 12
sudo block on delete), or if any step except S013 requires the user
to click a button, the scenario FAILS and the issue is logged for
R20/plugin-abstraction refinement.
