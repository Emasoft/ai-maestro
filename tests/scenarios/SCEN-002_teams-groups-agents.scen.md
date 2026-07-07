---
number: 2
name: Teams, Groups, and Agent Title Lifecycle
version: "2.0"
description: >
  The user logs in, creates two test agents, then creates a team containing
  both. They verify that joining a team auto-assigns the MEMBER title. They
  promote one agent to COS and another to ORCHESTRATOR, checking that
  role-plugins install automatically. They try to remove the COS (blocked
  by R4.7), remove an agent from the team (title reverts to AUTONOMOUS),
  re-add it, open the kanban board and drag a task, then delete the team
  with the governance password and confirm cemetery entries.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance (title transitions, singleton constraints, RBAC)
  - role-plugins (auto-install, auto-uninstall, plugin swap)
  - agent-registry (team membership, governanceTitle field, cemetery)
  - teams-service (create, edit, add/remove agents, delete pipeline)
  - auth (LoginGate, no-self-modification, RBAC authorize())
  - kanban (team task CRUD, drag between columns)
ui_sections:
  - Login page (governance password login)
  - Sidebar -> Teams tab -> Create Team modal
  - Sidebar -> Teams tab -> Edit Team modal
  - Sidebar -> Agents tab -> Agent list (grouped by team)
  - Agent Profile -> Overview tab -> Governance Title
  - Agent Profile -> Overview tab -> Team field
  - Agent Profile -> Config tab -> Role Plugin
  - Title Assignment Dialog (radio cards, singleton disable)
  - Governance Password Dialog
  - Team Dashboard -> Kanban board
  - Settings -> Cemetery tab
data_produced:
  - 2 test agents (temporary, created and deleted)
  - 1 test team (temporary, created and deleted)
  - 1 auto-COS agent (temporary, created and deleted)
  - 1 local kanban task (temporary, created in S038 and deleted in S039b — no longer deferred)
  - Agent registry entries (temporary, cleaned up)
  - Team entries (temporary, cleaned up)
  - Plugin settings.local.json modifications (restored)
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
  - ai-maestro-plugins marketplace registered (Emasoft/ai-maestro-plugins)
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

# Teams, Groups, and Agent Title Lifecycle Scenario

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state with known commit hash
- **Creates:** nothing
- **Modifies:** git history (new commit if needed)
- **Verify:** `git status` shows clean working tree. Screenshot: SCEN-002/S001-git-clean.png

#### S002: STATE-WIPE Checkpoint -- Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/teams-groups-agents_<timestamp>/`
- **Goal:** Copies of the following saved: `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.aimaestro/governance.json`, `~/.aimaestro/agents/registry.json`, `~/.aimaestro/teams/teams.json`, `~/.aimaestro/teams/groups.json`
- **Creates:** Backup directory with config copies
- **Modifies:** nothing
- **Verify:** Backup files exist and match originals (hash comparison). Screenshot: SCEN-002/S002-backup-created.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `GET /api/sessions` returns 200
- **Goal:** Server running and healthy
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API returns session list (HTTP 200). Screenshot: SCEN-002/S003-server-healthy.png

#### S004: Navigate to dashboard
- **Action:** `navigate_page` to `http://localhost:23000`
- **Goal:** Login page loads (LoginGate blocks unauthenticated access)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot shows login form. Screenshot: SCEN-002/S004-login-page.png

---

## Phase 1: LoginGate Authentication

#### S005: Log in with governance password
- **Action:** Fill password field with `mYkri1-xoxrap-gogtan`, click "Login" button
- **Goal:** Login succeeds, dashboard loads with sidebar and agent list
- **Creates:** Session cookie
- **Modifies:** nothing
- **Verify:** Dashboard visible. Screenshot: SCEN-002/S005-dashboard-loaded.png

#### S006: Take pre-test screenshot (baseline)
- **Action:** `take_screenshot` of full page
- **Goal:** Baseline image for CLEAN-AFTER-YOURSELF verification
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved. Screenshot: SCEN-002/S006-baseline.png

---

## Phase 2: Create Test Agents (0-IMPACT)

#### S007: Open agent creation wizard
- **Action:** Click the "+" button in sidebar header
- **Goal:** Agent creation wizard opens
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Wizard dialog visible with client selection step. Screenshot: SCEN-002/S007-wizard-open.png

