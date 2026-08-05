---
trdd-id: SBJRNYYY
title: 25 of 87 CLI scripts on PATH are stale and 7 were never deployed — order the deploy
column: proposal
scope: project
project-id: ai-maestro
created: 2026-08-05T17:35:51+0200
updated: 2026-08-05T17:35:51+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: user
mandate: false
approved: false
severity: high
effort: medium
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [deployment, cli, frozen-contract, safety]
external-refs: [Emasoft/ai-maestro#35, Emasoft/ai-maestro#43, Emasoft/ai-maestro#53, Emasoft/ai-maestro#64]
---

# 25 of 87 CLI scripts on PATH are stale and 7 were never deployed — order the deploy

## Problem

Whole-surface byte-compare of `scripts/*.sh` against `~/.local/bin/`, **87 scanned, 87 rows**
(control: scan set equals file count, so nothing was silently skipped):

| state | count |
|---|---|
| identical | **55** |
| STALE | **25** |
| never deployed | **7** |

Most stale copies date to one deploy event on **2026-07-21**. So "is the CLI current?" is answerable
only **per file**, and the honest default is *assume stale*.

## Two items are urgent; the rest is hygiene

**1. `amp-helper.sh` — the safety fix is written and NOT deployed (98 changed lines).** The deployed
copy still answers an unidentified session with `Use --id <uuid>` **and lists every registered
agent's address and uuid** — a pickable menu of live identities. The repo copy replaces it with a
refusal naming only the identity-proving paths, and states plainly that running as another agent
sends mail, moves kanban cards, and mutates state under that agent's identity. **Until this ships,
the fleet's own advice on an unresolved identity is the exploit.** Root cause is [[YJUIFOLO]].

**2. `aimaestro-groups.sh` — built, never deployed.** Landed as *"the groups CLI — #64 residual 6,
the last unbuilt one"*. In the repo, absent from `PATH`, so the work that closed #64's last residual
cannot be invoked.

Also: all six `amp-kanban-*.sh` lack #53's `--parent`/`--attachment` entirely (grep repo vs deployed:
4/0 and 6/0) **and** still carry a bug the repo fixed — `|| true` on the curl command substitution
is load-bearing under `set -e`, so an unreachable server kills the script with a bare exit 7 and the
"❌ Failed to move task" branch never runs. That is the worst shape for #43's round-trip hand-off:
the unreachable-server path is the first thing an integration test hits, and there the failure is
indistinguishable from a caller-side transport problem.

## Proposed fix

Deploy in this order, verifying **by effect** after each — run the command, never read `git log`:

1. `amp-helper.sh` (safety)
2. the six `amp-kanban-*.sh` (unblocks #43's round-trip)
3. `aimaestro-groups.sh` (never deployed; closes #64 residual 6 in practice)
4. the remaining 18 stale + 6 never-deployed, as one batch

## Verification

Per file: re-run the byte compare and confirm `identical`. Then **exercise** the behaviour — for
`amp-helper.sh`, an unidentified session must receive the refusal and **no uuid list**; for
`amp-kanban-move.sh`, an unreachable server must print the failure branch rather than exiting 7
silently.

**Do NOT verify a deploy with a substring count.** `grep -c 'Use --id'` returns **2 for both**
copies of `amp-helper.sh` — the deployed one prints it as advice, the repo one forbids it in prose.
Same token, opposite meaning. `cmp`/`diff` is the only instrument that answers "same or not".

## Estimated risk

HIGH blast radius, LOW technical risk: writing into `~/.local/bin` changes what **every agent on
this host executes**, immediately, with no build step and no restart. That is why this is a USER
decision and why the order above starts with the safety item.

## Approval log
