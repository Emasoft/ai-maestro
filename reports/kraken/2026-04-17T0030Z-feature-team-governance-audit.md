# feature/team-governance — Batch Audit (22 commits)

**Date**: 2026-04-17
**Auditor**: Kraken (read-only)
**Branch**: `feature/team-governance`
**Range**: `6eee4e4e..feature/team-governance` (22-commit batch + 1 docs-only audit commit)
**Base (divergence point)**: `6eee4e4e` (sync version references to 0.27.0)
**Tip**: `7b345b3e` (docs-only audit) / `8d60d336` (last code commit)

**Note on scope**: The user prompt references `CONSOLIDATED_PROPOSALS_2026-04-16.md`. **That file does NOT exist on the branch.** It is referenced by the autonomous batch protocol (Rule 13 in `tests/scenarios/SCENARIOS_TESTS_RULES.md`) as the Phase-2 deliverable, but the overnight cron never produced it. The P0 coverage map below is derived instead from (a) the individual `scenario_proposed-improvements_NNN_*.md` files that ARE on the branch, (b) the commit messages that explicitly reference P0 IDs, and (c) cross-referenced with the actual code diffs.

---

## Section 1: Commit table

Ordered newest → oldest. SHA shortened to 8 chars.

| SHA | Title | Files | P0 addressed | Concerns |
|---|---|---|---|---|
| 7b345b3e | docs: audit R17 UI surfaces + MANAGER escalation guidance | 2 docs | SCEN-017 P0-003, SCEN-009 P0-004 | None — docs only |
| 8d60d336 | fix(plugins): SCEN-019 P0-001 cache cleanup + SCEN-007 P0-001 R18 conversion | 1 code | SCEN-019 P0-001, SCEN-007 P0-001 | Cache cleanup only runs for user-scope Claude client — local scope silently skipped (by design, documented). No unit test for the new R18.3d priority chain. |
| 13847a30 | feat(governance): add G14c role-plugin uninstall on title release | 1 code | SCEN-002 P0-002 | G14c added between G14b and G15 (line 1870). Order is correct. G15's legacy `uninstallAllRolePlugins()` still runs as belt-and-braces — slight redundancy but not a bug. |
| 63c6f95f | feat(team-card): surface R12 composition warning badge | 2 code | SCEN-010 P0-003 | Replaces server-fetch implementation from **same batch** (2b8d1158, chronologically earlier) with pure local computation. Means the server round-trip code was written then removed within the same batch. **Two-step oscillation** in the batch. Memoization uses object reference deps `[team, agents]` — invalidated every render if parent passes new references (minor perf concern). |
| e5775c7d | feat(sidebar): add permanent HELPERS group with Haephestos card | 1 code | SCEN-004 P0-004 (partial) | **Code/comment mismatch**: comment says "Always visible regardless of viewMode filter" but the card is ONLY rendered inside the `viewMode === 'normal'` branch. Compact view has NO HELPERS card. |
| 0053c73c | test(scen-024): DeleteTeam revert COS regression scenario | 1 new scen | SCEN-005 P0-002 (regression test) | Scenario-level test only. No fast-feedback unit test. |
| d3b082c3 | test(change-client): add R18 decision matrix tests | 1 new test | SCEN-016 P0 (fast-feedback test) | **Weak coverage**: 5 tests, but the R18.3b test is an explicit "placeholder" that only verifies `typeof ChangeClient === 'function'` — it does NOT verify the refusal path of X→Claude without canonical source. The filename is "decision matrix" but only the first 4 gates are matrix'd; the actual R18.3d priority chain is not matrix'd. |
| f580a8fc | fix(haephestos): 30min server watchdog + hardened client heartbeat | 2 code | SCEN-004 P0-002 | WATCHDOG_TIMEOUT_MS 2min → 30min. 15x increase. If a Haephestos session is legitimately stuck, cleanup now takes 30 min instead of 2. Trade-off is documented in commit body. |
| 98277c4d | test(scen-023): add R17 exhaustive surface audit scenario | 1 new scen | SCEN-017 P0-003 | Scenario-level test. No fast unit test. |
| dcd8c870 | fix(sessions): pass AGENT_WORK_DIR + AID_AUTH atomically to tmux new-session | 2 code | WT-014#1 (AGENT_WORK_DIR), WT-022#1 (AID_AUTH) | Clean fix. Env var validation `^[A-Z_][A-Z0-9_]*$` correctly prevents injection. **Wake path (`agents-core-service::wakeAgent`) has the same bug but is NOT fixed** — explicitly deferred in commit body. This is a known gap. |
| 2fe9ef6f | fix(wizard): P0-018-003 — hide celebration on creation failure | 1 code | SCEN-018 P0-003 | Clean gate on `creationError` truthiness. Minor: the comment references line numbers ("set atomically with setAnimationPhase('error') at line 419-420") — these line numbers are stale-prone. |
| 8c7ec833 | test(haephestos): add pipeline smoke test | 1 new test | SCEN-004 P0-002 (regression test) | 383-line test file. Tests are REAL (exercise actual route code with in-memory fs). Mocks are limited to external deps (fs, PSS binary, etc.). Good coverage. |
| a2f90e0e | fix(marketplaces): route via CreateMarketplace/DeleteMarketplace/UpdateMarketplace pipelines | 4 code | SCEN-017 P0-001/P0-002, SCEN-021 P0-001 | Thin wrappers around ChangeMarketplace. **`ChangeMarketplace` accepts `authContext` but does NOT perform IBCT scope check** — all other Change* functions do. Inconsistency: other Change* functions have `G00: IBCT scope enforcement` but ChangeMarketplace does not. |
| 2b8d1158 | fix: SCEN-010 P0-002/P0-003 UI/UX around title dialog and team cards | 2 code | SCEN-010 P0-002, SCEN-010 P0-003 | P0-003 implementation (server-fetch composition-check) was **overwritten by 63c6f95f** within the same batch. Net effect: only P0-002 (title dialog storedTitle fetch) from this commit survives. |
| 4413648e | fix(governance): DeleteTeam skips global titles + UI agent delete uses hard | 2 code | SCEN-002 P0-003, SCEN-007 P0-002 | TEAM_SCOPED_TITLES set correctly excludes MANAGER/MAINTAINER. DeleteAgentDialog now passes `hard=true` always. Good. |
| 5cd45c5a | fix: SCEN-020 P0-002 + SCEN-022 P0-001 partial + SCEN-009 P0-003 noop | 2 code | SCEN-020 P0-002, SCEN-022 P0-001 (partial) | Trivial typo fix ("uninstalld"→"uninstalled"). SCEN-022 P0-001 explicitly partial (2 of N curl calls patched). SCEN-009 P0-003 explicitly no-op with rationale in commit body. |
| 8199b617 | fix(governance): persist governanceTitle through CreateAgent + ChangeTitle | 1 code | SCEN-007 P0-003, SCEN-010 P0-001, SCEN-020a BUG-001 | G22 silent WARN → hard FAIL. `_authContext` → `authContext` in ChangeTeam. **BUG IN THE FIX**: ChangeTeam G07 and G04d still `WARN and continue` on ChangeTitle failure with `result.success = true`. See Section 3 for details. |
| 65406841 | r20: Claude core = remote only + R20.27 manifest-name + R20.28 six canonical folder patterns | 4 files | SCEN-019 P0-002 (partial, R20 surface) | `patchManifestName` helper is sound. Claude core plugin now installed from remote only — changes R20.25 semantics. |
| 4f767149 | fix(plugin-install): route non-Claude clients through per-client adapter | 1 code | SCEN-007 P0-001, SCEN-009/013/018 P0 (recurring) | Adds `useClientAdapter` gate at top of install/uninstall EXE. PG01 verification also routed through adapter `detectState()`. |
| 54291380 | feat(r20): update converters for 3-container routing + R20.26 overwrite | 1 code | R20 infrastructure | `emitForClient` and `convertAndStorePlugin` now write into 3 hubs (core/role/custom) by `categorizePlugin()`. |
| a1dcf287 | fix(r20): R20.26 clarify — literal name comparison, no implicit suffix logic | 1 doc | R20 doc | One-line clarification. |
| 3ac53073 | fix(r20): R20.26 same-name collision → overwrite, never rename or suffix | 2 files | R20 infrastructure | **Semantic flip**: reversed the previous commit (446f544a) which said "converter suffixes on collision, never overwrites names". Final rule: overwrite. |
| 446f544a | feat(r20): R20.26 NO-RENAMING-RULE-FOR-PLUGINS | 2 files | R20 infrastructure | **Contradicts the next commit (3ac53073)**: this says "converter suffixes on collision, never overwrites" but 3ac53073 flipped it to overwrite. Net: this commit's stated rule was reversed within the batch. |

