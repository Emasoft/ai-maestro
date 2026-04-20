---
number: 3
name: Agent Creation Wizard with Title and Role-Plugin
version: "2.0"
description: >
  The user logs in, creates a test team, then opens the agent creation
  wizard twice. First they create an INTEGRATOR agent — the wizard locks
  the role-plugin with no dropdown choice. Then they create a MEMBER agent
  — the wizard shows a dropdown if multiple plugins are compatible. After
  each creation, they check the profile panel for correct title and the
  Config tab for the installed plugin. They delete both agents through
  the Danger Zone and confirm cemetery entries.
  Covers governance rules R4.4, R11, R12, R16.
client: claude
interhosts: false
device: desktop
subsystems:
  - governance (title assignment via wizard, RBAC)
  - role-plugins (auto-enforcement for locked titles, custom plugin selection)
  - agent-registry (agent creation, team membership, cemetery)
  - teams-service (team creation for test context)
  - agent-creation-wizard (multi-step wizard flow)
  - auth (LoginGate, no-self-modification)
ui_sections:
  - Login page (governance password login)
  - Sidebar -> Agents tab -> "+" Create Agent button
  - Agent Creation Wizard -> Step 1 Client
  - Agent Creation Wizard -> Step 2 Avatar + Name
  - Agent Creation Wizard -> Step 3 Team
  - Agent Creation Wizard -> Step 4 Title
  - Agent Creation Wizard -> Step 5 Role-Plugin
  - Agent Creation Wizard -> Step 6 Summary
  - Sidebar -> Teams tab -> Create Team modal
  - Agent Profile -> Overview tab -> Governance Title
  - Agent Profile -> Config tab -> Role Plugin
  - Settings -> Cemetery tab
data_produced:
  - 1 test team (temporary, created and deleted)
  - 2 test agents (temporary, created and deleted)
  - 1 auto-COS agent (temporary, deleted with team)
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
  - Role-plugin defaults synced (ai-maestro-integrator-agent, ai-maestro-programmer-agent available)
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

# Agent Creation Wizard with Title and Role-Plugin Scenario

## Phase 0: SAFE-SETUP

#### S001: Commit current state
- **Action:** Run `git status` and commit any uncommitted changes
- **Goal:** Clean git state with known commit hash
- **Creates:** nothing
- **Modifies:** git history (new commit if needed)
- **Verify:** `git status` shows clean working tree. Screenshot: SCEN-003/S001-git-clean.png

#### S002: STATE-WIPE Checkpoint -- Save configuration
- **Action:** Backup config files to `tests/scenarios/state-backups/agent-creation-wizard_<timestamp>/`
- **Goal:** Copies of the following saved: `~/.claude/settings.json`, `~/.claude/settings.local.json`, `~/.aimaestro/governance.json`, `~/.aimaestro/agents/registry.json`, `~/.aimaestro/teams/teams.json`, `~/.aimaestro/teams/groups.json`
- **Creates:** Backup directory with config copies
- **Modifies:** nothing
- **Verify:** Backup files exist and match originals (hash comparison). Screenshot: SCEN-003/S002-backup-created.png

#### S003: Build and verify server
- **Action:** `yarn build && pm2 restart ai-maestro`, wait 4s, check `GET /api/sessions` returns 200
- **Goal:** Server running and healthy
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** API returns session list (HTTP 200). Screenshot: SCEN-003/S003-server-healthy.png

#### S004: Navigate to dashboard
- **Action:** `navigate_page` to `http://localhost:23000`
- **Goal:** Login page loads (LoginGate)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Login form visible. Screenshot: SCEN-003/S004-login-page.png

---

## Phase 1: LoginGate Authentication

#### S005: Log in with governance password
- **Action:** Fill password field with `mYkri1-xoxrap-gogtan`, click "Login" button
- **Goal:** Dashboard loads with sidebar and agent list
- **Creates:** Session cookie
- **Modifies:** nothing
- **Verify:** Dashboard visible. Screenshot: SCEN-003/S005-dashboard-loaded.png

#### S006: Take pre-test screenshot (baseline)
- **Action:** `take_screenshot` of full page
- **Goal:** Baseline image for CLEAN-AFTER-YOURSELF verification
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Screenshot saved. Screenshot: SCEN-003/S006-baseline.png

---

## Phase 2: Create Test Team (0-IMPACT)

