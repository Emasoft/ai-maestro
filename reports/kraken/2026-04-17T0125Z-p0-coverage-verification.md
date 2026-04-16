# P0 Fix Coverage Verification — feature/team-governance — 2026-04-17

**Verifier:** Kraken (read-only)
**Scope:** `fork/feature/team-governance` HEAD = `fcba63c3` (post-audit)
**Range checked:** `6eee4e4e..fork/feature/team-governance` (732 commits)
**Proposals source:** local `tests/scenarios/reports/CONSOLIDATED_PROPOSALS_2026-04-16.md` (249 lines, not yet git-tracked on the branch)
**Prior audit:** `docs_dev/feature-team-governance-audit-2026-04-17.md` (committed as `fcba63c3`, covers last 23 commits only)

---

## Totals

- **Total P0s in consolidated file:** 59 (52 overnight + 7 Apr 15 refresh)
- **Approved (`[x]`) in consolidated file:** 57
- **P0s that map to a commit on this branch:** 52
- **P0s verified (real, in-place fix):** 46
- **P0s with regression test coverage:** 9 (integration-level) + 3 (new scenarios SCEN-023/024)
- **P0s OPEN or partial:** 11
- **P0s superseded by design change:** 2

---

## Coverage table — Section A (overnight batch SCEN-001..022)