**Summary counts:**
- Total commits examined: 23 (22 code + 1 docs)
- Code commits: 22 (18 fix, 4 feat/test)
- Doc-only commits: 1 (7b345b3e)
- Test-only commits: 3 (0053c73c, d3b082c3, 8c7ec833, 98277c4d) — 4 actually
- P0 proposals addressed in commits: ~20 distinct proposals

---

## Section 2: P0 coverage map

CONSOLIDATED_PROPOSALS_2026-04-16.md does not exist. The map below is derived from proposal files that DO exist and from P0 references in commit messages. Each row: `P0 ID | Status | Addressing commit(s) | Notes`.

| P0 ID | Status | Addressing commit(s) | Notes |
|---|---|---|---|
| SCEN-002 P0-001 (title persistence) | PREVIOUSLY FIXED | (pre-batch) | Cited in 4413648e as "already fixed upstream via G22 registry verify gate". |
| SCEN-002 P0-002 (role-plugin uninstall on title release) | ADDRESSED | 13847a30 | G14c added. Verified in `services/element-management-service.ts:1870`. |
| SCEN-002 P0-003 (UI delete permanent registry entry + folder) | ADDRESSED | 4413648e | DeleteAgentDialog now `hard=true`. |
| SCEN-004 P0-002 (Haephestos watchdog too aggressive) | ADDRESSED | f580a8fc, 8c7ec833 | 30min watchdog + smoke test. |
| SCEN-004 P0-004 (HELPERS sidebar entry) | PARTIALLY ADDRESSED | e5775c7d | Only in `viewMode === 'normal'` — compact view still missing. |
| SCEN-005 P0-001 (DeleteTeam authContext propagation) | PREVIOUSLY FIXED | (pre-batch) | Cited in 4413648e as "present at line 3997-3999". |
| SCEN-005 P0-002 (MANAGER/MAINTAINER global-title protection on team delete) | ADDRESSED | 4413648e | TEAM_SCOPED_TITLES allowlist. Regression scenario added in 0053c73c. |
| SCEN-007 P0-001 (CreateAgent R18 cross-client conversion) | ADDRESSED | 8d60d336, 4f767149 | Two-commit fix: first adapter routing, then R18.3d priority chain. |
| SCEN-007 P0-002 (legacy team field cleared on title revert) | ADDRESSED | 4413648e | `updateAgent(agentId, { team: '' })` inside DeleteTeam G03. |
| SCEN-007 P0-003 (governanceTitle persistence on team join) | ADDRESSED | 8199b617 | authContext propagation + G07b defensive retry. See Section 3 for concern. |
| SCEN-009 P0-003 (Delete Agents Too checkbox) | OPEN (intentional noop) | 5cd45c5a (noop) | Explicit deferral with rationale: backend DeleteTeam pipeline refuses cascade-delete per governance design; UI checkbox would mislead. Leaves an "opposing forces" tension to resolve via TRDD. |
| SCEN-009 P0-004 (MANAGER escalation guidance) | ADDRESSED (docs) | 7b345b3e | Docs only; no code change. Section C of the design doc is a deliverable for the role-plugin's own repo. |
| SCEN-010 P0-001 (ChangeTitle stores "member" when in team) | ADDRESSED | 8199b617 | Same root-cause fix as SCEN-007 P0-003. |
| SCEN-010 P0-002 (Title dialog Confirm stays disabled on display-title pick) | ADDRESSED | 2b8d1158 | storedTitle fetch + comparison. |
| SCEN-010 P0-003 (R12 composition warning badge) | ADDRESSED | 2b8d1158 → 63c6f95f | Server-fetch (2b8d1158) overwritten by local compute (63c6f95f) within the batch. |
| SCEN-012 P0 (BUG-001 Start Session bypasses R17) | PREVIOUSLY FIXED | (pre-batch) | `handleStartSession` in `app/page.tsx:494` routes to `/api/agents/{id}/wake`. Proposal file `scenario_proposed-improvements_012_*.md` marked as FIXED IN RUN. |
| SCEN-017 P0-001 (marketplace add/update/delete pipeline) | ADDRESSED | a2f90e0e | CreateMarketplace/DeleteMarketplace/UpdateMarketplace wrappers. |
| SCEN-017 P0-002 (marketplace install stamps correct marketplace) | ADDRESSED | a2f90e0e | MarketplacesTab `handleInstall(p.name)` → passes real marketplace. |
| SCEN-017 P0-003 (R17 surface audit scenario) | ADDRESSED | 98277c4d | New SCEN-023 scenario + audit doc in 7b345b3e. |
| SCEN-018 P0-003 (wizard celebration on failure) | ADDRESSED | 2fe9ef6f | creationError gate on Step 7 render. |
| SCEN-019 P0-001 (plugin cache cleanup on uninstall) | ADDRESSED | 8d60d336 | user-scope Claude only. `rm -rf` hardened by prefix check. |
| SCEN-020 P0-002 (uninstalld typo) | ADDRESSED | 5cd45c5a | pastTense switch. |
| SCEN-020a BUG-001 (governanceTitle persistence for team-required titles) | ADDRESSED | 8199b617 | Same fix. |
| SCEN-021 P0-001 (plugin install marketplace stamp) | ADDRESSED | a2f90e0e | Same as SCEN-017 P0-002. |
| SCEN-022 P0-001 (AID_AUTH propagation in CLI scripts) | PARTIALLY ADDRESSED | 5cd45c5a | 2 remaining curl calls patched. Commit body notes 3+ scripts already had the Bearer-token pattern in the in-run fix. Remaining coverage TBD in next scenario batch. |
| WT-014#1 (AGENT_WORK_DIR inheritance) | ADDRESSED | dcd8c870 | Only `createSession` path; `wakeAgent` path still buggy (explicit deferral). |
| WT-016#1 (R18 fast-feedback tests) | ADDRESSED (weak) | d3b082c3 | 5 tests; R18.3b test is a placeholder. |
| WT-022#1 (AID_AUTH inheritance) | ADDRESSED | dcd8c870 | Same fix as WT-014#1. |

