---
scenario: SCEN-003_agent-creation-wizard
run_id: 20260419T131651Z
base_report: SCEN-003_20260419T131651Z.report.md
base_commit: c268b6a14d00641e528dccb562331be055dc84cc
base_branch: feature/team-governance
generated_at: 2026-04-19T13:46:30Z
p0_count: 2
p1_count: 4
p2_count: 2
p3_count: 1
total_proposals: 9
---

# Proposed Improvements — SCEN-003 Run 2026-04-19T13:16:51Z

This file consolidates every proposal derived from SCEN-003 run 20260419T131651Z.
All proposals are categorized P0..P3 per urgency. User approves individual
proposals before they go into a Phase-3 implementation run.

Reference report: `tests/scenarios/reports/SCEN-003_20260419T131651Z.report.md`

---

## P0 — Critical bugs that block core workflows

### PROP-P0-001 — `TeamCreationWizard.handleCreate()` sends invalid payload fields → ALL `/teams` page team creations fail

**Source:** BUG-001 in SCEN-003 report. Fix already APPLIED in-place; this proposal is for USER APPROVAL to commit.

**Problem:**
Every attempt to create a team via the full wizard on `/teams` fails with
HTTP 400 `{ error: "Validation failed" }`. The wizard sends 5+ fields that
the server's `.strict()` Zod schema does not accept (`agentIds`,
`autoCreateCos`, `autoCreateOrchestrator`, `githubRepos`, `newRepo`,
`createGithubProject`, `githubProjectUrl`). The first extra field
triggers rejection of the whole payload.

**Root cause:**
The wizard was written against an earlier server contract that accepted
those fields. When the route was consolidated into
`app/api/teams/create-with-project/route.ts` with a strict schema, the
wizard was never updated. Auto-COS is handled server-side when
`chiefOfStaffId` is absent, making the wizard's `autoCreateCos` flag
redundant.

**Proposed fix (ALREADY APPLIED in this run):**
`components/teams/TeamCreationWizard.tsx` lines 278-340:
- Rewrite `handleCreate()` to send only schema-accepted fields:
  `{name, description, password, chiefOfStaffId?, orchestratorId?, githubProject?}`
- Parse `owner/repo/number` from `linkedProjectInfo.url` (the actual
  shape of `GitHubProjectInfo` which lacks owner/repo pre-parsed)
- Improve error display to include Zod `issues[]` array so future
  drift is surfaced immediately
- Add TODO comment pointing at GitHub-repo creation + orchestrator
  auto-creation as not-yet-plumbed-through functionality

**Verification:**
```bash
# Dev-browser automation can reproduce:
dev-browser --browser ai-maestro-scenarios --headless << 'EOF'
const page = await browser.getPage("dashboard");
await page.goto('http://localhost:23000/teams');
// ... fill wizard fields, click Create Team
// Without fix: "Validation failed" error visible
// With fix: team created in ~15s
EOF
```

**Priority rationale:**
Blocks the primary onboarding path for any user creating a team from
the dedicated `/teams` page. Has shipped in production v0.27.3. Any
clean install + "create team via /teams" would hit this.

---

### PROP-P0-002 — `/teams` page delete dialog missing sudo-token exchange → every team delete returns 403 "sudo_required"

**Source:** BUG-003 in SCEN-003 report (also BUG-003 in SCEN-002 from 2026-04-19). Fix already APPLIED in-place.

**Problem:**
Clicking "Delete Team" on the /teams page after entering governance
password returns HTTP 403 `{ error: "sudo_required" }` from the server.
The delete cannot proceed via the `/teams` page UI.

**Root cause:**
`DELETE /api/teams/[id]` is a strict route classified in
`security-registry.json`; strict routes require an `X-Sudo-Token`
header obtained by exchanging the governance password via
`POST /api/auth/sudo-password`. The `/teams` page `handleDelete()` at
`app/teams/page.tsx:88-125` sends password in body only — no token
exchange. The `components/sidebar/TeamListView.tsx::handleDelete()`
has the correct pattern (lines 78-99).

**Proposed fix (ALREADY APPLIED):**
`app/teams/page.tsx` — add the sudo-token exchange step before the
DELETE request. Pattern mirrors `TeamListView.tsx:78-99`. 25 new
lines, zero behavior change to the happy path, returns a user-visible
"Password does not match" on 403 instead of silently failing.

**Verification:**
Navigate to `/teams`, hover a team card, click trash icon, click
Delete (first phase), enter `mYkri1-xoxrap-gogtan`, click Delete Team.
Team should be removed in ~10s.

