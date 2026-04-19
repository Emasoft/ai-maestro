# SCEN-005 Proposed Improvements — 11th-HOUR Analysis

**Based on:** `reports/scenarios-runner/SCEN-005_20260419T182505Z.report.md`
**Run ID:** 20260419T182505Z
**Branch:** feature/team-governance
**Verdict:** PARTIAL (62/78 steps, 4 bugs found, 4 issues noticed, 0 fixes committed)

## Summary of proposals

| Priority | Count | Focus |
|----------|-------|-------|
| P0 | 0 | (no outright blockers) |
| P1 | 4 | Profile stale selection, task error-message swallowing, team delete options, sudo-modal linger |
| P2 | 4 | Scenario authoring clarifications, UI labeling, Advanced-tab DANGER ZONE UX, wizard retry |
| P3 | 3 | Tooltip + test-environment helpers + task-create-button disabling |

---

## P1 Proposals

### P1-001: BUG-001 — Profile panel stale-selection trap after wizard completion

**Problem description**

After completing the `CreateAgent` wizard (7-step for Claude) and seeing the "Your Agent Is Ready!" success dialog, clicking a different agent in the sidebar does NOT re-select the profile panel. The panel retains whatever agent was selected before the wizard opened. This causes destructive actions (title changes, sudo modal submissions) to target the WRONG agent silently. In this run, the `scen-test-manager` creation was followed by a title change that accidentally hit the pre-existing `scen018-mgr-v2` agent, re-assigning it MANAGER (an existing user artifact — this is a Rule 2 0-IMPACT near-miss).

**Root cause analysis**

The wizard's "Let's Go!" success dialog is a modal overlay. Sidebar clicks propagate through the overlay in some browsers but the underlying main-area terminal view (which drives profile-panel selection via React state) does NOT update until the wizard success dialog is explicitly dismissed. The profile panel is tied to the main-area terminal agent, not to sidebar click events.

**Proposed fix**

Change sidebar click to fire profile-panel selection directly, not via main-area binding. Alternative: block sidebar clicks until wizard overlay is dismissed.

```tsx
// components/SessionList.tsx (conceptual)
const handleAgentClick = (agent) => {
  dismissAnyOpenWizardOverlay()  // new helper
  setActiveSessionId(agent.id)
  setProfilePanelAgentId(agent.id)  // decouple from main-area
}
```

**Files:** `components/SessionList.tsx`, `components/AgentProfilePanel.tsx`, `app/page.tsx`
**Verification:** Run scenario, after wizard completion click any OTHER agent — profile panel title should update immediately (within 500ms) to show the clicked agent.
**Risk:** MED (touches profile panel selection flow; risk of breaking activity tracking)
**Priority rationale:** Active data-loss hazard. My run nearly corrupted a user's existing MANAGER. P1 because scenario succeeded after workaround.

---

### P1-002: BUG-002 — Task creation error swallows informative server message

**Problem description**

`hooks/useTasks.ts:76` wraps non-2xx responses with `throw new Error('Failed to create task')`, discarding the JSON body which contains actionable info like `"Cannot create task: team has no GitHub Project linked"`. Kanban UI users see only a generic red `Failed to create task` toast. Users cannot self-serve — they must consult logs or DevTools Network panel.

**Root cause**

```ts
// hooks/useTasks.ts:68-82 (current)
const createTask = useCallback(async (data) => {
  if (!teamId) return
  try {
    const res = await fetch(`/api/teams/${teamId}/tasks`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    if (!res.ok) throw new Error('Failed to create task')
    await fetchTasks()
  } catch (err) {
    await fetchTasks()
    throw err
  }
}, [teamId, fetchTasks])
```

**Proposed fix**

```ts
// hooks/useTasks.ts:71-76 (proposed)
const res = await fetch(`/api/teams/${teamId}/tasks`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(data),
})
if (!res.ok) {
  let msg = 'Failed to create task'
  try {
    const json = await res.json()
    if (typeof json?.error === 'string') msg = json.error
  } catch { /* body not JSON */ }
  throw new Error(msg)
}
```

No changes needed in `TaskCreateForm.tsx:48-51` — it already surfaces `err.message`.

**Verification**

1. On team without GitHub Project, click quick-add in Backlog → type "Test" → Add Task
2. Red error text in dialog should now read "Cannot create task: team has no GitHub Project linked"
3. No impact on successful creation path.

**Risk:** LOW (additive; preserves existing failure behavior)
**Priority rationale:** Direct user-facing friction; fix is ~8 lines; unlocks self-diagnosis for S041-class scenarios.

---

### P1-003: BUG-003 — Team delete dialog lacks "Delete Agents Too" option

**Problem description**

The scenario (and likely the original design intent) expected two options when deleting a team: **Keep Agents** (revert titles to AUTONOMOUS, keep agent records) vs **Delete Agents Too** (remove titles AND hard-delete the agents including folders). The actual sidebar and `/teams` page Delete Team dialogs offer only a single Delete Team button matching the "Keep Agents" semantics. The Delete Agents Too path requires N separate Danger Zone deletes afterward, which are slow, sudo-gated, and error-prone.