#### S008: Create first test agent -- scen-test-agent-alpha
- **Action:** Select "Claude Code" as client, click Next. Enter name `scen-test-agent-alpha`, click Next through remaining steps (no team, default AUTONOMOUS title, no role-plugin). Click Create/Finish.
- **Goal:** Agent `scen-test-agent-alpha` created as AUTONOMOUS with no team
- **Creates:** Agent `scen-test-agent-alpha` in registry
- **Modifies:** Agent registry (new entry)
- **Verify:** Agent appears in sidebar agent list. Screenshot: SCEN-002/S008-alpha-created.png

#### S009: Verify scen-test-agent-alpha in sidebar
- **Action:** Click on `scen-test-agent-alpha` in the agent list
- **Goal:** Profile panel shows agent details, title is AUTONOMOUS, no team
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Profile heading shows `scen-test-agent-alpha`, title badge shows AUTONOMOUS, team shows "No team". Screenshot: SCEN-002/S009-alpha-profile.png

#### S010: Open agent creation wizard again
- **Action:** Click the "+" button in sidebar header
- **Goal:** Agent creation wizard opens
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Wizard dialog visible. Screenshot: SCEN-002/S010-wizard-reopen.png

#### S011: Create second test agent -- scen-test-agent-beta
- **Action:** Select "Claude Code" as client, click Next. Enter name `scen-test-agent-beta`, click Next through remaining steps (no team, default AUTONOMOUS title, no role-plugin). Click Create/Finish.
- **Goal:** Agent `scen-test-agent-beta` created as AUTONOMOUS with no team
- **Creates:** Agent `scen-test-agent-beta` in registry
- **Modifies:** Agent registry (new entry)
- **Verify:** Agent appears in sidebar agent list. Screenshot: SCEN-002/S011-beta-created.png

#### S012: Verify scen-test-agent-beta in sidebar
- **Action:** Click on `scen-test-agent-beta` in the agent list
- **Goal:** Profile panel shows agent details, title is AUTONOMOUS, no team
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Profile heading shows `scen-test-agent-beta`, title badge shows AUTONOMOUS. Screenshot: SCEN-002/S012-beta-profile.png

---

## Phase 3: Team Creation

#### S013: Switch to Teams tab
- **Action:** Click "Teams" tab in sidebar
- **Goal:** Teams view shown with "Create Team" button
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows "Create Team" button visible. Screenshot: SCEN-002/S013-teams-tab.png

#### S014: Open Create Team modal
- **Action:** Click "+ Create Team" button
- **Goal:** Create Team modal opens with Name, Description, and agent multi-select fields
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Modal visible with heading "Create Team", name textbox, description textbox, agent selection list. Screenshot: SCEN-002/S014-create-team-modal.png

#### S015: Fill team name
- **Action:** Type `scen-test-team-alpha` in the Name field
- **Goal:** Name field populated
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Name field shows `scen-test-team-alpha`. Screenshot: SCEN-002/S015-team-name.png

#### S016: Fill team description
- **Action:** Type `Scenario 002 integration testing team` in the Description field
- **Goal:** Description field populated
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Description field shows entered text. Screenshot: SCEN-002/S016-team-desc.png

#### S017: Select scen-test-agent-alpha
- **Action:** Click `scen-test-agent-alpha` in the agents multi-select list
- **Goal:** Agent highlighted, selected count = 1
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Agent button highlighted, count text shows "1 selected". Screenshot: SCEN-002/S017-alpha-selected.png

#### S018: Select scen-test-agent-beta
- **Action:** Click `scen-test-agent-beta` in the agents multi-select list
- **Goal:** Agent highlighted, selected count = 2
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Agent button highlighted, count text shows "2 selected". Screenshot: SCEN-002/S018-beta-selected.png