**Priority rationale:**
P0 — blocks the primary team-lifecycle workflow. Same severity as
PROP-P0-001, same remediation urgency.

---

## P1 — Regressions, UX dealbreakers, significant governance gaps

### PROP-P1-001 — `/teams` page delete dialog lacks "Also delete agents" checkbox → orphan COS after every delete

**Source:** ISSUE-001 in SCEN-003 report.

**Problem:**
When a team is deleted via the `/teams` page card trash button, the
auto-created COS (and any other team agents) are reverted to
AUTONOMOUS and hibernated — not deleted. The dialog copy says
"Agents will be reverted to AUTONOMOUS and hibernated", but there's
no user-selectable option to also delete those agents.

Scenario SCEN-003 S040 expects a "Delete Agents Too" button, but
that UI only exists in `TeamListView.tsx` (sidebar accordion). The
`/teams` page dialog does not have that option.

**Impact:**
- Every test or user who deletes a team via /teams leaves an orphan
  `cos-<team-slug>` AUTONOMOUS agent + its folder on disk
- Over time this pollutes the agent registry and the ~/agents/
  directory
- Cleanup scripts cannot safely bulk-rm because agents may be
  genuine user resources

**Proposed fix:**
`app/teams/page.tsx` lines 212-250 (the second-phase delete dialog)
— add a checkbox:

```tsx
<div className="mb-3 flex items-start gap-2">
  <input
    id="delete-team-agents-too"
    type="checkbox"
    checked={alsoDeleteAgents}
    onChange={(e) => setAlsoDeleteAgents(e.target.checked)}
    className="mt-0.5"
  />
  <label htmlFor="delete-team-agents-too" className="text-xs text-gray-300">
    Also delete this team's agents (including auto-COS).
    <br />
    <span className="text-gray-500">
      Uncheck to keep them as AUTONOMOUS hibernated agents.
    </span>
  </label>
</div>
```

And update `handleDelete()` to pass `{ deleteAgents: alsoDeleteAgents }`
to the DELETE body, mirroring `TeamListView.tsx:118`. Server must
cascade-delete those agents when the flag is true (already supported
in the DELETE route per MEMORY.md prior runs).

**Verification:**
Create a team with auto-COS, check the new box, confirm delete. After
~10s, both team AND auto-COS should be removed from registry + disk.

**Priority rationale:**
Every user of the /teams UI is leaking agents. High cumulative cost.
Same dialog already has the phased UX (confirm → password), adding
one checkbox is minimal risk.

---

### PROP-P1-002 — `useTeam.ts` PUT body includes `lastActivityAt` which is rejected by strict schema

**Source:** BUG-002 in SCEN-003 report (carried from SCEN-002 2026-04-19 run).

**Problem:**
Every team update from `useTeam.ts::updateTeam()` fails HTTP 400
"Validation failed". The hook includes `lastActivityAt` in the PUT
body which the server's `UpdateTeamSchema` rejects as a strict-schema
violation.

**Root cause:**
`hooks/useTeam.ts:74-82` adds `lastActivityAt: new Date().toISOString()`
to the PUT body. `app/api/teams/[id]/route.ts` uses `.strict()` Zod
schema without a `lastActivityAt` field (it's a server-computed
field).

**Proposed fix (ALREADY APPLIED):**
`hooks/useTeam.ts:75-101`:
- Do NOT send `lastActivityAt` in the body
- Also improve error display — instead of generic
  "Failed to update team", propagate server-side error messages
  (e.g. R4.7 "Cannot remove the Chief-of-Staff from team members")

**Verification:**
Any `useTeam().updateTeam(...)` call should now succeed (verified via
S040 team delete flow which transitively uses this path).

**Priority rationale:**
Any team-dashboard operation using `useTeam` was broken. High
frequency. Same class of bug as PROP-P0-001 (wizard payload drift).

---

### PROP-P1-003 — Wizard role-plugin step label contradicts scenario expectation when only 1 compatible plugin exists

**Source:** AUTHORING-2 in SCEN-003 report.

**Problem:**
SCEN-003 S029 says "Unlike INTEGRATOR, MEMBER title allows user choice
(not locked)". In practice, `/api/agents/role-plugins?title=MEMBER&client=claude`
returns exactly 1 plugin (`ai-maestro-programmer-agent`), so the
wizard auto-locks it with label "Auto-assigned for MEMBER title
(R9.13: mandatory)". This creates confusion for anyone running the
scenario for the first time: which behavior is correct?

**Proposed fix — TWO PARTS:**

