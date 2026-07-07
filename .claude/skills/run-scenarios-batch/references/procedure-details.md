# Run Scenarios Batch — Detailed Procedure

## Table of contents

- [Step 1 — Parse arguments](#step-1--parse-arguments)
- [Step 2 — Optional preflight](#step-2--optional-preflight)
- [Step 3 — Main loop](#step-3--main-loop)
- [Step 4 — Aggregate the batch report](#step-4--aggregate-the-batch-report)
- [Step 5 — Optional improvement loop](#step-5--optional-improvement-loop)
- [Step 6 — Final output](#step-6--final-output)

## Step 1 — Parse arguments

Parse `$ARGUMENTS` into:
- An ordered list of scenario IDs (integers, expanded from a range or comma list)
- An `improve` boolean (true if `--improve` is present)

Examples:
- `18` → `ids=[18] improve=false`
- `16-20` → `ids=[16,17,18,19,20] improve=false`
- `16-20 --improve` → `ids=[16,17,18,19,20] improve=true`
- `1,5,8,12 --improve` → `ids=[1,5,8,12] improve=true`

Skip IDs whose `${CLAUDE_PROJECT_DIR}/tests/scenarios/SCEN-NNN_*.scen.md` file is missing and log that in the progress log.

## Step 2 — Optional preflight

Check for a project config file at `${CLAUDE_PROJECT_DIR}/tests/scenarios/scenarios.config.json`. If it exists, parse the following optional fields:

- `preflight_command` — a shell command to run once before the batch (e.g. restart a dev server, reset fixtures)
- `base_url` — the URL used for health checks (e.g. `http://localhost:3000`)
- `health_endpoint` — path appended to `base_url` to probe readiness (default `/`)

If the config file is present, run the `preflight_command` via Bash (single one-shot invocation), then probe `base_url + health_endpoint` with curl. If the probe fails, log the failure in the progress log and abort the batch with a clear error.

If no config file exists, skip preflight entirely. The per-scenario Phase 0 SAFE-SETUP in each scenario file is responsible for its own readiness checks.

**Complementary, not duplicative — the autonomous-cron per-scenario preflight (TRDD-QE1J5C91).** The batch-wide check above runs ONCE, before the whole batch, and only probes a generic command + health endpoint — it never inspects an individual scenario's fixtures. The unattended overnight cron (`tests/scenarios/scripts/state-machine-tick.sh`, driven by the autonomous batch protocol in `SCENARIOS_TESTS_RULES.md` Rule 13) runs a SEPARATE, PER-SCENARIO fixture-existence preflight on every tick: before dispatching a `pending` scenario, it verifies that scenario's `git-fixtures`/`dir-fixtures` are actually present on disk. A scenario whose fixtures are missing is marked `preflight_skipped` (skipped, not failed) instead of being handed a full setup-then-fail cycle, and it self-heals back to `pending` the moment its fixture appears. This skill's interactive main loop (Step 3 below) does not use `state-machine-tick.sh` and is unaffected — it still relies on the per-scenario setup script's own fixture check (Step 3.2) to fail fast.

## Step 3 — Main loop

For each scenario ID `N` in the parsed list, in numeric order:

1. **Check resume state.** Read `${CLAUDE_PROJECT_DIR}/tests/scenarios/state/batch-progress.log` (create the directory if missing). If it already contains a `SCENARIO_DONE <N>` line from a previous run in this batch window, skip this scenario and move to the next.

2. **Per-scenario pre-setup script (MANDATORY).** Run `${CLAUDE_PROJECT_DIR}/tests/scenarios/scripts/setup-SCEN-<padded-id>.sh` via Bash. Every scenario MUST have this script (all 24 are generated from a template — see `scenario-setup.sh`). The script reads the scenario's `rewipe-list`, `git-fixtures`, `dir-fixtures` frontmatter and prepares the environment.

   **If the setup script fails (non-zero exit), the scenario MUST NOT start.** Log the failure in `batch-progress.log` as `SCENARIO_SETUP_FAIL <N> <reason>`, skip this scenario, and continue to the next one. The setup failure is a scenario-author problem (missing fixture, missing tag, bad path) — not something the batch conductor should paper over. Do NOT spawn the scenario-runner subagent when setup fails; it would just restart the scenario from step 1 in an uninitialized environment.

3. **Spawn the scenario-runner subagent** via the Agent tool:
   ```
   Agent(
       description: "Run SCEN-<padded-id> end-to-end",
       subagent_type: "scenario-runner",
       prompt: "Run scenario number <N>. Scenario file: ${CLAUDE_PROJECT_DIR}/tests/scenarios/SCEN-<padded-id>_*.scen.md. Rules file: <resolved-rules-path>. Follow rules 0-14, drive the app via the dev-browser CLI (Rule 8 — loaded via Skill(skill: 'dev-browser:dev-browser')), write the report under ${CLAUDE_PROJECT_DIR}/reports/scenarios-runner/, author each improvement proposal as its own TRDD-proposal file in design/proposals/ (Rule 11, labels scen-<padded-id> + batch-<batch-timestamp>), and return a 3-line summary."
   )
   ```
   Wait for the subagent to return. Parse the 3-line result into pass/fail/partial + report path + proposal counts.

3b. **Commit the scenario's proposal TRDDs.** List the new files with `git status --porcelain -- design/proposals/` (they carry this batch's label — spot-check one), then `git add` each BY NAME and commit: `docs(scen-<padded-id>): add improvement-proposal TRDDs`. The scenario report itself is gitignored (Rule 14) and is never committed.

4. **Per-scenario cleanup script (MANDATORY).** Run `${CLAUDE_PROJECT_DIR}/tests/scenarios/scripts/cleanup-SCEN-<padded-id>.sh` via Bash. This delegates to `scenario-restore.sh` which verifies and replays the MANIFEST.sha256. If it fails, log `SCENARIO_CLEANUP_FAIL <N> <reason>` in `batch-progress.log`, but continue to the next scenario (cleanup failures are noted for operator review, not fatal to the batch).

5. **Append progress.** One line to `${CLAUDE_PROJECT_DIR}/tests/scenarios/state/batch-progress.log`:
   ```
   SCENARIO_DONE <padded-id> <pass|fail|partial> <report-path> <duration-seconds>
   ```

6. **Move to the next scenario.**

## Step 4 — Aggregate the batch report

After the loop completes, write an aggregated summary to `${CLAUDE_PROJECT_DIR}/reports/scenarios-runner/scenario-batch-<range>_<timestamp>.md` with:

- Per-scenario result table (ID, status, bugs found, bugs fixed, duration, report path)
- Aggregated proposal counts: `grep -l "^labels:.*batch-<batch-timestamp>" design/proposals/*.md`, then read each hit's `priority:` — sum per priority 0-3
- Open issues not covered by any proposal TRDD
- Recommended-for-implementer section naming which scenarios produced priority-0 TRDDs worth implementing (list their `TRDD-<id8>` ids)

## Step 5 — Optional improvement loop

If `improve=true` AND this batch authored priority-0 proposal TRDDs, first PROMOTE them — **the `--improve` flag IS the user's standing approval for this batch's priority-0 proposals** (per `~/.claude/rules/trdd-approval-tiers.md` the approval must be explicit; the user gave it by passing the flag). For each `priority: 0` TRDD in `design/proposals/` carrying label `batch-<batch-timestamp>`:

1. Append to its `## Approval log`: `- <ISO> — APPROVED by USER (via run-scenarios-batch --improve).`
2. Set `column: planned`, bump `updated:`
3. `git mv design/proposals/TRDD-<...>.md design/tasks/TRDD-<...>.md`
4. Commit the moves BY NAME: `docs: approve batch-<batch-timestamp> P0 proposal TRDDs → planned`

Priority 1-3 proposals are NOT promoted by `--improve` — they stay pending in `design/proposals/` for explicit screening. Then spawn the implementer subagent:

```
Agent(
    description: "Implement approved proposal TRDDs from batch <range>",
    subagent_type: "scenario-improvement-implementer",
    prompt: "Implement the approved scenario-improvement proposal TRDDs labeled batch-<batch-timestamp> (column: planned, in design/tasks/): <explicit list of TRDD ids + absolute paths>. Rules file: <resolved-rules-path>. Report back with IMPLEMENTATIONS_DONE or IMPLEMENTATIONS_FAIL."
)
```

The implementer runs in a git worktree automatically because its frontmatter has `isolation: worktree`. Wait for its 1-line completion marker. Parse the branch name.

If `IMPLEMENTATIONS_DONE`, write the branch name to the aggregated report so the user can merge it after a verification re-run. **Do NOT merge automatically from the skill** — merging is the user's decision.

If `IMPLEMENTATIONS_FAIL`, log the failure reason in the aggregated report and continue (the worktree is automatically cleaned up by the Agent tool).

## Step 6 — Final output

Return ONE short summary as your final message:

```
BATCH_DONE <range> <P>/<F>/<X> <aggregated-report-path>
Per-scenario reports: <space-separated paths>
Proposals: <n> TRDDs authored in design/proposals/ (P0:<a> P1:<b> P2:<c> P3:<d>)
Improvements: <branch-name or "skipped">
```

Where `P` = pass count, `F` = fail count, `X` = partial count.

## Hard rules

1. **NEVER spawn `claude -p`, `claude --print`** or any subprocess claude invocation — use Agent tool exclusively.
2. **NEVER nest skill invocations** — use Agent tool with `subagent_type: scenario-runner`.
3. **NEVER use `git add -A` or `git add .`** — stage files by explicit name.
4. **NEVER push to remote** — the user pushes, not the conductor.
5. **NEVER merge the implementer's worktree branch** — leave that for the user.
6. **NEVER hardcode project paths** — always use `${CLAUDE_PROJECT_DIR}`.