| P0 ID | Title | Status | Commit SHA | Test file | Concerns |
|-------|-------|--------|-----------|-----------|----------|
| SCEN-001 P0-001 | Commit & ship authContext fixes | ADDRESSED (no test) | 422eea78 (root BYPASS-1 fix) + a893721e (overnight checkpoint) | none | Structural authContext refactor landed cross-cut; no unit test for gate0Auth mandatory enforcement |
| SCEN-001 P0-002 | Fail loudly when ChangeTitle called without authContext | ADDRESSED (no test) | 422eea78 | none | gate0Auth now throws instead of silent allow; covered only by integration via SCEN-001 scenario |
| SCEN-002 P0-001 | DeleteTeam title persistence to registry.json | PREVIOUSLY FIXED | G22 verification gate (pre-batch) | none | 4413648e commit body confirms "already fixed" |
| SCEN-002 P0-002 | DeleteTeam does not uninstall role-plugins during title revert | ADDRESSED (no test) | 13847a30 (G14c added) | none | G14c role-plugin uninstall added between G14b and G15. G15 legacy uninstallAllRolePlugins still runs as belt-and-braces |
| SCEN-002 P0-003 | UI Agent Delete does not persist to registry.json | ADDRESSED (no test) | 4413648e | none | DeleteAgentDialog always passes hard=true; API DELETE /api/agents/[id] no longer soft-deletes from dialog |
| SCEN-003 P0-001 | Client name normalization missing in getPluginsForTitle | ADDRESSED (no test) | a893721e | none | CLIENT_ALIAS_MAP added at services/role-plugin-service.ts:818-825; short/canonical mapping works |
| SCEN-003 P0-002 | CreateAgent G06 ChangeTitle runs before G07 ChangeTeam | ADDRESSED (no test) | a893721e (titleNeedsTeamFirst defer) + 8199b617 (G07b re-apply) | none | titleNeedsTeamFirst defers G06 when title requires team. G07b re-applies title post-team-join to fix registry |
| SCEN-004 P0-001 | Fallback bootstrap when ?agent=haephestos finds no agent | FIXED IN RUN | (integrated in app/page.tsx via overnight checkpoint) | none | Marked FIXED IN RUN in proposal; no explicit commit trace |
| SCEN-004 P0-002 | Watchdog kills Haephestos within 2 min | ADDRESSED | f580a8fc | 8c7ec833 (haephestos-pipeline.test.ts) | WATCHDOG_TIMEOUT_MS 2min → 30min. 15x increase, trade-off documented |
| SCEN-004 P0-003 | Run smoke test for Haephestos pipeline in CI | ADDRESSED | 8c7ec833 | tests/integration/haephestos-pipeline.test.ts (383 LOC) | Real tests exercising actual route code with in-memory fs |
| SCEN-004 P0-004 | Restore HELPERS sidebar group with permanent Haephestos card | PARTIAL | e5775c7d | none | Only rendered when `viewMode === 'normal'`; compact view missing. Prior audit section 3.4 flagged this |
| SCEN-005 P0-001 | Verify BUG-002 DeleteTeam authContext fix end-to-end | PREVIOUSLY FIXED | pre-batch (lines 3997-3999 of EMS) | 0053c73c (SCEN-024 scenario) | Cited in 4413648e commit body; SCEN-024 is the regression scenario |
| SCEN-005 P0-002 | Add regression scenario SCEN-NNN to lock-in BUG-002 | ADDRESSED | 0053c73c | SCEN-024_delete-team-revert-cos.scen.md (254 lines) | New scenario-level test; no fast-feedback unit test |
| SCEN-005 P0-003 | Restore Phase 7: Kanban access for normal teams | SUPERSEDED | f0f9b6aa (team meetings removed entirely) | N/A | Design change — team meetings removed, kanban access deferred to future UI |
| SCEN-006 P0-001 | CCC-1: Auto-convert role-plugin during agent creation | ADDRESSED (no test) | 8d60d336 (R18 priority chain) + 4f767149 (per-client adapter) | d3b082c3 (R18 decision matrix, weak) | Two-commit fix; R18.3b placeholder in matrix test has NO real assertion |
| SCEN-006 P0-002 | DT-1: DeleteTeam must not strip standalone-only titles | ADDRESSED (no test) | 4413648e | 0053c73c (SCEN-024) | TEAM_SCOPED_TITLES allowlist whitelisted; MANAGER/MAINTAINER protected |
| SCEN-007 P0-001 | CreateAgent does not invoke cross-client conversion | ADDRESSED | 8d60d336 + 4f767149 | d3b082c3 (partial) | R18 priority chain + per-client adapter routing. Tested by R18 matrix (with placeholder gap) |
| SCEN-007 P0-002 | DeleteTeam strips MANAGER/MAINTAINER when in agentIds | ADDRESSED | 4413648e | 0053c73c | TEAM_SCOPED_TITLES excludes manager/maintainer |
| SCEN-007 P0-003 | CreateAgent G06/G07 ordering causes governanceTitle null | ADDRESSED | 8199b617 | none | authContext propagation + G07b defensive retry. Prior audit §3.1 flags a HIGH concern: ChangeTeam still sets result.success=true on internal ChangeTitle failure |
| SCEN-008 P0-001 | Plugin-pipeline client-capability gates | FIXED IN RUN | a893721e (overnight checkpoint includes gate) | none | G11 gate skips agents where client has no plugin support. Confirmed in EMS line 5248 |
| SCEN-009 P0-001 | CreateAgent install role-plugin for Claude team MEMBERs | ADDRESSED (no test) | e6afb515 (auto-install on title) + 8199b617 (G07b re-apply) + 4f767149 (adapter routing) | none | RECURRING. Multiple commits cover the path. Verified via EMS G11+G07b structure |
| SCEN-009 P0-002 | Clear team: field on former team members during DeleteTeam | ADDRESSED | 4413648e | 0053c73c | updateAgent call inside DeleteTeam G03 clears legacy team field |
| SCEN-009 P0-003 | Add "Delete Agents Too" checkbox to Delete Team dialog | OPEN (intentional noop) | 5cd45c5a (noop with rationale) | none | Commit body: backend DeleteTeam pipeline refuses cascade-delete per governance design. UI checkbox would mislead users. Needs TRDD |
| SCEN-009 P0-004 | MANAGER skill needs "when to escalate to user" guidance | ADDRESSED (docs) | 7b345b3e | none | Docs-only commit. Deliverable for role-plugin's own repo |
| SCEN-010 P0-001 | ChangeTitle must store "member" literally when picking MEMBER | ADDRESSED | 8199b617 | none | G22 verification hard-fail + effectiveRole lowercase + authContext propagation |
| SCEN-010 P0-002 | Title Assignment Dialog must compare against registry, not display | ADDRESSED (no test) | 2b8d1158 | none | storedTitle fetch + comparison. UI component only |
| SCEN-010 P0-003 | Add R12 warning badge to team cards in sidebar | ADDRESSED (no test) | 2b8d1158 → 63c6f95f (within-batch flip) | none | Server-fetch approach in 2b8d1158 replaced with local compute in 63c6f95f. Net effect: local-only, server endpoint unused. Prior audit §3.5 flags confusing within-batch oscillation |
| SCEN-012 P0-001 | Delete Agent "Also delete agent folder" checkbox propagation | ADDRESSED | bf9eff21 (batch delete fix) + 4413648e (hard=true always) | none | fs.rm with recursive+force handles .git subdirs on POSIX. Current EMS implementation (line 4571-4595) sandbox-checks before rm |
| SCEN-013 P0-001 | Fix CreateAgent cross-client plugin install path | ADDRESSED | 4f767149 + 8d60d336 | d3b082c3 (R18 matrix) | Per-client adapter routing at top of InstallElement install/uninstall EXE |
| SCEN-013 P0-002 | Rewrite SCEN-013 phases 4 and 6 for wake gate test | ADDRESSED | 224969aa (Phase C SCEN-008..015 alignment, includes SCEN-013 rewrite) | N/A | Scenario-level change |
| SCEN-014 P0-001 | Chat service must hydrate sessions live | PREVIOUSLY FIXED | pre-batch + ccd9939f | none | Marked "ALREADY FIXED" in proposal; ccd9939f added MobileDashboard overlays but the hydration was upstream |
| SCEN-014 P0-002 | Wizard agents cannot Bash/Write/Edit due to env race | ADDRESSED | dcd8c870 | none | createSession now passes env atomically via tmux new-session -e. Prior audit §3.9 flags wakeAgent path still buggy (deferred) |
| SCEN-015 P0-001 | UUID/name directory drift in AMP per-agent home | ADDRESSED (no unit test) | a893721e (BUG-015-01 + BUG-015-02 in amp-inbox-writer) | 2b0de8f2 (SCEN-015 integration scenario) | initAgentAMPHome runs autoMigrateToUUID before each write |
| SCEN-015 P0-002 | Attachment field stripped + file blobs never delivered | ADDRESSED | a893721e | 2b0de8f2 | Attachments preserved in payload; blobs copied from sender to recipient dirs |
| SCEN-015 P0-003 | Summary of P0/P1/P2/P3 (meta-proposal) | N/A | meta-only | N/A | Organizational item, no code change needed |
| SCEN-016 P0-001 | Add unit test coverage for ChangeClient | ADDRESSED (weak) | d3b082c3 | change-client-matrix.test.ts (168 LOC, 5 tests) | R18.3b test is a placeholder that only checks typeof ChangeClient === 'function'. Does NOT verify refusal path. Prior audit §3.6 |
| SCEN-017 P0-001 | Route /api/settings/marketplaces POST through pipeline | ADDRESSED | a2f90e0e | e10dca17 (create/delete-marketplace-pipeline.test.ts) | Thin wrappers; ChangeMarketplace lacks G00 IBCT scope check per prior audit §3.3 |
| SCEN-017 P0-002 | CreateMarketplace/DeleteMarketplace first-class pipelines | ADDRESSED | a2f90e0e | e10dca17 | New named entry points for each action |
| SCEN-017 P0-003 | Rule 10 scan: audit every UI surface that touches R17 | ADDRESSED | 7b345b3e (audit) + 98277c4d (SCEN-023 scenario) | SCEN-023_r17-ui-disable-protection.scen.md | Docs audit + new scenario-level test |
| SCEN-018 P0-001 | Umbrella header (P0-002..005 below are concrete items) | N/A | header only | N/A | Not a real item |
| SCEN-018 P0-002 | AgentProfile.tsx must display githubRepo for MAINTAINER | FIXED IN RUN | a893721e (overnight checkpoint) + 7604812c (UI) | none | githubRepo visible in Profile panel via GitBranch icon block |
| SCEN-018 P0-003 | CreateAgent install R17 core plugin on MAINTAINER | ADDRESSED (no unit test) | 5d46d8cc (R17 enforcement) + ad53db45 (MAINTAINER types) + 4f767149 (adapter routing) | 8c7ec833 (haephestos-pipeline) | G11 runs unconditionally with workDir. MAINTAINER has workDir. G11 returns WARN on fail not hard-FAIL (prior audit §3.1 pattern) |
| SCEN-018 P0-004 | Wizard must not show "Your Agent is Ready!" on failure | ADDRESSED (no test) | 2fe9ef6f | none | Commit title labels this "P0-018-003" but maps to consolidated P0-004. creationError gate on Step 7 render |
| SCEN-018 P0-005 | "Also delete agent folder" checkbox must actually delete folder | PARTIAL (RECURRING) | 4413648e + bf9eff21 | none | Sandboxed fs.rm with force:true handles most cases. Prior audit notes this is 3rd scenario hit. .git subdirs work on POSIX but no dedicated test |
| SCEN-019 P0-001 | Plugin uninstall must always clean up cache dir | ADDRESSED | 8d60d336 | none | rm -rf hardened with prefix check. User-scope Claude only — local-scope silently skipped (documented) |
| SCEN-020 P0-001 | CreateAgent does not persist governanceTitle for team-required titles | ADDRESSED | 8199b617 | none | Same fix as SCEN-007 P0-003 / SCEN-010 P0-001 |
| SCEN-020 P0-002 | "uninstalld" typo in R17 error message | ADDRESSED | 5cd45c5a | none | Trivial typo fix — "uninstalld" → "uninstalled" via pastTense switch |
| SCEN-021 P0-001 | Stop local plugin install from stamping wrong marketplace | ADDRESSED | a2f90e0e | none | Same commit as SCEN-017 P0-002; MarketplacesTab passes real marketplace name on install |
| SCEN-021 P0-002 | Null-safety in MarketplacesTab filter (already fixed) | PREVIOUSLY FIXED | pre-batch (retained note) | none | Retained for record |
| SCEN-022 P0-001 | Agent CLI scripts never pass AID_AUTH to curl | PARTIAL | 5cd45c5a (2 calls fixed) + 1d066c40 (initial SCEN-006 AID auth) | none | Partial coverage — commit body notes 2 of N curl calls patched. Full script audit TBD |
| SCEN-022 P0-002 | AID_AUTH session env does not reach running Claude Code | PARTIAL | dcd8c870 (createSession path) | none | Only createSession fixed. wakeAgent path still buggy per explicit commit body note. Prior audit §3.9 |
| SCEN-022 P0-003 | "Also delete agent folder" ignored for folders with .git (RECURRING) | PARTIAL | 4413648e | none | fs.rm force:true handles .git on POSIX. No test verifies the .git case specifically |

