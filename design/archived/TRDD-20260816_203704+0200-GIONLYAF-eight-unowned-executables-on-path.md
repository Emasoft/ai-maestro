---
trdd-id: GIONLYAF
title: Two PATH executables encode the superseded GitHub-as-SSOT kanban model and no repo ships them
column: completed
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-16T20:37:04+0200
updated: 2026-08-22T19:03:11+0200
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
effort: S
labels: [scripts, distribution, hub-self-audit]
external-refs: []
---

# Two executables encoding a superseded model, that no repo ships

## 🛑 STOP — 2026-08-21T16:4x: `kanban-sync.py` IS OWNED, and step 4 would have BROKEN a shipped skill

**The STATE block below is superseded on its central claim. Do NOT dispose of `kanban-sync.py`.**

It says the *"instructions still point at them"* premise is **REFUTED — both live docs are correct
as written**. Measured today, that is **wrong**, and the miss is one repo wide: a **LIVE, SHIPPED
plugin skill** — `ai-maestro-plugin/skills/team-kanban/`, in a plugin released **v3.1.31 on
2026-08-20** — declares and documents it:

| site | what it says |
|---|---|
| `SKILL.md:5` | `allowed-tools: … Bash(kanban-sync.py:*)` — a **declared tool** of the skill |
| `SKILL.md:34` | *"For GitHub sync: `gh` CLI authenticated, **`kanban-sync.py` at `~/.local/bin/`**"* — names the exact path this card calls unowned |
| `SKILL.md:36`, `:50` | worked invocations — `kanban-sync.py link <team-id> <owner/repo> <project-number>` |
| `SKILL.md:11` | *"GitHub-sync (`kanban-sync.py`, `gh`) is **OUT OF SCOPE — keep**"* — a deliberate, recorded decision to retain it |
| `references/github-sync.md:30,38,57,65,66` | a prerequisites line plus a full command reference |

**So the finding inverts.** `kanban-sync.py` is not litter with no owner; it is a **documented
dependency of a shipped skill that no repo installs**. "No repo ships it" was read as *nobody wants
it*; it is in fact an **install gap** — the plugin tells the user the file must be at
`~/.local/bin/` and ships nothing that puts it there. Deleting it would have broken the skill on
this machine and left the next reader debugging a missing command the docs promise exists.

**`kanban-sync.sh` is a separate question and may still be disposable** — the same skill calls it
**"Legacy"** (`SKILL.md:205`, `github-sync.md:20`) rather than declaring it. One of the two is
owned; the card treated them as one bucket.

**Why the earlier pass missed it, because the mechanism matters more than the miss:** it checked
"live docs" and found them correct — in a population that did not include another repo's shipped
skills. The needle was fine; **the corpus was drawn too small**, which is the same failure this
session hit repeatedly today from four different directions. A grep for the name across `~/Code`
finds it in seconds; a grep across *this* repo never can.

**Governance tension, recorded rather than resolved:** the skill's comment keeps `kanban-sync.py`
deliberately, while `universal-kanban.md` ratifies the TRDD corpus as the SSOT with GitHub as a
**mirror**. This card's title calls that model "superseded". Whether a shipped skill should still
offer GitHub-sync is a DESIGN question for `ai-maestro-plugin`'s own session — not a disposal
decision, and **not this repo's to make** (cross-project rule: reads anywhere, writes nowhere).

**REVISED NEXT ACTION:** nothing is deletable here today. The live question is the install gap, and
it belongs to `ai-maestro-plugin`.

**COLUMN: `todo` → `human_review` at 16:47.** `todo` claims a worker could pick this up; after the
inversion above, none can. What is left needs a person: **(a)** whether `kanban-sync.sh` — the one
the skill calls *"Legacy"* rather than declaring — may be disposed of, a removal outside any project
tree that `git` cannot undo and `/janitor-safe-delete` refuses; and **(b)** whether to file the
install gap on `ai-maestro-plugin`'s tracker, which is outward-facing under the shared owner
identity and therefore the USER's call, not this session's.

Recorded because the honest column is the whole point of the board: a card parked in `todo` with no
puller is indistinguishable from one being worked, and this card sat that way for five days while
its central claim was wrong.

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-16T22:33

> **⚠ Superseded on the ownership question by the STOP block above. The rest still holds.**

**Investigation COMPLETE. Steps 1-3 done. Only step 4 (disposal) remains, and it is not mine.**

