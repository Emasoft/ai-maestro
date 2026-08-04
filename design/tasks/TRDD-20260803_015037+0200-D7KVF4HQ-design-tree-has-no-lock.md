---
trdd-id: D7KVF4HQ
title: Give the pillar edit tools a transaction system — locks, queue, and CAS on the original text
column: dev
scope: project
project-id: ai-maestro
created: 2026-08-03T01:50:37+0200
updated: 2026-08-04T12:30:34+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-03T02:06:07+0200
severity: high
effort: large
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
labels: [trdd-tooling, prrd-tooling, spec-tooling, concurrency, project-scope-sharing, data-integrity]
external-refs: [Emasoft/ai-maestro#57]
---

# Give the pillar edit tools a transaction system — locks, queue, and CAS on the original text

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-04

**ALL THREE TOOLS SHIP THE TRANSACTION. 15 of 15 acceptance boxes met.** The residual is in
ANOTHER repo and is tracked as `Emasoft/ai-maestro-plugin#54` — see *The `prrd-edit.py`
double-writer* below for the decision and why it cannot be closed from here.

| commit | what |
|---|---|
| `422ed7f8` | `replaceAtLines` — the `AT LINE N REPLACE X WITH Y` primitive |
| `41c913bf` | the lock keyed on **identity, not path** |
| `99997a06` | all 5 TRDD write verbs async under that lock (USER's option A) |
| `31d297f4` | the verb-lock test the neuter proved was missing |
| `70c7ef65` | **`prrdgrep` + `specgrep`**, on the shared core `lib/pillar/cli.ts` |
| `267bd79a` | **`trddgrep edit`** — the third tool the directive names |
| `b03d4dae` | one identity for a TRDD id, across lookup and locking |

**FOUR DEFECTS FOUND WHILE BUILDING, none of which the existing suite could see.** Each is
recorded in full in its commit; the short form, because each is a class that will recur:

1. **The lock key was wrong for both new pillars.** `documentLockKey` takes a RECORD id, correct
   only where id↔document is 1:1 — TRDD and nothing else. PRRD is ONE file of bullets, SPEC is N
   files of clauses, so two writers of one file took two lockdirs. `documentLockKeyFor` now
   dispatches on `kind.source.mode`.
2. **`PillarRecord.line` was BODY-relative, not FILE-relative** — off by the frontmatter height.
   It shipped because both existing consumers only PRINTED it. The third ACTS on it: had line
   N+offset happened to contain the expected substring, `prrdgrep edit` would have **silently
   rewritten the wrong rule**. Caught by the POSITIVE CONTROL failing.
3. **`withTrddLock` keyed on the caller's RAW id** — so `abcd1234` and `ABCD1234` (both permanently
   valid) produced two lockdirs. The same bug as (1), one level up, in code committed 3 commits
   earlier **on this card**.
4. **`findTrdd` 404'd on `TRDD-<id8>`** — the canonical citation form — while the CLI resolved it.

**THE LESSON THAT COST THE MOST TIME, and it is about the FILESYSTEM.** Defect 3's case-only
variant is **invisible on macOS**: APFS is case-INSENSITIVE, so `mkdir .trdd-lock-abcd1234` beside
`.trdd-lock-ABCD1234` returns EEXIST and the two keys accidentally collide into ONE WORKING LOCK
(verified with a bare `mkdir`). On ext4 — i.e. CI — they are two directories and two writers
proceed at once. So a behavioural test of it on a dev Mac **cannot fail**, and its passing says
nothing. The guard is pinned on the KEY rather than on an observed block, and the reason is in the
code so nobody "improves" it into a test that cannot fail.

**AND THE TEST THAT PINNED NOTHING.** The first version of the key-agreement test computed its
expectation the same way the fix does (`documentLockKey(dir,'trdd',normalizeId(x))`) and never
called `withTrddLock` at all — it passed with the fix **fully reverted**, and only the neuter
reddening NOTHING exposed it. `trddLockKey` is now a named export so both sides of the comparison
are SHIPPED functions.

**USER DIRECTIVE, 2026-08-03 — this supersedes the original card's scope.** Verbatim:

> the risk of corrupting the design files is high since there is no central lock system, and design
> folders are often synched between agents working on the same project via **symlinks**. To solve this,
> you must modify every edit tool (`trddgrep`, `prrdgrep`, `specgrep`) to integrate a **transaction
> system** for editing, with **atomic changes, locks, writing queues, deterministic changes, diff
> changes, line by line replace functions to enforce replace only on the original text**, otherwise the
> message *"The content of the TRDD/PRRD/SPEC file changed since your command was enqueued. Please
> reread the file first."* or similar warning.

**USER DIRECTIVE 2, 2026-08-03 — the edit primitive, and the PRRD/SPEC decision.** Verbatim:

> the `trddgrep`, `specgrep` and `prrdgrep` (**if they do not exist, you must create them**..) must use
> a editing procedure like **AT LINE N REPLACE X WITH Y**, so if X is not found, this means the file
> has changed and **the command is blocked**.

This resolves the open question the card carried: **`prrdgrep` and `specgrep` are CREATED HERE**, as
siblings of `trddgrep`, with the transaction layer built in from line one. It is no longer a
cross-repo negotiation with the janitor's `prrd-edit.py` — and because the lock is a filesystem
`mkdir` directory, Python can take the identical lock, so a surviving `prrd-edit.py` is fixable rather
than fatal.

**DONE 2026-08-03:** the primitive is built, tested and neutered — `lib/pillar/edit.ts::replaceAtLines`
(commit `422ed7f8`). It is at the **pillar** layer, not inside `trdd-store`, because
`lib/pillar/kinds.ts` already carries `PillarName = 'trdd' | 'prrd' | 'spec'` and `PILLAR_KINDS`, so
`prrdgrep` / `specgrep` inherit the transaction core instead of reimplementing it. 10 tests; two
disjoint neuters recorded below.

**NEXT ACTION — and it opens a fork that must be decided before code:** route
`lib/trdd-store.ts`'s four write verbs through the seam. **The whole module is SYNCHRONOUS and
`withJsonLock` is async.** Measured ripple:

```
writers:        editTrdd:303   promoteTrdd:363   refuseTrdd   archiveTrdd:468
route callers:  app/api/trdd/[id]/route.ts · .../approve/route.ts · .../refuse/route.ts
test callers:   tests/unit/trdd-edit-guard.test.ts (5 sites) · tests/unit/trdd-store.test.ts
```

Two ways, and they are not equivalent:

**A — make the four verbs `async`** and route through `withJsonLock`. Correct, and the ripple above is
the cost (3 routes + 2 test files). Route handlers are already async, so that half is free.

**B — add a SYNC lock variant** (`mkdirSync` on the same `${file}.lock`) so the sync module keeps its
signatures. It IS the same physical lock — the lockdir is the exclusion object and the in-process
queue is only fairness — so A and B interoperate. **But a sync spin-wait blocks the Node event loop
for the whole process**, and three of the callers are server route handlers. That makes B wrong for
exactly the callers that matter, and acceptable only for a standalone CLI.

**DECIDED BY THE USER: A.** Landed `99997a06`. All five write verbs (`editTrdd`, `promoteTrdd`,
`refuseTrdd`, `advanceColumn`, `archiveTrdd`) are async and run inside
`withJsonLock(documentLockKey(designDir, 'trdd', id), …)`. **The lock wraps the WHOLE verb, `findTrdd`
included** — a transition is find → `git mv` → edit → stage and those must be one unit; a peer that
moves the card between our find and our move leaves us editing a path that no longer holds it.

Ripple was exactly as measured and entirely mechanical: 5 route call sites gained `await` (handlers
were already async), 16 test callbacks became `async` across 2 files. **B stays rejected in writing**
so it is not re-proposed on the grounds that it preserves signatures.

**NEXT ACTION:** create `prrdgrep` and `specgrep` on the shared core (`lib/pillar/edit.ts`), then
settle the `prrd-edit.py` double-writer.

## What the USER's directive corrects about the original card

The original card called this **latent** — "true today only because one agent works the board at a
time". That was wrong, and wrong in the dangerous direction. **Design folders are symlinked between
agents working the same project**, so concurrent access is the *operating model*, not a future
condition. Severity raised `medium → high`, effort `medium → large`, and the scope widened from the
TRDD tree to all three pillars.

Measured caveat, so the record is honest: `find ~/agents ~/Code -maxdepth 3 -name design -type l`
returns **nothing on this host right now** — but no agent is currently awake (see `#40`), so that is
the fleet being down, not the model being different. The USER states the deployment model; my
measurement cannot observe it while nothing is running.

## What already exists — this is the load-bearing finding

**`lib/trdd-store.ts::editTrdd` is already the single write funnel**, by design and by its own
documentation (`lib/trdd-edit-guard.ts`):

> *"`lib/trdd-store.ts::editTrdd` is the ONE funnel every write path in the system goes through (the
> API route, the CLI, every lifecycle verb)."*

