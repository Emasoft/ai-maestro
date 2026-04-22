# 11th-HOUR Improvement Proposals for SCEN-002

**Based on report:** `reports/scenarios-runner/SCEN-002_20260420T230138Z.report.md`
**Run verdict:** PASS (52/62 as-written, 8 adapted, 2 skipped, 0 code fixes committed)
**Scenario:** SCEN-002 Teams, Groups, and Agent Title Lifecycle v2.0
**Branch:** feature/team-governance @ 73e03732

This 11th-HOUR analysis produces a prioritized list of concrete improvements. Each proposal has:
- Problem description
- Root cause analysis
- Concrete fix (files, lines, proposed code)
- Verification command
- Priority rationale

---

## P0 — Critical (must fix before next batch run)

### PROP-P0-001: "Also delete agent folder" leaves residual `.claude/` after hard-delete

**Problem:** After a hard-delete with "Also delete agent folder" checkbox CHECKED, the agent's working directory is mostly removed, but a `.claude/` subdirectory (containing `settings.local.json`, and sometimes `amama/` memory dir, `.DS_Store`, etc.) persists. This has been documented in 6+ prior runs across multiple scenarios (SCEN-020 MEMORY: "Recurring bug — 6th consecutive run").

**Evidence from this run:**
```
~/agents/scen-test-agent-alpha/.claude/settings.local.json   (remained after delete)
~/agents/scen-test-agent-beta/.claude/settings.local.json    (remained)
~/agents/scen-test-agent-beta/.DS_Store                       (remained)
~/agents/cos-scen-test-team-alpha/.claude/settings.local.json (remained)
~/agents/scen002-manager/.claude/amama/{patterns,progress,activeContext}.md (remained)
```

**Root cause (hypothesis):** Race between `DeleteAgent` pipeline's G09 folder-rm and the plugin install/uninstall subsystem writing to `settings.local.json`:

1. `ChangeTitle` / `ChangePlugin` / `DeleteAgent` runs.
2. G-gates process: `DestroyAgent → uninstall plugins → rm -rf ~/agents/<name>`
3. BUT: plugin uninstall triggers a Claude CLI `claude plugin uninstall <plugin> <marketplace> --scope local` command in the agent workdir.
4. Claude CLI writes back to `~/agents/<name>/.claude/settings.local.json` (removing the plugin line), which **recreates the .claude folder** if rm already ran.

**Proposed fix:**
```
services/element-management-service.ts lines 5077-5096 (G09 folder deletion)
```

Two-step atomic cleanup:
```typescript
// Step 1: stop all tmux sessions FIRST
if (hard && options?.deleteFolder) {
  await killTmuxSessionsForAgent(agent)  // SIGTERM + wait
}

// Step 2: wait for any pending plugin-install/uninstall claude-cli calls to settle
await new Promise(r => setTimeout(r, 500))

// Step 3: delete folder with retry loop (if .claude is recreated, re-rm)
for (let i = 0; i < 3; i++) {
  await rm(resolvedDir, { recursive: true, force: true })
  await new Promise(r => setTimeout(r, 200))
  if (!(await stat(resolvedDir).catch(() => null))) break
}
```

Better: add a `finalCleanupLock` in the DeleteAgent gate chain that prevents ChangePlugin from writing to `settings.local.json` for this agent during its destruction, and verifies folder is gone after all sub-pipelines complete.

**Verification:**
```bash
# After scenario run + cleanup:
for d in scen-test-agent-alpha scen-test-agent-beta cos-scen-test-team-alpha; do
  if [ -e ~/agents/$d ]; then echo "FAIL: $d still exists"; else echo "PASS: $d gone"; fi
done
```

**Priority rationale:** Recurring bug documented across 6+ runs. Pollutes `~/agents/` with leftover folders on every test run. Confuses future users. MUST be fixed.

---

### PROP-P0-002: R9.8 "No MANAGER" block is not surfaced before agent wizard

**Problem:** When I started SCEN-002, the scenario's Phase 3 (team creation) immediately failed because R9.8 blocks team creation without a MANAGER on the host. But the scenario's Phase 2 (agent creation) succeeded without any warning. It was only when I clicked Teams tab and saw the red "No MANAGER on this host" banner that I learned about the requirement. This contradicts user expectations and scenario workflows.

**Root cause:** R9.8 enforcement is only at `/teams` page (sidebar + /teams route). The Agents tab and the wizard know nothing about it.

**Proposed fix:** Add a global banner at the top of the dashboard when R9.8 is violated:

```
components/LayoutHeader.tsx (or wherever the app shell renders)
```

