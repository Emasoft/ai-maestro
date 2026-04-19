# SCEN-002 Proposed Improvements — 2026-04-19T12:22:15Z run

**Based on:** `tests/scenarios/reports/SCEN-002_20260419T122215Z.report.md`
**Scenario:** Teams, Groups, and Agent Title Lifecycle
**Verdict:** PASS (with 3 in-run fixes applied)
**Branch:** feature/team-governance
**Commit at start/end:** c268b6a14d00641e528dccb562331be055dc84cc (fixes applied but NOT committed — per Rule 13 Phase 1 rules, proposals-only mode)

> **Note:** The 3 bugs listed in the scenario report (BUG-001, BUG-002, BUG-003) were **applied in-place** on the current branch during the scenario run (Rule 4 FIX-AS-YOU-GO). They are NOT in this proposals file because they are already fixed. This file lists proposals for the **issues and gaps that WEREN'T fixed** during the run — they need user approval before Phase 3 implementation.

---

## P0 Proposals (Must Fix Before Next Batch)

### P0-001: Commit the 3 Rule 4 in-run fixes for BUG-001, BUG-002, BUG-003

**Problem:** Three bug fixes were applied to source files during this scenario run (Rule 4 FIX-AS-YOU-GO) but have NOT yet been committed. The files currently have modifications that need to land on the feature branch:
- `hooks/useTeam.ts` — extracts server error + removes `lastActivityAt`
- `app/teams/page.tsx` — exchanges password for sudo token

**Root cause:** The scenario runner (per this current prompt) was told NOT to push/PR, but also to "edit source in place on the current branch". The edits exist on disk but await commit.

**Proposed fix:** The user should commit these changes with descriptive messages:
```bash
git add hooks/useTeam.ts app/teams/page.tsx
git commit -m "fix(scen-002): surface server errors, remove stale lastActivityAt, exchange sudo token in /teams delete"
```

**Verification:** `git log -1` shows the commit; re-run SCEN-002 should succeed with no re-introduction of these bugs.