#### S019: Submit Create Team
- **Action:** Click "Create Team" submit button
- **Goal:** Modal closes, team created via `POST /api/teams`, team card appears in sidebar. Auto-COS agent created (cos-scen-test-team-alpha with robot avatar).
- **Creates:** Team `scen-test-team-alpha` in teams registry, auto-COS agent `cos-scen-test-team-alpha`
- **Modifies:** Teams registry (new entry), agents registry (COS + members), both test agents get MEMBER title + programmer plugin
- **Verify:** Wait 2s, team card visible in sidebar showing name `scen-test-team-alpha` and count "3" (2 test agents + 1 auto-COS). Screenshot: SCEN-002/S019-team-created.png

#### S020: Verify team card shows description
- **Action:** Inspect the `scen-test-team-alpha` team card in sidebar
- **Goal:** Description text visible on team card
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows "Scenario 002 integration testing team" on the card. Screenshot: SCEN-002/S020-team-description.png

---

## Phase 4: Agent Title Auto-Assignment on Team Join

#### S021: Switch to Agents tab
- **Action:** Click "Agents" tab in sidebar
- **Goal:** Agent list shown, grouped by team
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows "Agents" tab active. Screenshot: SCEN-002/S021-agents-tab.png

#### S022: Verify team group header
- **Action:** Look for `SCEN-TEST-TEAM-ALPHA` group header in agent list
- **Goal:** Both test agents grouped under the team heading with count 2
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows team name header with count "2". Screenshot: SCEN-002/S022-team-group.png

#### S023: Check scen-test-agent-alpha title and plugin
- **Action:** Click on `scen-test-agent-alpha` in the agent list
- **Goal:** Profile panel opens, title auto-transitioned to MEMBER with programmer plugin
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title badge shows "MEMBER" (was AUTONOMOUS before joining team). Plugin banner shows `ai-maestro-programmer-agent`. Screenshot: SCEN-002/S023-alpha-member.png

#### S024: Verify team membership in profile
- **Action:** Scroll to "Team" section in profile Overview tab
- **Goal:** Team shows `scen-test-team-alpha`
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Team field displays `scen-test-team-alpha` (not "No team"). Screenshot: SCEN-002/S024-team-membership.png

---

## Phase 5: COS Verification + Title Dialog R4.7 enforcement

> **Context (AUTHORING-002 fix during 20260426T204800Z run):** Original
> S025-S031 assumed the COS slot was empty after team creation, but in
> reality CreateTeam auto-creates a `cos-<teamslug>` agent that takes the
> COS slot immediately (Laetitia in this run). R4.7 immutability is
> therefore tested by the Title Assignment Dialog DISABLING the
> CHIEF-OF-STAFF card on every other team agent. The scenario steps were
> rewritten to verify this disabled state IS the test outcome (not a
> failure to promote).

#### S025: Check team auto-COS was created
- **Action:** Verify team data (via team card or API check) for chiefOfStaffId
- **Goal:** Confirm a COS agent was auto-created (every team must have a COS)
- **Creates:** nothing (COS was auto-created during team creation at S019)
- **Modifies:** nothing
- **Verify:** chiefOfStaffId is NOT null. A `cos-scen-test-team-alpha` agent exists with CHIEF-OF-STAFF title and robot avatar. Screenshot: SCEN-002/S025-auto-cos.png

#### S026: Click on scen-test-agent-beta
- **Action:** Click `scen-test-agent-beta` in the agent list
- **Goal:** Profile panel opens for scen-test-agent-beta
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Profile heading shows `scen-test-agent-beta`. Screenshot: SCEN-002/S026-beta-profile.png

#### S027: Open Title Assignment Dialog
- **Action:** Click the Governance Title badge/button (showing MEMBER)
- **Goal:** Title Assignment Dialog opens with team-specific titles
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog shows MEMBER, CHIEF-OF-STAFF, ORCHESTRATOR, ARCHITECT, INTEGRATOR options. Screenshot: SCEN-002/S027-title-dialog.png

#### S028: Verify CHIEF-OF-STAFF is DISABLED (R4.7 enforcement)
- **Action:** Inspect the CHIEF-OF-STAFF radio card without clicking
- **Goal:** R4.7 enforcement is visible — the card is disabled with explanation referencing the existing COS persona name
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** CHIEF-OF-STAFF card is grayed out / not clickable. Disabled-state explanation text contains "Only one Chief-of-Staff is allowed per team" and the existing COS persona name (e.g. "Laetitia"). Screenshot: SCEN-002/S028-cos-disabled.png

