# SCEN-009 Post-Run Analysis — Proposed Improvements

**Based on:** `tests/scenarios/reports/SCEN-009_20260406T030830.report.md` (Run 1) and Run 2 (2026-04-06 13:10-14:00)
**Scenario:** Manager-Driven Team Creation (JSONL Viewer)
**Overall result:** PASS (both runs), but with significant friction

---

## 1. Bugs Found During Run

### BUG-021: Prompt Builder ignores CDP `fill` (FIXED in Run 1)

- **Status:** Fixed
- **Root cause:** React controlled component's `onChange` doesn't fire on programmatic value changes via native setter + `dispatchEvent`
- **Fix applied:** Native `input` event listener in `useEffect` on `promptTextareaRef` (`components/TerminalView.tsx:115-121`)
- **Priority:** P1 (blocks all scenario testing via CDP)

### BUG-022: `POST /api/agents` ignores `governanceTitle` in request body (NEW — UNFIXED)

- **Status:** UNFIXED
- **Root cause:** The CreateAgent pipeline in `services/agents-core-service.ts` does not read `governanceTitle` from the request body. When the MANAGER creates agents with `POST /api/agents` and includes `"governanceTitle": "architect"`, the API silently ignores it and defaults to `"member"` (because agents join a team via `teamId`, and `ChangeTeam` auto-calls `ChangeTitle('member')`).
- **Impact:** The MANAGER had to make 3 extra `PATCH` requests to correct titles (ARCHITECT, ORCHESTRATOR, INTEGRATOR). This wastes tokens (~2k per PATCH call), increases API calls, and creates a race window where agents briefly have wrong titles.
- **Proposed fix:**
  - **File:** `services/agents-core-service.ts` — `createAgent()` function
  - **Change:** After the agent is created and added to the team (which auto-assigns MEMBER), check if `body.governanceTitle` was provided and differs from "member". If so, call `ChangeTitle(agentId, body.governanceTitle)` as a final step in the creation pipeline.
  - **Alternative:** Accept `governanceTitle` in `POST /api/agents` and pass it through to `ChangeTeam`, which would call `ChangeTitle` with the specified title instead of always defaulting to "member".
  - **Priority:** P1 (forces MANAGER into multi-step workaround on every team creation)

### BUG-023: Auth bypass in Phase 1 (SF-058) — KNOWN, DOCUMENTED

- **Status:** Known, deferred to Phase 2
- **Root cause:** `lib/agent-auth.ts:35-41` — requests without auth headers get full system-owner access
- **Impact:** The MANAGER discovered it could bypass auth by omitting `X-Agent-Id` and `Authorization` headers. While this "worked", it means any process on localhost can create teams/agents without governance checks.
- **Proposed fix:** Phase 2 will add mandatory auth. For now, document this as a known limitation in the MANAGER persona so it doesn't waste tokens investigating auth.
- **Priority:** P2 (Phase 2 milestone)

---

## 2. Pre-Existing Issues That Interfered

### ISSUE-005: Subconscious count shows "49 Agents" / "56 Agents" on fresh start