## Coverage table — Section B (Apr 15 refresh / SCEN-020 protocol smoke)

| P0 ID | Title | Status | Commit SHA | Test file | Concerns |
|-------|-------|--------|-----------|-----------|----------|
| P0-PROTO-1 | Subagent write-guard false-positive on `cp SRC DST` | ADDRESSED | 08335f4e | test-subagent-write-guard.sh (new) | Split rule 4 into 4a (destination-only) and 4b (all-path). Test harness added |
| P0-PROTO-2 | Subagent write-guard false-positive on `/dev/null` redirect | ADDRESSED | 08335f4e | test-subagent-write-guard.sh | Same commit addresses all 3 protocol false positives |
| P0-PROTO-3 | Subagent write-guard false-positive on quoted regex literal | ADDRESSED | 08335f4e | test-subagent-write-guard.sh | Same commit |
| P0-AUTHORING-1 | S008/S011 use forbidden `curl -X DELETE` (Rule 6 violation) | ADDRESSED | 652b1c93 (Phase C SCEN-019..024 alignment) | N/A | Scenario-level fix |
| P0-AUTHORING-2 | MEMBER title requires team but scenario picks "No team" | ADDRESSED | 652b1c93 | N/A | Scenario authoring fix |

---

## Open items

### SCEN-005 P0-003 — Kanban access superseded