**P0s open or partially addressed:**
- SCEN-009 P0-003 (Delete Agents Too — noop by design; needs TRDD)
- SCEN-022 P0-001 (AID_AUTH — 2 curl calls, but full audit of every script TBD)
- WT-014/WT-022 in wake path (still buggy by explicit commit-body admission)
- SCEN-004 P0-004 (HELPERS in compact view)
- WT-016 R18.3b placeholder (no real assertion, just signature check)

---

## Section 3: Regressions / concerns

### 3.1 ChangeTeam silently treats internal ChangeTitle failure as success

**Severity: HIGH — contradicts the stated invariant of 8199b617.**

File: `services/element-management-service.ts` lines 3262-3267 (G04d, team removal) and 3311-3316 (G07, team add).

```typescript
// G07: Set title
const titleResult = await ChangeTitle(agentId, effectiveRole, { authContext })
if (!titleResult.success) {
  ops.push(`G07: WARN — ChangeTitle to ${effectiveRole} failed: ${titleResult.error}`)
} else {
  ops.push(`G07: Title set to ${effectiveRole.toUpperCase()}`)
}
// PG01: Set agent's team field in registry
await updateAgent(agentId, { team: targetTeam.name })
ops.push(`PG01: Set agent team field to "${targetTeam.name}" in registry`)

result.restartNeeded = titleResult.restartNeeded
result.success = true  // ← UNCONDITIONAL SUCCESS
```

