---
trdd-id: GIONLYAF
title: Eight executables on PATH are shipped by no repo in the fleet and are still named in instructions
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T20:37:04+0200
updated: 2026-08-16T20:37:04+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-16T20:37:04+0200
derived: true
derived-kind: eht
parent-trdd: BRRJK57P
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: medium
effort: M
labels: [scripts, distribution, hub-self-audit]
external-refs: []
---

# Eight executables nobody ships, that documentation still tells agents to run

## Problem

A byte-compare census of `~/.local/bin/*` (filtered to files whose content mentions aimaestro — 59
files) returned **38 identical / 0 differing / 21 without a same-named repo file**. The 21 resolve
into three buckets, and only the third is a defect:

| bucket | n | what |
|---|---|---|
| launcher → target | 9 | `trddgrep`/`prrdgrep`/`specgrep` → `.mjs`; `aimaestro-agent` + 5 `amp-*` → `.sh`. Correct by design. |
| `.bak-20260808_153204+0200` | 3 | backups of `aimaestro-continuity/panel/session.sh` sitting **on PATH** |
| **UNOWNED** | **8** | `aimaestro-agent-bash` · `aimaestro-agent.py` · `docs-helper.sh` · `graph-helper.sh` · `kanban-sync.py` · `kanban-sync.sh` · `memory-helper.sh` · `watch-inbox.sh` |

The 8 are absent from this repo **and from every repo under `~/Code` at depth 4**. Positive controls
for both searches: `trddgrep.mjs` found here; `publish.py` found in two repos at two *different*
nesting depths, so the depth covers both layouts. They date from **Dec 2025 to Aug 2026** —
`aimaestro-agent.py` is 47 KB from **February**.

**They are not merely litter: instructions still point at them.** Bounded to this repo +
`~/.claude/rules`, 5 of the 8 are still named in md files (`memory-helper.sh` twice). The unbounded
`~/Code` sweep timed out at 8m20s having already returned **17 md files for `aimaestro-agent-bash`
alone**, so the real instruction surface is materially larger than the local count.

That is the `check-all-files-after-breaking-change` failure mode: prose naming a removed thing still
executes, and neither tsc nor lint nor any test can see it, because it is prose.

## Root cause

Not measured, and the card must not assume one. Two candidates: they were shipped by an earlier
version of this repo and removed without an uninstall step, or they came from a repo that no longer
exists. `git log --diff-filter=D --name-only -- '*<name>*'` answers it per file and is part of the
work.

## Proposed fix

**Investigate before removing anything — the order matters.**

1. **Establish provenance per file** (git history here; then the fleet). A file that once lived here
   is a missing-uninstall bug; a file that never did is a different finding.
2. **Read each one.** 47 KB of Python on PATH from February may be dead or may be something an agent
   still invokes successfully. **Do NOT execute them to find out** — the standing rule about
   `install.sh`-shaped scripts with no argv parsing applies: a script can perform its side effect on
   any flag, including `--help`.
3. **Fix the instruction surface FIRST**, before touching the binaries. A doc that names a script
   nobody ships is wrong whether or not the script is deleted; correcting the doc is safe and
   independent, and it shrinks the blast radius of any later removal.
4. **Then dispose**, per file: re-home under `scripts/` if it is genuinely wanted, or
   `/janitor-safe-delete` it (it is inside a project tree — recoverable, so no approval is needed).
   The 3 `.bak-` files go the same way.

## Verification

- The byte-compare census re-run shows the unowned bucket **empty**, and — because a census is a
  snapshot, never a citable number — the run itself is repeated rather than the earlier figure
  quoted.
- `grep -rl "<each name>" --include=*.md` over this repo + `~/.claude/rules` returns **0**, or every
  remaining hit is deliberately historical ("X no longer exists").
- Nothing that was deleted is unrecoverable: each removal is either a `git mv` into `scripts/` or a
  `.trashcan/` entry with its manifest.

## Estimated risk

MEDIUM, and concentrated entirely in step 4. Removing an executable another session is invoking
breaks that session with an error that will look like something else entirely. Steps 1-3 carry no
risk and are most of the value.

## Approval log

- 2026-08-16T20:37:04+0200 — MANDATE issued by the hub session (min-approval-requirement: none).
  Pre-approved: Tier-0 — this repo's own docs and its own installed scripts, reversible, local.
  Derived (EHT) from TRDD-BRRJK57P's axis-3 pass. No approval request was sent.
