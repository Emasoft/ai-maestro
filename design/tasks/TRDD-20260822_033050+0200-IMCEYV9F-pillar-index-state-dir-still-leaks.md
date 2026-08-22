---
trdd-id: IMCEYV9F
title: The pillar-index state dir still collects test litter — YN8EQWYP fixed one suite, other writers were never contained
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-22T03:30:50+0200
updated: 2026-08-22T03:30:50+0200
current-owner: ai-maestro-hub
created-by: ai-maestro-hub
assignee: ai-maestro-hub
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub
approval-datetime: 2026-08-22T03:30:50+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 2
severity: low
effort: S
labels: [pillars, tests, containment, host-state]
external-refs: [TRDD-YN8EQWYP]
---

# The pillar-index state dir still collects test litter

## Problem

`~/.aimaestro/pillar-index/` holds **102 `.sqlite` files, 70 MB** (measured
2026-08-22T03:2x). Most are test corpora that no longer exist — indexes of `mkdtemp`
directories deleted the moment their suite finished.

This was already diagnosed and fixed once. **`TRDD-YN8EQWYP` is `complete`** and its fix
landed at `62d9db33` (2026-07-30T00:55:49) with a containment assertion that counts the
real directory either side of a run. Its own comment records the damage at the time:
*"Measured before the HOME redirect existed: +1 file per suite run, 43 accumulated in
~/.aimaestro/pillar-index/."*

**That fix held for the suite it touched, and the directory kept growing anyway.** Dating
every file makes the split unambiguous:

| family | n | dated | verdict |
|---|---|---|---|
| `t-*` | 43 | 2026-07-29 | YN8EQWYP's residue — the 43 its comment names |
| `pillar-0impact-xdmckp` | 1 | 2026-07-30 **00:54:45** | last pre-fix run — **64 s before** `62d9db33` |
| `tmp`, `aim-caller-i6tn`, `plainrepo-kfhw`, `otherproj2` | 4 | 2026-07-30 → 08-05 | **post-fix** |
| `test-find-trdd-*` ×3, `test-issue-title-citation-roun0` | 48 | 2026-08-19 | **post-fix**, 12 each |
| `ai-maestro`, `ai-maestro-plugin`, `-chief-of-staff`, `-orchestrator-agent`, `-assistant-manager-agent` | 5 | 08-02 → 08-22 | **legitimate** — real peer corpora |
| `scratchpad-*` | 1 | **2026-08-22 02:59** | **post-fix, tonight** |

So the leak is live, not historical: something wrote one 32 seconds after my own
`pillars-lint` run this session.

## Root cause

`corpusKeyFor` keys an index by `basename(dirname(realpath(corpusRoot)))` + a hash, and
`indexPath(statePath('pillar-index'), …)` puts it in the **host-global** state dir — which
is YN8EQWYP's own title: *"new server state shared by every agent on the host."* A corpus
under `mkdtemp` therefore gets a permanent entry in a shared directory, and when the corpus
is deleted the index is orphaned with no owner and no reaper.

Containment is per-caller, and there are **two different mechanisms**, which is why a
single sweep missed half of them:

1. **explicit path** — `openIndex(<tmp>/x.sqlite)` never touches `statePath`. Used by
   `pillar-index-{build,db,verify}.test.ts` and `kanban-index.test.ts`. Contained.
2. **`process.env.HOME` swap** — required whenever the path resolves through
   `statePath()`. `getStateDir()` reads `homedir()` at **call time**, so an in-process swap
   works; a spawned CLI needs `HOME` in the **child env**. Used by
   `pillar-index-open.test.ts` and the HOME-aware CLI suites.

A grep for `env.HOME` classifies group 1 as leaking (it does not) and cannot see a writer
outside this repo's `tests/` at all.

**The 48 files from 08-19 have no writer in this repo.** No suite here uses a
`test-`-prefixed `mkdtemp`, and their slugs (`find-trdd-across-zones`,
`issue-title-citation-round`) read like another repo's test titles. Because the directory
is host-global, any repo on this machine can fill it and this repo's tests can never
contain it — attribution is task 1, not a prerequisite to filing.

## Proposed fix

1. **Attribute the 08-19 and tonight's writers.** Take the count before and after each
   candidate suite rather than reasoning from names — a slug is a hint, a count is a
   measurement.
2. **Contain each writer at its own layer** (explicit path, or `HOME` in the spawn env).
3. **Give the containment ONE assertion that cannot go blind at a rename.** YN8EQWYP's
   assertion is per-suite, so a new writer is invisible to it by construction. A single
   check that the real dir did not grow across the whole run covers writers nobody has
   thought of yet — the only shape that survives the next new suite.
4. **Consider a reaper for orphaned keys** — an index whose `corpusRoot` no longer exists
   can never be valid again. Cheap, and it bounds the directory regardless of leaks.

## Verification

- `find ~/.aimaestro/pillar-index -maxdepth 1 -name '*.sqlite' | wc -l` does not increase
  across a full `bash scripts/with-node.sh yarn test` run. Take the count **before** the
  run; a post-mortem count cannot distinguish "contained" from "nothing ran".
- Neuter: remove one writer's containment → the run-level assertion reddens. If it does
  not, the assertion is measuring the wrong directory (an earlier YN8EQWYP draft called
  `homedir()` *inside* the swap and compared the fake dir against itself).

## Estimated risk

**LOW.** Test-side containment only; no production path changes. The reaper in step 4 is
the one piece that touches shared host state and can be deferred or dropped.

## Non-goals

**Deleting the existing 102 files is NOT in scope and is not mine to do.** 70 MB of state
in the owner's home directory is an owner decision (`~/.claude/rules/never_free_space.md`).
This card contains the *source*; it reports the residue and stops.

## Acceptance

- [ ] The writer of the 48 `test-*` files (2026-08-19) is identified by measurement, and
      named here — including which repo it lives in.
- [ ] The writer of `scratchpad-*` (2026-08-22 02:59) is identified and contained.
- [ ] Every writer reachable from this repo is contained at its own layer.
- [ ] One run-level assertion exists that reddens for a writer it was not written for.
- [ ] The neuter is recorded: which mutation, which test reddened, how many.
- [ ] The residue is reported to the owner with its size, and left untouched.

## Approval log

- 2026-08-22T03:30:50+0200 — MANDATE issued by ai-maestro-hub (min-approval-requirement:
  none). Pre-approved: Tier 0 — in-scope test containment, reversible, no governance,
  baseline, or release surface. No approval request was sent.
