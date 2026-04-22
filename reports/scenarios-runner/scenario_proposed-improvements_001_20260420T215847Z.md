# SCEN-001 — Proposed Improvements (Rule 11 11th-HOUR Analysis)

**Scenario report:** `reports/scenarios-runner/SCEN-001_20260420T215847Z.report.md`
**Run verdict:** PASS (2 BLOCKER bugs found + fixed in-place)
**Base commit:** e1f2b44a
**Fix commits landed on this branch:** a1107965 (BUG-001), c6c39958 (BUG-002)

This Rule 11 writeup lists FIVE categories of proposals extracted from
observations during the run, each with a priority tag. The bug fixes
themselves are already committed (Rule 4 FIX-AS-YOU-GO); the proposals
below target follow-up work that goes beyond in-run patching —
guardrails, ergonomics, scenario-vs-code alignment, and process rules.

---

## P0 — Prevent BUG-001-class regressions from shipping again

### PROP-P0-001: Add ESLint `no-mixed-operators` rule with `&&` + `||` + `?:` to the project

**Problem.** BUG-001 (SWC parser wedge) happened because the codebase
has no lint rule preventing the exact pattern that caused it:
```ts
const x = A || B ? Y : Z
```
SWC mis-tokenizes this in a TS + JSX context and then fails 300+ lines
later at the first JSX tag. The 2-hour diagnostic expedition from
"dashboard won't load" to "oh, it's the ternary operator precedence"
would have been prevented by a one-line ESLint rule.

**Root cause.** Neither `eslint --quiet` nor the current CI catches
`NONE || NONE ? NONE : NONE`. The TypeScript compiler accepts it
(matches the spec). Only SWC in JSX-mode wedges.

**Proposed fix.** Add to `.eslintrc.json` (or the project's ESLint
config — confirm location before applying):
```json
{
  "rules": {
    "no-mixed-operators": ["error", {
      "groups": [
        ["&&", "||", "?:"],
        ["&&", "||"],
        ["+", "-", "*", "/"]
      ],
      "allowSamePrecedence": false
    }]
  }
}
```
Then run `npx eslint . --quiet` to find existing violations; either
parenthesize them or accept the fix as a mechanical codemod. A pre-
commit hook (or a CI step) that runs `eslint --max-warnings=0` on
changed `.ts` / `.tsx` files would then block any future commit that
reintroduces the pattern.

**Verification.** Recreate the un-parenthesized ternary in a toy file,
run eslint, confirm it errors. Commit the ESLint config as a single
PR ahead of the codemod so reviewers can inspect the rule in isolation.

**Priority rationale.** This class of bug **destroys the entire
dashboard** — not a subsystem, not one feature, the whole app. A
one-line rule that eliminates the pattern is proportional.

---

### PROP-P0-002: Make the dev server's compile errors visible in the browser again

**Problem.** The current Next.js overlay DID NOT render the compile
error — the browser stayed on `Verifying session...` forever because
`main-app.js` returned 404 and `<LoginGate>` silently re-tried the
`/api/auth/session` fetch on an interval. Users (and scenario runners)
have no in-browser signal that the build is broken; they must tail
`pm2 logs ai-maestro` or scroll the terminal to notice.

**Root cause.** The Next.js dev-overlay lives inside an injected
client bundle. If the dev bundle fails to compile, the overlay never
loads. Meanwhile `LoginGate`'s try/catch treats the fetch failure as
an unauthenticated response, which means "show the login screen" but
the login screen can't render either (same bundle).

**Proposed fix.** Two complementary approaches:

1. **Server-side check:** `server.mjs` already knows the last compile
   status (it logs it to stdout). Add a `GET /api/dev/build-status`
   route that returns `{ok: true}` or `{ok: false, errors: [...]}`.
   Poll this from a **separately-bundled** `app/_dev-overlay.tsx`
   that renders even when the main bundle fails.

2. **LoginGate fallback:** If `/api/auth/session` returns 401 but the
   document's `<script src="/_next/static/chunks/main-app.js">`
   returned 404, show a specific "Dev server compile error — check
   `pm2 logs ai-maestro`" banner instead of the generic
   "Verifying session..." spinner.

**Verification.** Intentionally break a `.tsx` file (e.g. add a stray
curly brace), confirm the browser shows the new error banner within
5s of the broken save.

**Priority rationale.** Today the only way to know the dev server is
broken is to tail logs. That's acceptable for developers but DEAD for
scenario runners (no terminal attached) and for QA on remote hosts.
The 2-hour diagnostic from BUG-001 was not improved by in-browser
feedback.