| component | state |
|---|---|
| the census | **CORRECTED: 7 unowned, not 8** — `aimaestro-agent-bash` is a symlink (launcher bucket) |
| the "instructions still point at them" premise | **REFUTED** — both live docs are correct as written |
| provenance of the 2 unknowns | **ANSWERED** — AI Maestro's own, absent from all fetched history + the fleet, both zeros controlled |
| the real hazard | **FOUND and it is not litter** — they encode the pre-2026-07-08 GitHub-as-SSOT model |
| disposal (step 4) | **BLOCKED — USER's call.** See below |

**NEXT ACTION — none available to this session.** Every target lives in `~/.local/bin`, i.e.
**outside any project tree**, so `/janitor-safe-delete` refuses them and no recoverable in-repo path
exists. That is the same constraint as the `temp_git_*` cache checkouts, and it is why this stops
here rather than proceeding: the card's own step 4 names the risk plainly — *"removing an executable
another session is invoking breaks that session with an error that will look like something else
entirely"* — and an unattended removal outside the project tree is not recoverable by `git`.

**SUPERSEDED — do NOT carry forward:**
- *"eight unowned executables"* → **seven**.
- *"instructions still point at them"* → refuted for every live doc; the surviving hazard is that
  **the executables themselves are the documentation**.
- *"3 with provenance still unknown"* → **2**, and both are answered.

**Read first on resume:** the two INVESTIGATION sections below, in order — the second corrects the
first's count and reframes the finding.

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

## INVESTIGATION (steps 1-3 done 2026-08-16) — the premise is REFUTED for the live surface

Steps 1-3 were ordered before disposal precisely so the facts could change the plan. They did.

**Step 1 — provenance, from git history rather than assumption.** The 8 split three ways:

| class | n | files | fact |
|---|---|---|---|
| **deleted here, never uninstalled** | 3 | `docs-helper.sh` `graph-helper.sh` `memory-helper.sh` | all added `bbe4fc77` 2026-03-26 and all deleted `b862c6b0` 2026-04-18 — one feature added and removed together; the installed copies survived |
| **on a branch, not HEAD** | 1 | `aimaestro-agent.py` | added `c31cfe56` 2026-02-01, last seen `6d8c00b3`, absent from the HEAD tree |
| **never in this repo** | 4 | `aimaestro-agent-bash` `kanban-sync.py` `kanban-sync.sh` `watch-inbox.sh` | no add, no delete, ever |

**Step 3 — READ the two live docs, and neither is a defect:**

- **`docs/AGENT-COMMUNICATION-GUIDELINES.md:748`** — *"**Create** `~/.local/bin/watch-inbox.sh`:"*,
  followed by the script's contents in a fenced block. **The doc tells the reader to create it.**
  So `watch-inbox.sh` on PATH is the *product of following current documentation*, not orphan
  litter — no repo ships it because no repo is supposed to. **Correct behaviour; nothing to fix.**
- **`docs/SCRIPT-MANIFEST.md:520-529`** — the table sits under a heading stating these were
  *"Removed in `b862c6b0` … TRDD-70a521d9 — the RAG/CozoDB removal"* and that *"the plugin skills
  were never updated"*. **It is a table OF REMOVED SCRIPTS documenting a known gap** — the
  "deliberately historical" case the breaking-change rule explicitly preserves. **Correct as
  written.**

**So the card's premise — *"instructions still point at them"* — is REFUTED for every live doc.**

**And my own reference count was inflated three ways**, each of which this programme has a lesson
about:

1. **By my own documents.** Every one of the 8 appears in `GIONLYAF` and `BRRJK57P` *because I wrote
   the names into them tonight*. The observer modified the observed — third time in one evening.
2. **By a broken filter.** `grep -rl --include=*.md` returned `install-agent-cli.sh`, a `.sh` file.
   The known toolchain bug where `--include` silently does not filter, hit live.
3. **By an undecoded population.** The honest `find`-based sweep returns ~50 files, of which
   **~25 are chat-history archives, ~13 are dated `docs_dev/` audit reports, and 1 is a frozen
   archived TRDD** — text that *should* name a since-removed script, because it records history.
   **Two files are live instruction. Not seventeen.**

**Revised scope.** No documentation fix is needed. What remains is 3 files of genuine
missing-uninstall residue (documented as removed), 1 branch-only file, and **3 with provenance still
unknown** (`aimaestro-agent-bash`, `kanban-sync.py`, `kanban-sync.sh`) — the only open question, and
the only reason this card stays open rather than closing as refuted. Severity drops accordingly.