The commit 8199b617 explicitly stated: *"Gate22: verification mismatch is now a hard failure (result.error + return) instead of a silent WARN, guaranteeing a claimed success actually corresponds to a persisted governanceTitle."*

This guarantee is kept INSIDE ChangeTitle's G22, but the guarantee is LOST in ChangeTeam's callers: if ChangeTitle fails inside ChangeTeam, ChangeTeam still returns `success: true` while writing only `team` to the registry. The agent ends up in the team with stale governanceTitle. This was the exact scenario the fix was supposed to eliminate.

The CreateAgent G07b path (line 5080-5099) DOES handle this correctly with a rollback, but only when `desired.governanceTitle && desired.governanceTitle !== 'autonomous'`. If CreateAgent is called without `desired.governanceTitle` (e.g. adding a member to an existing team), the ChangeTeam→ChangeTitle path is the ONLY title write and its failure is silent.

**Recommended fix**: in ChangeTeam, if `titleResult.success === false`, set `result.error = titleResult.error` and `result.success = false` and return BEFORE the team-field write. Mirrors what G22 does inside ChangeTitle.

### 3.2 Stale comment in CreateAgent G07b

**Severity: LOW — documentation drift, no behavioral bug.**

File: `services/element-management-service.ts:5074-5079`

```typescript
// G07b: ChangeTeam tries to auto-assign "member" title, but that internal
// ChangeTitle call lacks authContext and FAILS silently at Gate 0.
// ALWAYS re-apply the requested title after team join (including 'member')
// to guarantee governanceTitle is persisted to the registry.
```

