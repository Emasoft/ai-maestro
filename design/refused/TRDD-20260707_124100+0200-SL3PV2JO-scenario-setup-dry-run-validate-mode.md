---
trdd-id: SL3PV2JO
title: Add a validate-only dry-run mode to scenario-setup.sh
column: refused
created: 2026-07-07T12:41:00+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 3
severity: LOW
effort: S
labels: [scenario-improvement, scen-026, batch-backlog-20260707]
task-type: infra
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_026_2026-05-04T12-26-52Z.md"]
---

# TRDD-SL3PV2JO — Add a validate-only dry-run mode to scenario-setup.sh

## Problem

Verified at HEAD (2026-07-07):
`tests/scenarios/scripts/scenario-setup.sh` creates a real backup
directory and starts writing to it BEFORE checking that all declared
fixtures actually exist:

- Line 86-89: `BACKUP_DIR="$PROJECT_DIR/tests/scenarios/state-backups/SCEN-${NNN}_${TS}"`,
  `mkdir -p "$BACKUP_DIR"`, `MANIFEST="$BACKUP_DIR/MANIFEST.sha256"`,
  `: > "$MANIFEST"` — these mutations happen unconditionally, right
  after argument/frontmatter parsing.
- Lines 93-112 then perform the `rewipe-list` backup (real file copies +
  manifest writes).
- Only at lines 114-135 (git-fixtures) and 137+ (dir-fixtures) does the
  script check whether the declared fixtures actually exist, and it
  `exit 1`s with `SETUP_FAIL` the first time one is missing.

So a missing fixture is discovered only AFTER the backup directory and
(for scenarios with a non-empty `rewipe-list`) real file backups already
exist on disk. There is no `--dry-run` / `--validate` flag to check
fixture readiness without those side effects. This exact class of
failure caused `SETUP_FAIL` at fixture-check time for SCEN-018
(missing `Emasoft/scen018-test-repo-alpha`), SCEN-025 (missing
`Emasoft/scen025-kanban-fixture`), and SCEN-026 (missing all four Codex
plugin fixtures) — three of the most recent overnight-batch scenarios,
each leaving behind a partially-written backup directory that a later
run or a human operator must decide is safe to reuse or must clean up.

## Root cause

`scenario-setup.sh` was written to do backup-then-fixture-check in a
single linear pass with no way to separate "will this succeed" from
"actually do it". As the fixture corpus has grown, authoring gaps
(forgotten forks, missing `scenario-start` tags, path typos in
`rewipe-list`) have become common enough that a cheap pre-flight check
would catch them before any state mutation.

## Proposed fix

Add a `--dry-run` (alias `--validate`) flag to
`tests/scenarios/scripts/scenario-setup.sh`, consumed as an optional
second positional/flag argument after `<NNN>`. When set:

1. Perform all the existing frontmatter parsing (`parse_list` for
   `rewipe-list`, `git-fixtures`, `dir-fixtures`) — this alone already
   catches malformed YAML per the existing fail-fast parser at lines
   28-49.
2. For `rewipe-list`: check each path exists or is knowably absent
   (mirror the `BACKUP` / `BACKUP_SKIP` distinction already used) —
   but do NOT create `$BACKUP_DIR`, do NOT copy any file, do NOT write
   `MANIFEST.sha256`.
3. For `git-fixtures`: check each resolves to a local clone with the
   `scenario-start` tag present — but do NOT run `git reset --hard` /
   `git clean -fdx`.
4. For `dir-fixtures`: check each path exists (and, if it's a git repo,
   that the tag exists) — but do NOT reset it.
5. Also verify `yq` is on `PATH` (already checked unconditionally today
   at line 24 — keep that check first, before any parsing).
6. Print `VALIDATE_OK SCEN-<NNN>` and exit 0 if everything checks out,
   or the existing `SETUP_FAIL <reason>` message and exit 1 on the
   first failure — reuse the exact same failure-message format so
   downstream consumers (the cron's `state-machine-tick.sh`, a human
   reading the log) don't need to special-case dry-run output.

Implementation approach: guard the mutating lines (86-89, the
`rewipe-list` copy loop's `cp -p` / manifest-append lines, and the
`git reset --hard` / `git clean -fdx` calls) behind an `if [
"$DRY_RUN" != "1" ]` check, while keeping the read-only existence/tag
checks unconditional.

## Verification

Run `setup-SCEN-026.sh --validate` (or `scenario-setup.sh 026
--dry-run` directly) against the current repo state, where SCEN-026's
git-fixtures are known to be missing. Expect output
`SETUP_FAIL git-fixture[0] ... — expected local clone at ...` (or
whichever fixture is checked first) on stderr, exit code 1, AND confirm
`tests/scenarios/state-backups/SCEN-026_*/` is NOT created by this
invocation (`ls tests/scenarios/state-backups/ | grep SCEN-026` before
and after the dry-run should show no new directory). Separately, run
`--validate` against a scenario whose fixtures ARE all present and
confirm it prints a success line and exits 0 without creating a backup
directory either.

## Estimated risk

LOW. Confined to `scenario-setup.sh`; the mutating code paths are
unchanged for the default (non-dry-run) invocation used by every
existing `setup-SCEN-NNN.sh` wrapper today.

**Dependencies:** None to implement. Once available, the Rule 13
autonomous-batch cron prompt (`tests/scenarios/SCENARIOS_TESTS_RULES.md`)
and `tests/scenarios/scripts/state-machine-tick.sh` are natural
consumers — they could call `setup-SCEN-NNN.sh --validate` before the
real setup to fail fast on a missing fixture without leaving a stray
backup directory, but wiring that in is a separate, optional follow-up
and not required for this TRDD's own verification.

## Approval log

- 2026-07-07T13:24:46+0200 — REFUSED by USER-delegated batch screening (tier 2). Superseded by approved TRDD-QE1J5C91 (batch preflight covers the validate-only intent).