#### S007: Navigate to /teams page (use the full wizard, not the sidebar mini-form)
- **Action:** Click "Teams" in the sidebar navigation — this navigates to `/teams` (the full Team Creation Wizard). Do NOT use the sidebar's "+ Create Team" mini-form, which requires ≥1 selected agent (verified 2026-04-20 in TeamListView.tsx disable-submit logic). The `/teams` wizard allows empty teams via auto-COS.
- **Goal:** `/teams` page shown with "Create Team" button + any existing team cards.
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Browser URL ends in `/teams`. Snapshot shows Create Team button. Screenshot: SCEN-003/S007-teams-page.png

#### S008: Create test team via full wizard (with auto-COS)
- **Action:** Click "Create Team". Fill Team Info step (name `scen-test-wizard-team`, description `Scenario 003 wizard test team`, governance password `mYkri1-xoxrap-gogtan`). Skip GitHub Repos + GitHub Project steps (Next → Next). On Team Roles step leave COS as "Auto-create" and Orchestrator as "None". Click Next → Create Team on the Confirm step. (Proposal 16 fix 2026-04-20 — replaced contradictory "Do NOT select any agents" wording with the actual /teams wizard flow.)
- **Goal:** Team created with auto-generated COS agent. No contradiction with the UI reality.
- **Creates:** Team `scen-test-wizard-team` + auto-COS agent (typically `cos-scen-test-wizard-team`).
- **Modifies:** Teams registry, agents registry (auto-COS entry).
- **Verify:** Browser redirects to `/teams/<new-id>`. Team card on `/teams` now shows "1 agent" (the auto-COS). Registry lists a new COS with a random robot avatar. Screenshot: SCEN-003/S008-team-created.png

---

## Phase 3: Create Agent via Wizard -- INTEGRATOR

#### S009: Open agent creation wizard
- **Action:** Click the "+" button in sidebar header
- **Goal:** Agent creation wizard opens at Step 1 (Client)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Wizard dialog visible with client selection step. Screenshot: SCEN-003/S009-wizard-open.png

#### S010: Select Claude Code as client
- **Action:** Click "Claude Code" option in client selector
- **Goal:** Claude Code selected
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Option highlighted/selected. Screenshot: SCEN-003/S010-client-selected.png

#### S011: Advance to Step 2
- **Action:** Click Next
- **Goal:** Step 2 shown: Avatar picker and Name input
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Avatar grid and name text field visible. Screenshot: SCEN-003/S011-step2-avatar.png

#### S012: Select avatar and enter name
- **Action:** Click any robot avatar image. Type `scen-test-integrator-rex` in the Name field.
- **Goal:** Avatar selected, name entered
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Avatar highlighted, name field shows `scen-test-integrator-rex`. Screenshot: SCEN-003/S012-name-entered.png

#### S013: Advance to Step 3
- **Action:** Click Next
- **Goal:** Step 3 shown: Team selection dropdown
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Team dropdown or selection list visible. Screenshot: SCEN-003/S013-step3-team.png

#### S014: Select test team
- **Action:** Select `scen-test-wizard-team` from team dropdown/list
- **Goal:** Team selected
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Team name shown as selected. Screenshot: SCEN-003/S014-team-selected.png

#### S015: Advance to Step 4
- **Action:** Click Next
- **Goal:** Step 4 shown: Title selection (filtered by team membership)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title options visible: MEMBER, CHIEF-OF-STAFF, ORCHESTRATOR, ARCHITECT, INTEGRATOR. Screenshot: SCEN-003/S015-step4-title.png

#### S016: Select INTEGRATOR title
- **Action:** Click INTEGRATOR option
- **Goal:** INTEGRATOR selected
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** INTEGRATOR option highlighted/selected. Screenshot: SCEN-003/S016-integrator-selected.png

#### S017: Advance to Step 5
- **Action:** Click Next
- **Goal:** Step 5 shown: Role-plugin selection
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Role-plugin picker visible. Screenshot: SCEN-003/S017-step5-plugin.png

#### S018: Verify role-plugin is auto-enforced
- **Action:** Inspect the role-plugin selection
- **Goal:** `ai-maestro-integrator-agent` is auto-selected and locked (INTEGRATOR title enforces this plugin)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin shown as pre-selected, possibly with lock icon or "Required by INTEGRATOR" text. User cannot change selection. Screenshot: SCEN-003/S018-plugin-locked.png

#### S019: Complete wizard
- **Action:** Click Next to reach Summary (Step 6), then click Create/Finish
- **Goal:** Agent created with INTEGRATOR title, plugin installed, added to team
- **Creates:** Agent `scen-test-integrator-rex` in registry, plugin entry in settings.local.json
- **Modifies:** Agent registry (new entry), team agentIds (agent added)
- **Verify:** Wait 5s, wizard closes. Screenshot: SCEN-003/S019-wizard-complete.png