```typescript
const { hasManager } = useGovernance()
{!hasManager && (
  <div className="bg-amber-900/30 border-b border-amber-700 px-4 py-2 text-sm">
    ⚠️ No MANAGER assigned on this host. Teams are currently BLOCKED (R9.8).
    <a href="/settings?tab=security#manager">Assign a MANAGER →</a>
  </div>
)}
```

Alternatively, in the Agent Creation Wizard's title step, if user selects MEMBER/ORCHESTRATOR/ARCHITECT/INTEGRATOR without a MANAGER on host, show inline: "Note: this title requires a team. No MANAGER on this host means no teams can be created yet. You may still create this agent but it will remain AUTONOMOUS until both a MANAGER is assigned and a team is created."

**Verification:**
```bash
# Delete any MANAGER, reload dashboard, confirm banner appears.
# Reload Teams page, confirm red banner still there (existing behavior preserved).
```

**Priority rationale:** Users waste time trying to create teams and hitting the block. New scenarios will keep making the same mistake. P0 because it blocks every multi-agent workflow.

---

## P1 — High (fix before SCEN-002 rerun)

### PROP-P1-001: Double-password modal UX in ChangeTitle (governance + sudo)

**Problem:** Changing an agent's title triggers TWO consecutive password modals for the SAME governance password:
1. Title Assignment Dialog's "Enter Governance Password" (inline)
2. Sudo-mode "Confirm with password" (PATCH /api/agents/[id]/title is strict)

The user types the password twice. This is annoying AND confusing: "why am I entering the same password twice?"

**Root cause:** Title Assignment Dialog has its own password confirm (pre-sudo-mode design), and after submit it calls `sudoFetch` which ALSO prompts for sudo password via `SudoContext`.

**Proposed fix:** In `components/governance/TitleAssignmentDialog.impl.tsx`, remove the inline password input and let `sudoFetch` handle the password prompt entirely. Alternatively, exchange the inline password for a sudo-token via `POST /api/auth/sudo-password` BEFORE calling the PATCH endpoint — mirroring the pattern in `components/sidebar/TeamListView.tsx:78-99` (team delete inline password → sudo token).

```typescript
// Before calling PATCH /api/agents/[id]/title:
const tokenRes = await fetch('/api/auth/sudo-password', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ password })
})
const { token } = await tokenRes.json()

// Then:
await fetch(`/api/agents/${agentId}`, {
  method: 'PATCH',
  headers: { 'Content-Type': 'application/json', 'X-Sudo-Token': token },
  body: JSON.stringify({ governanceTitle: newTitle })
})
```

**Verification:**
```
Change title for a team agent → only ONE password prompt, not two.
```

**Priority rationale:** UX friction affects every title change. Also confuses tests (two nested modals to fill is brittle).

---

### PROP-P1-002: CHIEF-OF-STAFF singleton prevents normal title demotions in scenarios

**Problem:** Team creation auto-creates a COS. If a scenario later wants to promote a different agent to COS (the common teaching pattern for "how to reassign COS"), the singleton blocks it.

**Evidence (scenario S028-S030 had to be adapted):** The scenario expected to promote `scen-test-agent-beta` to COS but the button was disabled because Zaire (auto-COS) held the title.

**Proposed fix:** Document the two supported workflows clearly:
1. **Auto-COS preservation** (default, most scenarios): the team's auto-created COS is kept. Other agents can only be MEMBER/ARCHITECT/INTEGRATOR/ORCHESTRATOR.
2. **COS reassignment** (special workflow): First remove Zaire's CHIEF-OF-STAFF title (which is ALSO blocked per R4.7 — Zaire is team.chiefOfStaffId), then promote alpha. But this is a multi-step flow requiring:
   - Delete Zaire (team.chiefOfStaffId becomes null → team gets "no COS" warning)
   - Promote beta to CHIEF-OF-STAFF (team.chiefOfStaffId = beta)
   - Optionally delete the orphan team-staff-role agents

**Suggested addition to UI:** When clicking COS option for a non-COS agent, show a "Reassign COS" wizard that guides the user:
- "To make this agent CHIEF-OF-STAFF of `<team>`, the current COS `<Zaire>` must first be demoted. Do you want to do that now? [Yes, start wizard] [Cancel]"

**Verification:**
Run SCEN-002 after this change. S028 now clicks COS → reassign wizard opens → user confirms demote of Zaire → promote beta → team.chiefOfStaffId = beta ID. No singleton violation.

**Priority rationale:** Multiple scenarios hit this pattern. Better UX + makes scenarios runnable as written.