**Ask:** Restore Phase 7 kanban access for normal teams (no meeting).
**Status:** Commit `f0f9b6aa` explicitly removed team meetings AND the kanban tab. Design change superseded this request.
**Recommended next action:** Close as won't-fix OR file a new design note for a standalone kanban panel if still desired. The consolidated file still has `[x]` marked — if the user still wants kanban access, a new proposal is needed.

### SCEN-009 P0-003 — Delete Agents Too checkbox

**Ask:** Add checkbox to the Delete Team dialog.
**Status:** OPEN by design. Commit `5cd45c5a` is an explicit noop with rationale: backend DeleteTeam pipeline refuses cascade-delete per governance design (CoS must recreate agents, not delete them), so a UI checkbox would mislead.
**Recommended next action:** File a TRDD to resolve the "opposing forces" tension: either relax governance design to allow cascade or document that the checkbox is permanently unnecessary. Prior audit §5 priority 3 calls this out.

### SCEN-004 P0-004 — HELPERS compact view

**Ask:** Permanent HELPERS sidebar group with Haephestos card.
**Status:** PARTIAL. Only rendered when `viewMode === 'normal'`. Compact view has NO HELPERS card. The comment in `components/AgentList.tsx:904` claims "Always visible regardless of viewMode filter" but that is false.
**Recommended next action:** Move HELPERS block out of the `viewMode === 'normal'` branch (hoist before the main tree). Trivial 3-line fix. Prior audit §3.4.