## INVESTIGATION 2026-08-16 (cont.) — the last open question, answered. 8 → 7 unowned, and the
## residue is not litter: two executables encode a SUPERSEDED governance model.

**`aimaestro-agent-bash` was never unowned — it is a SYMLINK** to `aimaestro-agent.sh`, so it
belongs in the *launcher → target* bucket beside the nine already there (it is a **second** link to
the same target as `aimaestro-agent`, which is why the first pass caught one and missed this one).

**That is a defect in my own census, and it is the interesting half.** The instrument classified by
*"no same-named repo file to byte-compare"* — and **a symlink has no bytes of its own to compare**,
so every symlink whose name differs from its target falls into UNOWNED by construction. `ls -la`
answers it in one call. The corrected count is **7 unowned, 2 of unknown provenance.**

(`stat -f '%z'` printed filesystem garbage on the same line — the GNU-vs-BSD trap this repo's
lessons file already records. Only the `|| ls -la` fallback produced the answer, which is the whole
argument for writing the fallback.)

### The two survivors: `kanban-sync.py` (346 lines) and `kanban-sync.sh` (384 lines)

**Provenance — absent from all fetched history, and the zero is controlled.** `git log --all
--diff-filter=AD` finds no add and no delete for either (control: `trddgrep.mjs` = 2 history lines);
`find ~/Code -maxdepth 4` finds neither (control: `publish.py` = 22 hits). Remote-tracking refs ARE
fetched (238 total, 3 on `origin`) and a known-upstream file resolves, so the search reaches real
upstream history. **Boundary stated rather than glossed:** only 3 `origin` refs are fetched, so an
unfetched upstream branch is not excluded.

Both are unambiguously AI Maestro's — they call `http://localhost:23000`, and `kanban-sync.sh`
self-identifies in its header as *"Part of AI Maestro (https://github.com/23blocks-OS/ai-maestro)"*.
Both dated **2026-03-15**, half an hour apart: one authoring session.

**They encode the INVERSE of the ratified kanban model, in two mechanically checkable ways:**

| | the script | the ratified rule |
|---|---|---|
| source of truth | `kanban-sync.py` docstring: *"GitHub is the sole source of truth."* | `aimaestro-kanban-multiagent.md:129`: *"Sync is **one-way authoritative**: the internal board is truth"* |
| column vocabulary | `kanban-sync.sh:108` — `local init_status="backlog"` | the ratified 17 columns begin at **`backburner`**; **`backlog` is not among them** |

**They are stale-by-supersession, not rogue.** The overlay was added **2026-07-08** and last revised
2026-07-18; the scripts are from **2026-03-15** — they predate the ruling by four months and nothing
removed them when the model changed.

**So the card's hazard survives in a sharper form than its original premise.** The refuted premise
was *"documentation still points at them"*. The real one is that **the executables themselves are
the documentation**: an agent that finds `kanban-sync.py` on PATH and reads its docstring learns
*"GitHub is the sole source of truth"* — the exact inversion of the rule it is meant to obey — and
`kanban-sync.sh` would write a `backlog` column no consumer admits. That is the
`check-all-files-after-breaking-change` failure mode one level below prose: **a superseded model
shipped as a runnable file, where no linter, type-check or test can see it.**

**Neither was executed** to establish any of this, per the standing rule about argv-less scripts.

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

## Acceptance

**Added 2026-08-21T16:53 — this card had ZERO checkboxes of either kind and no Acceptance section
at all, so it could never pass the completion gate, WHILE blocking `TRDD-BRRJK57P`.** Nothing
below revises the card's scope; it makes the already-decided remaining work expressible. (The gate
is written over unchecked boxes, so a card with no boxes passes having read nothing — the vacuity
`TRDD-5YRLA53W` exists to close. Found by the orchestrator's boxless census: 3 of 122 cards, and
this is the one that matters, because it gates another card.)

- [x] Step 1 — provenance established per file. 2 unknowns ANSWERED: AI Maestro's own, absent from
      all fetched history and from the fleet, both zeros positive-controlled.
- [x] Step 2 — each file READ, never executed (the `--help`-performs-its-side-effect rule).
- [x] Step 3 — instruction surface checked FIRST. Premise **REFUTED**: both live docs are correct
      as written. The surviving hazard is that **the executables themselves are the documentation**.
- [x] Census corrected **8 → 7**: `aimaestro-agent-bash` is an 18-byte symlink and belongs in the
      launcher bucket. A byte-compare census is structurally blind to symlinks — they have no bytes
      of their own, so they land in the unowned bucket by construction.
