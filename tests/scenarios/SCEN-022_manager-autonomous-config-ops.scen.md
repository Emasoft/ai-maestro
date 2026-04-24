---
number: 22
name: MANAGER performs full config ops on AUTONOMOUS agent via skills/scripts
version: "1.2"
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
  - 1 MANAGER test agent "scen022-manager" created by user via Wizard
    (precondition step S002a); deleted by user during cleanup (S014b).
  - 1 AUTONOMOUS test agent "scen022-autobot" created by
    scen022-manager; deleted by user fallback during cleanup (S013).
  - 1 AMP message from scen022-manager to user (the completion report)
  - 2 cemetery entries (one per deleted agent) purged during cleanup
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
  - NO real user MANAGER currently assigned on host (S002 precondition
    check — if a real MANAGER exists, the scenario HALTS rather than
    demoting it, to avoid triggering the R9.8 blocking cascade on
    user teams)
  - "aimaestro-agent.sh installed at ~/.local/bin/"
  - $AID_AUTH is auto-populated in scen022-manager's environment on wake
    (no manual export needed)
  - Small test plugin available in a registered marketplace
  - MAINTAINER role-plugin available as a title option per R19
    (not exercised in this scenario but must be picker-visible for the
    scen022-manager's agent-management skill to report it accurately)
governance_password: "mYkri1-xoxrap-gogtan"
rewipe-list:
  - ~/.aimaestro/governance.json
  - ~/.aimaestro/agents/registry.json
  - ~/.aimaestro/teams/teams.json
  - ~/.aimaestro/teams/groups.json
git-fixtures: []
dir-fixtures: []
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

### S002: Login + precondition check — NO real MANAGER may exist
- **Action:** Navigate to `/`, enter password `mYkri1-xoxrap-gogtan`, click Login. Then READ-ONLY check `GET /api/governance`. If `hasManager: true`, the host has a real user MANAGER (likely one of `alexandre`, `luckas-bot`, etc.). The scenario MUST HALT — this scenario creates its own test MANAGER and cannot safely co-exist with an existing real MANAGER.
- **Goal:** Confirm `hasManager: false`. If true, HALT with `SCENARIO_ABORTED SCEN-022 — real MANAGER exists on host.`
- **Creates:** session cookie
- **Modifies:** nothing — do NOT demote any existing MANAGER.
- **Verify:** `hasManager: false`.

### S002a: Create a scen-prefixed test MANAGER agent via the Wizard
- **Action:** Click the "+" button in the Agents sidebar to open the Agent Creation Wizard. Enter name EXACTLY `scen022-manager`. Select client Claude. Title: MANAGER (the scenario creates its own MANAGER rather than relying on ambient state). Let the wizard auto-assign the MANAGER role-plugin (`ai-maestro-assistant-manager-agent`) and the default workdir `~/agents/scen022-manager/`. DO NOT override the folder. DO NOT click "Import from existing folder". Enter governance password `mYkri1-xoxrap-gogtan` when prompted (assigning MANAGER title requires it per Rule 12).
- **Goal:** The scenario's OWN test MANAGER agent exists at `~/agents/scen022-manager/`. No real user agent is promoted.
- **Creates:** 1 test agent `scen022-manager` with MANAGER title and role-plugin, workdir `~/agents/scen022-manager/`.
- **Modifies:** Agent registry, governance.json (hasManager becomes true, managerId points at the test agent).
- **Verify:** `GET /api/agents | jq '.agents[] | select(.name=="scen022-manager") | .workingDirectory'` returns `/Users/<user>/agents/scen022-manager` exactly. If any other path, HALT as P0 bug.

### S003: Wake the test MANAGER if hibernated
- **Action:** Click `scen022-manager` card in sidebar (the scenario's own test MANAGER — never any other MANAGER-titled agent); if hibernated, click Wake. If the sudo password modal appears, enter governance password `mYkri1-xoxrap-gogtan` and Confirm. Do NOT click any other agent.
- **Goal:** The scenario-owned test MANAGER is online with a terminal session.
- **Creates:** tmux session (if was hibernated)
- **Modifies:** session status of `scen022-manager` only
- **Verify:** Terminal shows Claude prompt for `scen022-manager`.

---

## Phase 1: MANAGER creates an AUTONOMOUS agent (step-1 — via script)

### S004: Send instruction to scen022-manager via prompt builder
- **Action:** Ensure `scen022-manager` is the selected sidebar card. In scen022-manager's prompt builder (NOT any other MANAGER-titled agent), send:
  ```
  Create a new AUTONOMOUS agent named "scen022-autobot" (title AUTONOMOUS
  auto-resolves to the mandatory role-plugin `ai-maestro-autonomous-agent`
  per R9.13), program "claude", working directory "~/agents/scen022-autobot".
  Use the aimaestro-agent.sh CLI (NOT the web UI). Report success to me
  via AMP when done.
  ```
- **Goal:** scen022-manager executes `aimaestro-agent.sh create --name
  scen022-autobot --title AUTONOMOUS --program claude ...`.
- **Creates:** test agent in registry with `ai-maestro-autonomous-agent`
  role-plugin installed at --scope local (by scen022-manager, not user)
- **Modifies:** registry.json,
  `~/agents/scen022-autobot/.claude/settings.local.json`
- **Verify:** Watch scen022-manager's terminal for the command invocation. After
  ~20s, `GET /api/agents` (Rule 6 verification read) and confirm
  scen022-autobot is present with title `autonomous` AND its
  `role-plugin` field reports `ai-maestro-autonomous-agent`. Also
  confirm via `GET /api/agents/<id>/local-config` that the plugin is
  listed in `enabledPlugins` at `--scope local`.

### S004a: CRITICAL — verify workdir is safe under ~/agents/
- **Action:** Read-only check: `curl -s "http://localhost:23000/api/agents" -H "Cookie: <session>" | jq '.agents[] | select(.name=="scen022-autobot") | .workingDirectory'` — the returned path MUST be `/Users/<user>/agents/scen022-autobot` exactly. Then `ls -la ~/agents/scen022-autobot/.claude/settings.local.json` (read-only) to confirm the folder was actually created at that location (not somewhere else). If the workingDirectory field is anything outside `/Users/<user>/agents/`, or the `ls` fails (folder not at the expected path), STOP IMMEDIATELY — the CLI script has a critical security bug. Record as BUG-001 / P0 finding, abandon the scenario without cleanup, alert the user.
- **Goal:** scen022-autobot's working directory is confirmed under `~/agents/scen022-autobot/` — safe for cleanup's folder-delete step.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** curl returns `~/agents/scen022-autobot` path, ls succeeds.

### S005: Verify the test agent appears in the sidebar
- **Action:** Refresh sidebar or wait for useAgents polling.
- **Goal:** New agent visible.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot shows the new card.

---

## Phase 2: MANAGER installs a plugin into the new agent at LOCAL scope

### S006: Send instruction to scen022-manager
- **Action:** Confirm `scen022-manager` remains the selected sidebar card. In its prompt builder:
  ```
  Install the plugin "rechecker-plugin" (or another small utility) into
  agent scen022-autobot at --scope local using the agent-management
  skill / ChangePlugin API. Do not touch my user-scope plugins.
  ```
- **Goal:** scen022-manager calls `PATCH /api/agents/<id>` with
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
- **Action:** In scen022-manager's prompt builder:
  ```
  Disable the rechecker-plugin in scen022-autobot without uninstalling.
  ```
- **Goal:** scen022-manager sets enabled=false via API.
- **Creates:** nothing
- **Modifies:** `~/agents/scen022-autobot/.claude/settings.local.json`
- **Verify:** Config tab shows disabled state; local-config API confirms
  (Rule 6 verification read).

### S009: Re-enable
- **Action:** In scen022-manager's prompt builder:
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
  for a message from scen022-manager summarizing what was done.
- **Goal:** Verify the scen022-manager test agent sent a final
  completion report with step-by-step details.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Inbox contains a recent message from scen022-manager
  (sender name must match exactly) subjected something like
  "scen022 complete" or similar.

---

## Phase 5: MANAGER attempts to delete the test agent (Rule 12 sudo blocks)

### S011: Send delete instruction
- **Action:** In scen022-manager's prompt builder:
  ```
  Delete agent scen022-autobot. Use the aimaestro-agent.sh delete
  subcommand with --delete-folder. Confirm to me when done.
  ```
- **Goal:** scen022-manager calls DELETE /api/agents/<id>?deleteFolder=true.
  **Expected outcome:** Rule 12 rejects the call. DELETE
  /api/agents/[id] is classified "strict" in security-registry.json,
  which means the caller must present an X-Sudo-Token earned by
  re-entering the governance password via POST /api/auth/sudo-password.
  Agents CANNOT obtain sudo tokens (sudo-mode is system-owner only) —
  so scen022-manager's direct DELETE call returns 403 sudo_required.
  When this happens:
    1. Record the failure in the scenario report as the EXPECTED result
       of Rule 12 enforcement (agents cannot bypass sudo-mode).
    2. Fall back to the user performing the delete manually via the UI
       in the S013 cleanup step.
- **Removes:** intentionally blocked — scen022-manager is not allowed to
  perform sudo-gated deletes.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** 403 response captured in scen022-manager's terminal log
  with `sudo_required`. `GET /api/agents` still lists scen022-autobot.

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

### S014: Purge scen022-autobot cemetery entry
- **Action:** Settings → Cemetery → find the `scen022-autobot` row
  (match the name exactly; do NOT purge any other row) → click
  Purge → enter sudo password `mYkri1-xoxrap-gogtan` when prompted.
- **Removes:** scen022-autobot cemetery record ONLY
- **Verify:** Cemetery list no longer shows `scen022-autobot`. All
  other cemetery entries unchanged (count drops by exactly 1).

### S014a: Demote scen022-manager before deletion
- **Action:** Click `scen022-manager` card → Profile → title badge
  → select AUTONOMOUS (no team, no governance responsibilities) →
  enter governance password `mYkri1-xoxrap-gogtan` when prompted by
  the Title Assignment Dialog. This frees the MANAGER slot so the
  blocking cascade does NOT fire during deletion.
- **Goal:** `scen022-manager` title is AUTONOMOUS (no longer MANAGER).
- **Removes:** MANAGER title from scen022-manager; governance.json
  reverts to `hasManager: false`.
- **Verify:** `GET /api/governance | jq '.hasManager'` returns `false`.

### S014b: Delete scen022-manager via UI
- **Action:** Click `scen022-manager` card → Profile → Advanced
  → Danger Zone → Delete Agent. Check "Also delete agent folder"
  (safe — workdir is `~/agents/scen022-manager/`, enforced by G03
  guard). Type `scen022-manager` in the confirmation field. Click
  Delete Forever. Enter governance password
  `mYkri1-xoxrap-gogtan` in the sudo modal and Confirm.
- **Removes:** scen022-manager from registry,
  `~/agents/scen022-manager/`, tmux session.
- **Verify:** `GET /api/agents | jq '.agents[] | select(.name=="scen022-manager")'`
  returns nothing. Folder `~/agents/scen022-manager/` does not exist.

### S014c: Purge scen022-manager cemetery entry
- **Action:** Settings → Cemetery → find the `scen022-manager` row
  (match the name exactly) → click Purge → enter sudo password
  `mYkri1-xoxrap-gogtan`.
- **Removes:** scen022-manager cemetery record ONLY.
- **Verify:** Cemetery list no longer shows `scen022-manager`. No
  other cemetery entries touched.

### S015: STATE-WIPE restore
- **Action:** Compare config files with S001 backups; restore any that
  still differ (only settings files — registry/teams/governance
  already cleaned by S013 + S014a + S014b UI flow).
- **Goal:** Config files match pre-test state.
- **Removes:** nothing
- **Verify:** File hashes match.

### S016: Verify no scen022-prefixed artifacts remain
- **Action:** Read-only checks:
  `GET /api/agents | jq '.agents[] | select(.name | test("^scen022-"))'` —
  must return empty.
  `ls -d ~/agents/scen022-* 2>/dev/null || echo OK` — must print `OK`.
- **Goal:** Zero scen022-prefixed artifacts on host.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Both checks return empty / OK. If anything remains, fail
  the scenario (cleanup incomplete).

### S017: Post-test screenshot
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