Measured:

| tool | writes? |
|---|---|
| `scripts/trddgrep.mjs` | **0** write calls — read-only |
| `scripts/aimaestro-trdd.sh` | **0** write calls — routes through the API |
| `app/api/trdd/[id]/route.ts` | calls `editTrdd` |
| `lib/trdd-store.ts::editTrdd` | **the write** |

So "modify `trddgrep`" resolves to **"add the transaction layer at `editTrdd`"** — one place, not many.
That is the single most useful fact for whoever picks this up: the choke point the directive needs
already exists, and putting the lock anywhere else would create the second locking model this card must
avoid.

**What `editTrdd` guarantees today:** validation. `lib/trdd-edit-guard.ts` (TRDD-SCMPWF6R) refuses an
invalid value *before* the write, because a permissive editor once left 158 cards with no `column:` at
all. **What it does not guarantee:** anything about concurrency. `grep -n 'withLock' lib/trdd-store.ts`
→ **nothing**. No lock, no queue, no compare-and-swap.

## The lock — `withLock` is the WRONG primitive here, and reading it is what showed that

**Correction to this card's first draft, which said "reuse `withLock`".** `lib/file-lock.ts:192`'s
`withLock` is a **PROCESS-LOCAL** `Map`+`Set` mutex, and its own header says so under REG-MIN-05:

