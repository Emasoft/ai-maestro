---
trdd-id: D7KVF4HQ
title: Give the pillar edit tools a transaction system — locks, queue, and CAS on the original text
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-03T01:50:37+0200
updated: 2026-08-03T02:06:07+0200
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

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-03

**USER DIRECTIVE, 2026-08-03 — this supersedes the original card's scope.** Verbatim:

> the risk of corrupting the design files is high since there is no central lock system, and design
> folders are often synched between agents working on the same project via **symlinks**. To solve this,
> you must modify every edit tool (`trddgrep`, `prrdgrep`, `specgrep`) to integrate a **transaction
> system** for editing, with **atomic changes, locks, writing queues, deterministic changes, diff
> changes, line by line replace functions to enforce replace only on the original text**, otherwise the
> message *"The content of the TRDD/PRRD/SPEC file changed since your command was enqueued. Please
> reread the file first."* or similar warning.

**NEXT ACTION:** extend `lib/trdd-store.ts::editTrdd` — the funnel that already exists — with the
lock + CAS layer, before touching anything else. See "what already exists" below; the shape of this
work is *smaller than it looks* for TRDD and *larger than it looks* for PRRD/SPEC.

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

The precedent is right there in the same codebase and should be reused, not reinvented:
`lib/json-io.ts::updateJson` is described as *the ONE lock + write path for every settings mutation*,
and `withLock` keys already exist for `agents`, `amp-index`, `tasks-<teamId>`, and others.

## PRRD and SPEC — the directive names two tools that do not exist

```
trddgrep : ON PATH   (scripts/trddgrep.mjs)
prrdgrep : ABSENT    — not on PATH, not in this repo
specgrep : ABSENT    — not on PATH, not in this repo
```

So for PRRD and SPEC there is **no funnel to extend**. Today the PRRD editor is `prrd-edit.py`, shipped
by the **ai-maestro-janitor**, not by this repo — a cross-repo boundary. Two consequences to settle
before building:

1. **Do `prrdgrep` / `specgrep` get created here** (as siblings of `trddgrep`, with the transaction
   layer built in from line one), **or** does the janitor add the transaction layer to `prrd-edit.py`?
2. Whichever way, **the two must share one lock**, not two. A lock in this repo and a lock in the
   janitor's Python tool would exclude each other **nowhere** — which is worse than no lock, because it
   reads as protection. (This exact failure has been recorded before: two modules each individually
   correct, contending for nothing, because "one lock" meant one *function name* rather than one
   physical object.)

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
- **Reuse `withLock` / the `json-io` precedent** rather than inventing a second vocabulary.
- **Crash safety:** a process killed mid-move leaves a state the doctor can classify, never a card in
  neither zone.
- **A hand edit outside the tooling takes no lock at all** — which is exactly why the CAS clause is not
  optional. State this limit rather than hide it.

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

- [ ] the transaction layer lands at `lib/trdd-store.ts::editTrdd` (the existing single funnel), not beside it
- [ ] per-card lock key, using the existing `withLock` primitive
- [ ] the `column:` edit and the zone `git mv` are one atomic unit
- [ ] queued writers wait and then proceed — a blocked write is never silently dropped
- [ ] CAS: the replace applies only to the exact text read; on mismatch it refuses with the directive's message
- [ ] the same command on the same input is byte-deterministic
- [ ] crash mid-move leaves a doctor-classifiable state
- [ ] PRRD/SPEC decision recorded here: new `prrdgrep`/`specgrep` in this repo, **or** the janitor extends `prrd-edit.py` — and either way ONE shared physical lock, verified to exclude across both
- [ ] lock test pins the interleaving deterministically (hold → blocked → release → completes)
- [ ] CAS test mutates the file behind the tool's back and asserts the refusal
- [ ] a neuter recorded for each guard, naming which test it alone reddens

## Approval log

- 2026-08-02T01:50:37+0200 — SELF-MANDATE (min-approval-requirement: none). Filed from the
  `Emasoft/ai-maestro#57` verification pass after measuring that no `withLock` key covers `design/`.
- 2026-08-03T02:06:07+0200 — **USER DIRECTIVE** (quoted verbatim in the STATE block). Scope widened from
  the TRDD tree to all three pillar edit tools; severity `medium → high` and effort `medium → large`
  because design folders are **symlinked between agents**, making the race the operating model rather
  than a latent one. `mandated-by` changed `self → user`. No approval request was sent — the USER is
  above the ladder.