---

### PROP-P1-003: Team-dashboard's "Remove from team" needs confirmation dialog

**Problem:** At S042 (remove alpha from team), clicking the red "Remove from team" button on the team dashboard IMMEDIATELY removed alpha without a confirmation. This was the correct behavior for a non-destructive op (agent is NOT deleted, just reverted to AUTONOMOUS + hibernated), but it conflicts with the destructive-op pattern used elsewhere.

**Root cause:** `components/team/TeamDashboard.tsx` (or wherever the Remove button lives) calls the remove API directly without a confirmation modal.

**Proposed fix:** Add a lightweight confirmation:
```
Remove `<agent>` from team `<team>`?

The agent will:
- Revert to AUTONOMOUS title
- Lose its role-plugin (install autonomous-agent)
- Stay hibernated until re-assigned

[Cancel]  [Remove from team]
```

**Verification:** Hover alpha row → click red Remove → confirmation dialog appears → click Cancel → alpha still in team. Click Remove again → confirm → alpha removed.

**Priority rationale:** Risk of accidental removal. Low-cost fix.

---

## P2 — Medium (fix before next scenario authoring)

### PROP-P2-001: SCEN-002 v3.0 — update step definitions to match v0.27.3 app behavior

**Problem:** 8 steps were adapted in this run because SCEN-002 v2.0 doesn't match current app behavior.

**Proposed fix:** Update `tests/scenarios/SCEN-002_teams-groups-agents.scen.md` to v3.0 with the following corrections:

1. **Prerequisites frontmatter:** Add `- MANAGER exists on host (scenario creates scen002-manager in Phase 2.5)` to prerequisites. OR: add a Phase 2.5 step "S012a: Create scen002-manager via wizard" before Phase 3.

2. **S028 rewrite:** Change from "Select CHIEF-OF-STAFF" to "Verify CHIEF-OF-STAFF is DISABLED (auto-COS holds it)". Update Goal to "Singleton constraint enforced at client side".

3. **S029 rewrite:** Since CHIEF-OF-STAFF can't be freely promoted, rewrite as "Navigate to auto-COS agent (Zaire) and verify COS plugin is installed".

4. **S030 rewrite:** "Verify ai-maestro-chief-of-staff plugin on auto-COS, locked" (not on beta).

5. **S031 rewrite:** Replace "API PUT" with "UI probe: try to hover Remove button on COS row, verify it's disabled with R4.7 tooltip".

6. **S038-S039 rewrite:** Either add "Link GitHub project to team" step FIRST (via Repos tab), OR mark these steps as "SKIPPED if team has no GitHub project" with a follow-up scenario SCEN-002b for GitHub-connected teams.

7. **S041 rewrite:** Change "hover team card → edit pencil" to "navigate to team dashboard (/teams/<id>)".

8. **S045 rewrite:** Change expected "Role Plugin: None or empty" to "Role Plugin: ai-maestro-autonomous-agent (per R9.13 mandate)".

9. **S054 rewrite:** RBAC probe cannot be tested via UI. Either:
   - Remove this step entirely and rely on unit tests for `lib/authorization.ts` self-mod enforcement.
   - Rewrite as a read-only verification: "grep `lib/authorization.ts` for `X-Agent-Id` self-mod check presence and assert source code has the check". (Still Rule 6 compliant — read-only.)

**Verification:**
```bash
# Re-run SCEN-002 v3.0: expect 0 adapted steps, PASS verdict.
```

**Priority rationale:** 8 scenario adaptations per run is unsustainable. Fix the scenario file.

---

### PROP-P2-002: Sidebar + button should directly open wizard (no dropdown if one item)

**Problem:** Clicking the sidebar "+" (aria-label: "Create new agent") opens a dropdown with one option: "Create Agent". Second click closes the dropdown. Two clicks for a single user intent.

**Proposed fix:** In `components/sidebar/AgentListHeader.tsx` (or wherever the + lives): if there's only one menu item, skip the dropdown and open the wizard directly.

```typescript
// BEFORE:
<button onClick={toggleDropdown}>+</button>
{dropdownOpen && (<div>
  <button onClick={openWizard}>Create Agent</button>
</div>)}

// AFTER:
<button onClick={openWizard} aria-label="Create new agent" title="Create new agent">+</button>
```

If you want to preserve space for future items (Import agent, Create from template), consider a hover-slot pattern: main click opens wizard, ⌄ chevron click opens dropdown.

**Verification:** Single click on + opens wizard immediately.

