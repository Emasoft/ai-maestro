# SCEN-006 Improvement Proposals

Based on: `tests/scenarios/reports/SCEN-006_20260408T183000.report.md`

---

## P0 (Critical)

### PROPOSAL-001: Sidebar Delete button must open DeleteAgentDialog for all agents
- **Problem:** The sidebar "Delete agent" context button does nothing for offline/hibernated agents. Only online agents with a loaded profile panel can be deleted via the Danger Zone path. This makes offline agent cleanup impossible via UI.
- **Root cause:** The sidebar delete button likely calls a function that depends on the currently loaded profile panel state, which is null for offline agents.
- **Solution:** Make `DeleteAgentDialog` a standalone modal that can be opened from the sidebar regardless of agent session state. Pass the agent ID and name directly from the sidebar context menu, not from the profile panel.
- **Files:** `components/sidebar/AgentListItem.tsx` (or wherever the context menu is), `components/DeleteAgentDialog.tsx`
- **Priority:** P0 — blocks scenario cleanup

### PROPOSAL-002: Agent folder deletion fails silently
- **Problem:** Checking "Also delete agent folder" in the DeleteAgentDialog doesn't reliably delete the folder. The folder `~/agents/scen006-codex-member/` persisted after deletion with the checkbox checked.
- **Root cause:** The DELETE API handler may fail to remove the folder due to permissions, async timing, or the folder being in use by a subconscious process.
- **Solution:** (1) Verify folder deletion in the API response. (2) Return an error if deletion fails. (3) Show a warning toast in the UI if the folder couldn't be removed. (4) Kill subconscious processes for the agent before attempting folder deletion.
- **Files:** `app/api/agents/[id]/route.ts` (DELETE handler), `lib/agent-registry.ts`
- **Priority:** P0 — leaves orphan folders on disk

---

## P1 (High)

### PROPOSAL-003: Add `--password` flag to `aimaestro-agent.sh wake`
- **Problem:** The MANAGER agent couldn't authenticate to the wake API because `aimaestro-agent.sh wake` doesn't accept a password parameter. The agent had to manually curl the login endpoint and use session cookies.
- **Root cause:** The wake command in `aimaestro-agent.sh` doesn't handle LoginGate authentication.
- **Solution:** Add `--password <pwd>` flag to `aimaestro-agent.sh wake/hibernate/restart` commands. When provided, auto-authenticate via `/api/auth/login` and use the session cookie for the subsequent API call.
- **Files:** `scripts/agent-wake.sh`, `scripts/agent-hibernate.sh`
- **Priority:** P1 — MANAGER agent should be able to wake team members without manual curl hacking

### PROPOSAL-004: Auto-wake COS on team creation
- **Problem:** When a team is created, the auto-COS agent is created but left hibernated. The user must manually tell the MANAGER to wake it, which is a multi-step process involving auth negotiation.
- **Root cause:** Team creation only registers the COS in the registry and creates its folder — no tmux session is started.
- **Solution:** After auto-COS creation, automatically call the wake API to start the COS session. The team creation endpoint already has auth context (the user is authenticated via LoginGate).
- **Files:** `app/api/teams/route.ts` (POST handler), `services/governance-service.ts`
- **Priority:** P1 — reduces friction in team setup workflow

### PROPOSAL-005: Zoom view should include offline agents
- **Problem:** The Zoom grid only shows agents with "Hibernating" or "Online" status. Agents in "Offline" state (exited tmux but still in registry) are invisible. This makes it impossible to manage them from the Zoom view.
- **Root cause:** The Zoom view likely filters agents by session presence. "Offline" agents have no tmux session and no subconscious status.
- **Solution:** Add a filter toggle in the Zoom view: "Show all" (includes offline) vs "Show active" (current behavior). Show offline agents with a distinct card style (grayed out, "Offline" badge).
- **Files:** `app/zoom/page.tsx`, `hooks/useSessions.ts`
- **Priority:** P1 — usability gap for agent management