**Priority rationale:** Without commit, the next session loses these fixes (they're uncommitted). These are P0/P1 bugs that break core functionality (team update + team deletion).

---

## P1 Proposals (Should Fix Soon)

### P1-001: Add actionable error message when kanban task creation fails due to missing GitHub Project

**Problem:** When a team has no GitHub project linked, clicking "Add task" on the kanban board and submitting returns the opaque error "Failed to create task". Users have no indication that they need to link a GitHub Project first.

**Root cause:** `components/team-meeting/TaskCreateForm.tsx` (or wherever the task create API call lives) likely shows the generic error from the response catch, but the server's error message is either missing or unhelpfully generic.

**Proposed fix:**
1. On the server side: the kanban task create endpoint should return a specific error code like `{ error: "Team has no GitHub Project linked. Link one in the Repos tab first.", code: "missing_github_project" }`.
2. On the client side: when the form submit returns this error code, show a prominent CTA "Link a GitHub Project" that navigates to `/teams/<id>?tab=repos`.
3. Alternatively: show the error state on the kanban tab itself (not in the task creation form) — something like "This team's kanban is disabled. [Link a GitHub Project]" banner at the top of the kanban board when `team.githubProject` is null.

**Files to change:**
- Server: `app/api/teams/[id]/tasks/route.ts` (or wherever task creation lives) — return specific error message
- Client: `components/team-meeting/TaskCreateForm.tsx` or `TaskKanbanBoard.tsx` — show specific error + CTA

**Verification:** Create a team without a GitHub project, try to create a task, verify error message clearly explains the cause and provides a CTA.

**Priority rationale:** High-impact UX issue — kanban is a first-class feature, and the current failure mode silently breaks it. P1 because it's a papercut, not a data-integrity issue.

---

### P1-002: Add "Delete Agents Too" option to Team Delete dialog

**Problem:** The scenario file S057 expected a "Delete Agents Too" button in the team delete flow. The current UI only has "Delete Team" (which reverts agents to AUTONOMOUS + hibernates) but no bulk-delete-agents option. Users wanting a clean slate must delete each agent individually via Advanced → Danger Zone → Delete Agent (with sudo modal each time).

**Root cause:** The `DeleteTeam` pipeline in `services/element-management-service.ts` supports the `deleteAgents` option, but the UI doesn't expose it.

**Proposed fix:**
1. In `app/teams/page.tsx` Delete Team dialog (phase='agents'), add a checkbox "Delete agents too (irreversible)".
2. When checked, the DELETE request body includes `deleteAgents: true`.
3. The server's DeleteTeam pipeline handles the cascade (delete agents, purge cemetery).
4. Add a strong warning like "This will permanently delete 3 agents including their working directories."

**Files to change:**
- `app/teams/page.tsx:212-246` — add checkbox, include flag in body
- `app/api/teams/[id]/route.ts` DELETE handler — accept and propagate `deleteAgents` flag
- `services/teams-service.ts` deleteTeamById — if flag is set, call DeleteAgent for each team member after stripping titles

**Verification:** Delete a team with agents, check the box, confirm agents are hard-deleted (registry status=deleted + folders removed).

**Priority rationale:** Addresses a valid workflow (full team teardown) that is currently tedious. Also aligns UI with scenario expectations.

---

### P1-003: Auto-delete `_aim-assistant` if it was re-instantiated during session and is hibernated

**Problem:** Clicking the + (Create new agent) button on the sidebar auto-spawns the `_aim-assistant` system help agent. This creates a registry entry that persists across test runs. Strict STATE-WIPE verification fails when comparing registry.json to backup because `_aim-assistant` was not in the pre-test backup.

**Root cause:** The + button's behavior triggers the Haephestos/Help agent launcher. The agent is a system helper that's always AUTONOMOUS/hibernated but is registered in the registry.

**Proposed fix (2 options):**

Option A (Fix the test flow): Pre-spawn `_aim-assistant` at master setup, so the backup includes it. Then STATE-WIPE will match.

Option B (Fix the UI): The + button should NOT auto-spawn `_aim-assistant`. The assistant should only spawn when the user explicitly opens the Help panel. The + button should ONLY open the agent creation wizard.

Option C (Make _aim-assistant truly ephemeral): Don't register `_aim-assistant` in the persistent registry at all. Keep it as an in-memory-only system session that disappears on server restart.

**Files to change (Option A):** `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh` — add `aim_ensure_assistant` that pre-launches the help agent before baseline screenshot.
**Files to change (Option B):** `components/AgentList.tsx` or wherever the + button handler lives — don't call `/api/help/agent` on + click.
**Files to change (Option C):** `services/help-service.ts` — use a temporary id and don't persist to registry.

**Verification:** After a SCEN-002 run, compare registry.json to backup — they should match byte-for-byte.

**Priority rationale:** Medium UX issue — causes state drift between runs. Option C is the cleanest but invasive. Option A is minimal but moves responsibility to scenario runner.

---

## P2 Proposals (Nice to Have)

### P2-001: Surface "Cannot remove Chief-of-Staff" client-side check in the team dashboard

**Problem:** In this scenario run, the client-side guard in `components/teams/TeamOverviewSection.tsx:76-79` fires AFTER the user clicks the remove button on Victoria. Ideally, the remove button should be DISABLED (grayed out) for the COS agent, with a tooltip explaining why. Currently, the button looks identical for COS and non-COS, so users don't see the R4.7 constraint until they click.

**Proposed fix:** In `TeamOverviewSection.tsx:291-297`, add a disabled state + tooltip when `agent.id === team.chiefOfStaffId`:
```tsx
<button
  onClick={() => handleRemoveAgent(agent.id)}
  disabled={agent.id === team.chiefOfStaffId}
  className={`p-1 rounded ${
    agent.id === team.chiefOfStaffId
      ? 'text-gray-800 cursor-not-allowed'
      : 'hover:bg-red-900/30 text-gray-600 hover:text-red-400 opacity-0 group-hover:opacity-100'
  } transition-all`}
  title={agent.id === team.chiefOfStaffId ? "Chief-of-Staff cannot be removed without unassigning COS first" : "Remove from team"}
>
  <Trash2 className="w-3.5 h-3.5" />
</button>
```

**Files to change:** `components/teams/TeamOverviewSection.tsx:291-297`

**Verification:** Open team dashboard, hover over COS agent — remove button appears greyed with informative tooltip.

**Priority rationale:** Polish. R4.7 is already enforced at all 3 layers (UI guard, server 400, file-level validation). This is just better UX.

---

### P2-002: Add an "Edit Team" button to team card with bulk agent edit modal

**Problem:** The only ways to modify team membership from the sidebar/teams page are per-agent (Add Agent dropdown + Remove from team button). Users may prefer a bulk-edit modal where they can toggle multiple agents in/out of a team in one operation.

**Proposed fix:** Add an "Edit Team" button (pencil icon) on each team card in `app/teams/page.tsx` and `components/sidebar/TeamListView.tsx`. Clicking it opens an Edit Team modal (mirror of Create Team modal) where users can update name, description, and toggle agent membership in bulk.

**Files to change:**
- `app/teams/page.tsx` — add edit button to team cards
- `components/sidebar/TeamListView.tsx` — add edit button, reuse existing TeamEditDialog component if one exists
- `components/teams/TeamEditModal.tsx` (new) — bulk-edit modal

**Verification:** Click edit on a team card, toggle multiple agents, save, verify team membership updated + auto-title transitions fire.

**Priority rationale:** UX improvement. Current flow is functional but tedious for large teams.

---

### P2-003: Add disabled-state explanation on CHIEF-OF-STAFF radio when team already has auto-COS

**Problem:** The Title Assignment Dialog correctly disables CHIEF-OF-STAFF when the team already has a COS and shows a message. But the message displays "'4285eb8c' already holds this title" — using the raw UUID prefix, not the agent name. Users will not know which agent that is without checking the team dashboard.

**Root cause:** The `Title Assignment Dialog` has access to agent names but falls back to UUID when formatting the message.

**Proposed fix:** In the dialog component (likely `components/TitleAssignmentDialog.tsx`), when building the "already holds" message, look up the agent name from the agents array:
```tsx
const cosAgent = agents.find(a => a.id === team.chiefOfStaffId)
const cosDisplay = cosAgent ? (cosAgent.label || cosAgent.name) : team.chiefOfStaffId.slice(0, 8)
const disabledMessage = `Only one Chief-of-Staff is allowed per team. "${cosDisplay}" already holds this title. Remove them first or select another title.`
```

**Files to change:** `components/TitleAssignmentDialog.tsx` (or equivalent) — replace UUID with display name in disabled-state messages.

**Verification:** Open title dialog for a team member when team has a COS — message shows "Victoria" (or whatever name) instead of "4285eb8c".

**Priority rationale:** Polish. Same improvement should be applied to ORCHESTRATOR singleton message, which currently does use agent name (per S051 snapshot: "'scen-test-agent-alpha' already holds this title"). COS one is inconsistent — user-facing UUID leak.

---

## P3 Proposals (Long-Term / Exploratory)

### P3-001: New scenario "SCEN-0XX_kanban-with-github-project"

**Problem:** Our scenario's Phase 8 (Kanban) was blocked because teams need a linked GitHub project for task creation. Post-2026-03-27 governance simplification, GitHub Projects is the authoritative task store.

**Proposed new scenario:** Create a scenario that:
1. Creates a team
2. Links a GitHub project to the team (via Repos tab)
3. Creates a kanban task
4. Drags it through columns (Backlog → In Progress → Review → Done)
5. Verifies status sync with the GitHub project
6. Tests dependency chains
7. Tests assignment

**Why:** Kanban is a first-class feature but is currently untested in the scenario suite because every new test team starts without a GitHub project. A dedicated kanban scenario with GitHub integration would cover the critical gap.

**Files to create:**
- `tests/scenarios/SCEN-0XX_kanban-with-github-project.scen.md`

**Priority rationale:** Exploratory — fills a test coverage gap.

---

### P3-002: Consolidate "Delete Agent" dialog state to avoid needing to hover+expand+type+confirm+sudo

**Problem:** Deleting an agent via UI is tedious: Click agent → View Profile → Advanced tab → Expand DANGER ZONE → Click Delete Agent → Check "Also delete folder" → Type agent name → Click Delete Forever → Enter governance password → Click Confirm. That's 9 interactions for each agent. In this scenario's cleanup phase, I deleted 3 agents (27 interactions + 3 sudo modals).

**Proposed improvement:** Move delete to a top-level "Agent Actions" menu accessible from the profile header. Minimize clicks. Keep the confirmation + sudo modal for safety.

**Files to change:** `components/AgentProfile.tsx` — add a dropdown or overflow menu with "Delete Agent" option at the top.

**Priority rationale:** UX improvement. Not urgent, but bulk agent cleanup is painful today.

---

### P3-003: Integration test for R4.7 COS-immutability (automated unit test)

**Problem:** R4.7 ("Cannot remove the Chief-of-Staff from team members while they are chiefOfStaffId") is enforced at 3 layers (client guard, server schema validation, registry-level validation in `lib/team-registry.ts:141-147`). Scenario tests verify the end-to-end UX but no unit test protects the registry-level enforcement from regressions.

**Proposed fix:** Add a unit test for `updateTeam` in `lib/team-registry.ts` that:
1. Creates a team with COS
2. Tries to update agentIds to exclude the COS
3. Asserts the return value is `{ valid: false, code: 400, error: /Chief-of-Staff/ }`

**Files to create:** `tests/unit/team-registry-r4.7.test.ts`

**Priority rationale:** Defense-in-depth testing. The 3-layer enforcement is good but brittle — a regression at the registry layer would only be caught by the scenario test (which is slow to run).

---

## Summary

- **P0:** 1 proposal (COMMIT the 3 in-run fixes — this is the #1 priority)
- **P1:** 3 proposals (kanban error UX, "Delete Agents Too" checkbox, _aim-assistant STATE-WIPE drift)
- **P2:** 3 proposals (disable remove for COS, Edit Team button, use names not UUIDs in singleton messages)
- **P3:** 3 proposals (kanban scenario, simpler delete flow, R4.7 unit test)

**Total:** 10 proposals

**Counts for state tracking:**
- P0: 1
- P1: 3
- P2: 3
- P3: 3