Part 1 (scenario file):
- Update `tests/scenarios/SCEN-003_agent-creation-wizard.scen.md` S029
  to say: "If ≥2 plugins are compatible with MEMBER+claude, verify
  a dropdown appears. Otherwise verify the plugin is auto-locked
  with the R9.13 label."

Part 2 (optional — UI clarity):
- `components/AgentCreationWizard.tsx` RolePluginPickerWidget: when
  exactly 1 plugin is compatible and auto-locked, tweak the label to
  explain WHY there's no dropdown: currently says "Auto-assigned for
  INTEGRATOR title (R9.13: mandatory)" for ANY N:1 case; suggest
  "Auto-assigned — only 1 plugin is compatible with INTEGRATOR on
  this client" when N=1, and keep the R9.13 language for the
  mandatory-title case (INTEGRATOR, COS, etc.). That distinction is
  user-meaningful.

**Verification:**
Install a custom role-plugin compatible with MEMBER (e.g. a
Haephestos-crafted alternative programmer plugin). Start the wizard,
select MEMBER → dropdown should appear. Remove the custom plugin →
dropdown should revert to locked single-option with the right label.

**Priority rationale:**
User-facing clarity issue. Users trying to pick a plugin for MEMBER
are being told it's "mandatory" when really it's just the only
available one.

---

### PROP-P1-004 — S037 RBAC probe cannot be exercised without AID proof-of-possession — update scenario

**Source:** AUTHORING-3 + ISSUE-004 in SCEN-003 report.

**Problem:**
S037 expects a PATCH `/api/agents/<id>` with `X-Agent-Id` header to
return 403 (self-modification forbidden). In reality, the auth layer
(`lib/agent-auth.ts`) requires `Authorization: Bearer <api-key>` AID
proof-of-possession when `X-Agent-Id` is present — so the request
returns 401, not 403. The 403 self-mod check at
`lib/authorization.ts:117-122` never runs.

Without AID setup, the scenario cannot actually verify the
self-modification RBAC rule — only the upstream auth rule.

**Proposed fix — TWO PARTS:**

Part 1 (scenario file): update S037 to clarify this is a test of
defense-in-depth, and accept EITHER 401 (auth required) or 403
(self-mod) as valid proof of defense:

```markdown
- **Goal:** API rejects with 401 (agent-identity authentication
  required) OR 403 (self-modification forbidden) -- either response
  proves that no agent can successfully modify itself via the API.
```

Part 2 (optional — scenario extension): add a new scenario
SCEN-XXX that DOES set up AID properly (via `aid-init.sh` +
`aid-token.sh`) and verifies the actual 403 self-mod rule at the
RBAC layer. This requires extending dev-browser helpers to
orchestrate shell commands outside the sandbox.

**Verification:**
Re-run SCEN-003 S037. Should now PASS on the first try without
"Adapted" annotation.

**Priority rationale:**
Medium — the defense IS in place (just stronger than documented).
Scenario accuracy matters for future runs.

---

## P2 — Minor bugs, documentation improvements

### PROP-P2-001 — Scenario SCEN-003 S008 is internally inconsistent: "Do NOT select agents" vs sidebar form requiring ≥1 agent

**Source:** AUTHORING-1 in SCEN-003 report.

**Problem:**
SCEN-003 S008 says "Click '+ Create Team' ... Do NOT select any
agents. Click 'Create Team'". But the sidebar `TeamListView.tsx`
form disables the submit button until at least 1 agent is selected.
Only the `/teams` page's full `TeamCreationWizard` allows empty
teams (with auto-COS).

**Proposed fix:**
Update `tests/scenarios/SCEN-003_agent-creation-wizard.scen.md`
S007+S008 to explicitly use the `/teams` page full wizard:

```markdown
#### S007: Navigate to /teams page
- **Action:** Click "Teams" in sidebar navigation → redirected to /teams page
- **Goal:** /teams page shown with team cards + Create Team button
- **Verify:** Create Team button + any existing team cards visible.

#### S008: Create test team via full wizard (with auto-COS)
- **Action:** Click Create Team → fill Team Info step (name=`scen-test-wizard-team`,
  description=`Scenario 003 wizard test team`, governance password). Skip
  GitHub Repos + Project steps. On Team Roles step leave COS as "Auto-create"
  and Orchestrator as "None". Click Next → Next → Create Team on Confirm step.
- **Goal:** Team created with auto-generated COS agent
- **Verify:** Redirected to /teams/<id> page. Team card shows "1 agent"
  (the auto-COS). Registry shows new COS with random robot avatar.
```