---

## P1 — Close BUG-002-class gaps without losing the ChangeTitle invariant

### PROP-P1-001: `UpdateTeamSchema` should be a single source of truth with `UpdateTeamParams`

**Problem.** BUG-002 was caused by three schemas that *should* be in
lockstep but drifted:
- `app/api/teams/[id]/route.ts` → Zod `UpdateTeamSchema` (missing `orchestratorId`)
- `services/teams-service.ts` → TypeScript `UpdateTeamParams` (had `orchestratorId`)
- `lib/team-registry.ts` → `updateTeam()` Partial<Pick<Team, ...>> (had `orchestratorId`)

The storage layer accepted the field. The service layer accepted it.
The HTTP route rejected it. A field added to a type in one place was
not propagated to the other two.

**Proposed fix.** Make `UpdateTeamParams` (TypeScript) the canonical
definition and **derive the Zod schema from it** at the route. Use
`z.infer` plus a `satisfies` check:
```ts
// lib/teams-schemas.ts (new file)
export const UpdateTeamSchema = z.object({
  name: z.string().min(1).max(128).optional(),
  description: z.string().max(512).optional(),
  agentIds: z.array(z.string().uuid()).max(50).optional(),
  type: z.string().max(32).optional(),
  chiefOfStaffId: z.string().uuid().nullable().optional(),
  orchestratorId: z.string().uuid().nullable().optional(),
  // ... every field UpdateTeamParams has
}).strict()
type ZodUpdateTeamSchema = z.infer<typeof UpdateTeamSchema>
// Type-level check: the Zod schema MUST be a subset of UpdateTeamParams
export const _updateTeamSchemaCompat: ZodUpdateTeamSchema extends Omit<UpdateTeamParams, 'requestingAgentId' | 'githubProject' | 'instructions'> ? true : false = true
```
The `_updateTeamSchemaCompat` constant will fail to compile if a field
is added to `UpdateTeamParams` but not to `UpdateTeamSchema`.

**Verification.** Add a unit test that asserts every key in
`UpdateTeamParams` (minus the documented exclusions `requestingAgentId`
etc.) is present in the Zod schema's `shape` at runtime. Run it
alongside every PR that touches any of the three files.

**Priority rationale.** The three layers will drift again. A compile-
time + runtime check is cheap insurance.

---

### PROP-P1-002: TitleAssignmentDialog should retry the full transition atomically or roll back

**Problem.** Even with the route schema fixed, the ORCHESTRATOR →
MEMBER path is a client-side 2-step (clear title, then
`updateTeamOrchestratorId(null)`) that is NOT atomic. If the first
step succeeds but the second fails, the agent is stranded at
`governanceTitle=null` while still in the team. That's exactly what
BUG-002 looked like at the user.

**Proposed fix.** One of:

1. **Server-side single endpoint.** Extend `PATCH /api/agents/[id]`
   (or add a dedicated
   `POST /api/agents/[id]/governance-title/change-to-member`) that
   accepts `{ from: 'orchestrator', to: 'member' }` and performs both
   the agent-title clear AND the team-orchestratorId-clear AND the
   plugin swap in a single transaction on the server. The client calls
   one endpoint, one sudo prompt, one failure mode.

2. **Client-side try/rollback.** If `updateTeamOrchestratorId(null)`
   throws after `clearGovernanceTitle()` succeeded, immediately try
   `setGovernanceTitle('orchestrator')` to restore the pre-demotion
   state before re-throwing. User sees the error with nothing changed
   instead of a silent stranded state.

Option 1 is the better long-term design (matches the ChangeTitle
pipeline philosophy — one op, one authContext, all gates run on the
server). Option 2 is a quick retrofit while Option 1 is designed.