#### S020: Verify agent in sidebar
- **Action:** Look for `scen-test-integrator-rex` in the agent list under `scen-test-wizard-team`
- **Goal:** Agent card visible under team grouping
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows agent card under team header. Screenshot: SCEN-003/S020-agent-in-sidebar.png

#### S021: Verify agent profile -- title
- **Action:** Click on `scen-test-integrator-rex` in the agent list
- **Goal:** Profile panel opens, title is INTEGRATOR
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title badge shows "INTEGRATOR". Screenshot: SCEN-003/S021-integrator-title.png

#### S022: Verify agent profile -- role-plugin
- **Action:** Click "Config" tab in profile panel
- **Goal:** Role Plugin section shows `ai-maestro-integrator-agent` locked by INTEGRATOR
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin name displayed with lock indicator. Screenshot: SCEN-003/S022-integrator-plugin.png

---

## Phase 4: Create Agent via Wizard -- MEMBER with Role-Plugin

#### S023: Check for available custom role-plugins
- **Action:** Verify `~/agents/role-plugins/` for custom plugins compatible with MEMBER title (via API: `GET /api/agents/role-plugins?title=MEMBER&client=claude-code` or filesystem check)
- **Goal:** Determine if a custom plugin is available, or if the default `ai-maestro-programmer-agent` will be used
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Record the plugin name to use (custom if available, otherwise `ai-maestro-programmer-agent`). Screenshot: SCEN-003/S023-plugin-check.png

#### S024: Open agent creation wizard
- **Action:** Click the "+" button in sidebar header
- **Goal:** Wizard opens at Step 1
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Wizard dialog visible. Screenshot: SCEN-003/S024-wizard-reopen.png

#### S025: Select Claude Code as client
- **Action:** Click "Claude Code" option
- **Goal:** Client selected
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Claude Code highlighted. Screenshot: SCEN-003/S025-client-selected.png

#### S026: Enter avatar and name
- **Action:** Click Next, select any avatar, type `scen-test-member-zeta` in Name field
- **Goal:** Avatar and name set
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Avatar highlighted, name shows `scen-test-member-zeta`. Screenshot: SCEN-003/S026-member-name.png

#### S027: Select team
- **Action:** Click Next, select `scen-test-wizard-team` from team dropdown
- **Goal:** Team selected
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Team name shown. Screenshot: SCEN-003/S027-team-selected.png

#### S028: Select MEMBER title
- **Action:** Click Next, select MEMBER from title options
- **Goal:** MEMBER selected
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** MEMBER option highlighted. Screenshot: SCEN-003/S028-member-title.png

#### S029: Select role-plugin
- **Action:** Click Next to reach role-plugin step. If a custom plugin was found in S023, select it. Otherwise, verify `ai-maestro-programmer-agent` is available as default and select it.
- **Goal:** Role-plugin selected (custom or default programmer)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin shown as selected. Unlike INTEGRATOR, MEMBER title allows user choice (not locked). Screenshot: SCEN-003/S029-plugin-selected.png

#### S030: Complete wizard
- **Action:** Click Next to Summary, then Create/Finish
- **Goal:** Agent created with MEMBER title and selected role-plugin
- **Creates:** Agent `scen-test-member-zeta` in registry, plugin entry in settings.local.json
- **Modifies:** Agent registry (new entry), team agentIds (agent added)
- **Verify:** Wait 5s, wizard closes. Screenshot: SCEN-003/S030-wizard-complete.png

#### S031: Verify agent in sidebar
- **Action:** Look for `scen-test-member-zeta` in agent list under `scen-test-wizard-team`
- **Goal:** Agent card visible under team grouping
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Snapshot shows agent card under team header. Screenshot: SCEN-003/S031-member-in-sidebar.png

#### S032: Verify agent profile -- title
- **Action:** Click on `scen-test-member-zeta`
- **Goal:** Profile panel opens, title is MEMBER
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Title badge shows "MEMBER". Screenshot: SCEN-003/S032-member-title.png

#### S033: Verify agent profile -- role-plugin
- **Action:** Click "Config" tab
- **Goal:** Role Plugin section shows the selected plugin (custom or `ai-maestro-programmer-agent`)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Plugin name displayed. If MEMBER, plugin is NOT locked (user can change it later). Screenshot: SCEN-003/S033-member-plugin.png

---

## Phase 5: Verify Plugin Elements in Config Tab