**Priority rationale:** Minor UX. But cumulative (every scenario run starts with this friction).

---

### PROP-P2-003: `scenarios-runner/MEMORY.md` is 71KB / 1122 lines — compact or split

**Problem:** Per the system-reminder seen at session start: "MEMORY.md is 1122 lines and 71KB. Only part of it was loaded. Keep index entries to one line under ~200 chars; move detail into topic files."

This means the scenario-runner agent's MEMORY.md is TOO LARGE for reliable context loading. The runner may miss critical information (e.g., "Create MANAGER first for SCEN-002" is in MEMORY but might not load).

**Proposed fix:** Restructure `.claude/agent-memory/scenario-runner/MEMORY.md`:
- Keep ONLY index entries (one line each, <200 chars) pointing to topic files
- Move detailed run memory into per-scenario files: `runs/SCEN-001_<ts>.md`, `runs/SCEN-002_<ts>.md`, etc.
- Keep a compact `active/` dir for "currently applicable patterns" (e.g., `active/prerequisites.md`, `active/known-bugs.md`).

**Verification:**
```bash
wc -l .claude/agent-memory/scenario-runner/MEMORY.md
# Expected: < 200 lines

ls .claude/agent-memory/scenario-runner/runs/ | wc -l
# Per-run files extracted
```

**Priority rationale:** Information loss in future runs. Each run will waste time rediscovering known patterns.

---

## P3 — Low (nice-to-have)

### PROP-P3-001: Help panel should unmount when collapsed (accessibility)

**Problem:** Help panel uses `translate-x-full pointer-events-none` to hide. DOM heading "AI Maestro Help" stays in DOM, confusing automation + screen readers.

**Fix:** Add `aria-hidden="true"` when collapsed OR conditionally render (mount/unmount).

**Priority:** Cosmetic + accessibility. Non-blocking.

### PROP-P3-002: Shared setup script — auto-detect wizard-created MANAGER presence

**Problem:** Several scenarios need a MANAGER. If MANAGER already exists (from a prior scenario run that failed to cleanup), the scenario creates a duplicate.

**Fix:** Shared `scenario-setup.sh` can read registry.json to check for MANAGER; if missing, note in output so scenarios can conditionally skip creation. Better: move the scen-specific MANAGER creation into a shared `scenario-prereqs.sh scen002` helper.

**Priority:** Quality-of-life for scenario authors.

### PROP-P3-003: Kanban empty-state message should explain GitHub project requirement upfront

**Problem:** The Kanban board opens with 5 columns showing "0 tasks" and "Add task" buttons. Clicking "Add task" opens the form, but submitting shows "Cannot create task: team has no GitHub Project linked". This is late feedback.

**Fix:** If team has no GitHub project, show on all 5 "Add task" buttons a disabled state with tooltip "Link a GitHub Project first (Repos tab)". Hide the "Add task" button entirely OR show inline banner above columns.

**Priority:** UX nit. Documented for future work.

---

## Summary

| Priority | Count | Description |
|---------:|------:|-------------|
| P0       | 2     | Recurring .claude/ residual bug; R9.8 block not surfaced globally |
| P1       | 3     | Double-password modal; COS singleton workflow; Remove-from-team confirmation |
| P2       | 3     | SCEN-002 v3.0 rewrite; + button direct-open; MEMORY.md split |
| P3       | 3     | Help panel aria; setup MANAGER auto-detect; Kanban empty-state |
| **Total** | **11** | |

**Recommended order:** P0-001 (folder cleanup race) → P0-002 (R9.8 banner) → P1-001 (double password) → P2-001 (SCEN-002 v3.0). Then re-run SCEN-002 expecting 0 adaptations.

## Changelog for SCEN-002 MEMORY.md

After this run, scenario-runner MEMORY should have these new/updated entries:
- ISSUE-001 / BUG-001: Residual .claude/ after hard-delete (6+ consecutive runs now; documented here with proposed race-condition root cause).
- Create scen002-manager FIRST before team creation (R9.8).
- S028-S030 adaptation: COS already held by Zaire, verify disabled state + navigate to auto-COS for plugin check.
- S031 adaptation: Probe via UI disabled button tooltip, not API.
- S038-S039 skip: Kanban requires GitHub project.
- S041 adaptation: Team dashboard (no Edit Team modal).
- S045 adaptation: AUTONOMOUS agents have autonomous-agent plugin (R9.13).
- S054 deferred: Self-mod RBAC probe requires Bearer token — cannot test via UI; Rule 6 blocks curl PATCH.
- Double-password modal for title changes (governance + sudo): 2 fills required.