### SCEN-022 P0-002 — AID_AUTH wakeAgent path

**Ask:** AID_AUTH session env must reach already-running Claude Code process.
**Status:** PARTIAL. `services/sessions-service.ts::createSession` is fixed via `dcd8c870`. But `services/agents-core-service.ts::wakeAgent` uses a different (shell-export) anti-pattern and is still buggy. Commit body explicitly defers it.
**Recommended next action:** Port the `env?: Record<string, string>` parameter pattern to wakeAgent. Requires a TRDD since wake path is the primary path for agent startup. Prior audit §3.9.

### SCEN-022 P0-001 — AID_AUTH script audit

**Ask:** Agent CLI scripts never pass AID_AUTH to curl (FIXED in-run but needs commit + install-pipe audit).
**Status:** PARTIAL. Two call sites patched in `5cd45c5a`. Full audit of every `curl /api/*` call across `scripts/**/*.sh` not yet done.
**Recommended next action:** Survey every curl invocation in scripts/ and ensure each has `Authorization: Bearer $AID_AUTH`. Prior audit §5 priority 4 calls for this.

### SCEN-022 P0-003 — .git folder deletion

**Ask:** "Also delete agent folder" checkbox ignored for folders containing `.git`.
**Status:** PARTIAL. Current `fs.rm(resolvedDir, { recursive: true, force: true })` handles `.git` dirs correctly on POSIX. However no regression test asserts the `.git` case specifically, and the issue appears recurring across SCEN-012, SCEN-018, SCEN-022.
**Recommended next action:** Add a dedicated test that creates an agent folder with a `.git` subdir, runs DeleteAgent with `deleteFolder: true`, and verifies the folder is removed.

### SCEN-015 P0-001/P0-002 — no unit test

**Ask:** UUID/name drift + attachment stripping (both ADDRESSED in code).
**Status:** Code fix in `a893721e`. Covered by scenario SCEN-015 (integration-level). No unit test for `initAgentAMPHome` or attachment blob-copy.
**Recommended next action:** Add a vitest suite for `lib/amp-inbox-writer.ts::writeToAMPInbox` covering (a) name→UUID migration, (b) attachment preservation, (c) blob copy on local delivery.

### SCEN-003 P0-001/P0-002 — no unit test

**Ask:** Client normalization + G06/G07 ordering.
**Status:** Both ADDRESSED in `a893721e` + `8199b617`. No unit test for `getPluginsForTitle` or CreateAgent's `titleNeedsTeamFirst` detection.
**Recommended next action:** Add unit tests for `getPluginsForTitle` (CLIENT_ALIAS_MAP correctness) and CreateAgent (title-requires-team defer path).

### SCEN-007 P0-003 / SCEN-010 P0-001 / SCEN-020 P0-001 — ChangeTeam silent success

**Ask:** governanceTitle must persist for team-required titles.
**Status:** ADDRESSED via `8199b617`. BUT: prior audit §3.1 flagged a HIGH-severity leftover — `ChangeTeam` G07 and G04d still `WARN and continue` on internal `ChangeTitle` failure with `result.success = true`. The commit fixes ChangeTitle.G22 and passes authContext through, but the ChangeTeam caller doesn't propagate ChangeTitle failure to its own return value.
**Recommended next action:** 1-line fix: if `titleResult.success === false`, set `result.error = titleResult.error` and `result.success = false` and return early in ChangeTeam. Add a unit test for ChangeTeam that mocks ChangeTitle to fail and asserts ChangeTeam returns `success: false`.

### SCEN-006 P0-001 / SCEN-016 P0-001 — R18 test placeholder

**Ask:** Unit test coverage for ChangeClient on every client target.
**Status:** `d3b082c3` added `tests/integration/change-client-matrix.test.ts` (168 LOC, 5 tests). BUT: the critical R18.3b test is a placeholder that only checks `typeof ChangeClient === 'function'` and `ChangeClient.length >= 2`. It does NOT verify the refusal path of X→Claude without canonical source. Prior audit §3.6.
**Recommended next action:** Implement the R18.3b test body with `vi.mock('@/services/plugin-storage-service')` and verify the refusal path.