Commit 8199b617 explicitly FIXED this — ChangeTeam now receives `authContext` from CreateAgent and propagates it to ChangeTitle. The comment is now describing the OLD bug as if it still exists. The defensive retry in G07b is still useful as belt-and-braces (and does guard against the concern in 3.1 above), but the comment should be updated to reflect that it is defense-in-depth, not a workaround for a live bug.

### 3.3 ChangeMarketplace has no IBCT scope check

**Severity: MEDIUM — defense-in-depth gap.**

File: `services/element-management-service.ts:2649-2716`

```typescript
export async function ChangeMarketplace(desired: {
  action: 'add' | 'remove' | 'update'
  name: string
  source?: { repo: string } | { path: string }
}, authContext?: AuthContext): Promise<ChangeResult> {
  // G01, G02, G03… but NO G00 IBCT check
}
```

Every other Change* function (ChangeTitle, ChangePlugin, ChangeTeam, DeleteTeam, CreateAgent) starts with `G00/G0b: IBCT scope enforcement`. ChangeMarketplace accepts `authContext` but never calls `checkIbctScope()`. The guardrail is purely at the route layer via `enforceSystemOwner`.

**Recommended fix**: add G00 IBCT scope check at the top of ChangeMarketplace, matching the pattern in ChangePlugin.

### 3.4 HELPERS group comment contradicts implementation

**Severity: LOW — functional gap + doc mismatch.**

File: `components/AgentList.tsx:904-909`

```tsx
/* WT-004#3: permanent HELPERS section pinned to the top of the
    sidebar. The Haephestos card is NOT a real agent — it's a
    shortcut to the embedded role-plugin creation helper. Always
    visible regardless of viewMode filter so users can always
    find the forge. */
```

The comment claims "Always visible regardless of viewMode filter", but the JSX containing HELPERS is inside the `viewMode === 'normal'` branch (line 901). `viewMode === 'compact'` path (further below in the same function) does NOT render HELPERS. Users who have switched to compact view will not see the Haephestos card.

**Recommended fix**: either move the HELPERS block outside both branches (before `{Object.entries(teamGroupedAgents)...}`) OR update the comment to say "Visible in normal view only". The former is preferable.

### 3.5 Within-batch contradictory semantics (R20.26 + composition check)

**Severity: MEDIUM — confusing git history.**

Two cases of within-batch flip:

1. **R20.26 rule**: 446f544a said "converter suffixes on collision, never overwrites names". 3ac53073 reversed to "overwrite, never rename or suffix". This is the SAME batch by the SAME author on the SAME file within the same day. Final state is "overwrite" and both docs and code match that final state, but the batch contains 4 commits (446f544a, 3ac53073, a1dcf287, 54291380) repeatedly adjusting the same rule. A future reader diffing 446f544a alone would draw the wrong conclusion.

2. **R12 composition check**: 2b8d1158 implemented `useEffect`+`fetch /api/teams/{id}/composition-check`. 63c6f95f deleted that implementation and replaced it with pure local computation via `checkTeamComposition(team, agents)`. Again, same batch. Net effect: the server endpoint is unused for this purpose (but still exists). Similar concern: diffing 2b8d1158 alone suggests a server-fetch approach that was actually reverted within the batch.

