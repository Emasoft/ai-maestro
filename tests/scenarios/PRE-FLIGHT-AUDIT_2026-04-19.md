# Pre-Flight Audit for SCEN-001..023 Batch Run (2026-04-19)

Answers the 15-point checklist before kicking off the long unattended run.

## TL;DR

| # | Check | Status | Action needed |
|---|-------|--------|---------------|
| 1 | Janitor conflict with scenario runner | ✅ Mostly safe | Small optimization in #15 |
| 2 | Skills/agents updated to latest rules | ⚠ Mixed | Fix outdated procedure-details.md + user-scope skill |
| 3 | Scenario runner follows Rule 6 STICK-TO-UI | ✅ Enforced via write-guard hook | — |
| 4 | Reports saved to tests/scenarios/reports/ | ✅ Hard-coded path | — |
| 5 | dev-browser used (Rule 8) | ✅ scenario-runner mandates it | — |
| 6 | Sequential, not parallel | ✅ run-scenarios-batch is sequential | Don't use user-scope run-scenario-test (parallel default) |
| 7 | Both report + proposals saved | ✅ Phase G writes both | — |
| 8 | Fix-as-you-go (Rule 4) + 11th-HOUR waits approval (Rule 11) | ✅ Rule 4 immediate, Rule 11 deferred | — |
| 9 | Disk monitoring | ❌ Not implemented | **BLOCKER** — only 132GB free (93% full) |
| 10 | JPEG 97% screenshots | ✅ scenario-runner uses .jpg | Compress script exists as backup |
| 11 | Scenarios up-to-date with latest paths | ⚠ Needs per-scenario check | Sample SCEN-019/SCEN-020/SCEN-021 at minimum |
| 12 | GitHub test repos recycled | ❌ 2 stale from Apr 12 | Delete `scen018-test-repo-alpha/beta` first |
| 13 | Write-guard in place | ✅ Hook configured on both agents | — |
| 14 | Server rebuilt + restarted | ❌ pm2 shows v0.27.3, yesterday | **BLOCKER** — needs rebuild |
| 15 | Janitor-aware scenario runner | ⚠ Partial | Forked runner is isolated from parent heartbeat — safe |

---

## Q1 — Janitor hook/cron conflict with scenario run

**Hooks installed locally in ai-maestro:**
- Janitor plugin: `SessionStart` (prose reminder), `UserPromptSubmit` (idle-timer refresh), `Stop` (success clear), `StopFailure` (rate-limit flag)
- Project-scoped: `scenario-runner` + `scenario-improvement-implementer` PreToolUse write-guard hooks

**Janitor cron (`*/5 * * * *`) interaction:**
The heartbeat fires in the **parent session**, not in forked scenario-runner subagents. Scenario execution is NOT interrupted — the forked agent runs in its own context until verdict.

Between scenarios (in the batch conductor), heartbeat fires become short turns that just run `dispatch.sh`. Dispatch emits:
- `[dirty-tree]` if working tree has uncommitted work for >30 min — will fire during FIX-AS-YOU-GO since the runner edits source files. Mitigation: runner commits its fixes.
- `[stale-task]` if pending/in_progress tasks older than threshold — possible noise but harmless
- `[janitor-resume]` only if `rate-limited.flag` is set — useful for rate-limit auto-resume

**Verdict:** Safe. No blocking conflict. See Q15 for optimization.

## Q2 — Skills/agents updated to latest rules

**Project-scope (used by run-scenarios-batch) — `ai-maestro/.claude/`:**

- `agents/scenario-runner.md` ✅ uses dev-browser, PreToolUse write-guard, JPEG 97%, Rule 13 mentions
- `agents/scenario-improvement-implementer.md` ✅ worktree isolation, write-guard
- `skills/run-scenarios-batch/SKILL.md` ⚠ line 49 says "12 rules" (should be 13)
- `skills/run-scenarios-batch/references/procedure-details.md` ⚠ line 2-3 scenario-runner spawn prompt says "rules 1-12" and "Chrome CDP" — **outdated** (must say "rules 1-13" and "dev-browser CLI per Rule 8"). The runner itself overrides this, but the prompt shouldn't mislead.