### SCEN-018 P0-003 — MAINTAINER core plugin install no hard-fail

**Ask:** CreateAgent pipeline must install R17 core plugin on MAINTAINER agents.
**Status:** ADDRESSED via G11 running unconditionally. BUT: G11 uses `ops.push('G11: WARN — ...')` on install failure instead of hard-failing CreateAgent. This is the same "soft success" pattern the prior audit (§3.1) flagged.
**Recommended next action:** Consider promoting G11 install failure to hard-fail CreateAgent when MAINTAINER is the target title (R17.17 is critical for MAINTAINER's reporting chain).

### SCEN-001 P0-001/P0-002 — no authContext regression test

**Ask:** Fail loudly when ChangeTitle called without authContext.
**Status:** ADDRESSED via `422eea78` (gate0Auth type change: AuthContext required, no longer optional). TypeScript enforces at compile time. No runtime test verifies the behavior.
**Recommended next action:** Add a unit test for `gate0Auth(undefined)` that expects a thrown error or rejected result.

---

## Missing test coverage (by P0)

| P0 | Missing test | Proposal |
|----|-------------|---------|
| SCEN-001 P0-001/P0-002 | gate0Auth mandatory runtime check | 1 unit test: `gate0Auth(undefined)` throws |
| SCEN-002 P0-002 | G14c role-plugin uninstall on title release | 1 unit test: ChangeTitle(autonomous→manager) then back; assert role-plugin install/uninstall ops in sequence |
| SCEN-003 P0-001 | CLIENT_ALIAS_MAP normalization | 1 unit test: `getPluginsForTitle('MEMBER', 'claude')` === `getPluginsForTitle('MEMBER', 'claude-code')` |
| SCEN-003 P0-002 | titleNeedsTeamFirst defer | 1 unit test: CreateAgent with member+team, assert G06 DEFER then G07b apply |
| SCEN-007 P0-003 | ChangeTeam propagates ChangeTitle failure (PRIOR AUDIT §3.1) | 1 unit test: mock ChangeTitle to fail, expect ChangeTeam to return success: false |
| SCEN-009 P0-002 | Clear team: field on former team members | 1 unit test: DeleteTeam then verify updateAgent({team: ''}) called for each |
| SCEN-015 P0-001 | Name→UUID migration | 1 unit test: writeToAMPInbox to agent with name-keyed dir; assert auto-migrated to UUID |
| SCEN-015 P0-002 | Attachment blob copy | 1 unit test: writeToAMPInbox with attachments; assert blobs copied to recipient |
| SCEN-016 P0-001 | R18.3b invariant (X→Claude refuse) | Replace placeholder with real test using vi.mock of plugin-storage-service |
| SCEN-018 P0-003 | R17 core plugin landed on MAINTAINER | 1 unit test: CreateAgent(maintainer); assert settings.local.json has ai-maestro-plugin |
| SCEN-018 P0-005 | .git subdir in agent folder | 1 e2e test: create folder with .git subdir; DeleteAgent(deleteFolder:true); assert folder gone |
| SCEN-022 P0-002 | AID_AUTH inheritance (wakeAgent path) | 1 unit test: mock tmux runtime; assert env passed to wakeAgent's new-session call |

---

## Concerns flagged during verification

### 1. Commit numbering mismatch — SCEN-018 P0-003 vs P0-004

Commit `2fe9ef6f` has the subject `fix(wizard): P0-018-003 — hide celebration on creation failure (SCEN-018)`. This matches SCEN-018 **P0-004** in the consolidated file, not P0-003. The offset is one because the consolidated file treats the umbrella header as P0-001 (itself a header), shifting the real items by one. Future commits should reference the consolidated file's IDs, not the proposal-file's internal IDs.

### 2. Within-batch oscillation — R12 composition badge

Commit `2b8d1158` implemented a server-fetch approach for the R12 composition warning badge. Commit `63c6f95f` (same day, same author) REMOVED that code and replaced it with pure local computation via `checkTeamComposition()`. The net state is correct but the intermediate commit 2b8d1158 now contains dead-from-birth code. Prior audit §3.5 called this out. No functional bug, but confusing for future readers looking at individual commits.

### 3. Within-batch oscillation — R20.26 rule flip

Commits `446f544a` → `3ac53073` → `a1dcf287` → `54291380` repeatedly adjusted the R20.26 collision-handling rule within the same batch. `446f544a` said "converter suffixes on collision, never overwrites". `3ac53073` reversed to "overwrite, never rename or suffix". Final state is "overwrite". Same concern as above — misleading in isolation. Prior audit §3.5.

### 4. ChangeMarketplace lacks G00 IBCT scope check

`services/element-management-service.ts::ChangeMarketplace` (line 2649-2716) accepts `authContext` but never calls `checkIbctScope()`. Every other Change* function (ChangeTitle, ChangePlugin, ChangeTeam, DeleteTeam, CreateAgent) starts with `G00/G0b: IBCT scope enforcement`. The marketplace routes route through `ChangeMarketplace` (via SCEN-017 P0-001 fix `a2f90e0e`), meaning marketplace operations bypass the IBCT scope gate. This is guarded only at the route layer via `enforceSystemOwner`, which works but is defense-in-depth gap. Prior audit §3.3.

**Recommended fix:** add G00 IBCT scope check at the top of ChangeMarketplace matching ChangePlugin pattern.

### 5. Test file hygiene — `change-client-matrix.test.ts` R18.3b placeholder

The R18.3b "placeholder" test in `tests/integration/change-client-matrix.test.ts` only asserts `typeof ChangeClient === 'function'` and `ChangeClient.length >= 2`. It does NOT test the R18.3b invariant (X→Claude without canonical source must refuse). The comment in the test acknowledges this: "expanded in a follow-up". Either mark it `.skip()` with a TRDD link OR implement the full test. Prior audit §3.6.

### 6. Stale comment — CreateAgent G07b

`services/element-management-service.ts:5078-5081` has a comment saying "ChangeTeam tries to auto-assign 'member' title, but that internal ChangeTitle call lacks authContext and FAILS silently at Gate 0." Commit `8199b617` FIXED this (authContext is now passed through), making the comment describe a bug that no longer exists. The G07b defensive retry is still useful (it's the only thing catching the concern in §3.1 below), but the comment should say "defense-in-depth" not "workaround for a live bug". Prior audit §3.2.

### 7. Commit `a893721e` is a massive checkpoint with many P0s implicitly addressed

The "overnight checkpoint" commit bundles 21 source files with FIX-AS-YOU-GO patches from SCEN-001..022. Many individual P0s are only addressable by reading its diff, not its commit message. This makes post-hoc auditing harder. SCEN-003 P0-001/P0-002, SCEN-008 P0-001, SCEN-015 P0-001/P0-002, SCEN-018 P0-002 are all "in the checkpoint" without explicit labeling.

### 8. No direct verification of wakeAgent path env race

Prior audit §3.9 notes `wakeAgent` has the same env race as `createSession` but is NOT fixed in `dcd8c870`. This is HIGH severity because wake is the primary path for agent startup in Phase 1 (sidebar Start Session button, auto-wake on title change, wake from terminal command). No commit in the range addresses wakeAgent.

### 9. Consolidated file hash vs branch state

The consolidated proposals file `tests/scenarios/reports/CONSOLIDATED_PROPOSALS_2026-04-16.md` exists locally in the main repo working tree but is NOT committed on `fork/feature/team-governance`. Its fingerprint references commit `54291380` as the base, but the branch tip is now `fcba63c3`. This is the file my verification is based on, sourced from the main-repo working copy. Prior audit §5 priority 5 recommends reconstructing and committing this file; that has not happened yet.

### 10. Scenario reports are on the branch but the consolidated file is not

Individual `scenario_proposed-improvements_NNN_*.md` files ARE on the branch (4 visible in `git ls-tree` as of earlier check). The consolidated file aggregates them but was never committed. This explains why it's in the local working tree only.

---

## Summary judgment

- **46 of 57 approved P0s are verified as addressed with a real fix** on the branch.
- **11 P0s are partial, open-by-design, or superseded** — all have clear next actions.
- **12 P0s would benefit from fast-feedback unit tests** that don't currently exist.
- **Prior audit `fcba63c3`** already covered the last 23 commits with high-quality per-commit analysis. My verification extends that to the full 732-commit range and confirms the prior audit's conclusions are consistent with the wider commit history.
- **HIGH-severity concern** from prior audit §3.1 remains unresolved: `ChangeTeam` still treats internal `ChangeTitle` failure as success. This contradicts the stated invariant of `8199b617` and should be fixed in a follow-up commit.

---

**End of verification.**
