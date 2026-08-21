---
trdd-id: 0N792LL5
title: update-aimaestro.sh checks out main and pulls from the upstream origin over unpushed work
column: todo
created: 2026-08-21T18:48:32+0200
updated: 2026-08-21T18:48:32+0200
implementation-commits: []
current-owner: hub-orchestrator
created-by: hub-orchestrator
assignee: hub-orchestrator
task-type: bugfix
scope: project
project-id: ai-maestro
min-approval-requirement: user
mandate: false
approved: false
priority: 0
severity: critical
labels: [installer, git-safety, data-loss, fork]
relevant-rules: []
npt: []
eht: []
---

# update-aimaestro.sh checks out main and pulls from the upstream origin over unpushed work

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-21

Found while reinstalling the agent CLIs under `TRDD-A9335BZ6`. **Nothing is broken yet — the
script has not been run.** It is filed at `severity: critical` because the failure is
unrecoverable-by-the-user and the script advertises itself as the recommended next step:
`install-agent-cli.sh` ends by printing *"For a full update (server + all tools):
`./update-aimaestro.sh`"*.

### The measurement

`update-aimaestro.sh`, on this machine, in this order:

| line | statement | consequence here |
|---|---|---|
| 144-153 | `git checkout main` when `CURRENT_BRANCH != main` | leaves `governance-rules`, the branch all current work is on |
| 162 | `git fetch origin main` | `origin` is **`https://github.com/23blocks-OS/ai-maestro.git`** — the UPSTREAM |
| 201 | `git pull origin main` | merges upstream `main` into the local tree |

Verified `git remote -v` at 18:45 +0200: `origin` → `23blocks-OS/ai-maestro`,
`fork` → `Emasoft/ai-maestro`. Verified `git rev-list --left-right --count`:
`fork/main` and `fork/governance-rules` are each **385 commits BEHIND** local HEAD and **0
ahead** — so every commit of the current work exists only on this disk.

The script's own comment at line 141 (`SF-042`) shows the branch hazard was already understood
once: *"Running `git pull origin main` on a feature branch would merge main into it."* The fix
chosen then was to **switch the branch**, which trades a merge-into-feature for an
abandon-the-feature. Neither is right while `origin` points at a repo we do not publish to.

### Why this is not merely a wrong default

The owner's standing directive (2026-08-21): *"never file an issue on 23blocks-OS/ai-maestro …
solve it yourself in our fork"* and *"ignore 23blocks-OS for now."* A script that silently
fetches and merges from that remote contradicts the directive without the operator typing any
remote name.

### What is NOT affected (measured, so nobody re-derives it)

- **`install-agent-cli.sh`** — performs **zero** git operations. It copies its 11 CLIs + 1
  helper from its own checkout (`SCRIPT_DIR`). Correct by construction; there is no origin or
  branch for it to get wrong. Ran it at 18:47, verified 0/11 byte-stale afterwards.
- **`install-messaging.sh`** — `--repo`/`--branch` are **opt-in**; the default installs from the
  local checkout. Correct **as long as nobody passes `--repo Emasoft/ai-maestro`**, which would
  install a tree 385 commits old.
- **`remote-install.sh`** — defaults to `23blocks-OS/ai-maestro` with `INSTALL_DIR` defaulting to
  `$HOME/ai-maestro`, i.e. this working tree. It does **not** ship `aimaestro-governance.sh` or
  `aimaestro-trdd.sh` (0 hits each), so it is not the installer for them, but its default target
  is the same tree and it carries the same upstream-origin assumption.

### NEXT ACTION

Decide the intended source of truth for a "full update" on a fork-based checkout, then make the
updater refuse rather than guess. Sketch, for the owner to accept or replace:

1. Resolve the update remote by name with **no upstream fallback** — prefer `fork` when it
   exists, never `origin` implicitly.
2. Update the **current** branch; never `git checkout` a different one on the operator's behalf.
3. **Refuse and exit non-zero** when the working tree has commits the chosen remote lacks, naming
   the count. A pull that would bury 385 unpushed commits must fail closed, not prompt.

## Acceptance

- [ ] `update-aimaestro.sh` performs no `git checkout` of a branch the operator did not name
- [ ] The update remote is resolved explicitly and never falls back to `origin` when `origin` is
      the upstream; a neuter that repoints it at upstream reds a test
- [ ] The script exits non-zero, naming the ahead-count, when local commits are absent from the
      chosen remote — asserted against a fixture repo with a seeded unpushed commit
- [ ] `remote-install.sh`'s upstream default is reviewed against the same directive, or documented
      as deliberately upstream-only with its `INSTALL_DIR` collision called out

## Approval log
