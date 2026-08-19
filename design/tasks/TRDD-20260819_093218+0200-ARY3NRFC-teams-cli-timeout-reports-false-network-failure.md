---
trdd-id: ARY3NRFC
title: Teams CLI 30s timeout reports a false network failure while the operation succeeds
column: todo
created: 2026-08-19T09:32:18+0200
updated: 2026-08-19T09:32:18+0200
implementation-commits: []
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

- [ ] slow verbs no longer time out on the normal auto-COS create/delete path
- [ ] timeout message names timeout + verify-before-retry; distinct from network refusal
- [ ] one test pins the exit-28 classification (neuter run recorded)

## Approval log

- 2026-08-19T09:32:18+0200 — MANDATE issued as Tier-0 self-mandate (in-scope CLI fix in
  the repo that owns the script; reversible, local). No approval request needed.
