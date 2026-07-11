---
name: implement-scenarios-proposals
description: >-
  Use when scenario improvement-proposal TRDDs need their priority-0 items
  applied to code. Trigger with "implement proposals from scenario N" or
  "fix P0 issues from last batch". Screens pending proposal TRDDs with the
  user (confirmation = approval), promotes them to design/tasks/, then
  spawns the implementer in an isolated git worktree.
argument-hint: batch-id-or-scenario-range-or-trdd-ids
disable-model-invocation: false
model: opus
---

# Implement Scenarios Proposals — proposal-to-code bridge

## Overview

You are the bridge between scenario run analysis and application source code changes. Scenario runs author each improvement suggestion as its own TRDD-proposal file (Rule 11 / TRDD-CJZRB57R): PENDING ones live in `design/proposals/` (`column: proposal`, label `scenario-improvement`); APPROVED ones live in `design/tasks/` (`column: planned`). You find the relevant proposal TRDDs, screen the pending ones with the user (their confirmation IS the approval act), promote the confirmed ones, and hand the code changes to the `scenario-improvement-implementer` subagent (which runs in a git worktree).

You do NOT edit application source code directly. Your role is discovery, screening/promotion, and orchestration.

**Rule 0 (SCENARIOS_TESTS_RULES.md) is a screening filter, not just a runner rule.** A proposal whose "fix" amounts to having the user prompt, nudge, or babysit an agent (rather than fixing the agent, its plugin, or the app) must be REFUSED at screening — do not promote it. Note the refusal and the reason in the implementation summary; the correct fix lives in the code the agent runs, never in user hand-holding.

## Prerequisites

- Proposal TRDDs at `${CLAUDE_PROJECT_DIR}/design/proposals/TRDD-*.md` (pending) and/or `design/tasks/TRDD-*.md` with `column: planned` + label `scenario-improvement` (already approved)
- Project with a valid git repo (the implementer needs a worktree)
- Build/test command available in the project (optional but recommended)

## Instructions

### Checklist

Copy this checklist and track your progress:

- [ ] Parse `$ARGUMENTS` (batch label / scen range / TRDD ids) to scope the proposal TRDDs
- [ ] Grep `design/proposals/` (column: proposal) + `design/tasks/` (column: planned) for label `scenario-improvement` and filter
- [ ] Present the pending list to the user (id — title — priority); wait for confirmation
- [ ] Promote each confirmed proposal: Approval-log line, `column: planned`, `git mv` → `design/tasks/`, commit by name
- [ ] Spawn `scenario-improvement-implementer` subagent via Agent tool with the approved TRDD list
- [ ] Parse subagent result (IMPLEMENTATIONS_DONE / IMPLEMENTATIONS_FAIL)
- [ ] Write implementation summary to `reports/scenarios-runner/`
- [ ] Return 3-line final summary

### Workflow

1. Parse `$ARGUMENTS` to scope the proposal TRDDs (batch label `batch-<id>`, scenario range → `scen-NNN` labels, explicit `TRDD-<id8>` ids, or "last batch").
2. Discover: `grep -l "^labels:.*scenario-improvement" design/proposals/*.md design/tasks/*.md`, filter by scope + column (`proposal` = pending, `planned` = already approved); stop if none found.
3. Present the pending proposals to the user as a numbered list (TRDD-id — title — priority 0-3), plus any already-approved ones that will be included as-is.
4. Wait for the user's confirmation. **The user's confirmation IS the approval act** (per `~/.claude/rules/trdd-approval-tiers.md`): for each confirmed proposal append to its `## Approval log` `- <ISO> — APPROVED by USER (via /implement-scenarios-proposals). <one-line rationale>`, set `column: planned`, bump `updated:`, `git mv` the file into `design/tasks/`, and commit the moves BY NAME (`docs: approve scenario-improvement TRDDs → planned`). Unconfirmed proposals stay PENDING in `design/proposals/` — never refuse by omission.
5. Spawn the `scenario-improvement-implementer` subagent via Agent tool, passing the approved TRDD ids/paths.
6. Parse the subagent result (IMPLEMENTATIONS_DONE or IMPLEMENTATIONS_FAIL).
7. Write the implementation summary to `reports/scenarios-runner/`.
8. Return a 3-line final summary.

### Rules reference

Canonical rules file: `${CLAUDE_PROJECT_DIR}/tests/scenarios/SCENARIOS_TESTS_RULES.md` — tracked in git, single source of truth for the 15 rules (0-14).

See [Detailed Procedure](references/p0-implementation-patterns.md) for the full 7-step flow, argument format table (range, comma list, timestamp, "last batch"), and implementer subagent spawn template.

## Output

```
PROPOSALS_IMPLEMENTED <P0-count> items | Result: <DONE|FAIL>
Branch: <branch-name or "none">
Summary: <absolute-path-to-summary-report>
```

## Error Handling

| Error | Action |
|-------|--------|
| No matching proposal TRDDs | Tell user to run scenarios first; stop |
| User declines confirmation | Stop; do not spawn subagent |
| Proposal's fix is "have the user nudge/prompt the agent" | REFUSE (Rule 0) — do not promote; note it as a rejected proposal in the summary |
| IMPLEMENTATIONS_FAIL | Log reason in batch report; tell user to inspect worktree or re-run proposals |
| Build fails in worktree | Implementer reports FAIL; worktree is auto-cleaned |

## Examples

```
/implement-scenarios-proposals 18
/implement-scenarios-proposals 16-20
/implement-scenarios-proposals last batch
```

## Resources

- [Detailed Procedure](references/p0-implementation-patterns.md) — full 7-step flow including argument parsing, proposal extraction, subagent spawn template, and summary format
  - Step 1 — Discover proposal files
  - Step 2 — Read every proposal file and extract P0 items
  - Step 3 — Confirm with the user
  - Step 4 — Spawn the implementer subagent
  - Step 5 — Parse the implementer's result
  - Step 6 — Never merge automatically
  - Step 7 — Write the implementation summary
