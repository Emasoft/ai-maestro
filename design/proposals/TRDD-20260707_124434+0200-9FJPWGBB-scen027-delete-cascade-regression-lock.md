---
trdd-id: 9FJPWGBB
title: Add an explicit regression-lock assertion + comment for the DeleteAgent Claude-projects cascade
column: proposal
created: 2026-07-07T12:44:38+0200
updated: 2026-07-07T12:44:38+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: LOW
effort: S
labels: [scenario-improvement, scen-027, batch-backlog-20260707]
task-type: docs
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_027_2026-05-23T00-42-41Z.md"]
---

# TRDD-9FJPWGBB — Add an explicit regression-lock assertion + comment for the DeleteAgent Claude-projects cascade

## Problem

SCEN-027 verified that `DeleteAgent` (with "Also delete agent folder"
checked) now removes the Claude Code project directory at
`~/.claude/projects/-Users-<user>-agents-<name>/`. An earlier scenario,
SCEN-023 (per its P1-PROP-002 finding, 2026-05-04), explicitly reported
this directory was NOT being cleaned up ("stale jsonl files in
`~/.claude/projects/-Users-*-agents-scen023-*/` survived previous runs").
That gap has clearly been closed by one of the ~30 commits landed since
then — but nothing in the scenario file locks the fix in as a regression
guard, so a future refactor of `DeleteAgent` could silently reintroduce
the leak with no test catching it.

## Root cause

Verified at HEAD (2026-07-07) by reading
`tests/scenarios/SCEN-027_jsonl-session-browser.scen.md` step S018:

- The **Goal** line does state the expectation: "...all `.jsonl` files
  under `~/.claude/projects/-Users-*-agents-scen027-jsonl-session-browser/`
  are gone (along with any `.aimidx` sidecars)".
- But the **Verify** line only actually checks two things:
  `GET /api/agents?includeDeleted=false` no longer lists the test agent,
  and `ls ~/agents/scen027-jsonl-session-browser/` returns "No such file
  or directory". It does **not** include a command asserting the
  `~/.claude/projects/...` directory is gone — the cascade claim lives
  only in prose (the Goal), not in an executable Verify check.

So the regression risk is real: a future runner could tick S018 as PASS by
satisfying only the Verify line's two literal checks, without anyone
actually confirming the Claude-projects cascade still works.

## Proposed fix

In `tests/scenarios/SCEN-027_jsonl-session-browser.scen.md`, step S018:

1. **Verify** — add an explicit third check:
   ```
   ls ~/.claude/projects/-Users-*-agents-scen027-jsonl-session-browser/ 2>&1
   # expected: "No such file or directory" (glob matches zero directories)
   ```
2. Add a regression-lock comment immediately above or within S018:
   ```yaml
   # Regression lock for SCEN-023 P1-PROP-002 (2026-05-04): DeleteAgent's
   # "Also delete agent folder" path MUST cascade-delete the Claude Code
   # project dir, not just ~/agents/<name>/. Confirmed fixed at SCEN-027
   # run 2026-05-23 (94f00b5b); this Verify line is the regression guard.
   ```

## Verification

Re-run SCEN-027 S018 after the edit; the new Verify line should pass
against current behavior. Confirm (by temporarily reverting the fix in a
throwaway branch, or by code inspection of the current `DeleteAgent`
cascade path in `services/element-management-service.ts`) that the new
assertion would actually FAIL if the cascade regressed — i.e. it is a real
guard, not a tautology.

## Estimated risk

TRIVIAL — one additional shell assertion + one comment in a scenario
markdown file; no application code touched.

## Approval log