- [x] **OWNER DECISION 1 — disposal of the 2 superseded executables. RULED 2026-08-22: KEEP BOTH,
      no disposal.** The box asked whether to delete; the answer is no, and a decision NOT to
      perform a destructive act needs no owner authorization — so this closes here rather than
      queueing. Evidence, first-hand at current source HEAD:
      **`kanban-sync.py`** is a *declared tool* of a shipped skill (`allowed-tools` at
      `ai-maestro-plugin/skills/team-kanban/SKILL.md:5`), documented as required at
      `~/.local/bin/` (`:34`), deliberately retained (`:11`, `:50`).
      **`kanban-sync.sh`** — the one this card called "may still be disposable" — is documented
      in that same shipped skill's reference (`references/github-sync.md:203-205`) as *"still
      exists for backward compatibility"*. **Deleting it would make shipped documentation false**,
      which is the identical class of error the 🛑 STOP block caught for the `.py`, one layer
      down; and it exists in no git history anywhere, so the removal is unrecoverable.
      The superseded-model hazard is REAL and is **content in files the `team-kanban` skill
      owns**, not litter this repo may unilaterally destroy (cross-project rule: reads anywhere,
      writes nowhere). It therefore moves into the cross-repo report, not into a delete.
- [~] **OWNER DECISION 2 — the `kanban-sync.py` install gap. DESCOPED to TRDD-WMNE9OU3.**
      Reaching another project's tracker under the shared owner GitHub identity is outward-facing
      and `how-to-fix-issues-of-other-projects.md` requires explicit direction. The descope card
      carries BOTH findings — the install gap and the superseded model — because a report of only
      the first would leave the worse defect unfiled.
- [x] Once both are ruled: re-run the byte-compare census (the run, never the earlier figure — a
      census is a snapshot) and confirm the unowned bucket is empty or deliberately non-empty.
      **DONE 2026-08-22 — and it did not confirm the old figure, it quadrupled it: UNOWNED 7 → 31.**
      Deliberately non-empty, fully decoded, in the verdict section below. The delta is an
      instrument defect in the ORIGINAL census, now filed as **TRDD-YUK66AJO**.

## Estimated risk

MEDIUM, and concentrated entirely in step 4. Removing an executable another session is invoking
breaks that session with an error that will look like something else entirely. Steps 1-3 carry no
risk and are most of the value.

## Approval log

- 2026-08-16T20:37:04+0200 — MANDATE issued by the hub session (min-approval-requirement: none).
  Pre-approved: Tier-0 — this repo's own docs and its own installed scripts, reversible, local.
  Derived (EHT) from TRDD-BRRJK57P's axis-3 pass. No approval request was sent.
- 2026-08-21T16:53:40+0200 — Acceptance section ADDED (it had none, of either kind).
  Scope unchanged; the two OWNER decisions that were already the only remaining work are now
  expressible, so this card can be closed once ruled instead of gating TRDD-BRRJK57P forever.
- 2026-08-22T17:03:06.508Z — column → complete. Human review under the owner's standing grant. DECISION 1 RULED KEEP BOTH (no destructive act needed, so no owner authorization needed): kanban-sync.sh is documented in the shipped skill's own reference as still existing for backward compatibility, so deleting it makes shipped docs false - the same class of error the STOP block caught for the .py, one file later. DECISION 2 descoped to TRDD-WMNE9OU3 (outward-facing cross-repo write). Census box EXECUTED: re-ran symlink-aware with both spellings of the product name and passing controls, UNOWNED 7 to 31 - the original needle knew only the joined spelling and could not see its own subject. The 20-file delta is one commit (b862c6b0, the RAG/CozoDB removal) and is filed as TRDD-YUK66AJO. Nothing executed, nothing deleted.
- 2026-08-22T17:03:11.867Z — COMPLETED by user. 3 boxes resolved: 1 ruled KEEP on verified evidence, 1 descoped to WMNE9OU3, 1 executed (census re-run, 7 to 31, delta filed as YUK66AJO)..

## ⏹ 2026-08-22T19:0x+0200 — REVIEW VERDICT: COMPLETE (1 ruled, 1 descoped, 1 executed)

Reviewed under the owner's standing decide-on-my-behalf grant. Two of the three open boxes
turned out NOT to need the owner at all, and the third — the census re-run this card had
deferred behind them — is the one that produced a new finding.