Both are technically fine since the tip state is correct, but the intermediate commits are misleading as standalone references.

### 3.6 R18.3b placeholder test has no real assertion

**Severity: MEDIUM — stated test coverage doesn't exist.**

File: `tests/integration/change-client-matrix.test.ts` test `R18.3b placeholder: X → Claude with no canonical source must refuse`:

```typescript
it('R18.3b placeholder: X → Claude with no canonical source must refuse', async () => {
  // Aim: lock in the R18.3b invariant at a structural level. …
  // For now, we assert the signature + the documented invariant via
  // the CLAUDE.md reference.
  const { ChangeClient } = await import('@/services/element-management-service')
  expect(typeof ChangeClient).toBe('function')
  expect(ChangeClient.length).toBeGreaterThanOrEqual(2)
})
```

This only tests that `ChangeClient` exists as a function with ≥2 parameters. It does NOT test the R18.3b invariant (X→Claude with no canonical source refuses). The comment acknowledges this: "expanded in a follow-up".

**Recommended fix**: either mark the test `.skip()` with a `// TODO(R18.3b)` link to a TRDD, OR implement the full test with proper mocks on `findNativePluginForClient`.

### 3.7 No unit test for governanceTitle persistence fix (8199b617)

**Severity: MEDIUM — P0 fix lacks fast-feedback test.**

The largest fix in the batch (8199b617) addresses 3 P0s (SCEN-007 P0-003, SCEN-010 P0-001, SCEN-020a BUG-001). It modifies:
- ChangeTitle.G22 (WARN → FAIL)
- ChangeTeam signature (`_authContext` → `authContext`)
- ChangeTeam G04d + G07 (pass authContext through)
- ChangeTeam G07 effectiveRole lowercase
- CreateAgent G07 (pass desired.authContext)

The EMS test file `tests/services/element-management-service.test.ts` (1296 lines) does NOT cover ChangeTitle, ChangeTeam, or CreateAgent. Only `ChangePlugin` is tested at that granularity. There is no fast-feedback test of the governanceTitle persistence behavior; the only verification path is SCEN-024 (scenario-level, 10+ min).

**Recommended fix**: add a vitest suite for ChangeTitle.G22 + ChangeTeam.G07 + CreateAgent.G07 that mocks agent-registry and verifies:
- ChangeTitle.G22 returns `success: false` on registry mismatch
- ChangeTeam passes `authContext` through to ChangeTitle
- CreateAgent passes `desired.authContext` to ChangeTeam

### 3.8 No unit test for DeleteTeam team-scoped-title gate

**Severity: MEDIUM — P0 fix lacks fast-feedback test.**

4413648e adds a TEAM_SCOPED_TITLES allowlist to DeleteTeam G03. No unit test asserts that a MANAGER-bootstrap agent is NOT reverted on team delete. SCEN-024 covers the normal COS revert path but not the MANAGER protection path.

**Recommended fix**: add a test for DeleteTeam where the team contains an agent with `governanceTitle: 'manager'`, assert the title is preserved.

### 3.9 wakeAgent retains the AGENT_WORK_DIR race bug

**Severity: HIGH — known gap, explicit deferral.**

dcd8c870 commit body: *"The wake path in agents-core-service has the same bug but uses a different (shell-export) anti-pattern and is out of scope for this PR per the task prompt."*

This means: **agents woken via the wake API (as opposed to the `createSession` API) still have the AGENT_WORK_DIR empty race**. This is the more common path (sidebar wake button, auto-wake on title change, wake from terminal command).

**Recommended fix**: port the `env?: Record<string, string>` parameter pattern to the wake path in `services/agents-core-service.ts::wakeAgent`. Track in a TRDD.

### 3.10 _authContext underscore prefix audit

**Severity: LOW — not a bug, but audit flag.**

Several Change* functions keep `_authContext?: AuthContext` as an explicitly-unused parameter:
- ChangeAgentDef (line 2917)
- ChangeCommand (2925)
- ChangeRule (2933)
- ChangeOutputStyle (2941)
- ChangeMCP (2956)
- ChangeLSP (3013)