#### S029: Cancel out of Title dialog (no change)
- **Action:** Click Cancel button in the dialog
- **Goal:** Dialog closes, beta remains MEMBER (no title change)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title badge still shows MEMBER. Screenshot: SCEN-002/S029-dialog-cancelled.png

#### S030: Verify COS plugin still on auto-COS agent
- **Action:** Click on `cos-scen-test-team-alpha` (Laetitia) in the ALL/HIBER tab. Click Profile if not visible.
- **Goal:** Auto-COS profile shows CHIEF-OF-STAFF title with `ai-maestro-chief-of-staff` plugin
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Profile shows CHIEF-OF-STAFF badge and `ai-maestro-chief-of-staff` plugin. Screenshot: SCEN-002/S030-cos-plugin.png

---

## Phase 6: COS Immutability Probe (R4.7)

> **Context:** R4.7 says COS cannot be removed from a team's agentIds while they
> remain chiefOfStaffId. COS title can only be removed by deleting the team.

#### S031: Attempt to remove auto-COS from team agentIds via API
- **Action:** Get the auto-COS agent's ID (cos-scen-test-team-alpha). Read-only verification: the API path `PUT /api/teams/<teamId>` is the canonical mutation; the runner inspects the team's COS-removal protections via the UI flow at S041-S044 (the team-edit modal does not allow deselecting the COS card). This step verifies the dialog-side protection by re-opening the Title Assignment Dialog on Laetitia (the auto-COS) and confirming her CHIEF-OF-STAFF title is locked / non-removable from her side too.
- **Goal:** R4.7 immutability is observable from BOTH directions — promotion of others is blocked (S028) AND demotion of the existing COS is blocked.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title Assignment Dialog on Laetitia shows MEMBER + ORCHESTRATOR + ARCHITECT + INTEGRATOR all DISABLED with text referencing R4.7 lock or "team's Chief-of-Staff cannot be demoted while the team exists". Cancel out without changes. Screenshot: SCEN-002/S031-cos-immutability.png

---

## Phase 7: Assign ORCHESTRATOR Title

#### S032: Click on scen-test-agent-alpha
- **Action:** Click `scen-test-agent-alpha` in the agent list
- **Goal:** Profile panel opens for scen-test-agent-alpha
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Profile heading shows `scen-test-agent-alpha`. Screenshot: SCEN-002/S032-alpha-profile.png

#### S033: Open Title Assignment Dialog
- **Action:** Click the Governance Title badge (showing MEMBER)
- **Goal:** Title Assignment Dialog opens
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog visible with title options. Screenshot: SCEN-002/S033-title-dialog.png

#### S034: Verify ORCHESTRATOR is available
- **Action:** Inspect ORCHESTRATOR radio card
- **Goal:** ORCHESTRATOR option is visible and ENABLED (no one has it yet)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** ORCHESTRATOR card is not grayed out, is clickable. Screenshot: SCEN-002/S034-orchestrator-available.png

#### S035: Select ORCHESTRATOR and confirm with password
- **Action:** Click ORCHESTRATOR, click Confirm. Enter `mYkri1-xoxrap-gogtan` in password dialog, submit. When the sudo password modal appears (strict route `PATCH /api/agents/[id]/title` per Rule 12), enter governance password `mYkri1-xoxrap-gogtan` again and click Confirm.
- **Goal:** Title changes to ORCHESTRATOR, orchestrator role-plugin auto-installed
- **Creates:** Plugin entry in agent's settings.local.json
- **Modifies:** Agent governanceTitle (MEMBER -> ORCHESTRATOR), plugin state
- **Verify:** Profile shows ORCHESTRATOR badge. Screenshot: SCEN-002/S035-orchestrator-assigned.png

#### S036: Verify ORCHESTRATOR role-plugin
- **Action:** Click "Config" tab in profile panel
- **Goal:** Role Plugin section shows `ai-maestro-orchestrator-agent` locked by ORCHESTRATOR
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin name `ai-maestro-orchestrator-agent` displayed with lock indicator. Screenshot: SCEN-002/S036-orchestrator-plugin.png

---

## Phase 8: Kanban Board UI Verification

