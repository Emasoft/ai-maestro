---
trdd-id: IMCEYV9F
title: The pillar-index state dir still collects test litter — YN8EQWYP fixed one suite, other writers were never contained
column: dev
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-22T03:30:50+0200
updated: 2026-08-22T13:52:25+0200
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

### ATTRIBUTED 2026-08-22T03:4x — `ai-maestro-orchestrator-agent/tests/unit/test_trdd_link.py`

A **pytest** suite in `~/Code/EMASOFT-ORCHESTRATOR-AGENT/`. The slugs are pytest `tmp_path`
directory names — the test function name truncated to 30 chars with a numeric suffix, which
is where the otherwise inexplicable trailing `0` comes from. Three of four match verbatim:

| index slug | test function |
|---|---|
| `test-find-trdd-across-zones-an0` | `test_find_trdd_across_zones_and_case` |
| `test-find-trdd-does-not-mistak0` | `test_find_trdd_does_not_mistake_the_timestamp_for_the_id` |
| `test-find-trdd-survives-a-nega0` | `test_find_trdd_survives_a_negative_utc_offset` |

Mechanism closed end to end: that file's own comment says *"find_trdd shells to `trddgrep
show --porcelain`"*, and `scripts/trddgrep.mjs:751` resolves `indexPath(statePath(...))`. A
peer repo's pytest run spawns **our** CLI against a throwaway corpus, and **our** CLI writes
a permanent entry into the shared host dir. 12 per family = one per suite run.

This confirms the host-global claim rather than merely being consistent with it, and it
moves the fix: **prefer our side.** Peer-side containment (`HOME` in the subprocess env)
works but must be repeated by every repo that ever shells to a pillar CLI, and one that
forgets fails silently into someone else's home. A guard in `trddgrep` — do not persist a
host-global index for a corpus under a temp root — covers every caller, including callers
in repos we do not own. **We must not edit the peer repo** (cross-project rule); peer-side
work is an issue on `Emasoft/ai-maestro-orchestrator-agent`, not an edit here.

## ⚠ ADVISOR PATH FAILED — the design fork below is OPEN, not decided (04:07)

`~/.claude/rules/advisor-rules.md` forbids proceeding on a design decision without either an
advisor verdict **or an explicit note that both advisor paths failed.** This is that note.

- **Built-in advisor tool** — not present in this session's tool surface. Unavailable.
- **`fable-advisor:advisor` agent** — dispatched **twice**, killed twice. #1 (read 4 files,
  answer 4 questions) froze at 15,781 B; #2 (facts supplied inline, file reads FORBIDDEN, ≤400
  words) froze at 14,931 B. **Both froze ~30 s after dispatch, at ~15 KB**, i.e. at the initial
  context record, before any work. Two completely different prompts, one signature — so this is
  the agent, not the prompting.

I have therefore **not implemented the fix**, deliberately. It is Tier 0 and I am authorized to,
but the severity is `low` (disk litter accumulated over three weeks) and the one genuinely
contestable piece is a **predicate whose blast radius is every caller of these two functions**.
Shipping that unreviewed to save a night is the wrong trade.

**The fork, for whoever decides it:**

| question | my leaning | why it is contestable |
|---|---|---|
| predicate = "corpus realpath is under `os.tmpdir()`"? | yes | may be **too narrow** (a CI runner or container whose scratch root is not `$TMPDIR`) and **too broad** (a legitimate long-lived corpus deliberately kept under `/tmp`) |
| layer | a pure helper beside `corpusKeyFor` in `index-db.ts` | it must NOT go inside `index-open.ts`: both functions there hold an explicit never-silently-degrade contract, and a silent skip is exactly what that contract forbids |
| CLI (`trddgrep`) | reuse the existing `--no-index` walk path | already built, already tested, already prints a loud message — no new mechanism |
| lint (`pillars-lint`) | skip the dangling check, report it via the existing `skipped[]` | **weakest link.** It silently loses reference-integrity checking on a temp corpus, and the whole point of `216FTVC9` was that a check which cannot run must not look like a check that passed |
| alternative framings not evaluated | — | should the index simply not be host-global? would reaping orphaned keys (a corpus root that no longer exists can never be valid) replace the guard entirely and cover writers we never predict? |

**The reaping alternative deserves a real look before the predicate is built**, because it is the
only option here that needs no predicate at all and bounds the directory regardless of who leaks
into it — including callers in repos we do not own, which is precisely the case that produced
this card.

## ✅ FORK RESOLVED — REAPER, by measurement (2026-08-22, owner-delegated)

Owner delegated the decision: *"you can decide by yourself. base your decisions on verified
facts and tests. never assume anything."* Three measurements settled it; none of this was a
judgement call in the end.

**1. Composition of the leak — 97 of 102 are ephemeral, 5 are real.**

| corpus key | count | what it is |
|---|---|---|
| `t` | 43 | `basename($TMPDIR)` — corpora made directly under `$TMPDIR` |
| `test-find-trdd-across-zones-an0` · `…-does-not-mistak0` · `…-survives-a-nega0` · `test-issue-title-citation-roun0` | 12 **each** | four test families, twelve runs apiece |
| `tmp` · `scratchpad` · `plainrepo-kfhw` · `pillar-0impact-xdmckp` · `aim-caller-i6tn` · `otherproj2` | 1 each | fixtures |
| `ai-maestro` · `-plugin` · `-orchestrator-agent` · `-chief-of-staff` · `-assistant-manager-agent` | 1 each | **the 5 legitimate corpora** |

Twelve of each test family means the same test ran twelve times, each run minting a permanent
index because its temp root gets a fresh name and therefore a fresh `corpusKeyFor` hash.

**2. Stored paths are ABSOLUTE — so an orphan is exactly detectable, not heuristically.**
Read from a COPY of each file (never the original — opening a sqlite can create it, and
`applyPragmas` sets a persistent `journal_mode`, so an observer must not touch the subject):

- ephemeral: `/var/folders/…/T/pillar-graph-jMI1nR/tasks/TRDD-…-fixture.md` — root long gone
- real (control): `/Users/…/ai-maestro/design/archived/TRDD-…-secure-auto-restore.md` — exists

The control matters: it proves the schema is the same in both, so the test is not reading a
property peculiar to test indexes.

**3. Every worry the predicate carried dissolves under existence-testing.**

| the fork's stated risk for the predicate | under a reaper |
|---|---|
| too narrow — a CI runner whose scratch root is not `$TMPDIR` | irrelevant: it tests EXISTENCE, not location |
| too broad — a legitimate corpus deliberately under `/tmp` | irrelevant: if the root exists, it is kept |
| blast radius = every caller of those two functions | **zero** — the reaper touches no read path |
| the lint's weakest link: silently loses reference-integrity checking | does not arise — no skip is introduced, so `216FTVC9`'s invariant is untouched |
| covers writers we never predict, incl. repos we do not own | yes, and see below — that case is now MEASURED, not hypothetical |

**4. The source-fix is unavailable here — already established ABOVE, not by me.**

⚠ **Correction to my own working, recorded because the mistake is the instructive part.** I
searched this tree, found the four families nowhere, and wrote this up as a fresh finding. The
card had **already attributed them**, far more precisely, in §*"ATTRIBUTED 2026-08-22T03:4x"* —
`~/Code/EMASOFT-ORCHESTRATOR-AGENT/tests/unit/test_trdd_link.py`, a pytest suite, with three
slugs matched verbatim to test-function names and the trailing `0` explained as `tmp_path`'s
numeric suffix. I measured before reading the card's own top sections, which is the exact
failure `~/.claude/rules/lessons-verification.md` already records. My search also looked in the
janitor and tldr-code and not in the orchestrator repo, so it could not have found it.

What survives from that pass, and is new: `getStateDir()` is `join(homedir(), …)` with **no env
override**, and `os.homedir()` honours `$HOME` on POSIX — so peer-side containment is possible,
which is what makes the card's "prefer our side" a preference rather than a necessity.

**5. Guard vs reaper are not exclusive, and only the reaper is unconditional.** The card's
conclusion above favours a guard in `trddgrep` (do not persist a host-global index for a corpus
under a temp root). That PREVENTS the write; the reaper BOUNDS the directory afterwards. Both
sit on our side and cover peer callers. The difference is that the guard needs the contestable
predicate — the one whose blast radius is every caller of two functions — and the reaper needs
none, because absolute paths make an orphan a fact rather than a guess. At `severity: low` the
reaper alone is sufficient and carries no design risk, so it goes first. A guard may follow if
the churn (one index minted per peer suite run, reaped later) ever proves to matter; that is a
measurement nobody has yet needed to take.

**Constraint on the implementation — REPORT-ONLY by default.** `~/.claude/rules/never_free_space.md`
reserves deleting-to-free-space to the owner, and this repo already has the matching house
pattern: `check-script-drift.mjs` *"REPORTS, it must never refresh … remediation stays manual
and USER-gated"*. So the reaper reports orphans and exits `0` clean / `1` findings / `2` could
not run, and only an explicit opt-in flag removes anything. **The 102 existing files are NOT
deleted by this card** — clearing the standing backlog remains the owner's.

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

- [x] The writer of the 48 `test-*` files (2026-08-19) is identified by measurement, and
      named here — including which repo it lives in.
      **TICKED 2026-08-22T03:4x** — `ai-maestro-orchestrator-agent/tests/unit/test_trdd_link.py`.
      Evidence is a traced mechanism, not a name guess: 3 of 4 slugs match a test function
      verbatim under pytest's `tmp_path` naming, that file's own comment names the CLI it
      shells to, and `scripts/trddgrep.mjs:751` is the `statePath` call site that receives it.
      **Not yet done, and deliberately separate:** the confirming BEFORE/AFTER count around a
      run of that suite. The chain is decisive on its own, but a count is what would make it
      unfalsifiable — leave it for whoever does the containment.
- [ ] The writer of `scratchpad-*` (2026-08-22 02:59) is identified and contained.
- [ ] Every writer reachable from this repo is contained at its own layer.
- [ ] One run-level assertion exists that reddens for a writer it was not written for.
- [ ] The neuter is recorded: which mutation, which test reddened, how many.
- [ ] The residue is reported to the owner with its size, and left untouched.

## Approval log

- 2026-08-22T03:30:50+0200 — MANDATE issued by ai-maestro-hub (min-approval-requirement:
  none). Pre-approved: Tier 0 — in-scope test containment, reversible, no governance,
  baseline, or release surface. No approval request was sent.