**Root cause analysis**

Likely UX simplification post-2026-03-27 governance work. Scenario authoring in SCEN-001..005 still references the two-option flow.

**Proposed fix — option A (UI):**

Add a secondary button in the Delete Team dialog: "Delete Team + Agents" (red, explicit warning). On click, emit a `{ deleteAgentsToo: true }` payload to the delete API, which cascades `DeleteAgent(id, deleteFolder=true)` for each non-COS agent, then deletes the COS last, then the team.

**Proposed fix — option B (Scenario authoring):**

Update SCEN-001, SCEN-002, SCEN-003, SCEN-005 to use "Keep Agents" as the default cleanup, then explicitly delete each test agent via Profile → Advanced → DANGER ZONE → Delete Agent. Acknowledge the current UI shape.

**Recommendation:** Combine both — implement option A to match scenario expectations, update scenarios to use the new option.

**Files:** `components/sidebar/TeamListView.tsx`, `app/teams/page.tsx` delete flow, `app/api/teams/[id]/route.ts` DELETE handler (add optional `deleteAgentsToo` query flag), `services/teams-service.ts` `deleteTeam()` to cascade.
**Verification:** Run SCEN-005 cleanup — should now cleanly delete 2 teams and 2 auto-COS agents in ~2 operations, no orphans.
**Risk:** MED (destructive cascade; needs thorough tests for dependency handling)
**Priority rationale:** Currently forces 6-step cleanup per team. A scenario cleanup of 2 teams requires ~12 UI interactions. Automation-heavy and error-prone.

---

### P1-004: ISSUE-003 — Sudo modal lingers across navigation

**Problem description**

When a destructive-op chain (title change, team delete, agent delete) is canceled mid-sudo or times out, the sudo modal remains visible and intercepts all input. Subsequent UI actions (e.g., clicking + to create an agent) may appear to succeed but actually hit the sudo modal first. Recovery requires Cancel or Escape or Escape until clear.

**Root cause (inferred)**

Sudo-mode state (`contexts/SudoContext.tsx`) is rendered as a React portal near the app root and not dismissed on `route change` / `pathname change`. 

**Proposed fix**

In `contexts/SudoContext.tsx`, subscribe to Next.js router events and dismiss on navigation. Additionally, add a 120-second auto-timeout (UI-side) that matches the server's 60-second token TTL plus a grace period.

```tsx
// contexts/SudoContext.tsx (conceptual addition)
const router = useRouter()
useEffect(() => {
  const handle = () => setOpen(false)
  router.events?.on('routeChangeStart', handle)
  return () => router.events?.off('routeChangeStart', handle)
}, [router])
```

**Files:** `contexts/SudoContext.tsx`, `components/SudoModal.tsx`
**Verification:** Open sudo modal, navigate to /teams → modal should auto-dismiss. Click + button → new-agent menu should appear, no intercept.
**Risk:** LOW
**Priority rationale:** Bookkeeping bug; not data-unsafe but drops productivity in scenario runs.

---

## P2 Proposals

### P2-001: ISSUE-001 — Add "MANAGER required" preflight in Create Team dialog

**Problem**: S011 expected an error on Create Team click when no MANAGER exists. The UI silently opens the full dialog; submission fails only when agent selection is missing (unrelated reason).

**Fix**: In `components/sidebar/TeamListView.tsx` + `app/teams/page.tsx`, when `governance.hasManager === false`, render the dialog with a top banner:

```tsx
{!hasManager && (
  <div className="border-amber-500 bg-amber-500/10 text-amber-300 p-3 rounded">
    <strong>No MANAGER on this host.</strong> Teams cannot be created until a MANAGER is assigned. 
    <button onClick={...}>Assign MANAGER</button>
  </div>
)}
```

Also disable the submit button with tooltip "No MANAGER — cannot create team".

**Files:** `components/sidebar/TeamListView.tsx`, `app/teams/page.tsx` team-wizard step 1
**Risk:** LOW
**Rationale:** Aligns UX with scenario expectations and R12 governance rule.

### P2-002: Scenario wording mismatch in S051 (title dialog enabled options)

**Problem**: S051 says "Exactly 3 options (AUTONOMOUS, MANAGER, MAINTAINER)" for an AUTONOMOUS no-team agent. In reality, MANAGER is enabled only if no MANAGER singleton exists. When another MANAGER is active (as in this scenario after S021), MANAGER is correctly disabled → only AUTONOMOUS + MAINTAINER are enabled.

**Fix**: Update SCEN-005 S051 Goal text to:
> Goal: Only standalone titles visible. Enabled set depends on singleton state: AUTONOMOUS (always), MAINTAINER (always enabled, independent), MANAGER (enabled only if no other MANAGER on host). Team titles (MEMBER/COS/ORCHESTRATOR/ARCHITECT/INTEGRATOR) are always disabled for a no-team agent.

**Files:** `tests/scenarios/SCEN-005_manager-gate-team-lifecycle.scen.md`
**Risk:** NONE (doc change)

### P2-003: Improve Advanced tab DANGER ZONE discoverability + scroll

