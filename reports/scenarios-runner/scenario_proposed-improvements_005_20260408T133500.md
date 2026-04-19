# SCEN-005 11th-HOUR Analysis: Manager Gate Team Lifecycle

**Scenario:** SCEN-005 Manager Gate Team Lifecycle (Claude)
**Date:** 2026-04-08
**Result:** PASS (with 1 bug fixed during run)

---

## 1. Bugs Found During Run

### BUG-001: Create Team modal closes silently on API error
- **Step:** S011
- **Symptom:** Clicking "Create Team" when no MANAGER exists returns 400, but the modal closes without showing the error message
- **Root cause:** The backdrop `onClick={onClose}` fires during the async save operation. While `handleSave` correctly returns the error string, the modal unmounts before `setError(err)` can render
- **Fix applied:** `components/sidebar/TeamListView.tsx` — backdrop click disabled while `saving` is true. Committed `02b3873c`
- **Status:** FIXED and verified

### BUG-002: Delete Agent dialog "Delete Forever" button doesn't fire on first click via CDP
- **Step:** Cleanup phase (deleting scen-005-mgr)
- **Symptom:** The "Delete Forever" button appeared enabled in the DOM but clicking via CDP `click` tool had no effect. Required clicking twice or using DOM `button.click()`
- **Root cause:** Likely a timing issue — the button's `disabled` state toggles based on the text input matching, and CDP click may fire before React reconciliation completes
- **Suggested fix:** Add a 100ms debounce after filling the confirmation text before enabling the button, or use `requestAnimationFrame` to ensure the state update is committed before accepting clicks
- **Status:** NOT FIXED (low priority — works on second click)

### BUG-003: Cannot delete MANAGER agent without first removing title
- **Step:** Cleanup phase
- **Symptom:** "Delete Forever" returns 403 "Cannot delete the MANAGER. Reassign the MANAGER title to another agent first"
- **Analysis:** This is correct governance behavior (R9), NOT a bug. But the error is only visible in console — the Delete Agent dialog shows no error to the user
- **Suggested fix:** Surface the 403 error message in the DeleteAgentDialog UI (red error banner below the confirmation area)

---

## 2. Pre-existing Issues That Interfered

### ISSUE-001: Dead session "scen-mgr-jsonl" from previous test run
- **Impact:** Clutters the sidebar with a stale dead session entry
- **Suggested fix:** Scenario cleanup should include killing orphan tmux sessions created by previous failed runs. Add a pre-test cleanup step that kills any `scen-*` tmux sessions

### ISSUE-002: jack-bot was used as a pre-existing test subject
- **Impact:** Violated Rule 2 (0-IMPACT) — jack-bot was added to the test team, then deleted with "Delete Agents Too", requiring config backup restore
- **Suggested fix:** Future scenarios must create ALL test agents from scratch (never use pre-existing agents in team operations). The scenario file should be updated to create scen-005-member-1 instead of using jack-bot

---

## 3. Workflow Inefficiencies

### INEFFICIENCY-001: Title must be changed to AUTONOMOUS before deleting MANAGER agent
- **Impact:** Cleanup requires 2 extra steps (open title dialog, select AUTONOMOUS, enter password) before the agent can be deleted
- **Suggested fix:** The Delete Agent dialog should handle MANAGER demotion automatically — if the agent holds a singleton title, show a warning and auto-demote on confirmation (with governance password)

### INEFFICIENCY-002: Agent Creation Wizard skips Step 6 (Role Plugin) for locked titles
- **Impact:** When creating a MANAGER agent, Step 5 is "Working Directory" and Step 7 is "Summary" — Step 6 (Role Plugin selection) is skipped because MANAGER has a locked plugin. This is correct but the step numbering jumps from 5 to 7, which is confusing
- **Suggested fix:** Show Step 6 as "Role Plugin: ai-maestro-assistant-manager-agent (auto-assigned)" with a brief explanation, rather than skipping it entirely

---

## 4. Governance Rule Gaps

### GAP-001: Delete team "Delete Agents Too" deletes pre-existing agents
- **Rule affected:** No specific rule covers this
- **Issue:** When a team is deleted with "Delete Agents Too", ALL agents in the team are deleted — including agents that existed before the team was created. There's no distinction between "agents created for this team" and "agents that were added to an existing team"
- **Proposed governance rule:** R10.x: "When deleting a team with agents, the system should warn if any agents predate the team creation and offer to keep them as AUTONOMOUS instead of deleting them"

### GAP-002: No R9 rule for MANAGER deletion protection UX
- **Rule affected:** R9 (Manager Gate)
- **Issue:** R9 says MANAGER is required for teams to function, but doesn't specify what happens when a user tries to DELETE the MANAGER agent. The API blocks it (403), but the UI shows no feedback
- **Proposed governance rule:** R9.x: "The Delete Agent dialog must show a clear warning when attempting to delete the MANAGER, and must either auto-demote the MANAGER first or refuse with an actionable error message"

---

## 5. API Design Issues

### API-001: Delete Agent 403 error not surfaced in UI
- **Endpoint:** `DELETE /api/agents/{id}`
- **Issue:** Returns `{ error: "Cannot delete the MANAGER..." }` with 403, but the DeleteAgentDialog doesn't check `res.ok` or display errors — it shows the success animation regardless
- **Suggested fix:** Add error state handling to DeleteAgentDialog's `onConfirm` callback, display inline red error message

### API-002: Team creation error message could be more actionable
- **Endpoint:** `POST /api/teams`
- **Current:** "Teams require an existing MANAGER first. Assign the MANAGER title to an agent before creating teams."
- **Suggested improvement:** Include a link or button to the agent creation wizard with MANAGER pre-selected: "No MANAGER assigned. [Create MANAGER Agent] to enable team creation."

---

## Summary

| Category | Count |
|----------|-------|
| Bugs found | 3 (1 fixed, 2 UX improvements suggested) |
| Pre-existing issues | 2 |
| Workflow inefficiencies | 2 |
| Governance rule gaps | 2 |
| API design issues | 2 |
| **Total improvements proposed** | **11** |