**Verification.** Scenario-test: mid-transition, kill the server
between step 1 and step 2. Confirm the next page reload shows the
agent STILL as ORCHESTRATOR (rollback worked) or the "stuck" state
(rollback didn't run) and a clear error in the UI.

**Priority rationale.** BUG-002 was discoverable in 1 attempt. A
user doing the same demotion on a flaky network would see it on any
500 from the team endpoint. The current UI offers no recovery.

---

### PROP-P1-003: DeleteAgentDialog — surface "did I just lose the cemetery archive?" explicitly

**Problem.** ISSUE-002 in the report. Today's dialog always sends
`hard=true`. The checkbox "Also delete agent folder" only controls
folder deletion. There's no path from the UI to create a cemetery
archive for an accidentally-deleted agent that the user might want
to revive.

**Proposed fix.** Add a third, default-CHECKED checkbox "Keep an
archive in the cemetery (recommended — lets you revive this agent
later)". When checked, the dialog calls the DELETE endpoint with
`hard=false` on a first pass to create the cemetery archive, then
(if the folder-delete box is also checked) removes the folder. The
existing `archiveAgentToCemetery()` code path on the server can be
reused. Unchecking the box reverts to today's hard-delete behavior.

Label the current "Delete Forever" button "Permanent Delete" to
match the semantics when the cemetery box is unchecked.

**Verification.** New scenario SCEN-001a: soft-delete an agent, go
to Settings → Cemetery, confirm the archive is there, revive it,
confirm the agent reappears in the sidebar and its folder is
re-populated from the archive.

**Priority rationale.** The current behavior is irreversibly
destructive on a single misclick with nothing more than a type-the-
name confirmation. The cemetery was designed as the safety net; the
UI currently skips it by default.

---

## P2 — Keep scenarios honest, keep the runner fast

### PROP-P2-001: Update SCEN-001 to match current UI (R11.5 scenario-vs-code alignment)

**Problem.** The scenario file was written against a pre-v0.27
dialog that:
- hid team-only titles when the agent had no team (instead of showing
  them grayed with "Requires team membership")
- offered a "Leave team" button in the profile panel (no longer
  present — user must click Reassign and pick a different team, or
  delete+recreate)
- created a cemetery archive by default when soft-deleting (current
  UI doesn't do this)

These drifts make the scenario partially unrunnable as written.

**Proposed fix.** Rewrite the affected step groups:
- S015/S016: change expectation from "only 3 options shown" to "8
  options shown, 5 disabled with 'Requires team membership' text".
- S034: change from "Leave team first, then title auto-reverts" to
  "delete the team (S034b); agents auto-revert to AUTONOMOUS and
  hibernated as a side effect".
- S035/S036/S037: either wait for PROP-P1-003 (add cemetery opt-in)
  and then expect the behavior, OR update to "soft-delete is not
  currently available in the UI; cemetery verification skipped" with
  a link back to ISSUE-002.

Also remove the scenario-level instruction "Create a test team" from
S017 and replace with "Create MANAGER first (singleton required for
R9.8), then team". The user-instruction reminds us scenarios must
create their own MANAGER — add this to the scenario so future runs
don't have to re-invent the sequence.

**Verification.** Re-run SCEN-001 against the rewritten file; every
step should PASS without an "adapted" or "skipped" status.

**Priority rationale.** Every "adapted" row in the scenario report
costs the runner a diagnostic expedition. Keeping scenarios current
is cheaper than re-discovering the drift every run.

---

### PROP-P2-002: Add a `scenarios/authoring-rules.md` with the "create your own MANAGER" rule

**Problem.** The user instruction was explicit: "the user deliberately
does NOT pre-create a MANAGER for scenarios; every scenario that needs
a MANAGER creates one". I had to re-derive this at S017 after hitting
R9.8 block. The scenario file didn't say so, MEMORY.md didn't say so,
SCENARIOS_TESTS_RULES.md didn't say so.

**Proposed fix.** Add a section to `SCENARIOS_TESTS_RULES.md`:

> ### Authoring rule: scenarios that touch teams MUST create their own MANAGER
>
> AI Maestro blocks team creation with HTTP 400 "no MANAGER on host"
> when `governance.json` has no `managerId`. The user does NOT
> pre-create a MANAGER for scenarios — every scenario that needs to
> create a team (i.e. every scenario that tests team-scoped governance
> titles) MUST:
>
> 1. In an early Phase 2 step, create a `scen<NNN>-manager` agent via
>    the wizard with MANAGER title.
> 2. Record its id in the scenario's state for cleanup.
> 3. In Phase CLEANUP, delete the `scen<NNN>-manager` agent.
>
> This mirrors how real users bootstrap new AI Maestro hosts.

**Verification.** Next scenario-author adds a team-requiring scenario
and lands the manager-creation step without needing to re-derive the
rule.

**Priority rationale.** Every scenario that will ever test a team
needs this. Writing it down once saves N future re-derivations.

---

### PROP-P2-003: aim-helpers.sh gap — no `aim_click_danger_zone` helper

**Problem.** The DANGER ZONE accordion in the Advanced tab is
rendered as a `<button>` whose text is ONLY present via `innerText`
(not `textContent`), breaking most `document.querySelector` + text-
match approaches. Every cleanup step in this scenario had to manually
rediscover the selector, scroll into view, click via DOM, wait, then
find the Delete button, scroll, click, then find the checkbox, etc.

**Proposed fix.** Add to `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh`:

```bash
aim_expand_danger_zone() {
  dev-browser --browser ai-maestro-scenarios --headless --timeout 10 <<'EOF'
    const page = await browser.getPage("dashboard");
    await page.evaluate(() => {
      const btn = Array.from(document.querySelectorAll('button'))
        .find(b => (b.innerText || '') === 'DANGER ZONE');
      if (btn) { btn.scrollIntoView({block: 'center'}); btn.click(); }
    });
    await page.waitForTimeout(800);
  EOF
}

aim_delete_agent_via_profile() {
  local agent_name="$1"
  local also_delete_folder="${2:-true}"
  # ... wraps: select agent → Advanced → expand DZ → Delete Agent
  #            → (check folder cb) → type name → Delete Forever → sudo
}
```

**Verification.** Replace the hand-rolled delete sequences in
`tests/scenarios/` cleanup scripts with calls to the helper. Confirm
SCEN-001 cleanup shrinks by ~200 lines.

**Priority rationale.** Every scenario deletes agents in cleanup.
Every scenario re-invents the DANGER ZONE expansion. One helper
eliminates this rediscovery for every future run.

---

## P3 — Governance / protocol refinements

### PROP-P3-001: `DELETE /api/teams/[id]` return payload should include the list of agents it reverted

**Problem.** After S034b, the UI silently reverted 2 agents to
AUTONOMOUS. The scenario runner had to poll `/api/agents` to confirm
which agents were affected. For audit and for the UI's "you just did
X" toast, the DELETE response should enumerate the side-effects.

**Proposed fix.** Extend the DELETE response:
```json
{
  "deleted": {"teamId": "...", "teamName": "..."},
  "revertedAgents": [
    {"id": "...", "name": "scen-test-title-agent", "oldTitle": "orchestrator", "newTitle": "autonomous", "hibernated": true},
    {"id": "...", "name": "cos-scen001-title-team", "oldTitle": "chief-of-staff", "newTitle": "autonomous", "hibernated": true}
  ],
  "cascadeDeletedAgents": []  // populated only when ?deleteAgents=true was set
}
```

The existing `DeleteTeamSchema` already accepts `deleteAgents`; the
current response body shape is `{ success: true }` with no detail.

**Verification.** Unit test: create team with 3 agents, delete,
confirm response lists all 3 in `revertedAgents` with correct
oldTitle/newTitle.

**Priority rationale.** Cheap, visible, makes every UI toast and
every scenario report more useful. Not blocking anything.

---

### PROP-P3-002: Scenario runner should auto-restart the dev server on a Next.js 404-chunk detection

**Problem.** When BUG-001 triggered Next.js to fail the build, the
runner had to manually pm2 restart + `mv .next .next.stale` to
recover. A better recovery: detect the signal `GET /_next/static/
chunks/main-app.js → 404` and auto-run `pm2 restart ai-maestro`
with a single warning log.

**Proposed fix.** Add to the SAFE-SETUP phase (Rule 7) at the end:

```bash
if curl -s http://localhost:23000/_next/static/chunks/main-app.js \
  | head -c 100 | grep -q "<!DOCTYPE"; then
  echo "WARN: main-app.js returns HTML not JS — triggering rebuild"
  pm2 stop ai-maestro
  mv .next .next.stale-$(date -u +%Y%m%dT%H%M%SZ) 2>/dev/null
  pm2 restart ai-maestro
  sleep 20
fi
```

This should be part of `scripts/scenario-setup.sh` so every scenario
benefits without its own author having to remember.

**Verification.** Deliberately leave a broken `.next` (by aborting a
previous dev-server compile mid-file-write), run the setup, confirm
the second curl returns valid JS.

**Priority rationale.** Saves 10 minutes of diagnostic time per
corrupted dev build. Not every run will need it, but when it does,
it's a big time saver.

---

## Summary

| Priority | Count | Total effort est. |
|----------|-------|-------------------|
| P0 | 2 | ~4h (eslint config + dev-overlay prototype) |
| P1 | 3 | ~16h (schema derivation + atomic demotion + cemetery opt-in) |
| P2 | 3 | ~6h (scenario rewrite + authoring rule + helper) |
| P3 | 2 | ~4h (response enrichment + auto-rebuild) |

Each proposal is self-contained and can land as a separate PR.
P0 items should go first because they prevent the next BUG-001-
scale outage. P1 items close the gap between "the scenario passes"
and "a real user won't hit this bug". P2/P3 are quality-of-life
improvements for future runs.