**Problem**: S073 cleanup stuck because the DANGER ZONE accordion is below a large Long-Term Memory Options section. Automation (and users) must scroll ~600px to reach it.

**Fix**: Move DANGER ZONE to the TOP of Advanced tab (it's the most destructive — users should see it without scrolling). Or introduce a dedicated "Delete Agent" tab.

**Files:** `components/AgentProfilePanel.tsx` Advanced section
**Risk:** LOW
**Rationale:** Reduces accidental-discovery risk; helps cleanup scripts.

### P2-004: Scenario wording mismatch in S057 (Keep Agents button)

**Problem**: S057 instructs "Enter governance password and choose 'Keep Agents'" — no such button in the current UI. Single Delete Team button handles this path.

**Fix**: Rewrite S057 Action to:
> Action: Enter governance password `mYkri1-xoxrap-gogtan`, click Delete Team. Team is deleted via DeleteTeam 8-gate pipeline; all agents revert to AUTONOMOUS (Keep Agents semantics).

**Files:** `tests/scenarios/SCEN-005_manager-gate-team-lifecycle.scen.md`
**Risk:** NONE (doc)

---

## P3 Proposals

### P3-001: Add tooltip "Requires GitHub Project" to disabled quick-add task buttons

**Fix**: Per ISSUE-002, when `team.githubProject` is null, either disable the + quick-add column button or render tooltip:
> "Link a GitHub Project to this team in order to create tasks. Tasks are backed by GitHub Issues in the current architecture."

**Files:** `components/team-meeting/TaskKanbanBoard.tsx` EnhancedColumn render
**Risk:** NONE
**Rationale:** Reduces user-frustration; ties into P1-002 fix.

### P3-002: Tooltip on R12 badge

**Fix**: Per ISSUE-004, change the badge component to include a tooltip "Blocked — no MANAGER on host". Or change text from "R12" to "BLOCKED (R12)".

**Files:** `components/teams/TeamCard.tsx` or sidebar team item
**Risk:** NONE

### P3-003: Scenario runner helper for Delete-Agent UI sequence

**Problem**: The scenario runner (dev-browser automation) struggled with DANGER ZONE accordion + type-to-confirm + sudo modal. This pattern recurs in SCEN-001, SCEN-002, SCEN-003, SCEN-005.

**Fix**: Add `aim_delete_agent` to `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh`:
- Input: `agent_name` + `agent_id` + `governance_password`
- Steps encapsulated: click agent → Advanced tab → scroll DANGER ZONE → click Delete Agent → check folder-delete checkbox → fill name → click Delete Forever → fill sudo password → amber Confirm
- Return: API fetch result of `/api/agents/<id>` status (404 = success)

**Files:** `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh`
**Risk:** LOW
**Rationale:** Unblocks future scenario runs. Would have saved this run's cleanup failure.

---

## Proposed new/updated scenarios

### SCEN-NEW: "MANAGER re-assignment during cascade" 
Extension of SCEN-005: During blocking cascade (hasManager=false), verify that attempting `POST /api/governance/manager` to re-assign via a different agent succeeds iff password is present; verify cascade unblocks correctly; verify agents are NOT auto-woken (must be manual).

### SCEN-005 v2.1 (this scenario, updated)
- Update S011 to accept "preflight banner" pattern (after P2-001 implemented)
- Update S051 to match reality of MANAGER singleton (P2-002)
- Update S057 to match single Delete Team flow (P2-004)
- Add explicit "delete orphan COS" steps after S057 and S071 (current scenario assumes Delete Agents Too option)
- Bump version to "2.1"

## Priority summary

| ID | Title | P | Effort | Impact |
|----|-------|---|--------|--------|
| P1-001 | Profile stale selection | P1 | M | HIGH (0-IMPACT near-miss) |
| P1-002 | Task error message swallowing | P1 | S | MED (UX + debuggability) |
| P1-003 | Delete Agents Too option | P1 | L | HIGH (scenario cleanup) |
| P1-004 | Sudo modal linger | P1 | S | MED |
| P2-001 | MANAGER required banner | P2 | S | MED |
| P2-002 | SCEN-005 S051 wording | P2 | XS | LOW |
| P2-003 | DANGER ZONE placement | P2 | S | MED |
| P2-004 | SCEN-005 S057 wording | P2 | XS | LOW |
| P3-001 | GitHub Project tooltip | P3 | XS | LOW |
| P3-002 | R12 badge tooltip | P3 | XS | LOW |
| P3-003 | aim_delete_agent helper | P3 | S | MED (scenario infra) |

Total: 0 P0, 4 P1, 4 P2, 3 P3 = 11 proposals

## Recommended implementation order

1. **P1-002** (fast, low-risk, immediate user value) — 1 file edit, 8 lines
2. **P1-004** (fast, low-risk) — 1 file edit, ~15 lines
3. **P2-002 + P2-004** (scenario doc edits, no code risk)
4. **P3-003** (scenario infra — unblocks future runs)
5. **P1-001** (medium risk, high value) — requires QA
6. **P1-003** (largest; should plan alongside scenario rewrites)
7. Remaining P2/P3 (nice-to-have polish)