**User-scope — `/Users/emanuelesabetta/.claude/skills/run-scenario-test/SKILL.md`:**
- ❌ **SEVERELY OUTDATED** — uses chrome-devtools MCP, .png screenshots, "12 rules". Defaults to PARALLEL execution ("launch ONE forked subagent per scenario in parallel").
- **Action:** do NOT trigger this skill. Use `/run-scenarios-batch 1-23` from the project-scope skill instead.

**Recent refactor (today's commits) not yet reflected anywhere:**
- `authContext` mandatory on all Change*/Delete* (commits `8265dc8b`, `b5d27678`, `314a0baf`). Scenarios that script ChangeTitle/ChangePlugin via API would have been broken by this if the API routes weren't also updated — but they were (included in b5d27678). tsc is clean project-wide.

## Q3 — Rule compliance

Rule 6 STICK-TO-UI is enforced by two layers:
1. The scenario-runner agent instructions (textually)
2. The PreToolUse write-guard hook blocks writes outside the worktree — hard backstop

The authoring-bug override (scenario-runner lines 167-169) forces the runner to fix forbidden `rm`/`curl -X POST`/etc. patterns in scenario files rather than executing them.

## Q4 — Report path

Hard-coded in scenario-runner Phase G. Writes:
- `tests/scenarios/reports/SCEN-NNN_<timestamp>.report.md`
- `tests/scenarios/reports/scenario_proposed-improvements_NNN_<timestamp>.md`

## Q5 — dev-browser usage

scenario-runner lines 37-51: loads `dev-browser:dev-browser` skill via Skill tool before any CLI call. Chrome DevTools MCP is explicitly deprecated.

## Q6 — Sequential vs parallel

`run-scenarios-batch` (project-scope) = **sequential** — procedure-details.md Step 3 is a for-loop.
`run-scenario-test` (user-scope) = **parallel** — says "launch ONE forked subagent per scenario in parallel".

**To run 1-23 sequentially, invoke:** `/run-scenarios-batch 1-23` (NOT /run-scenario-test with a range).

## Q7 — Both reports saved

scenario-runner Phase G writes both. Rule 11 is the primary deliverable (proposals file).

## Q8 — FIX-AS-YOU-GO immediate, 11th-HOUR deferred

- Phase D loops diagnose → fix → retry with no attempt cap, committing in-place on the current branch
- Phase G writes proposals to `scenario_proposed-improvements_*.md` but does NOT implement them
- `scenario-improvement-implementer` is ONLY spawned when the user passes `--improve` to run-scenarios-batch, and it runs in a worktree (merge-or-discard decision left to the user)

## Q9 — Disk monitoring — **BLOCKER**

**Current state (`df -h /Users/emanuelesabetta`):**
- 1.9 TB disk total, 132 GB free (**93% full**)
- `tests/scenarios/state-backups/` = **13 GB** (mostly 2 x 6.1 GB OVERNIGHT_* dirs from 2026-04-13)
- `tests/scenarios/screenshots/` = 316 MB
- `.next` build dir = 835 MB

**Risk:** a full 23-scenario overnight run produces ~100MB–500MB of screenshots + per-scenario state backups (~5MB each). On this disk, that's fine on its own, but the 12 GB of OVERNIGHT_* leftovers is a big pre-existing sinkhole.

**Recommendations:**
1. Before the run, delete the 2 OVERNIGHT_* state-backup dirs (recovery no longer needed, they're April 13 relics). Reclaims 12.2 GB → ~144 GB free. Deletion requires your explicit approval per CLAUDE.md RULE 0.
2. Add a pre-flight disk check to `run-scenarios-batch` Step 2: abort if free space < 10 GB.
3. Current Rule 10 auto-purge only kicks in on PASS verdicts. After a batch, manually review FAIL/PARTIAL screenshot dirs.

## Q10 — JPEG 97% screenshots

`scenario-runner.md:89` uses `.jpg` extension for screenshots. Rule 10 specifies JPEG 97%.
`tests/scenarios/scripts/compress-screenshots.sh` exists as a batch fallback if anything captures PNG.

## Q11 — Scenarios updated for recent path changes

**Known recent path changes** that scenarios should reflect:
- `~/agents/role-plugins/` vs `~/agents/custom-plugins/`
- Marketplaces renamed: `ai-maestro-local-roles-marketplace`, `ai-maestro-local-custom-marketplace`
- R20 disk migration (legacy layout → container+marketplace-<client>/)
- R18 X→Claude lossy conversion refused

**Scenarios to spot-check before batch:** SCEN-019 (marketplace lifecycle), SCEN-020 (core plugins), SCEN-021 (user-scope vs local-scope), SCEN-016 (R18 plugin continuity).

**Full audit:** 24 scenario files, not re-read here. FIX-AS-YOU-GO (Rule 4) will catch most drift during execution.

## Q12 — GitHub test repos — **action required**

**Currently on fork:**
- `scen018-test-repo-alpha` (created 2026-04-12)
- `scen018-test-repo-beta` (created 2026-04-12)

**Action:** delete these two repos before re-running SCEN-018, so the scenario creates fresh ones. Deletion can go through GitHub UI or `gh repo delete` (requires explicit user approval).

## Q13 — Write-guard

Both `scenario-runner` and `scenario-improvement-implementer` have:
```yaml
hooks:
  PreToolUse:
    - matcher: "Write|Edit|MultiEdit|NotebookEdit|Bash"
      hooks:
        - type: command
          command: "${CLAUDE_PROJECT_DIR}/.claude/scripts/subagent-write-guard.sh"
```

Script exists at `.claude/scripts/subagent-write-guard.sh`. Enforces: writes only under `$CLAUDE_PROJECT_DIR` or `/tmp`. Reads unrestricted.

## Q14 — Server rebuild + restart — **action required**

pm2 shows `ai-maestro` at v0.27.3 (started 2D ago). Today's commits (`8265dc8b`, `b5d27678`, `314a0baf`, `eebcc79c`, `7a3c34fd`, `cf42bf12`) are NOT in the running process.

**Action before batch:**
```
yarn build
pm2 restart ai-maestro
curl -s http://localhost:23000/api/sessions >/dev/null && echo OK
```

## Q15 — Improving scenario runner janitor-awareness

Current behavior:
- Heartbeat fires in the parent conductor session between scenarios.
- Forked scenario-runner subagents are isolated — heartbeat doesn't touch them.
- Between scenarios, the heartbeat turn just runs dispatch.sh and ends. No interference with the next `Agent(scenario-runner)` call.

Proposed small improvements (not required for this run, but easy wins):
1. Have `run-scenarios-batch` write its `batch-progress.log` location to `.janitor/state/active-batch.ts` so the janitor's stale-task detector can suppress nudges during an active batch.
2. Detect `[janitor-resume]` in the dispatch output inside the conductor and log it to the batch progress file, then continue normally.
3. Set `stale_task_interval` to 3600 (1 h) during long batches to reduce noise; revert to 1800 (30 min) after.

None of these are blockers — the current architecture is already isolation-safe.

---

## Recommended action sequence

Before `/run-scenarios-batch 1-23`:

1. ✅ **Commit audit file** — this document.
2. ⚠ **Fix outdated procedure-details.md** — update "rules 1-12" → "rules 1-13", "Chrome CDP" → "dev-browser CLI".
3. ⚠ **Fix outdated batch skill** — "12 rules" → "13 rules".
4. 🗑 **Delete OVERNIGHT_* state-backup dirs** (explicit user approval required) — reclaims 12.2 GB.
5. 🗑 **Delete 2 scen018-test-repo-* on GitHub** (explicit user approval required).
6. 🔧 **Rebuild + restart ai-maestro server**.
7. 🚀 **Launch: `/run-scenarios-batch 1-23`** — sequential, proposals deferred for user review.