- **Observed:** On server restart, the Subconscious status shows inflated counts (49, 56) before settling to 1 Active after the first agent poll
- **Root cause:** Legacy subconscious processes from old orphan auto-registration (killed in this session's orphan removal) may still have stale state files. The count is read from `~/.aimaestro/agents/` subconscious configs before they're cleaned up.
- **Impact:** Confusing UI display during scenario setup screenshots. Does not affect functionality.
- **Proposed fix:**
  - **File:** `services/subconscious-service.ts` or wherever the count is computed
  - **Change:** Only count subconscious processes for agents that currently exist in the registry (cross-reference `registry.json`). Orphan subconscious configs should be pruned at startup.
  - **Priority:** P3 (cosmetic, no functional impact)

### ISSUE-006: Multiple jq parsing errors due to API response wrappers

- **Observed:** The MANAGER's bash commands failed 4 times because API responses wrap data in `.team` or `.agents` objects, not flat arrays
- **Root cause:** API response structure inconsistency — some endpoints return `{ teams: [...] }`, others return `{ team: {...} }`. The MANAGER had to discover this through trial and error.
- **Impact:** Wasted ~5k tokens on jq debugging. Every MANAGER session will rediscover this.
- **Proposed fix (multiple):**
  1. **Role-plugin improvement:** Add a **cheat sheet** to the MANAGER persona (`ai-maestro-assistant-manager-agent-main-agent.md`) documenting the exact API response structure for all governance endpoints. E.g.:
     ```
     GET /api/teams → { teams: [...] }
     GET /api/teams/{id} → { team: {...} }
     GET /api/agents → { agents: [...] }
     GET /api/agents/{id} → { agent: {...} }
     POST /api/teams → { team: {...} }
     POST /api/agents → { id, name, ... } (flat)
     PATCH /api/agents/{id} → { agent: {...} }
     ```
  2. **Skill improvement:** The `team-governance` skill in `ai-maestro-plugin` should include curl examples with correct jq paths.
  3. **API improvement:** Consider adding a `?flat=true` query parameter that returns unwrapped responses for CLI/agent consumption.
  - **Priority:** P1 (affects every MANAGER session)

---

## 3. Workflow Inefficiencies

### WF-001: MANAGER creates agents one-by-one instead of batch

- **Observed:** The MANAGER made 5 separate `POST /api/agents` calls + 3 `PATCH` calls = 8 API calls to create the team
- **Root cause:** No batch agent creation API exists. The MANAGER must create each agent individually.
- **Proposed fix:**
  - **API addition:** `POST /api/teams/{id}/batch-create-agents` — accepts an array of `{ name, governanceTitle, program }` objects, creates all agents in one call with correct titles. Returns the full team roster.
  - **Governance skill update:** Document the batch endpoint in `team-governance` skill
  - **MANAGER persona update:** Instruct to prefer batch creation over individual calls
  - **Priority:** P2 (significant token savings, but individual creation works)

### WF-002: MANAGER had to investigate auth mechanism (~12 tool calls)

- **Observed:** After the initial auth error, the MANAGER spent 12 bash/read calls investigating `agent-auth.ts`, `amp-send.sh`, `amp-helper.sh`, etc. before discovering the Phase 1 bypass
- **Root cause:** The MANAGER persona doesn't document the auth mechanism or the Phase 1 bypass
- **Proposed fix:**
  - **Role-plugin improvement:** Add to MANAGER persona: "Phase 1 note: API calls without auth headers are treated as system-owner requests. You do not need X-Agent-Id or Authorization headers for localhost API calls."
  - **Skill improvement:** Add to `team-governance` skill: "Authentication: In Phase 1 (localhost only), omit auth headers for system-owner access."
  - **Priority:** P1 (saves 12+ tool calls per MANAGER session)

### WF-003: Governance password not used during team creation

- **Observed:** The governance password `mYkri1-xoxrap-gogtan` was provided in the task but never used. Auto-COS creation didn't require it. Team creation didn't require it (Phase 1 bypass).
- **Root cause:** The password is only required for title changes via the UI (ChangeTitle pipeline) and GovernanceRequests. The API-level team creation doesn't require it in Phase 1.
- **Impact:** The MANAGER persona says "use password when prompted" but the API never prompts for it during team creation. This creates confusion.
- **Proposed fix:**
  - **API improvement:** Consider requiring governance password for `POST /api/teams` and `PATCH /api/agents/{id}` (governanceTitle changes) even in Phase 1. This would enforce governance discipline from the start.
  - **Governance rule update:** R9.1 should specify that team creation requires governance password
  - **Priority:** P2 (governance hardening)

---

## 4. Governance Rule Gaps

### GAP-001: R12 not enforced by the server

- **Observed:** The MANAGER correctly created 6 agents with all 5 titles, but nothing in the server prevents a partial team from being created
- **Root cause:** R12 (Minimum Team Composition) is only documented in governance rules and role-plugin personas. The server doesn't validate team composition.
- **Proposed fix:**
  - **API improvement:** Add a `GET /api/teams/{id}/composition-check` endpoint that returns which required titles are missing
  - **Startup task:** At server startup, check all teams for R12 compliance and log warnings
  - **UI improvement:** Show a warning badge on teams missing required titles (like the "blocked" badge)
  - **Priority:** P2 (enforces R12 at the system level, not just persona level)

### GAP-002: No validation that governanceTitle matches role-plugin

- **Observed:** When agents were PATCH'd from "member" to "architect", the system auto-installed the correct role-plugin. But the MANAGER could theoretically set any title without a matching plugin.
- **Root cause:** The ChangeTitle pipeline handles plugin installation, but if plugin installation fails silently, the agent would have a title with no role-plugin.
- **Proposed fix:** ChangeTitle Gate should verify plugin was actually installed after the title change. If installation fails, revert the title.
- **Priority:** P3 (edge case, ChangeTitle pipeline already handles this)

---

## 5. Test Infrastructure Improvements

### TEST-001: tmux alternate screen buffer prevents scrollback capture

- **Observed:** `tmux capture-pane -p -S -5000` only returned 23 lines (the visible pane). Claude Code's alternate screen buffer hides the full conversation history.
- **Root cause:** Claude Code uses xterm alternate screen buffer. tmux's `capture-pane` can only capture the current buffer, not historical content from the alternate buffer.
- **Impact:** Could not read the MANAGER's terminal output directly. Had to resort to analyzing the JSONL conversation log via LLM Externalizer.
- **Proposed fix:**
  1. **Scenario rule addition:** When terminal history is needed, always analyze the JSONL conversation log at `~/.claude/projects/-Users-<user>-agents-<name>/*.jsonl` (most recent by mtime)
  2. **AI Maestro feature:** Add a `GET /api/agents/{id}/conversation-log` endpoint that returns the latest conversation log path
  3. **Session logging:** Enable `ENABLE_LOGGING=true` in `.env.local` for scenario testing sessions to get a separate log file
  - **Priority:** P2 (important for scenario debugging)

### TEST-002: CDP tool state loss between Chrome DevTools and Claude-in-Chrome

- **Observed:** Mid-scenario, `mcp__chrome-devtools__take_screenshot` stopped working and tools had to be re-loaded via ToolSearch. The tool namespace changed from `mcp__chrome-devtools__*` to `mcp__plugin_chromedev-tools_cdt__*`.
- **Root cause:** Claude Code's deferred tool loading may expire or the MCP connection may reset during long scenario runs
- **Impact:** Interrupted scenario flow, required re-navigation
- **Proposed fix:** Add to scenario rules: "At the start of each phase, verify CDP tools are loaded by taking a snapshot. If tools fail, reload via ToolSearch."
- **Priority:** P2 (affects all long scenarios)

### TEST-003: Need a scenario specifically for R12 enforcement

- **Proposed scenario:** SCEN-010 — "Partial Team Detection"
  - Create a team with only 3 agents (missing ORCHESTRATOR and INTEGRATOR)
  - Verify the COS detects the non-functional team and creates the missing agents
  - Tests R12.2 + R14.1 (team resilience)
  - **Priority:** P1 (validates the new R12 rule end-to-end)

### TEST-004: Need a scenario for R15 (Written Orders & GitHub Trail)

- **Proposed scenario:** SCEN-011 — "Written Orders Workflow"
  - MANAGER sends a task to the team
  - Verify each agent creates .md files from templates
  - Verify attachments are published as GitHub issues, not sent via AMP
  - Tests R15.1-R15.7
  - **Priority:** P2 (validates the new R15 rule)

---

## 6. Priority Summary

| ID | Description | Priority | Category |
|----|-------------|----------|----------|
| BUG-022 | CreateAgent ignores governanceTitle in body | P1 | Bug fix |
| ISSUE-006 / WF-002 | MANAGER wastes tokens on API structure + auth discovery | P1 | Role-plugin + Skill improvement |
| TEST-003 | SCEN-010 for R12 enforcement | P1 | New scenario |
| WF-001 | Batch agent creation API | P2 | API improvement |
| WF-003 | Governance password not required for API team creation | P2 | API + Governance |
| GAP-001 | R12 not enforced by server | P2 | API + UI improvement |
| TEST-001 | Terminal history capture method | P2 | Test infrastructure |
| TEST-002 | CDP tool state loss | P2 | Test infrastructure |
| TEST-004 | SCEN-011 for R15 written orders | P2 | New scenario |
| BUG-023 | Auth bypass (SF-058) | P2 | Phase 2 milestone |
| ISSUE-005 | Subconscious inflated count | P3 | Cosmetic fix |
| GAP-002 | Title-plugin mismatch validation | P3 | Edge case |
