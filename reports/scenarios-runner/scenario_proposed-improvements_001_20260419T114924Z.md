# SCEN-001 — Proposed Improvements (Rule 11 / 11th-HOUR)

**Scenario:** SCEN-001 Title Change Lifecycle
**Run id:** 20260419T114924Z
**Verdict:** PASS (1 bug fixed in-run, 5 issues filed)
**Scenario report:** `tests/scenarios/reports/SCEN-001_20260419T114924Z.report.md`
**Bug-fix commit (already landed on `feature/team-governance`):** `c268b6a14d00641e528dccb562331be055dc84cc`

This file is Phase 2 output (per Rule 13) — **nothing below is implemented**. The fixer in Phase 3 should consult each proposal, land P0/P1 items first, and leave P2/P3 for later batches.

---

## Summary

- **1 × P0** already landed in-run (ORCHESTRATOR/COS singleton enforcement in ChangeTitle)
- **2 × P1** (cosmetic label + sudo_required leak; both have been documented for 5+ runs, still unfixed)
- **2 × P2** (scenario authoring cleanup + HelpPanel viewport positioning)
- **1 × P3** (RBAC probe expectation: 401 vs 403)

---

## P0 — Already fixed in this run (listed for traceability)

### P0-1 FIXED: Per-team ORCHESTRATOR/COS singleton not enforced

- **Where:** `services/element-management-service.ts`
  - Gate 8 (new pre-write check against `team.orchestratorId` / `team.chiefOfStaffId`)
  - Gate 13b (new post-write to SET these fields)
- **Impact:** Without the fix, two orchestrators could coexist in the same team. The TitleAssignmentDialog already tried to guard this (`components/governance/TitleAssignmentDialog.impl.tsx:291-294`) but was reading an always-null field.
- **Verification in this run:** S027-retest populated `team.orchestratorId = 8438b3d1-…`, and S030 on a second team member then correctly showed "Only one Orchestrator is allowed per team. \"scen-test-title-agent\" already holds this title."
- **Commit:** `c268b6a14d00641e528dccb562331be055dc84cc`
- **Status:** LANDED, nothing further required.

---

## P1 — High priority (long-standing, many scenarios)

### P1-1: "ASSIGN TITLE" button label instead of MEMBER (5th scenario)

- [ ] **Approve**
- **Problem:** Profile panel's title button reads "ASSIGN TITLE" after auto-title transitions (team-join, post-sudo title update) even though a nearby static badge reads "MEMBER". Same class of bug documented in SCEN-005, SCEN-006, SCEN-007, SCEN-008 memory.
- **Root cause:** The button text comes from a resolver that checks `agent.governanceTitle` only. The static badge uses the richer fallback `governanceTitle ?? (teamId ? 'member' : 'autonomous')`.
- **Proposed fix:** In `components/agent-profile/OverviewTab.tsx`, replace the button's text expression with:
  ```typescript
  (agent.governanceTitle ?? (agent.teamId ? 'member' : 'autonomous')).toUpperCase()
  ```
  Fallback identical to `TitleBadge`. One-line change. Risk: LOW.
- **Verification:** Manually open the profile for a MEMBER agent after team-join; the button must read "MEMBER" not "ASSIGN TITLE".
- **Estimated risk:** LOW
- **Dependencies:** none

### P1-2: `sudo_required` raw text leaks into profile panel after Leave team

- [ ] **Approve**
- **Problem:** Clicking the Leave team "X" briefly displays "sudo_required" as a raw string in the profile before the sudo modal appears. Documented in SCEN-006 P1-UI-2, reproduced here at S034.
- **Root cause:** The Leave team handler does not go through `sudoFetch`, so the 401 response body's `error: 'sudo_required'` ends up rendered as plain error text.
- **Proposed fix:** In the handler that invokes leave team (likely `components/governance/TeamMembershipSection.tsx`), wrap the fetch with `sudoFetch` so the retry loop runs silently and no inline error surface is needed.
- **Verification:** Trigger Leave team, confirm no "sudo_required" text appears at any point; only the sudo modal shows.
- **Estimated risk:** LOW
- **Dependencies:** none

---

## P2 — Medium priority

### P2-1: Scenario S036/S037 assume soft-delete + cemetery; current "Also delete folder" triggers hard-delete

- [ ] **Approve**
- **Problem:** `tests/scenarios/SCEN-001_title-change-lifecycle.scen.md` S035 says "check 'Also delete agent folder'" AND S036 says the agent must appear in the Cemetery. But in `services/element-management-service.ts` G03, `hard=true` explicitly skips cemetery archive. These expectations are mutually exclusive.
- **Root cause:** Scenario was written before the hard-delete/cemetery distinction was clarified. The scenario step is internally inconsistent.
- **Proposed fix:** Two options, pick one:
  1. Split cleanup into two agents: one deleted with folder-kept (soft-delete → cemetery → purge), one deleted with folder-checkbox (hard-delete → no cemetery).
  2. Change S035 to NOT check "Also delete agent folder" (so soft-delete runs), then S036/S037 work as written. Add a separate S035b for the folder-delete behaviour.
- **Verification:** Re-run SCEN-001; S036 now finds the agent in cemetery.
- **Estimated risk:** LOW (scenario authoring only, no code change)
- **Dependencies:** none

### P2-2: HelpPanel positions outside viewport at 1280×800

- [ ] **Approve**
- **Problem:** `components/HelpPanel.tsx` closed-state positions the panel at `x=1280…1700` on a 1280-wide viewport (bounding rect is outside visible area). Real users probably never see this because they use wider screens, but the scenario's "desktop" viewport (1280×800 per `device: desktop` in frontmatter) exposes the CSS glitch. Playwright `page.click` refuses: "element is outside of the viewport".
- **Root cause:** The fixed+`right-0` element should anchor to the viewport right edge. Something is computing the left offset against a larger containing block.
- **Proposed fix:** Audit `components/HelpPanel.tsx` and any parent layout wrapping it. Candidate: `PromptBuilder` or `DashboardLayout` may use `w-screen` or an off-canvas pattern that breaks the right-anchor. Likely a single `left-auto` on the outer container fixes it.
- **Verification:** At viewport 1280×800, `document.querySelector('button[aria-label="Close help panel"]').getBoundingClientRect().x` should be < 1280.
- **Estimated risk:** MED (CSS layout, may have secondary effects on smaller mobile viewports — test all three `device:` variants)
- **Dependencies:** none

---

## P3 — Low priority

### P3-1: Scenario expects 403 on RBAC probes; reality is 401

- [ ] **Approve**
- **Problem:** Scenarios 001, 005, 006, 007, 008 all expect 403 for agent-auth probes; reality is 401 because the auth layer rejects un-Bearered requests before the RBAC layer runs.
- **Root cause:** Agent identity is authenticated via Bearer token (AID). A request with only `X-Agent-Id` but no Bearer is not "an authenticated agent trying to violate RBAC" — it's "no identity presented at all".
- **Proposed fix:** Two options:
  1. Update scenario expected code to "4xx denied" or "401 OR 403".
  2. Have the API route distinguish the two cases with a secondary check: if `X-Agent-Id` is present but no Bearer, return 401; if Bearer is valid but for a different agent, return 403. This would require plumbing the agent-id claim through.
- **Verification:** After a scenario update or API refinement, S014/S032 expectations match.
- **Estimated risk:** LOW (scenario doc update) or MED (API refinement)
- **Dependencies:** none