#### S034: Inspect Config tab for scen-test-integrator-rex
- **Action:** Click on `scen-test-integrator-rex` in sidebar, click "Config" tab
- **Goal:** Config tab loads with all plugin element sections
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Role Plugin, Skills, Agents, Hooks, Rules, Commands, MCP Servers sections visible. Screenshot: SCEN-003/S034-config-sections.png

#### S035: Verify Skills section
- **Action:** Expand "Skills" section in Config tab
- **Goal:** Skills from the `ai-maestro-integrator-agent` plugin listed with counts
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Skills count matches what the plugin actually contains. Screenshot: SCEN-003/S035-skills-section.png

#### S036: Verify other element sections
- **Action:** Expand Agents, Hooks, Rules, Commands, MCP Servers sections
- **Goal:** Each section shows correct element count from the plugin (may be 0 for some)
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Element counts are accurate (cross-reference with plugin contents if needed). Screenshot: SCEN-003/S036-element-sections.png

---

## Phase 6: RBAC Probe -- No Self-Modification

#### S037: Attempt self-modification for scen-test-integrator-rex via API
- **Action:** Get scen-test-integrator-rex's agent ID. Attempt `PATCH /api/agents/<id>` with header `X-Agent-Id: <id>` and body `{"label": "self-hack-integrator"}`.
- **Goal:** API returns 403 -- no agent can modify itself
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Response status 403. Error mentions self-modification forbidden. Screenshot: SCEN-003/S037-no-self-mod.png

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

#### S038: Delete scen-test-integrator-rex
- **Action:** Click on `scen-test-integrator-rex` in sidebar, click delete button in profile panel -> Danger Zone -> Delete Agent -> confirm. When the sudo password modal appears (`DELETE /api/agents/[id]` is a strict route per Rule 12), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Agent fully removed from registry and team
- **Creates:** Cemetery archive entry
- **Modifies:** Agent registry (entry removed), team agentIds (agent removed)
- **Verify:** Agent no longer appears in sidebar. Screenshot: SCEN-003/S038-integrator-deleted.png

#### S039: Delete scen-test-member-zeta
- **Action:** Click on `scen-test-member-zeta` in sidebar, click delete button in profile panel, confirm deletion. When the sudo password modal appears (strict route `DELETE /api/agents/[id]` per Rule 12), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Agent fully removed from registry and team
- **Creates:** Cemetery archive entry
- **Modifies:** Agent registry (entry removed), team agentIds (agent removed)
- **Verify:** Agent no longer appears in sidebar. Screenshot: SCEN-003/S039-member-deleted.png

#### S040: Delete scen-test-wizard-team via DeleteTeam pipeline
- **Action:** Switch to "Teams" tab, find `scen-test-wizard-team` team card, click delete icon. First dialog: click Delete. Second dialog: enter governance password `mYkri1-xoxrap-gogtan`, click "Delete Agents Too".
- **Goal:** Test team fully removed via DeleteTeam 8-gate pipeline. Auto-COS agent deleted. Pending transfers cancelled. Team task files deleted.
- **Creates:** nothing
- **Modifies:** Teams registry (entry removed), auto-COS agent deleted
- **Verify:** Team card no longer appears in sidebar. Screenshot: SCEN-003/S040-team-deleted.png

#### S041: Verify cemetery entries and purge
- **Action:** Navigate to Settings -> Cemetery tab. Verify deleted test agents appear. Click "Purge" for each test entry. When the sudo password modal appears each time (`DELETE /api/agents/cemetery` is a strict route per Rule 12, and sudo tokens are one-shot), enter governance password `mYkri1-xoxrap-gogtan` and click Confirm.
- **Goal:** Cemetery entries verified then purged (no test artifacts remain)
- **Removes:** Cemetery archives for test agents
- **Verify:** No scen-test entries remain in cemetery. Screenshot: SCEN-003/S041-cemetery-purged.png

#### S042: STATE-WIPE -- Restore configuration files
- **Action:** Compare current config files with backups from S002. If any differ, restore from backup.
- **Goal:** All config files match pre-test state
- **Creates:** nothing
- **Modifies:** Config files (restored to backup state if changed)
- **Verify:** File hash comparison -- all match. Screenshot: SCEN-003/S042-state-restored.png

#### S043: Take post-test screenshot and compare with S006
- **Action:** `take_screenshot` of full page
- **Goal:** UI looks identical to pre-test baseline
- **Creates:** nothing
- **Modifies:** nothing
- **Verify:** Visual comparison with S006 screenshot -- sidebar, agent list, team list unchanged. Screenshot: SCEN-003/S043-post-cleanup.png