**Verification:**
Re-run SCEN-003 S007-S008 — should not require any "adapted" annotation.

**Priority rationale:**
Low impact but visible drift between scenario text and UI reality.

---

### PROP-P2-002 — Scenario SCEN-003 S040 "Delete Agents Too" button does not exist in /teams page

**Source:** AUTHORING-4 in SCEN-003 report.

**Problem:**
S040 says "click 'Delete Agents Too'" but that button doesn't exist
in the /teams page delete dialog. The current UI button label is
"Delete Team", and the behavior is always "hibernate agents as
AUTONOMOUS".

**Proposed fix:**
Two options:

Option A (update scenario to match current UI):
```markdown
#### S040: Delete scen-test-wizard-team via DeleteTeam pipeline (/teams page)
- **Action:** Navigate to /teams. Hover the scen-test-wizard-team card,
  click trash icon. First dialog: click Delete. Second dialog: enter
  governance password `mYkri1-xoxrap-gogtan`, click "Delete Team".
- **Goal:** Test team removed. Auto-COS becomes an orphan hibernated
  AUTONOMOUS agent (to be cleaned up in S040b).
- **Verify:** Team card no longer appears.

#### S040b (new step): Delete orphan auto-COS via Profile
- **Action:** Switch sidebar to ALL tab. Search for cos-scen-test-wizard-team.
  Click the agent. In Profile → Advanced → Danger Zone → Delete Agent.
  Check "Also delete agent folder". Type the agent name. Delete Forever.
  Sudo password: `mYkri1-xoxrap-gogtan`.
- **Goal:** Orphan COS removed.
- **Verify:** Registry entry gone, ~/agents/cos-scen-test-wizard-team/ removed.
```

Option B (add "Delete Agents Too" to UI — see PROP-P1-001):
Then S040 would work as currently written. Option B is preferred
because it addresses the underlying UX gap.

**Verification:**
Re-run scenario S040 — should not require adaptation.

**Priority rationale:**
Low impact but this is a recurring cleanup-phase authoring bug across
multiple scenarios. Fixing PROP-P1-001 in the UI is the more durable fix.

---

## P3 — Nice-to-have

### PROP-P3-001 — `aim-helpers.sh` documentation should recommend `page.click(selector)` over synthetic events

**Source:** ISSUE-003 in SCEN-003 report.

**Problem:**
During this run, 3 different places where synthetic events
(`btn.dispatchEvent(new MouseEvent('click'))`) were silently ignored
by React handlers. Switching to `page.click(selector)` via a CSS
locator or `:has-text()` pseudo-selector always worked.

**Proposed fix:**
Add a preamble comment to `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh`:

```bash
# TOOLING NOTE — React-event compatibility:
#
# Prefer `page.click(selector)` over `page.evaluate(() => btn.click())` or
# `page.evaluate(() => btn.dispatchEvent(new MouseEvent('click')))` for any
# React-button in the AI Maestro UI.
#
# Reason: React synthetic events require a matching internal fiber node.
# Manually-dispatched MouseEvents sometimes don't trigger React's
# `onClick` handler because React has its own event delegation at
# document root and the synthetic-event dispatch doesn't match.
#
# `page.click(selector)` uses CDP's real Input.dispatchMouseEvent which
# always works with React.
#
# Confirmed cases in SCEN-003 20260419T131651Z:
# - TeamPickerWidget team card buttons
# - TeamCreationWizard Create Team submit button
# - Wizard step-advance chevron (when Playwright-click-visible selector available)
```

**Verification:**
Subsequent scenarios should land on `page.click(...)` as first choice.

**Priority rationale:**
Tooling nit. Documenting the trap saves hours per future run.

---

## Summary

| Priority | Count | Status |
|----------|-------|--------|
| P0 | 2 | Both FIXES APPLIED in-place during run (uncommitted). User approval needed to commit. |
| P1 | 4 | 2 FIXES APPLIED in-place (PROP-P1-002 hook fix, BUG-003 restored from stash). 2 need design decision + implementation. |
| P2 | 2 | Scenario-file updates; no code changes. |
| P3 | 1 | Documentation tooling nit. |
| **Total** | **9** | **3 code fixes uncommitted on `feature/team-governance`** |

**Files modified in this run (uncommitted):**
- `components/teams/TeamCreationWizard.tsx` — PROP-P0-001 fix
- `app/teams/page.tsx` — PROP-P0-002 fix
- `hooks/useTeam.ts` — PROP-P1-002 fix (+ error-surfacing improvement)

User: review the 3 code diffs before committing. The fixes are minimal
and surgical; no destructive changes.