> **Context (AUTHORING-004 fix — 2026-07-07, TRDD-5BPG69NO investigation):**
> The prior AUTHORING-003 note below (kept for history) claimed the kanban
> UI is GitHub-Project-gated end-to-end and deferred S038/S039. Investigation
> on 2026-07-07 found there are TWO separate task/kanban surfaces:
> `POST /api/teams/[id]/kanban/items` (GitHub-only, gates on
> `team.githubProject` at `app/api/teams/[id]/kanban/items/route.ts:74`), and
> `POST /api/teams/[id]/tasks` (the LOCAL-TASK model — no `githubProject`
> gate — used by `useTasks.createTask` in `hooks/useTasks.ts:112`). The
> kanban board's "Add task" inline form
> (`components/team-meeting/TaskKanbanBoard.tsx` `onCreateTask` prop, wired
> from `useTasks`) posts to the LOCAL route `/api/teams/[id]/tasks`, NOT the
> GitHub-gated route. So S038/S039 below are now LIVE steps exercising the
> local-task CRUD path (create -> drag -> verify -> delete) with zero
> GitHub fixture dependency — they are no longer DEFERRED.
>
> **Prior context (AUTHORING-003, 2026-04-26 run, SUPERSEDED — kept for
> history):** As of 2026-03-27 (governance simplification), local kanban
> tasks were believed removed in favor of GitHub Projects integration
> exclusively (see `services/teams-service.ts` line 30 comment). That
> comment describes the GitHub-linked kanban ITEMS route only — the
> separate local-task route (`/api/teams/[id]/tasks`) was never actually
> removed, and it is what the "Add task" inline form on this board uses.

#### S037: Navigate to team dashboard kanban
- **Action:** Navigate browser to `/teams/<teamId>` (the URL with the team ID), wait for the team dashboard to render, click the "Kanban" tab.
- **Goal:** Kanban board loads with ≥5 columns matching the project's configured kanban pipeline (see `~/.claude/rules/trdd-design-tasks.md` v2 Column enum and `types/team.ts` `DEFAULT_KANBAN_COLUMNS`), each with a per-column "Add task" control. Do not hardcode a fixed column count or name list — the pipeline shape is allowed to evolve (current actual: the TRDD-v2 14-stage set — Backburner/To Do/Design/Dispatch/Dev/Testing/AI Review/Human Review/Complete/Publish/Published/Deploy/Live/Live-Auditing).
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Kanban board visible with ≥5 column headers, each showing a per-column "Add task" affordance. Screenshot: SCEN-002/S037-kanban-board.png

#### S038: Create a task in the kanban board (local-task model)
- **Action:** Click "Add task" on the first column (Backburner, the TRDD-v2 entry column). Fill title `SCEN-002 test task`. Click "Add Task" / submit.
- **Goal:** Task is created via the local-task route `POST /api/teams/<id>/tasks` (no GitHub project required) and appears as a card in the Backburner column.
- **Creates:** 1 local task (persisted per `lib/task-registry.ts`).
- **Modifies:** nothing else.
- **Verify:** Network response from `POST /api/teams/<id>/tasks` returns 200/201 with the new task object. Card with title "SCEN-002 test task" visible in the Backburner column. Screenshot: SCEN-002/S038-task-created.png

#### S039: Drag the task to another column and verify status change
- **Action:** Drag the "SCEN-002 test task" card from Backburner to the next column (To Do) using native HTML5 drag-and-drop (matching the existing `KanbanCard`/`KanbanColumn` pattern — see CLAUDE.md §"Team Meeting Architecture"). Drop.
- **Goal:** Task status updates to the target column via `PUT /api/teams/<id>/tasks/<taskId>`.
- **Creates:** nothing.
- **Modifies:** the task's status field.
- **Verify:** `GET /api/teams/<id>/tasks` shows the task's status matching the To Do column. Card visually moved to the To Do column. Screenshot: SCEN-002/S039-task-dragged.png

#### S039b: Delete the test task (cleanup)
- **Action:** Open the "SCEN-002 test task" card's detail view, click delete/remove, confirm.
- **Goal:** Task removed from the board and from persisted storage via `DELETE /api/teams/<id>/tasks/<taskId>`.
- **Removes:** 1 local task.
- **Verify:** `GET /api/teams/<id>/tasks` no longer lists "SCEN-002 test task". Screenshot: SCEN-002/S039b-task-deleted.png

