---
number: 9
name: Manager-Driven Team Creation (JSONL Viewer)
version: "2.0"
description: >
  The user logs in, creates a MANAGER agent, and launches its Claude session.
  They type a project task into the terminal ("build a JSONL viewer in Swift for
  macOS") and watch the MANAGER work autonomously: it creates a team, a COS is
  auto-assigned, team members are recruited with appropriate titles, and kanban
  tasks are populated. The user verifies each step through the sidebar and team
  dashboard, confirms the resulting 5-agent team, and checks that the MANAGER
  itself stays outside the team. Finally, they delete everything and clean up.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance
  - teams
  - agent-registry
  - element-management-service
  - agent-messaging (AMP)
  - role-plugins
  - kanban (team tasks)
  - auth (LoginGate, agent auth mst_* secrets, RBAC, no-self-modification)
ui_sections:
  - Login page (governance password login)
  - Sidebar -> Agents tab -> Agent list
  - Sidebar -> Teams tab -> Team list
  - Agent Profile -> Overview tab -> Governance Title
  - Agent Profile -> Config tab -> Role Plugin
  - Title Assignment Dialog
  - Governance Password Dialog
  - Team Dashboard -> Overview
  - Team Dashboard -> Kanban
  - Terminal view (MANAGER agent input/output)
  - Settings -> Cemetery tab
data_produced:
  - 1 MANAGER agent (temporary, created and deleted)
  - 1 team (temporary, created by MANAGER, deleted)
  - 1 auto-COS agent (temporary, created by system, deleted)
  - 5+ team member agents (temporary, created by MANAGER, deleted)
  - Kanban tasks (temporary, deleted with team)
  - AMP messages (temporary)
  - Agent folders under ~/agents/ (temporary, deleted)
  - Plugin settings modifications (temporary, restored via STATE-WIPE)
  - Cemetery archive entries (temporary, purged)
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
  - Chrome browser open with DevTools accessible via CDP
  - ai-maestro-plugins marketplace registered
  - No MANAGER currently assigned
  - Claude Code CLI available
  - Sufficient API credits for MANAGER agent to run autonomously (~15 min)
governance_password: "mYkri1-xoxrap-gogtan"
rewipe-list:
  - ~/.aimaestro/governance.json
  - ~/.aimaestro/agents/registry.json
  - ~/.aimaestro/teams/teams.json
  - ~/.aimaestro/teams/groups.json
git-fixtures: []
dir-fixtures: []
commit: TBD
author: AI Maestro Team
---

# Manager-Driven Team Creation (JSONL Viewer) Scenario

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state
- **Creates:** nothing
- **Modifies:** git history
- **Verify:** Clean working tree. Screenshot: SCEN-009/S001-git-clean.png

#### S002: STATE-WIPE Checkpoint -- Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/manager-driven-team_<timestamp>/`
- **Goal:** All config files saved
- **Creates:** Backup directory
- **Modifies:** nothing
- **Verify:** Backups match. Screenshot: SCEN-009/S002-backup.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `GET /api/sessions`
- **Goal:** Server running
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API returns 200. Screenshot: SCEN-009/S003-server-ok.png

#### S004: Navigate to dashboard
- **Action:** `navigate_page` to `http://localhost:23000`
- **Goal:** Login page loads
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Login form visible. Screenshot: SCEN-009/S004-login-page.png

---

## Phase 1: LoginGate Authentication

#### S005: Log in with governance password
- **Action:** Fill password `mYkri1-xoxrap-gogtan`, click Login
- **Goal:** Dashboard loads
- **Creates:** Session cookie
- **Modifies:** nothing
- **Verify:** Dashboard visible. Take baseline screenshot. Screenshot: SCEN-009/S005-dashboard.png

#### S006: Ensure no MANAGER exists and record baseline counts
- **Action:** Check `GET /api/governance` for `hasManager: false`. Record agent and team counts.
- **Goal:** No MANAGER, baseline recorded
- **Creates:** nothing
- **Modifies:** Possibly removes MANAGER
- **Verify:** `hasManager: false`. Screenshot: SCEN-009/S006-baseline-counts.png

---

## Phase 2: Create and Activate MANAGER Agent

#### S007: Create agent `scen-mgr-jsonl` via wizard
- **Action:** Wizard: Claude Code -> `scen-mgr-jsonl` -> No team -> AUTONOMOUS -> Auto-folder -> Create
- **Goal:** Agent created
- **Creates:** Agent, tmux session, folder ~/agents/scen-mgr-jsonl/
- **Modifies:** Registry
- **Verify:** Agent in sidebar. Screenshot: SCEN-009/S007-agent-created.png

#### S008: Assign MANAGER title
- **Action:** AUTONOMOUS badge -> MANAGER. SUDO-MODE: when the sudo password modal appears (PATCH `/api/agents/{id}/title` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** MANAGER active with plugin
- **Creates:** Plugin entry
- **Modifies:** Governance, title
- **Verify:** MANAGER badge, `ai-maestro-assistant-manager-agent`. Screenshot: SCEN-009/S008-manager-assigned.png

#### S009: Verify agent auth token was generated
- **Action:** Check `GET /api/agents/<managerId>` for auth-related fields. Verify the agent's tmux session has AID_AUTH env var set.
- **Goal:** Agent has mst_* session secret for API authentication
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Auth token present (may be masked in API response). Screenshot: SCEN-009/S009-auth-token.png

#### S010: Launch Claude Code session for MANAGER
- **Action:** If terminal shows only shell prompt, click "New Session". Wait for Claude Code idle prompt.
- **Goal:** MANAGER has running Claude Code session
- **Creates:** Claude process in tmux
- **Modifies:** nothing
- **Verify:** Claude prompt visible. Screenshot: SCEN-009/S010-session-running.png

---

## Phase 3: Send Project Task to MANAGER

#### S011: Give the MANAGER the directive — then STOP (Rule 0.b)

> **This step was rewritten.** It used to hand the MANAGER an answer key: it named the skill to
> invoke (`/team-governance`), designed the org chart for it (one ARCHITECT for X, one
> ORCHESTRATOR for Y, two MEMBERs for Z…), and listed every agent to create. A MANAGER given
> that cannot demonstrate judgement — it can only transcribe, and the scenario could never fail
> for the one reason worth failing for. **State the GOAL. Never the METHOD.** (Rule 0.b)

- **Action:** In the MANAGER's **chat** section (NOT the terminal — it is read-only), type and send:

  `Build a JSONL viewer desktop app for macOS in Swift/SwiftUI. It must: (1) open .jsonl files and display each JSON line in a table, (2) filter/search across all lines, (3) pretty-print an individual JSON object when clicked, (4) stay responsive on 100MB+ files. Organise whatever team you need and get it moving.`

  `Two house rules: name every agent you create with the prefix 'scen9-', and leave every agent's working directory at the wizard default under ~/agents/<name>/ (never inside ~/ai-maestro, ~/.claude, or a project folder I own). If something needs the governance password, ask me and I will type it into the UI popup — I will not give it to you.`

  Then **STOP**. Send nothing further. Do not name skills, titles, agents, or a team structure — those are the MANAGER's decisions and whether it makes them well is the entire point of this scenario.

  *(The two house rules are permitted: they are sandbox policy — a real user setting naming and
  safety boundaries — not instructions about how to do the work. The line is: constraints on the
  BLAST RADIUS are yours; decisions about the WORK are the MANAGER's.)*

- **Goal:** MANAGER receives a goal-level directive with no method prescribed
- **Creates:** nothing yet
- **Modifies:** nothing yet
- **Verify:** the message appears in the MANAGER's chat. Screenshot. From here on you are an
  OBSERVER: record what the MANAGER does **on its own** — which skills it invokes unprompted,
  whether it creates a team, which titles it chooses and why, whether it routes through its COS,
  whether it populates the kanban. **If it stalls, does nothing, or picks a nonsensical team,
  that is the RESULT — record it and do NOT prod it.** A goal reached only because you
  intervened is a FAIL, and the intervention is the bug report.
- **Verify:** Terminal shows MANAGER processing. Screenshot: SCEN-009/S011-task-sent.png

#### S012: Wait for MANAGER to acknowledge and start planning
- **Action:** Watch terminal for planning output or skill invocation
- **Goal:** MANAGER is acting
- **Creates:** nothing yet
- **Modifies:** nothing yet
- **Verify:** Planning output visible. Screenshot: SCEN-009/S012-manager-planning.png

---

## Phase 4: Verify Team Was Created

#### S013: Check Teams tab for new team
- **Action:** Click Teams tab. Look for team named "jsonl-viewer-swift" or similar.
- **Goal:** Team appears in sidebar
- **Creates:** nothing (verifying)
- **Modifies:** nothing
- **Verify:** Team visible. Record name. Screenshot: SCEN-009/S013-team-in-sidebar.png

#### S014: Verify auto-COS was assigned
- **Action:** Check team chiefOfStaffId
- **Goal:** COS agent exists with correct title
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** COS found. Record name. Screenshot: SCEN-009/S014-cos-verified.png

---

## Phase 5: COS Immutability Probe (R4.7)

#### S015: Attempt to remove COS from team agentIds via API
- **Action:** `PUT /api/teams/<teamId>` with agentIds excluding COS ID
- **Goal:** 400 -- COS immutability enforced
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 400. Screenshot: SCEN-009/S015-cos-immutability.png

---

## Phase 6: Verify Full 5-Agent Team (R12)

#### S016: Check for agents with required titles
- **Action:** For each agent in team, check governanceTitle via API
- **Goal:** COS + ARCHITECT + ORCHESTRATOR + INTEGRATOR + at least 1 MEMBER (R12)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** All 5 required titles present. Count >= 5. Screenshot: SCEN-009/S016-r12-composition.png

#### S017: Verify all agents have working directories under ~/agents/
- **Action:** Check each agent's workingDirectory
- **Goal:** All safe (G03-OVERLAP)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** All under ~/agents/. Screenshot: SCEN-009/S017-working-dirs.png

#### S018: Verify MANAGER is NOT in the team
- **Action:** Check team agentIds for MANAGER
- **Goal:** MANAGER is host-level, not team-level (R4.3)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** MANAGER ID not in team. Screenshot: SCEN-009/S018-mgr-not-in-team.png

---

## Phase 7: RBAC Probes

#### S019: Attempt MANAGER self-modification via API
- **Action:** `PATCH /api/agents/<managerId>` with `X-Agent-Id: <managerId>` and body `{"label": "self-hack"}`
- **Goal:** 403 -- no agent can modify itself
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 403. Screenshot: SCEN-009/S019-no-self-mod.png

#### S020: Attempt agent deletion by MEMBER
- **Action:** Get a MEMBER agent ID. `DELETE /api/agents/<anotherMemberId>` with `X-Agent-Id: <memberId>`
- **Goal:** 403 -- only MANAGER can delete agents
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response 403. Screenshot: SCEN-009/S020-rbac-delete-denied.png

---

## Phase 8: Verify Kanban Tasks

#### S021: Open team kanban board
- **Action:** Team dashboard -> Kanban tab
- **Goal:** Kanban board visible
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Board rendered. Screenshot: SCEN-009/S021-kanban.png

#### S022: Count and inspect tasks
- **Action:** Count tasks, note titles and statuses
- **Goal:** If MANAGER created tasks, they are well-formed
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Tasks (if any) have titles and assignees. Screenshot: SCEN-009/S022-kanban-tasks.png

---

## Phase 9: Stress Test -- MANAGER Removal/Re-assignment

#### S023: Remove MANAGER title
- **Action:** Click MANAGER badge -> AUTONOMOUS. SUDO-MODE: when the sudo password modal appears (PATCH `/api/agents/{id}/title` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** MANAGER removed, team blocked (R9.5)
- **Creates:** nothing
- **Modifies:** Governance, team blocked
- **Verify:** AUTONOMOUS. `hasManager: false`. Team `blocked: true`. Screenshot: SCEN-009/S023-mgr-removed.png

#### S024: Re-assign MANAGER title
- **Action:** AUTONOMOUS badge -> MANAGER. SUDO-MODE: when the sudo password modal appears (PATCH `/api/agents/{id}/title` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm. Sudo tokens are one-shot; each strict operation needs a fresh token.
- **Goal:** MANAGER restored, team unblocked (R9.6)
- **Creates:** nothing
- **Modifies:** Governance, team unblocked
- **Verify:** MANAGER badge. `hasManager: true`. Team `blocked: false`. Screenshot: SCEN-009/S024-mgr-restored.png

---

## Phase CLEANUP: Restore Original State

> **MANDATORY CLEANUP ORDER (see SCENARIOS_TESTS_RULES.md WARNING section):**
> 1. Delete test agents via UI (Profile → Danger Zone → Delete Agent → check "Also delete agent folder")
> 2. Delete test teams via UI (Teams tab → Delete team → governance password → "Delete Agents Too")
> 3. Purge cemetery entries via UI (Settings → Cemetery → Purge)
> 4. Verify via API (no test artifacts remain)
> 5. THEN STATE-WIPE restore config files from backup
> 6. Post-test screenshot
>
> **NEVER use bash to delete agent folders or kill tmux sessions. That is a Rule 6 violation.**

#### S025: Delete team with all agents
- **Action:** Teams -> Delete team -> password `mYkri1-xoxrap-gogtan` -> Delete Agents Too
- **Goal:** Team and all team agents deleted via DeleteTeam 8-gate pipeline
- **Removes:** Team, COS, all team members and folders
- **Verify:** Team gone. No team agent IDs in agents list. Screenshot: SCEN-009/S025-team-deleted.png

#### S026: Remove MANAGER title
- **Action:** MANAGER badge -> AUTONOMOUS. SUDO-MODE: when the sudo password modal appears (PATCH `/api/agents/{id}/title` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Removes:** MANAGER title
- **Verify:** `hasManager: false`. Screenshot: SCEN-009/S026-no-manager.png

#### S027: Delete scen-mgr-jsonl with folder
- **Action:** Profile -> Advanced -> Danger Zone -> Delete Agent -> check "Also delete agent folder" -> type `scen-mgr-jsonl` -> Delete Forever. SUDO-MODE: when the sudo password modal appears (DELETE `/api/agents/{id}` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Removes:** Agent, tmux, folder
- **Verify:** Agent gone. Run `ls ~/agents/scen-mgr-jsonl` returns "No such file or directory". Screenshot: SCEN-009/S027-mgr-deleted.png

#### S028: Delete remaining scen9-prefixed agents (strict ^scen9-/^cos-scen9- prefix only)
- **Action:** Fetch `GET /api/agents | jq '.agents[] | select(.name | test("^scen9-|^cos-scen9-")) | .name'`. For EACH name returned, open Profile -> Advanced -> Danger Zone -> Delete Agent -> check "Also delete agent folder" -> type exact name -> Delete Forever. Enter governance password `mYkri1-xoxrap-gogtan` when the sudo modal appears. Do NOT use substring matches like "jsonl" or "swift" — a user might have real agents with those words in their names (e.g. a swift project agent in ~/Code/).
- **Removes:** Only agents whose name starts exactly with `scen9-` or `cos-scen9-`.
- **Verify:** After the deletion, `GET /api/agents | jq '.agents[] | select(.name | test("^scen9-|^cos-scen9-"))'` returns empty. Pre-existing user agents are untouched. Screenshot: SCEN-009/S028-cleanup-agents.png

#### S028a: Post-cleanup hard workdir check — every remaining agent must be a real user agent
- **Action:** `GET /api/agents | jq '.agents[] | {name, workingDirectory}'`. For each returned agent, verify: (a) name does NOT start with `scen` in any form, (b) workingDirectory does NOT start with `/Users/<user>/agents/scen` in any form. If any scen-* agent remains, halt and report as cleanup failure.
- **Goal:** No scenario-created agent survives cleanup.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Report prints "Cleanup verified: 0 scen-prefixed agents remain."

#### S029: Verify cemetery entries and purge
- **Action:** Settings -> Cemetery. Verify test agents. For each test entry, click Purge. SUDO-MODE: when the sudo password modal appears for each purge (DELETE `/api/agents/cemetery` is a strict route), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Removes:** Cemetery archives
- **Verify:** No test entries. Screenshot: SCEN-009/S029-cemetery-purged.png

#### S030: STATE-WIPE -- Restore configuration files
- **Action:** Restore from S002 backup
- **Goal:** All files match
- **Verify:** Hash match. Screenshot: SCEN-009/S030-state-restored.png

#### S031: Post-test screenshot
- **Action:** `take_screenshot`
- **Goal:** UI identical to S005 baseline
- **Verify:** Visual comparison. Screenshot: SCEN-009/S031-post-cleanup.png