> *"The Map+Set machinery below is PROCESS-LOCAL. It serialises concurrent load→modify→save sequences
> within a single Node.js process but provides NO protection against: … Test harnesses or CLI utilities
> directly importing registry modules while a dev/prod server is running."*

The USER's threat model is **N agents on one host through symlinked design folders** — N *processes*.
A process-local mutex protects nothing there. Reusing it would have produced a lock that is correct,
tested, and inert against the exact race this card exists to stop.

**The right precedent is already in this codebase**, at `lib/json-io.ts` — the ONE lock + write path
for every settings mutation (TRDD-RYFP030K):

```ts
:176   const lockDir = `${filePath}.lock`        // taken with mkdir(recursive: false)
```

A **lock DIRECTORY beside the file**, acquired by `mkdir` failing atomically when it exists. Three
properties this card needs and `withLock` cannot give:

1. **Cross-process** — the filesystem is the shared object, not a Map in one heap.
2. **Cross-language** — Python's `os.mkdir` takes the identical lock, which is what makes the
   `prrd-edit.py` double-writer resolvable at all.
3. **Per-document by construction** — the lock path is derived from the file path, so the unit of
   exclusion is one card, never the tree.

And `json-io.ts`'s header already records the failure this card must not repeat, in its own words:

> *"AgentlensPro's is a FILE at `${file}.agentlens-lock` taken with O_EXCL. Two different paths AND two
> different mechanisms … leaving a `withSettingsLock` caller silently unprotected against this module,
> which is the very split this card exists to close."*

**Same mechanism, same path convention, or it is not the same lock.** `mkdir` on `${file}.lock` — not
O_EXCL, not a `.lock` file, not a different suffix.

## The edit primitive — `AT LINE N REPLACE X WITH Y` (USER-specified, canonical)

Every mutation in all three tools goes through one operation:

```
AT LINE <N> REPLACE <X> WITH <Y>
```

- `N` — the line number, from the caller's read.
- `X` — the **exact original text** the caller believes is at that line.
- `Y` — the replacement.
- **If `X` is not found at line `N`, the file changed since the read → the command is BLOCKED**, with
  the directive's message: *"The content of the TRDD/PRRD/SPEC file changed since your command was
  enqueued. Please reread the file first."*

