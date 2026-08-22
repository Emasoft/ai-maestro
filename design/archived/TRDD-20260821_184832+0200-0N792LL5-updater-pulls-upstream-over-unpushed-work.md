---
trdd-id: 0N792LL5
title: update-aimaestro.sh checks out main and pulls from the upstream origin over unpushed work
column: complete
created: 2026-08-21T18:48:32+0200
updated: 2026-08-22T14:22:10+0200
implementation-commits: [bd9816ab]
current-owner: hub-orchestrator
created-by: hub-orchestrator
assignee: hub-orchestrator
task-type: bugfix
scope: project
project-id: ai-maestro
min-approval-requirement: user
mandate: false
approved: true
approval-judge: owner-delegated
approval-datetime: 2026-08-22T14:22:10+0200
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

- [x] `update-aimaestro.sh` performs no `git checkout` of a branch the operator did not name
      **SF-042's `git checkout main` is GONE** — both the interactive prompt and the
      `NON_INTERACTIVE` path, which switched with no prompt at all (worse than this card recorded).
      The updater now fetches and pulls `$CURRENT_BRANCH` and never switches on the operator's
      behalf: switching branches to make a pull legal discards the very work being protected.
- [x] The update remote is resolved explicitly and never falls back to `origin` when `origin` is
      the upstream; a neuter that repoints it at upstream reds a test
      `resolve_update_remote` prefers an explicit `AIM_UPDATE_REMOTE`, then `fork`, then `origin`;
      `assert_update_safe` then REFUSES an implicitly-resolved upstream. **Two neuters, both
      observed:** dropping the `fork` preference reds *"prefers fork over origin"*, and flipping
      `remote_is_upstream`'s empty-constant branch to `return 1` reds *"FAILS CLOSED"*. The
      fail-closed direction is the load-bearing one — a "no" there AUTHORIZES a merge, so the
      answer given when we cannot identify the remote must be the one that refuses.
- [x] The script exits non-zero, naming the ahead-count, when local commits are absent from the
      chosen remote — asserted against a fixture repo with a seeded unpushed commit
      `tests/unit/update-remote-guard.test.ts` builds real repos under `mkdtemp` (git pinned to
      that cwd — nothing can reach the developer's checkout, which matters here because the suite
      deliberately creates unpushed commits). Two seeded commits ⇒ `REFUSED: 2 commit(s)`, exit
      non-zero. **Neuter observed: 1 red / 8 green.** A positive control asserts the in-sync case
      PROCEEDS, without which every refusal assertion is satisfied by a guard that refuses always.
- [x] `remote-install.sh`'s upstream default is reviewed against the same directive, or documented
      as deliberately upstream-only with its `INSTALL_DIR` collision called out
      **Reviewed AND guarded — it had the same blind spot.** It is BETTER in one respect (it pulls
      `git rev-parse --abbrev-ref HEAD`, so it never abandons a branch) and identical in the
      dangerous one: its `git stash` protects a DIRTY TREE and cannot see unpushed COMMITS, so a
      pull into an existing `$HOME/ai-maestro` — its default `INSTALL_DIR`, i.e. this tree —
      buried local-only work with every visible safeguard reporting success. It now sources the
      same helper and refuses on a non-zero ahead-count. **Only that half applies:** this script is
      deliberately upstream-capable (cloning from upstream is its job), so importing the
      upstream-refusal would break its actual purpose. Documented in the code, not just here.

## Closing note — 2026-08-22T14:2x

**Two hazards, one root, fixed once.** Both scripts pulled a remote into a tree that could hold
local-only commits, and both carried a safeguard that LOOKED like it covered the case: SF-042's
branch switch, and the stash prompt. Each is real and neither can see a commit. That is why the
bug survived a prior pass that had already understood half of it — the guard's presence is what
stops the next reader checking what it actually guards.

The fix is a refusal, never a repair. The guard does not switch, stash, reset or pull; it exits
non-zero and names the count, because the operator is the only party who knows whether those
commits matter. Extracted to its own file because where it lived — three statements inside a
400-line installer that also restarts pm2 and reinstalls plugins — nothing could drive it, and
nothing did.

**The card's "385 commits" is stale; re-measured today it is 89** (`git rev-list --left-right
--count fork/main...HEAD` → `0 89`). The number moved, the condition did not, and the fix is
keyed on the condition rather than on any number.

## Approval log

- 2026-08-22T14:22:10+0200 — **APPROVED by owner-delegation (min-approval-requirement: user).**
  This card was authored at floor `user` because its own NEXT ACTION asked the owner to rule on
  the intended source of truth: *"Sketch, for the owner to accept or replace."* The owner's
  standing directive of 2026-08-22 — *"you can decide by yourself. base your decisions on verified
  facts and tests. never assume anything."* — IS that ruling, so the card is approved on it rather
  than on a lowered floor. The floor is left at `user` deliberately: it was correctly classified,
  and rewriting it would erase why the card waited.
  The remote-policy question the sketch raised was already settled by the owner's own earlier
  directive, quoted in this card's body: *"never file an issue on 23blocks-OS/ai-maestro … solve
  it yourself in our fork"* and *"ignore 23blocks-OS for now."* Nothing was decided here that the
  owner had not already decided; the fix only stops a script from contradicting it.