### Decision 1 was mis-framed as an owner act, and the re-read is why

The box said *"disposal … is not this session's to take"*, which is true of a **deletion** and
says nothing about a **ruling**. The ruling is KEEP, and keeping requires no act at all. What
made it decidable was doing to `kanban-sync.sh` exactly what the 🛑 STOP block had done to the
`.py` — reading the shipped skill instead of the local tree:

```
$ SRC=~/Code/AI-MAESTRO-PLUGIN/ai-maestro-plugin/skills/team-kanban
$ grep -n 'kanban-sync' $SRC/SKILL.md
    5:   allowed-tools: "… Bash(kanban-sync.py:*), Read, Edit, Grep, Glob"
   11:   GitHub-sync (`kanban-sync.py`, `gh`) is OUT OF SCOPE — keep.
   34:   For GitHub sync: `gh` CLI authenticated, `kanban-sync.py` at `~/.local/bin/`
   36,50: kanban-sync.py link <team-id> <owner/repo> <project-number>
  205:   - Legacy: kanban-sync.sh
$ grep -n 'kanban-sync.sh' $SRC/references/github-sync.md
   203: ## Legacy: kanban-sync.sh
   205: The old `kanban-sync.sh` script (bash) still exists for backward compatibility.
```

The card had recorded the `.sh` as *"Legacy … and may still be disposable"* on the strength of
that word alone. The reference page **asserts its existence** and offers it as a fallback, so
deleting it makes a shipped skill's documentation false — the same defect, discovered the same
way, one file later. Both are KEEP.

### The census re-run: 7 → 31, because the original needle knew one of two spellings

The product's name is spelled **both** `aimaestro` and `AI Maestro` on disk. The original
census filtered its population on the joined form only. `kanban-sync.py` carries the spaced
form **13 times and the joined form ZERO times** — so the census that this card is built on
could not see its own subject; it appeared in the earlier list for other reasons. Re-run with
`ai[ _-]?maestro`, symlink-aware (TYPE read first), against a one-pass 3.7M-file index of
`~/Code` + `~/ai-maestro` with both controls passing (`publish.py`=42, `trddgrep.mjs`=1):

```
symlinks=196   identical=67   differing=2   UNOWNED=31   not_ours=38
```

| n | bucket | disposition |
|---|---|---|
| 4 | launchers — `aimaestro-agent` (122 B, execs its `.py`); `prrdgrep`/`specgrep`/`trddgrep` (one 5428-byte launcher installed under three names, dispatching on `$0`) | correct by design |
| 3 | `*.bak-20260808_153204+0200` | residue → `YUK66AJO` |
| **20** | `docs-*.sh` (8) · `graph-*.sh` (10) · `memory-*.sh` (2) | **new** → `YUK66AJO` |
| 1 | `aimaestro-agent.py` — on a branch, not HEAD | unchanged |
| 1 | `watch-inbox.sh` — the doc tells the reader to create it | correct behaviour |
| 2 | `kanban-sync.py` · `kanban-sync.sh` | KEEP (above); content defect → `WMNE9OU3` |

4+3+20+1+1+2 = 31. The 20 are ONE commit: added `bbe4fc77` (2026-03-26), removed `b862c6b0`
(TRDD-70a521d9, the RAG/CozoDB removal) — verified per file with `git log --all
--diff-filter=AD` on four spanning all three families. `docs/SCRIPT-MANIFEST.md` already
documents that removal and says *"the plugin skills were never updated"*, so the docs are
correct and the gap is a missing **uninstall step**. This card classified 3 of the 20 and
could not see the other 17 for the needle reason above.

### What this card got right, and the one thing it did not

Right, and worth keeping: the STOP block's inversion (`kanban-sync.py` is an install gap, not
litter), the symlink correction (8 → 7), the refutation of *"instructions still point at
them"* for every live doc, and the honest re-column to `human_review` when it found no puller.

Not right: **its census under-counted by 4x**, and the under-count was invisible because the
number looked precise. Same family as the symlink blindness it had already caught — a census
is only ever a statement about the population its filter admits. Filed rather than patched
here, because the residue is 20 files with one owner and one disposition.

### Nothing was executed and nothing was deleted

No script on `~/.local/bin` was run (the argv-less `--help`-performs-its-side-effect rule), and
no file was removed. The three follow-ups are `WMNE9OU3` (cross-repo report), `YUK66AJO` (the
20 + 3 residue), both owner-gated, and neither blocks `TRDD-BRRJK57P` any longer.