This is legitimate (marker for "future IBCT scope check"). But given 8199b617 unified the ChangeTeam pattern to use `authContext`, these should probably follow suit with at least a `// TODO: add G00 IBCT scope check` comment to make the gap explicit rather than hidden.

---

## Section 4: Recommended follow-up

### Priority 1 (blocks further stability work)

1. **Fix ChangeTeam silent-success on ChangeTitle failure** (Section 3.1). This directly contradicts the invariant of 8199b617. One-line fix + unit test. Without this, SCEN-007/010/020 P0s can re-surface under edge cases.

2. **Port env-var atomicity fix to wakeAgent** (Section 3.9). Wake path is the primary path for agent startup; AGENT_WORK_DIR race is still real there. Requires a TRDD because the wake path uses a different anti-pattern (shell export).

3. **Add ChangeMarketplace IBCT scope check** (Section 3.3). Five-line defense-in-depth addition.

### Priority 2 (test gap closure)

4. **Add unit tests for ChangeTitle.G22, ChangeTeam, CreateAgent** (Section 3.7). These are the most critical Change* functions and have ZERO unit coverage. The integration tests `change-client-matrix.test.ts` and `haephestos-pipeline.test.ts` are good examples of the mocking pattern.

5. **Implement the R18.3b test body** (Section 3.6). The placeholder locks in the signature but not the invariant. A real test with `vi.mock('@/services/plugin-storage-service')` and verifying the refusal path is straightforward.

6. **Add DeleteTeam team-scoped-title gate test** (Section 3.8). Complements the existing SCEN-024 scenario with a fast-feedback unit test.

### Priority 3 (UI/UX polish)

7. **Move HELPERS group out of the normal-view branch** (Section 3.4). Either hoist the block or update the comment.

8. **Fix stale comment in CreateAgent G07b** (Section 3.2). Update the comment to reflect current state (authContext IS propagated; G07b is belt-and-braces).

9. **Resolve SCEN-009 P0-003 cascade-delete tension via TRDD**. The "opposing forces" note in 5cd45c5a is correct but the TRDD is not yet filed.

### Priority 4 (infrastructure hygiene)

10. **Squash or annotate the R20.26 commit chain (446f544a → 3ac53073 → a1dcf287 → 54291380)** (Section 3.5). Four commits back-and-forth on the same rule is confusing in isolation. A future rebase to a single "feat(r20): R20.26 overwrite-on-collision" commit would clean up git history.

11. **Squash the composition-check flip (2b8d1158 → 63c6f95f)** (Section 3.5). Same concern. The server-fetch code in 2b8d1158 is dead code from birth since 63c6f95f removed it.

12. **Complete SCEN-022 AID_AUTH audit across all scripts** (partial coverage from 5cd45c5a). Survey every `curl /api/*` call in `scripts/**/*.sh` and ensure each has the `Authorization: Bearer $AID_AUTH` guard.

13. **Open a TRDD for adding IBCT scope checks to ChangeAgentDef/Command/Rule/OutputStyle/MCP/LSP** (Section 3.10). The underscore prefix signals the intent is deliberate but uncommitted; either commit to adding the gates or to the decision that they don't need one.

### Priority 5 (docs only)

14. Draft the `CONSOLIDATED_PROPOSALS_2026-04-16.md` file retroactively (per Rule 13 of `SCENARIOS_TESTS_RULES.md`). The overnight cron was supposed to emit it; it is missing. Reconstructing it from the scenario_proposed-improvements files + commit messages is ~2 hours of work but closes the audit-trail gap.

---

## Appendix: verification approach

This audit was performed entirely on the feature branch via `git show` without building or running tests. For each commit:

1. Read full commit message + stat
2. For code commits < 500 LOC: read full diff
3. For code commits > 500 LOC: read structural diff (added/removed import lines, modified function signatures, new gate blocks)
4. For test commits: read test bodies to verify they are real tests (not stubs)
5. Spot-checked the final state of `services/element-management-service.ts` at HEAD by writing it to `/tmp/ems.ts` and grepping for gate numbers, authContext references, _authContext references, and IBCT checks

No build (`yarn build`), no `yarn test`, no `yarn tsc --noEmit` was run — only static analysis. Commits self-claim `tsc --noEmit` passes; this was NOT independently verified.

---

**End of audit.**