**Why line-anchored rather than file-wide unique-match** (the harness `Edit` tool's shape): the line
number turns an O(file) search into an O(1) check, makes the failure message precise (*"line 14 no
longer reads …"* rather than *"no match"*), and — the load-bearing part — a caller that read line 14
and edits line 14 is asserting something a whole-file match cannot express: **that its view of that
specific line is current.** A unique-match edit silently succeeds when the content moved to a different
line, which for frontmatter (where `column:` may legitimately appear in a fenced example in the body)
is precisely the wrong outcome.

**A blocked command is not an error to swallow.** The whole value is that it is loud: the caller must
re-read and re-issue. A tool that retries automatically, or that falls back to a fuzzy match, has
deleted the guarantee while appearing to implement it.

**This is the CAS clause, and it is the half a lock cannot provide** — it catches a change made by
anything that never took the lock: a hand edit, a `git mv`, a symlinked peer, another tool.

## PRRD and SPEC — the directive names two tools that do not exist (RESOLVED: create them)

```
trddgrep : ON PATH   (scripts/trddgrep.mjs)
prrdgrep : ABSENT    — not on PATH, not in this repo
specgrep : ABSENT    — not on PATH, not in this repo
```

So for PRRD and SPEC there is **no funnel to extend** — that half is a **create**, not a modify.

**RESOLVED by USER directive 2: create them here.** `prrdgrep` and `specgrep` are built as siblings of
`trddgrep`, sharing the same transaction core from line one. The janitor's `prrd-edit.py` is no longer
the design centre for PRRD edits.

**The residual hazard this decision does NOT remove**, and which must be handled explicitly:
`prrd-edit.py` still exists and still writes. So the moment `prrdgrep` ships, **two writers exist for
the PRRD** — one here holding our lock, one in the janitor holding nothing (or its own). A lock in this
repo and a lock in the janitor's Python tool would exclude each other **nowhere**, which is worse than
no lock because it reads as protection. (Recorded failure: two modules each individually correct,
contending for nothing, because "one lock" meant one *function name* rather than one physical object.)

Two acceptable resolutions, and the choice must be recorded here before `prrdgrep` ships:

1. **One physical lock both honour** — a filesystem lock (a lockdir / flock on a path both tools
   compute identically), since they are different languages in different processes and cannot share an
   in-process Map. This is the only mechanism that actually excludes across the boundary.
2. **`prrd-edit.py` is retired** in favour of `prrdgrep`, coordinated with the janitor — one writer,
   no cross-language lock needed.

The CAS clause partially mitigates either way — an edit by the unlocked writer is *detected* by the
locked one, because the line no longer matches — but detection after a lost update is not the same as
preventing it.

### DECIDED 2026-08-04 — option 1, and it is filed as `Emasoft/ai-maestro-plugin#54`

**Option 1: one physical lock both honour.** Option 2 is not this card's to take — the IND rule
`prrd-design-rules.md` cites `prrd-edit.py` by name and documents its `403 — propose via COS`
authority check, so retiring it would leave that enforcement homeless. It is named in the issue as
the other real option, not recommended.

**Read before ruling, not reasoned about.** `prrd_lib.write_prrd` (verified against the LIVE repo
HEAD at v2.11.0, not the stale plugin cache) is:

```python
p.write_text(render_prrd(doc), encoding="utf-8")
```

— **unlocked AND non-atomic**, re-emitting the WHOLE document from a parsed model. So the second
defect is real *today* with no second writer required: a crash mid-write truncates the project's
constitution. That is in the issue too.

**The lock path was OBSERVED on disk while held, not derived** — and the intuitive guess is wrong:

```
<project>/design/requirements/.prrd-lock-PRRD.md.lock
```

`withJsonLock` appends `.lock` to the KEY, and the key already contains `PRRD.md`. A Python side
that guessed `PRRD.md.lock` would take a second lock and exclude nothing — the exact failure this
section exists to prevent, re-created by the fix for it.

**Why this card cannot close the hazard:** `prrd-edit.py` lives in `Emasoft/ai-maestro-plugin`, a
different repo, so the standing constraint is issues-only. The DECISION is recorded here; the
hazard closes when #54 lands. Until then a PRRD is protected against concurrent `prrdgrep` writers
and NOT against `prrd-edit.py` — and the CAS still *detects* the latter, which is the mitigation,
not the fix.

## The transaction contract (from the directive, made testable)

Each clause restated as something a test can pin:

| directive clause | testable form |
|---|---|
| **locks** | a second writer to the same card cannot proceed while the first holds it |
| **atomic changes** | the `column:` edit and the zone `git mv` land together or not at all |
| **writing queues** | a blocked writer waits and then proceeds — it does not fail, and does not lose its edit |
| **deterministic changes** | the same command on the same input yields byte-identical output |
| **diff changes** | the write is expressed as a diff against the read snapshot, not a whole-file rewrite |
| **line-by-line replace, only on the original text** | the replace targets the exact text read; if it no longer matches, **refuse** |
| **the warning** | `The content of the TRDD/PRRD/SPEC file changed since your command was enqueued. Please reread the file first.` |

The last two are **optimistic concurrency (compare-and-swap)** and they are the heart of it: the
harness `Edit` tool's contract — *fail loudly when `old_string` no longer matches* — applied to the
pillar CLIs. That is a stronger guarantee than a lock alone, because it also catches an edit made
**outside** the tooling (a hand edit, another agent's `git mv`, a symlinked peer), which no lock can
ever see.

**Both are required, and neither substitutes for the other.** The lock serialises writers who use the
tool; the CAS catches everything else. A design with only the lock is safe against agents and blind to
humans.

## Why the atomicity clause is the sharp one

A TRDD state change is **two operations that must be atomic together**: the `column:` frontmatter edit
and the `git mv` between zone folders. A lost update on a JSON store drops an edit — recoverable and
obvious. A lost update here leaves a card whose **column and folder disagree**, which is precisely the
corrupt state the zone layout exists to make impossible, and the doctor then reports a ZONE-MISMATCH
with no way to tell which half was intended.

## Constraints any implementation must satisfy

- **The unit of exclusion is ONE card, not the tree.** A tree-wide lock serialises unrelated work, and
  a lock people route around is worse than none.
- **The lock must span the edit AND the move.** Holding it for one half re-introduces the mismatch
  under a lock that reads as correct — the most expensive outcome.
- **ONE physical lock across all three pillars and both languages** (see the PRRD/SPEC section). Not one
  per tool, not one per process.
- **Reuse `lib/json-io.ts`'s `mkdir` lock-directory mechanism verbatim** — same path (`${file}.lock`), same primitive. NOT `withLock` (process-local; see the lock section above). A second mechanism or a second path is a second lock, and two locks exclude each other nowhere.
- **Crash safety:** a process killed mid-move leaves a state the doctor can classify, never a card in
  neither zone.
- **A hand edit outside the tooling takes no lock at all** — which is exactly why the CAS clause is not
  optional. State this limit rather than hide it.

## Neuter record — 2026-08-03, `lib/pillar/edit.ts` (via `scripts/dev/neuter`)

Two guards, two neuters, and the attribution is **disjoint** — neither test set can be reddened by
the other guard's mutation, so each is pinned by tests only it reddens:

| neuter | red | which tests |
|---|---|---|
| CAS disarmed (`if (actual === undefined \|\| !actual.includes(e.expect))` → `if (false)`) | **4** | BLOCKS when the line changed · BLOCKS past end of file · carries the USER-specified message · is ALL-OR-NOTHING |
| lock removed (`withJsonLock` → pass-through identity) | **1** | a contender cannot complete while the lock is held, and completes once released |
| lock key reverted to the PATH (`opts.lockKey ?? filePath` → `filePath`) | **1** | two writers on the SAME id via DIFFERENT paths still exclude each other |
| `withTrddLock` → direct `withJsonLock` (the verb lock removed) | **1** | the write verbs hold the document identity lock |

## Neuter record — 2026-08-04, the two CLIs and the id-identity fixes

Eight neuters total on this card. Every one names the tests it reddens, and the two that reddened
**nothing** are recorded as findings about the TESTS rather than quietly re-aimed:

| # | neuter | red | which tests |
|---|---|---|---|
| 1 | `documentLockKeyFor` per-line branch → record-id keying | **2** | identical for two records of one per-line document · BEHAVIOURAL two-bullet exclusion |
| 2 | `recordsOf` drops `+ doc.bodyLineOffset` | **9** | both pillars' "prints the FILE line" · the edit POSITIVE CONTROL · the batch positive control · the specgrep twin · the declaration-vs-citation test · 2 store tests |
| 3 | the `STALE ` token dropped from the CLI's stderr | **2** | STALE is the FIRST stderr token · the specgrep second-run block |
| 4 | `--at-line` no longer always opens the next edit | **2** | trailing `--at-line` binds to its OWN edit · the batch positive control |
| 5 | `assertCorpusRoot` removed from the CLI | **3** | both pillars' "exits 2 when the corpus is ABSENT" · the STALE-token test's no-corpus arm |
| 6 | `trddLockKey` drops `normalizeId` | **2** | store key equals CLI key via both real paths · the PREFIXED-id block |
| 7 | `documentLockKeyFor` per-document branch keeps the caller's spelling | **1** | INSENSITIVE to how the caller spelled the TRDD id |
| 8 | `findTrdd` back to `toUpperCase()` | **1** | the PREFIXED-id block |

**Two neuters reddened NOTHING before these, and both were faults in the TEST:**

- Neuter 6's first target — the key test **re-implemented the fix** instead of calling it. Rewritten
  to compare two shipped functions.
- Neuter 6's second target — the behavioural rewrite used the **lowercase** spelling, which APFS
  masks (above). Re-aimed at `TRDD-<id8>`, which differs by more than case on any filesystem.

A third measurement error is recorded because it produced a **silent false green**: the neuter runs
were first issued as `vitest run $T` with `T` a space-joined variable, and **zsh does not
word-split it** — vitest printed `No test files found`, exited 1, and the report grep matched
nothing, which read exactly like "clean". Every neuter above was re-run with literal paths and a
positive control proving the harness runs at all.
| `withTrddLock` → direct call (`lib/trdd-store.ts`) | **1** | a verb cannot proceed while the document lock is held, and completes once released |

**The fourth neuter found the lock SHIPPED UNPINNED, and that is the most useful thing it has done.**
Run against the 54 existing `trdd-store` / `trdd-edit-guard` tests it reddened **nothing** — the lock
was live, correct, and untested. The reason is structural, not an oversight: **every existing test
drives a SINGLE writer, and a single writer never contends.** A guard whose failure mode requires two
actors cannot be caught by a suite that only ever supplies one, however thorough that suite is. The
test written for it reddens on the identical mutation.

**The path-keying neuter records a defect found by READING, not by a failing test.** `promoteTrdd` /
`refuseTrdd` / `archiveTrdd` each `git mv` the file and THEN edit it at the new path, so a lock keyed
on the path is taken on `proposals/X.md` by one writer and `tasks/X.md` by another — **two locks, zero
exclusion, both looking correct from inside.** Fixed by `documentLockKey(corpusRoot, kind, id)`: the
id is the only thing stable across a move. Same failure `json-io`'s header records against
O_EXCL-vs-mkdir, from a different direction — there two mechanisms, here one mechanism with two names
for the same document.

**A third mutation is recorded because it produced a NON-result and that is worth keeping.** An
earlier attempt at neuter 2 rewrote the `return withJsonLock(` line into invalid TypeScript; the run
reported *"no tests"*, which the tool correctly flagged as ambiguous — *"nothing red — the guard is
UNPINNED, or the mutation missed the branch under test"*. A broken mutation and an unpinned guard look
identical in the output. Re-aimed at the import (keeping the file valid) it reddened exactly one test.

## Verification

```bash
grep -n 'withLock' lib/trdd-store.ts        # must be non-empty when done
grep -rn 'withLock(' lib/ services/ | grep -c design
```

A test must pin the interleaving **deterministically**, not by racing: hold the lock, assert the
contender **cannot complete**, release, assert it then does. Firing N concurrent writers and asserting
all survive passes with the lock removed — whether the losing interleaving occurs is the scheduler's
choice, not the test's. The release-then-completes half is a mandatory positive control, since "did not
complete" is equally satisfied by a contender that threw or was never called.

The CAS half needs its own test and its own neuter: read a card, mutate it on disk behind the tool's
back, then apply the enqueued edit — it must refuse with the directive's message. A test that only
exercises the happy path passes with the CAS deleted.

## Estimated risk

**MEDIUM-HIGH.** Introducing a lock on a path many tools touch (the doctor, `trddgrep`, the fixer, the
API route, any agent editing by hand) risks serialising or deadlocking work that is fine today. A
per-card key plus a timeout bounds it. The larger risk is the PRRD/SPEC half: getting "one lock" wrong
across a repo boundary produces two locks that exclude each other nowhere, which is *worse* than the
status quo because it looks solved.

## Acceptance

- [x] `AT LINE N REPLACE X WITH Y` implemented as `lib/pillar/edit.ts::replaceAtLines` — the shared WRITE seam mirroring `lib/pillar/store.ts` (the READ seam), so all three tools share ONE concurrency story
- [x] `X` not found at line `N` ⇒ **BLOCKED** via `StaleDocumentError`, carrying the directive's message verbatim; no fuzzy match, no auto-retry
- [x] `prrdgrep` and `specgrep` CREATED (`70c7ef65`), sharing the transaction core `lib/pillar/cli.ts`; installed to `~/.local/bin` and verified from a FOREIGN cwd through the bare command name, not a repo-relative path
- [x] `trddgrep edit` — the directive named THREE tools, and `fix` is not this verb (it writes what the doctor DERIVES; this writes what the caller SAYS). Same core, `--at-line` REQUIRED because a TRDD record has no declaration line to default to (`267bd79a`)
- [x] the `prrd-edit.py` double-writer resolved and the choice recorded here: **one filesystem lock both honour** — filed with the exact, OBSERVED lockdir string as `Emasoft/ai-maestro-plugin#54`. It is another repo, so this card records the DECISION; the hazard closes when that issue lands
- [x] the lock is a **`mkdir` lock DIRECTORY at `${file}.lock`** — `lib/json-io.ts`'s mechanism and path convention, NOT `withLock` (process-local, inert across agents) and NOT a different suffix or O_EXCL
- [x] the `column:` edit and the zone `git mv` are one atomic unit — the lock wraps find → mv → edit → stage (`99997a06`), pinned by the zone assertion in the verb-lock test
- [x] queued writers wait and then proceed (`withJsonLock`'s in-process queue + cross-process lock) — pinned by the lock test's release-then-completes half
- [x] byte-deterministic — edits applied in line order regardless of caller order; no trailing-newline normalisation; a byte-identical result skips the write entirely (an mtime bump is what every `lib/pillar/` freshness probe keys on)
- [x] crash mid-move leaves a doctor-classifiable state — **already met by pre-existing machinery, verified rather than assumed.** The lock wraps find → `git mv` → edit → stage, so a crash between the move and the edit leaves the file in the new zone with the old `column:`. `lib/trdd-doctor.ts:659` `ZONE-MISMATCH` compares `expectedZone(column)` against the actual zone and errors on ANY disagreement — it is symmetric, so it fires whichever of the two landed first. Severity `error`, with an actionable message. The other window (edited but not `git add`-ed) is not a corruption: `git status` shows it
- [x] the lock key is derived from **document identity per PILLAR**, not from a record id — `documentLockKeyFor` dispatches on `kind.source.mode`, because PRRD/SPEC are N-records-per-file and the record id would give two writers of one file two locks
- [x] the two write paths to a TRDD (the store's verbs, and `trddgrep edit`) compute a **byte-identical** key — pinned from both sides with neither re-implemented
- [x] lock test pins the interleaving deterministically (hold → blocked → release → completes), contender started from a SIBLING async context because `withJsonLock` is re-entrant via AsyncLocalStorage
- [x] CAS test mutates line `N` behind the tool's back and asserts the BLOCK, with the positive control alongside it
- [x] a neuter recorded for each guard, disjoint attribution — see the neuter record above

## Approval log

- 2026-08-02T01:50:37+0200 — SELF-MANDATE (min-approval-requirement: none). Filed from the
  `Emasoft/ai-maestro#57` verification pass after measuring that no `withLock` key covers `design/`.
- 2026-08-03T02:31:00+0200 — **USER DIRECTIVE 2** (quoted verbatim in the STATE block). Specifies the
  edit primitive `AT LINE N REPLACE X WITH Y` with a hard BLOCK when `X` is absent at `N`, and RESOLVES
  the card's open question: `prrdgrep` / `specgrep` are **created here**, not negotiated with the
  janitor. The `prrd-edit.py` double-writer hazard is recorded as the residual to settle before
  `prrdgrep` ships.
- 2026-08-03T02:06:07+0200 — **USER DIRECTIVE** (quoted verbatim in the STATE block). Scope widened from
  the TRDD tree to all three pillar edit tools; severity `medium → high` and effort `medium → large`
  because design folders are **symlinked between agents**, making the race the operating model rather
  than a latent one. `mandated-by` changed `self → user`. No approval request was sent — the USER is
  above the ladder.
