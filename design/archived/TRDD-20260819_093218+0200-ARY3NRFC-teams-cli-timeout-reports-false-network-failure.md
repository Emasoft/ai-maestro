---
trdd-id: ARY3NRFC
title: Teams CLI 30s timeout reports a false network failure while the operation succeeds
column: completed
created: 2026-08-19T09:32:18+0200
updated: 2026-08-19T14:27:52+0200
implementation-commits: [f244b155, 6d60c017]
current-owner: hub-session-brrjk57p-phase2
created-by: hub-session-brrjk57p-phase2
assignee: hub-session-brrjk57p-phase2
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
priority: 2
severity: medium
project-id: ai-maestro
labels: [teams-cli, dx, decoupling-layer]
external-refs: [TRDD-6SL6UY6N (COS card whose e2e surfaced this), ai-maestro#133]
---

# Teams CLI 30s timeout reports a false network failure while the operation succeeds

## Problem

Measured live 2026-08-19 during the TRDD-6SL6UY6N e2e: `scripts/aimaestro-teams.sh`'s
`_api` uses `curl --max-time 30`, but `POST /api/teams` (CreateTeam with auto-COS spawn +
plugin install) and `DELETE /api/teams/[id] --delete-agents` (cascade) each run ~2 minutes
server-side. Every one of 6 calls (3 creates, 3 deletes) printed
`Error: request to /api/teams failed (network)` and exited 1 — while every operation
COMPLETED successfully server-side (curl exit 28 timeout, not a network refusal).

Two harms:
1. **False failure**: the caller (a COS/MANAGER skill, or a human) is told the create
   failed when it succeeded. The message blames the network, aiming diagnosis at the wrong
   layer.
2. **Retry hazard**: a caller that reasonably retries a "failed" create produces a
   DUPLICATE team (and a second auto-COS agent); a retried delete against an id already
   gone returns a second confusing error. This is the same misclassification family as
   CPV's TRDD-WC2GEDOC (a timeout/exit shape collapsing into the wrong verdict).

## Scope addition (2026-08-19 10:15, same e2e session)

`scripts/shell-helpers/common.sh:589` uses `local -n` (nameref, bash ≥4.3) in
`get_auth_args`. Under macOS default `/bin/bash` 3.2 the CLI dies BEFORE any request
(`local: -n: invalid option`) — it only works when homebrew bash resolves first on PATH,
which is per-environment luck. Measured live: the same delete verb worked at 09:28 (homebrew
bash first) and died at 10:02 (fresh login shell, /bin/bash first). Fix alongside the
timeout: either a version guard with a clear error, or replace the nameref with a
bash-3.2-safe return (echo + command substitution), since every plugin agent's PATH is
uncontrolled.

**RESOLVED 2026-08-19 14:11 (f244b155):** nameref replaced with a 3.2-safe eval-assign in
`get_auth_args` (the repo's only `local -n`). Proven under /bin/bash 3.2 AND homebrew bash
(space-containing token preserved); the two proven bash-caused files (statusline-cli,
teams-stats-verb) rerun 16/17 green isolated. CORRECTION to f244b155's commit message —
its "15 of the 16 red files were this line" was an overclaim written before the mode
split: reading each failure's MODE shows the pillar-* and governance files failed on
`Test timed out in 5000ms` (loadavg 167-180 contention, the known flake family), not on
the bash line; the bash-caused set is the CLI-SPAWNING files only. The TIMEOUT half of
this card (curl --max-time 30 vs ~2-min pipelines, exit-28 classification) remains OPEN.

## Proposed fix

In `scripts/aimaestro-teams.sh` (and any sibling CLI sharing `_api`):
- Raise the curl `--max-time` for the slow verbs (`create`, `delete`) to ≥ 300 s, keeping
  30 s for reads.
- Distinguish curl exit 28 from other failures: on timeout print
  `request timed out after <N>s — the operation may still be completing server-side;
  verify with 'show'/'list' BEFORE retrying` and use a distinct exit code so a scripted
  caller cannot conflate timeout with refusal.

## Verification

- A create that takes >30 s (auto-COS path) returns 0 with the created team JSON when
  max-time is raised; a forced timeout (max-time 1 against a slow verb) prints the
  timeout-specific message, not "(network)".
- Neuter: revert the max-time bump → the create test reds on the false-network message.

## Acceptance

- [x] slow verbs no longer time out on the normal auto-COS create/delete path — _api
      gained a per-call max_time (4th arg, default 30, AIMAESTRO_API_MAX_TIME env seam);
      create / delete / both chief-of-staff POST sites pass 300 (6d60c017)
- [x] timeout message names timeout + verify-before-retry; distinct from network refusal —
      curl exit 28 → exit 124 + "may still be completing server-side; verify with
      'show'/'list' BEFORE retrying"; every other curl failure keeps exit 1 and now names
      the curl exit code
- [x] one test pins the exit-28 classification (neuter runs recorded below) —
      tests/unit/teams-cli-timeout-classification.test.ts, 4/4 green: real _api + real
      curl against an accept-and-never-respond socket (genuine exit 28), a
      refused-connection specificity control (curl 7 must STAY network/exit 1), and the
      300s wiring pinned at the curl-function boundary

## Neuter runs (2026-08-19 14:26-14:27, fix committed FIRST as 6d60c017)

- n1. delete the `[ "$rc" -eq 28 ]` branch → EXACTLY 1 red: the exit-28 test, failing on
  the old message `(network, curl exit 28)` + EXIT=1 — the bug's own signature. Control
  and both wiring tests stayed green. One mutation, one test, clean attribution.
- n2. revert `--max-time "$max_time"` to literal 30 (both curl branches) → EXACTLY 2 red,
  both predicted in the test's doc comment: the create-wiring test (shows `--max-time 30`,
  not 300) and the exit-28 test (the env seam is dead, curl waits 30s > the 20s spawn
  guard — reds by harness timeout, attributed). Refused control + list-default stayed
  green.
- Restored between and after each run via git checkout of the committed fix; final run
  4/4 green.

## Approval log

- 2026-08-19T09:32:18+0200 — MANDATE issued as Tier-0 self-mandate (in-scope CLI fix in
  the repo that owns the script; reversible, local). No approval request needed.
- 2026-08-19T14:27:52+0200 — COMPLETED by hub (standing USER Phase-2 delegation,
  BRRJK57P). bash-3.2 half f244b155; timeout half 6d60c017 with both neuter runs
  recorded above. Sibling _api copies (governance/groups/panel/portfolio/session/trdd
  CLIs) mostly serve fast reads — the exit-28 classification is worth porting there the
  next time any of those files is touched, not as a mass edit now.