---

## Phase 9: Remove Agent from Team

#### S040: Switch to Agents tab
- **Action:** Click "Agents" tab in sidebar
- **Goal:** Agents view shown
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows agents list. Screenshot: SCEN-002/S040-agents-tab.png

#### S041: Switch to Teams tab and open Edit Team modal
- **Action:** Click "Teams" tab. Hover over `scen-test-team-alpha` team card, click edit (pencil) icon
- **Goal:** Edit team modal opens with both test agents PLUS the auto-created COS agent pre-selected (per the CreateTeam pipeline's auto-COS creation — see the "Auto-COS creation on team creation" authoring note in `SCENARIOS_TESTS_RULES.md`; the auto-COS is a full `team.agentIds` member, not a UI-only decoration). Do NOT hardcode the auto-COS's persona name (it is randomly generated) — derive it from `team.chiefOfStaffId` via `GET /api/teams/<id>` when verifying which row is the COS.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Modal shows `scen-test-agent-alpha`, `scen-test-agent-beta`, AND the auto-COS agent (identified via `team.chiefOfStaffId`) all selected — 3 selected total (N=2 explicit members + 1 auto-COS). Screenshot: SCEN-002/S041-edit-team.png

#### S042: Remove scen-test-agent-alpha from team
- **Action:** Click `scen-test-agent-alpha` to deselect
- **Goal:** Agent unhighlighted, count decreases from 3 to 2 (beta + auto-COS remain selected)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows count "2 selected". Screenshot: SCEN-002/S042-alpha-deselected.png

#### S043: Save team changes
- **Action:** Click "Save" / "Update Team" button
- **Goal:** Modal closes, team updated with only scen-test-agent-beta
- **Creates:** nothing
- **Modifies:** Team agentIds (alpha removed), alpha's team membership, alpha's title (-> AUTONOMOUS), alpha's role-plugin (orchestrator plugin swapped for `ai-maestro-autonomous-agent` per R9.13)
- **Verify:** Wait 2s, team card shows count 1. Screenshot: SCEN-002/S043-team-updated.png

#### S044: Verify scen-test-agent-alpha reverted to AUTONOMOUS
- **Action:** Switch to "Agents" tab, click on `scen-test-agent-alpha`
- **Goal:** Agent's title reverted to AUTONOMOUS, no team (AUTONOMOUS still carries its mandatory role-plugin per R9.13 — checked in S045)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title badge shows "AUTONOMOUS", team shows "No team". Screenshot: SCEN-002/S044-alpha-autonomous.png

#### S045: Verify role-plugin swapped to ai-maestro-autonomous-agent (R9.13)
- **Action:** Click "Config" tab in profile panel
- **Goal:** Role-plugin is `ai-maestro-autonomous-agent` (the orchestrator plugin was uninstalled on team-leave; AUTONOMOUS is NOT a role-less state — ChangeTitle Gate 17 auto-installs the mandatory AUTONOMOUS role-plugin per R9.13)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Role Plugin section shows `ai-maestro-autonomous-agent` (locked by AUTONOMOUS), NOT "None"/empty. The previous `ai-maestro-orchestrator-agent` is gone. Screenshot: SCEN-002/S045-autonomous-plugin.png

---

## Phase 10: Re-add Agent and Re-assign ORCHESTRATOR

#### S046: Edit team to re-add scen-test-agent-alpha
- **Action:** Switch to "Teams" tab, click edit on `scen-test-team-alpha`, select `scen-test-agent-alpha`, save
- **Goal:** Alpha re-added to team, title auto-transitions to MEMBER
- **Creates:** nothing
- **Modifies:** Team agentIds (alpha added back), alpha's team membership, alpha's title (-> MEMBER)
- **Verify:** Team card shows count 3 (beta + auto-COS + re-added alpha — COS-inclusive, per the auto-COS authoring note; do not hardcode the auto-COS persona name, derive it from `team.chiefOfStaffId`). Screenshot: SCEN-002/S046-team-readded.png

#### S047: Verify scen-test-agent-alpha is MEMBER again
- **Action:** Switch to "Agents" tab, click on `scen-test-agent-alpha`
- **Goal:** Title shows MEMBER (auto-assigned on team rejoin)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title badge shows "MEMBER". Screenshot: SCEN-002/S047-alpha-member-again.png

#### S048: Re-assign ORCHESTRATOR title
- **Action:** Click title badge, select ORCHESTRATOR, confirm with `mYkri1-xoxrap-gogtan`. When the sudo password modal appears (strict route `PATCH /api/agents/[id]/title` per Rule 12), enter governance password `mYkri1-xoxrap-gogtan` again and click Confirm.
- **Goal:** Title changes back to ORCHESTRATOR, plugin re-installed
- **Creates:** Plugin entry in settings.local.json
- **Modifies:** Agent governanceTitle (MEMBER -> ORCHESTRATOR), plugin state
- **Verify:** Title badge shows "ORCHESTRATOR". Screenshot: SCEN-002/S048-orchestrator-reassigned.png

#### S049: Verify role-plugin restored
- **Action:** Click "Config" tab
- **Goal:** Role Plugin shows `ai-maestro-orchestrator-agent` locked by ORCHESTRATOR
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin name and lock indicator visible. Screenshot: SCEN-002/S049-plugin-restored.png

---

## Phase 11: Singleton Constraint Checks

#### S050: Open title dialog for scen-test-agent-beta (COS agent)
- **Action:** Click on `scen-test-agent-beta` in agent list, click Governance Title badge
- **Goal:** Title Assignment Dialog opens
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog visible with title options. Screenshot: SCEN-002/S050-singleton-dialog.png

#### S051: Verify ORCHESTRATOR option is DISABLED
- **Action:** Inspect ORCHESTRATOR radio card
- **Goal:** ORCHESTRATOR is grayed out / not selectable because scen-test-agent-alpha holds the slot
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** ORCHESTRATOR card shows disabled state with explanation text (e.g. "Already assigned" or "Only one ORCHESTRATOR per team"). Screenshot: SCEN-002/S051-orchestrator-disabled.png

#### S052: Verify CHIEF-OF-STAFF shows as current
- **Action:** Inspect CHIEF-OF-STAFF radio card
- **Goal:** COS is shown as the current/active selection (scen-test-agent-beta IS the COS)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** CHIEF-OF-STAFF card shown as active/selected. Screenshot: SCEN-002/S052-cos-current.png

#### S053: Close title dialog
- **Action:** Click Cancel or close button
- **Goal:** Dialog dismissed
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Dialog gone, profile panel visible. Screenshot: SCEN-002/S053-dialog-closed.png

---

## Phase 12: RBAC Probe -- No Self-Modification

> **Context (AUTHORING-002 fix during 20260623T094045Z run):** The original
> S054 instructed a direct `PATCH /api/agents/<id>` curl carrying an
> agent-identity header `X-Agent-Id`. That is forbidden by Rule 0 (the
> scenario runner is the HUMAN USER, never an agent — it has no AID and may
> not send agent-authenticated API calls) AND by Rule 6 (state-mutating
> `curl -X PATCH` to agent/team/governance endpoints is blocked by the
> subagent write-guard; reads only). A negative test expecting 403 does not
> change that the *method* is forbidden user tooling, and the human user has
> no UI path to make an agent modify itself. S054 is therefore DEFERRED — the
> RBAC no-self-modification rule is a backend `authorize()` concern best
> covered by a unit test, not a UI scenario step. The whole scenario already
> demonstrates the USER-authority model: every title change required the
> governance password / sudo modal (the USER's authority), and no agent ever
> acted on itself through the UI.

#### S054: DEFERRED — RBAC no-self-modification probe (requires forbidden agent-auth API call)
- **Action:** N/A via the UI. The probe needs a direct `PATCH /api/agents/<id>` with an `X-Agent-Id` header — forbidden user tooling (Rule 0 + Rule 6). Read-only verification only: confirm `scen-test-agent-alpha`'s `label` is still its name (unchanged), demonstrating no out-of-band self-mutation occurred.
- **Goal:** Document that the no-self-modification RBAC rule cannot be exercised through the human-user surface; it belongs in a backend unit test.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** `scen-test-agent-alpha.label` unchanged in the registry (read-only). Screenshot: SCEN-002/S054-no-self-mod.png
- **DEFERRED:** Move RBAC self-modification coverage to `tests/unit/` (server `authorize()`), or rewrite as a UI-observable check if one exists. Tracked in proposals.

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

#### S055: Delete scen-test-agent-alpha
- **Action:** Click on `scen-test-agent-alpha` in sidebar, click delete button in profile panel -> Danger Zone -> "Delete Agent" -> confirm. When the sudo password modal appears (`DELETE /api/agents/[id]` is a strict route per Rule 12), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Test agent fully removed from registry and team
- **Creates:** Cemetery archive entry
- **Modifies:** Agent registry (entry removed), team agentIds (alpha removed)
- **Verify:** Agent no longer appears in sidebar. Screenshot: SCEN-002/S055-alpha-deleted.png

#### S056: Delete scen-test-agent-beta
- **Action:** Click on `scen-test-agent-beta` in sidebar, click delete button in profile panel, confirm deletion. When the sudo password modal appears (strict route `DELETE /api/agents/[id]` per Rule 12), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Test agent fully removed from registry and team
- **Creates:** Cemetery archive entry
- **Modifies:** Agent registry (entry removed), team agentIds (beta removed), team chiefOfStaffId (cleared)
- **Verify:** Agent no longer appears in sidebar. Screenshot: SCEN-002/S056-beta-deleted.png

#### S057: Delete scen-test-team-alpha via DeleteTeam pipeline
- **Action:** Switch to "Teams" tab, find `scen-test-team-alpha` team card, click delete icon. First dialog: click Delete. Second dialog: enter governance password `mYkri1-xoxrap-gogtan`, click "Delete Agents Too".
- **Goal:** Test team fully removed via DeleteTeam 8-gate pipeline. All agents (including auto-COS) reverted to AUTONOMOUS with no role-plugin, then deleted. Pending transfers cancelled. Team task files deleted.
- **Creates:** nothing
- **Modifies:** Teams registry (entry removed), all team agents deleted
- **Verify:** Team card no longer appears in sidebar. Screenshot: SCEN-002/S057-team-deleted.png

#### S058: Delete auto-COS agent (cos-scen-test-team-alpha)
- **Action:** Find `cos-scen-test-team-alpha` in agent list (ALL tab). If still present (not deleted by "Delete Agents Too"), click delete button, confirm. When the sudo password modal appears (strict route `DELETE /api/agents/[id]` per Rule 12), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Auto-created COS agent removed from registry
- **Creates:** nothing
- **Modifies:** Agent registry (entry removed)
- **Verify:** Agent no longer appears in sidebar. Screenshot: SCEN-002/S058-cos-deleted.png

#### S059: Verify cemetery entries exist
- **Action:** Navigate to Settings page -> click "Cemetery" tab
- **Goal:** Deleted test agents appear in cemetery as archived zips
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Cemetery list shows entries for the deleted test agents. Screenshot: SCEN-002/S059-cemetery-entries.png

#### S060: Purge all test cemetery entries
- **Action:** For each test agent in cemetery (scen-test-agent-alpha, scen-test-agent-beta, cos-scen-test-team-alpha), click "Purge" and confirm. When the sudo password modal appears each time (`DELETE /api/agents/cemetery` is a strict route per Rule 12, and sudo tokens are one-shot), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** All test cemetery entries removed
- **Removes:** Cemetery zip archives for test agents
- **Verify:** No test agent entries remain in cemetery. Screenshot: SCEN-002/S060-cemetery-purged.png

#### S061: STATE-WIPE -- Restore configuration files
- **Action:** Compare current config files with backups from S002. If any differ, restore from backup.
- **Goal:** All config files match pre-test state
- **Creates:** nothing
- **Modifies:** Config files (restored to backup state if changed)
- **Verify:** File hash comparison -- all match. Screenshot: SCEN-002/S061-state-restored.png

#### S062: Take post-test screenshot and compare with S006
- **Action:** `take_screenshot` of full page
- **Goal:** UI looks identical to pre-test baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual comparison with S006 screenshot -- sidebar, agent list, team list unchanged. Screenshot: SCEN-002/S062-post-cleanup.png