---

## P2 (Medium)

### PROPOSAL-006: Profile panel should load for offline agents from dashboard
- **Problem:** Clicking an offline agent in the sidebar shows "This agent is offline" with "Start Session" and "View Profile" buttons, but "View Profile" doesn't open the profile panel in the main area.
- **Root cause:** The profile panel component likely depends on the terminal/WebSocket connection being active.
- **Solution:** Decouple the profile panel from the terminal view. When an agent is offline, show the profile panel without the terminal — the agent metadata is in the registry and doesn't need a session.
- **Files:** `app/page.tsx`, `components/AgentProfilePanel.tsx`
- **Priority:** P2 — workaround exists (use Zoom view for hibernated agents)

### PROPOSAL-007: Wizard should show Codex agent "Next Steps" with wake instructions
- **Problem:** After creating a Codex agent, the wizard shows generic "Next Steps" (folder created, launch manually). It doesn't mention that the agent is already registered and can be woken from the dashboard.
- **Root cause:** The wizard completion page is designed for all client types but doesn't differentiate between Claude (auto-starts tmux) and Codex (needs manual launch or dashboard wake).
- **Solution:** For Codex agents created in a team, show: "Your agent has been registered. The MANAGER or you can wake it from the sidebar."
- **Files:** `components/AgentCreationWizard.tsx` (completion step)
- **Priority:** P2 — user guidance improvement

### PROPOSAL-008: Team deletion should offer "Delete Agents + Folders" option
- **Problem:** The "Also delete all agents in this team" checkbox in the Delete Team dialog deletes agents from the registry but the scenario showed agent folders may persist. There's no separate "Also delete agent folders" checkbox.
- **Root cause:** Team deletion with agents uses a different code path than individual agent deletion. The individual path has the "Also delete agent folder" checkbox but the team path may not clean up folders.
- **Solution:** Add "Also delete agent folders" checkbox to the Delete Team dialog when "Delete Agents" is checked. Ensure the team delete pipeline calls the same folder cleanup as individual agent delete.
- **Files:** `components/sidebar/TeamListView.tsx` (Delete Team dialog), `services/governance-service.ts`
- **Priority:** P2

---

## P3 (Low)

### PROPOSAL-009: Scenario SCEN-006 naming convention adopted
- **Problem:** The original SCEN-006 used `scen-codex-*` names which confused the MANAGER (Claude) with the Codex client. Fixed mid-test.
- **Root cause:** Scenario naming convention didn't separate "scenario number" from "client type".
- **Solution:** Already fixed: `scen006-manager` (Claude), `scen006-codex-member` (Codex). Adopt `scen<NNN>-<role>` as standard for all future scenarios.
- **Status:** DONE (committed as dfcf7b9b)

### PROPOSAL-010: New scenario — SCEN-012: Offline agent lifecycle
- **Problem:** Multiple issues discovered around offline agent management (delete, profile view, zoom visibility).
- **Solution:** Create a dedicated scenario that tests: creating an agent, letting it go offline (exit Claude), then attempting all management operations (view profile, change title, delete, purge) while offline. This would catch ISSUE-002 and ISSUE-003 systematically.
- **Priority:** P3 — test infrastructure improvement

### PROPOSAL-011: MANAGER auth token injection
- **Problem:** The MANAGER agent spent significant time (2+ minutes) figuring out how to authenticate to the AI Maestro API. It tried multiple approaches before succeeding.
- **Root cause:** No pre-injected auth token in the MANAGER's environment. The agent has to discover and negotiate auth on its own.
- **Solution:** When the MANAGER agent is created, inject an `AIMAESTRO_AUTH_TOKEN` environment variable into its tmux session. The token would be a long-lived JWT or session token that the MANAGER can use for API calls without manual login.
- **Files:** `services/element-management-service.ts` (CreateAgent pipeline), `server.mjs` (session launch)
- **Priority:** P3 — quality of life for MANAGER operations
