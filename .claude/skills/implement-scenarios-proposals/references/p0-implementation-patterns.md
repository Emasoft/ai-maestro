# Implement Scenarios Proposals — Detailed Procedure

## Table of contents

- [Step 1 — Discover proposal TRDDs](#step-1--discover-proposal-trdds)
- [Step 2 — Read every proposal TRDD](#step-2--read-every-proposal-trdd)
- [Step 3 — Confirm with the user (confirmation = approval)](#step-3--confirm-with-the-user-confirmation--approval)
- [Step 4 — Spawn the implementer subagent](#step-4--spawn-the-implementer-subagent)
- [Step 5 — Parse the implementer's result](#step-5--parse-the-implementers-result)
- [Step 6 — Never merge automatically](#step-6--never-merge-automatically)
- [Step 7 — Write the implementation summary](#step-7--write-the-implementation-summary)

## Step 1 — Discover proposal TRDDs

Parse `$ARGUMENTS`. Accept any of these forms:

- **Scenario number:** `18` → match label `scen-018`
- **Scenario range:** `16-20` → match labels `scen-016`..`scen-020`
- **Comma list:** `16,18,19` → match labels for exactly those scenarios
- **Batch label:** `batch-auto-2026-07-07T02-00-00Z` (or a bare batch id) → match that label
- **Explicit TRDD ids:** `TRDD-K3QX9P2W, #M7BZ4X1Q` → resolve by filename glob
- **Empty / "last batch":** the most recent `batch-<id>` label present in design/proposals/ (fall back to ALL pending scenario-improvement proposals if none carries a batch label)

Discover (frontmatter grep — proposals are TRDD files, per Rule 11 / TRDD-CJZRB57R):

```
grep -l "^labels:.*scenario-improvement" ${CLAUDE_PROJECT_DIR}/design/proposals/*.md   # pending
grep -l "^labels:.*scenario-improvement" ${CLAUDE_PROJECT_DIR}/design/tasks/*.md       # approved (keep only column: planned)
```

Filter by the parsed scope. Sort by `priority:` ascending (0 first), then `created:` descending.

If nothing matches, tell the user: "No proposal TRDDs matched `<arguments>`. Run the scenarios first via `run-scenarios-batch` to produce proposals." Stop.

## Step 2 — Read every proposal TRDD

Read each matched TRDD in full. For each one, extract:

- `trdd-id`, `title`, `priority` (0-3), `labels` (scen-NNN / batch-<id>), `column`
- Body: `## Problem`, `## Root cause`, `## Proposed fix` (affected files), `## Verification`, `## Estimated risk`

Build a consolidated list grouped by scenario. By default only `priority: 0` TRDDs go to the implementer; include 1-3 only when the user's arguments explicitly named them.

## Step 3 — Confirm with the user (confirmation = approval)

Present the consolidated list in a compact format:

```
Found <N> pending proposal TRDDs across <M> scenarios (+ <K> already approved):

SCEN-018:
  - TRDD-A1B2C3D4 [p0] Add wait_for after task send
  - TRDD-E5F6G7H8 [p0] Return task ID on creation

SCEN-019:
  - ...

Approve + implement these? (yes / list of ids / no)
```

Wait for the user. **Their confirmation IS the approval act** (per `~/.claude/rules/trdd-approval-tiers.md`). For each confirmed proposal:

1. Append to its `## Approval log`: `- <ISO> — APPROVED by USER (via /implement-scenarios-proposals). <one-line rationale>`
2. Set `column: planned`, bump `updated:`
3. `git mv design/proposals/TRDD-<...>.md design/tasks/TRDD-<...>.md`
4. Commit the moves BY NAME: `docs: approve scenario-improvement TRDDs → planned`

Unconfirmed proposals stay PENDING in `design/proposals/` (never refused by omission). If the user says no, stop without spawning anything.

## Step 4 — Spawn the implementer subagent

The `scenario-improvement-implementer` subagent is defined in the plugin's `agents/` folder with `isolation: worktree` in its frontmatter. That frontmatter flag tells the Agent tool to create a new git worktree, check out a fresh branch, and run the subagent entirely inside it. You do NOT have to create the worktree yourself — it is handled by the Agent tool based on the subagent's frontmatter.

Spawn via the Agent tool:

```
Agent(
    description: "Implement approved proposal TRDDs for <scenario-list>",
    subagent_type: "scenario-improvement-implementer",
    prompt: "Implement the following APPROVED scenario-improvement proposal TRDDs (column: planned, in design/tasks/): <newline-separated TRDD ids + absolute paths>. Project: ${CLAUDE_PROJECT_DIR}. Rules file: <resolved-rules-path>. For each TRDD: read its ## Proposed fix, locate the affected file, apply the minimum surgical fix, run the project's test/build command if one is present, commit each fix as a separate commit citing (TRDD-<id8>) in the subject, and append the sha to the TRDD's implementation-commits. Do NOT push — leave the branch local for the user to review. Return IMPLEMENTATIONS_DONE <branch-name> <commits-count> or IMPLEMENTATIONS_FAIL <reason> as the final line."
)
```

## Step 5 — Parse the implementer's result

The subagent returns one of two result formats as its final line:

1. **`IMPLEMENTATIONS_DONE <branch-name> <commits-count>`** — success.
2. **`IMPLEMENTATIONS_FAIL <reason>`** — failure. Agent tool auto-cleans up the worktree.

## Step 6 — Never merge automatically

**Do NOT merge the branch from this skill.** The user is responsible for reviewing the commits, re-running the scenarios against the branch to verify the fixes, and merging.

## Step 7 — Write the implementation summary

Save to `${CLAUDE_PROJECT_DIR}/reports/scenarios-runner/scenario-implementations-summary_<timestamp>.md`:

- List of proposal TRDD ids consumed (approved + implemented / approved + deferred / left pending)
- Count grouped by scenario
- Implementer final result (DONE/FAIL)
- Branch name (if DONE)
- Next steps: "Review commits on `<branch-name>`, re-run affected scenarios via `run-scenarios-batch <range>`, merge when green."

## Hard rules

1. **NEVER spawn `claude -p` or subprocess** — use Agent tool exclusively.
2. **NEVER edit source code directly** — the implementer subagent is the only authorized editor.
3. **NEVER merge the implementer's branch** — the user merges.
4. **NEVER push to remote** — branch stays local.
5. **NEVER touch DB migrations or external service state** — source-code only.
6. **NEVER use `git add -A`** — the implementer stages files by explicit name.
