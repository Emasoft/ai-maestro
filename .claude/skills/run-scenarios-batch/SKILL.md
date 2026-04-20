---
name: run-scenarios-batch
description: >-
  Use when the user wants unattended batch execution of scenario files.
  Trigger with "run scenarios 16-20" or "batch 5-10 --improve". Accepts a
  range, comma list, or single number.
argument-hint: range [--improve]
disable-model-invocation: false
model: opus
---

# Run Scenarios Batch — the conductor

## Overview

You are the conductor for unattended UI scenario batches. Orchestration only — you parse the range, spawn scenario-runner subagents, aggregate results. The `scenario-improvement-implementer` subagent (if `--improve`) needs `isolation: worktree`.

## Prerequisites

- A project with `${CLAUDE_PROJECT_DIR}/tests/scenarios/SCEN-NNN_*.scen.md` files
- Chrome browser open and accessible via CDP
- AI Maestro server (or target app) running and healthy
- Optional: `${CLAUDE_PROJECT_DIR}/tests/scenarios/scenarios.config.json` for preflight config

## Instructions

### Checklist

Copy this checklist and track your progress:

- [ ] Parse `$ARGUMENTS` into scenario IDs list and `improve` flag
- [ ] Run optional preflight (config file + health probe)
- [ ] For each scenario: check resume state → run setup script → spawn runner subagent → run cleanup script → log result
- [ ] Aggregate batch report
- [ ] If `--improve`: spawn implementer subagent for P0 proposals
- [ ] Return 3-line final summary

### Workflow

1. Parse `$ARGUMENTS` into scenario IDs list and `improve` flag.
2. Run optional preflight: read config file, probe health endpoint.
3. For each scenario: check resume state, run setup script, spawn runner subagent, run cleanup script, log result.
4. Aggregate results into the batch report.
5. If `--improve`: spawn the implementer subagent for P0 proposals.
6. Return a 3-line final summary.

### Rules reference

Canonical rules file: `${CLAUDE_PROJECT_DIR}/tests/scenarios/SCENARIOS_TESTS_RULES.md` — tracked in git, single source of truth for the 13 rules (Rule 13 = AUTONOMOUS-PROTOCOL, added 2026-04-15). Pass this path into every subagent prompt.

### Argument formats

| Input | Expands to |
|-------|-----------|
| `18` | `ids=[18] improve=false` |
| `16-20` | `ids=[16,17,18,19,20] improve=false` |
| `16-20 --improve` | `ids=[16,17,18,19,20] improve=true` |
| `1,5,8 --improve` | `ids=[1,5,8] improve=true` |

See [Detailed Procedure](references/procedure-details.md) for all 6 steps, the subagent spawn template with full prompt format, and the improvement loop implementation.

## Output

```
BATCH_DONE <range> <P>/<F>/<X> <aggregated-report-path>
Per-scenario reports: <space-separated paths>
Improvements: <branch-name or "skipped">
```

Where `P` = pass, `F` = fail, `X` = partial.

Aggregated batch report is saved under the project-root `reports/` directory (Rule 14):
`${CLAUDE_PROJECT_DIR}/reports/scenarios-runner/scenario-batch-<range>_<timestamp>.md`

Progress log is appended to:
`${CLAUDE_PROJECT_DIR}/tests/scenarios/state/batch-progress.log`

## Error Handling

| Error | Action |
|-------|--------|
| Scenario file missing | Skip, log `SCENARIO_MISSING <N>` in progress log, continue |
| Preflight health probe fails | Log failure, abort batch with clear error |
| Subagent returns FAIL | Log in progress log, continue to next scenario |
| Implementer returns IMPLEMENTATIONS_FAIL | Log reason in batch report, do not abort |

## Examples

```
/run-scenarios-batch 18
/run-scenarios-batch 16-20
/run-scenarios-batch 1,5,8,12 --improve
/run-scenarios-batch 16-20 --improve
```

## Resources

- [Detailed Procedure](references/procedure-details.md) — full 6-step procedure with preflight, main loop, improvement loop, and final output format
  - Step 1 — Parse arguments
  - Step 2 — Optional preflight
  - Step 3 — Main loop
  - Step 4 — Aggregate the batch report
  - Step 5 — Optional improvement loop
  - Step 6 — Final output
