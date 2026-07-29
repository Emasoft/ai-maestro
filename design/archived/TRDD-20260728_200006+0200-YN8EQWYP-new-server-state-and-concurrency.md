---
trdd-id: YN8EQWYP
title: The pillar index is new server state shared by every agent on the host
column: complete
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
updated: 2026-07-30T01:27:40+0200
implementation-commits: [62d9db33, 004c12a4]
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-28T20:00:06+0200
derived: true
derived-kind: eht
parent-trdd: L55IYKL4
priority: 1
severity: normal
effort: small
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
external-refs: []
---

# The pillar index is new server state shared by every agent on the host

## The hole this handles

The parent creates a persistent SQLite index under `~/.aimaestro/pillar-index/`. That directory is
**new server state on a shared host**, and three things follow that the index task itself will not
notice:

1. **It must be a registered, documented path.** `~/.aimaestro/` has an owner
   (`statePath()` in `lib/ecosystem-constants.ts`) and a documented inventory in the
   janitor-footprint rule, which classifies every path as *real state* (never delete) or
   *regeneratable* (safe to delete). An unregistered directory that appears in `~/.aimaestro/` is
   exactly the thing a future agent finds and cannot classify. The pillar index is **derived and
   disposable** — that must be written down where someone about to delete it will read it.
2. **N agents share one host.** Every registered agent can run `greptrdd`, so several processes may
   reindex the same corpus concurrently. WAL + `busy_timeout` + `BEGIN IMMEDIATE` is the mechanism;
   what needs deciding is the behaviour when a second writer arrives mid-reindex — wait, skip, or
   read-only-degrade.
3. **Tests must never touch the real `~/.aimaestro/`.** `tests/helpers/fake-ecosystem-home.ts`
   already exists (with its own test) and is the containment seam — this is a *use it* item, not a
   *build it* item, and it is called out because the 0-IMPACT rule has been broken before by a
   suite that wrote the developer's real home.

The precedent to follow is `lib/kanban-index.ts:213` — `statePath('kanban-index', <hash>.json)`,
keyed by a hash of the resolved design dir, written outside the corpus so a fleet agent's repo is
never dirtied by a cache of itself.

## PARTLY LANDED 2026-07-30 (`62d9db33`) — box 4 was a LIVE leak, and box 1 was already met

**Box 4 was not a paperwork gap. The suite had been writing into the developer's real state dir
for at least a day.** `~/.aimaestro/pillar-index/` held the legitimate corpus index plus ~43
`t-*.sqlite` files — one per throwaway tmp corpus, timestamps spanning Jul 29 00:18-23:40.

Cause: `statePath()` is `join(homedir(), '.aimaestro')` and `board` is an INDEX-BACKED subcommand,
so `tests/unit/pillar-cli-exit-codes.test.ts` — which spawns the production CLI with no `HOME`
override — built a real index for every tmp corpus it tested.

**Isolated by experiment, not by reading.** Counting the real directory either side of each suite:
`pillar-cli-exit-codes` **+1 per run**, `pillar-graph-cli` **+0** (that file already redirects
`HOME`, and that contrast is what made the diagnosis decisive rather than a hypothesis).

**`vi.mock` cannot contain this** — the writer is a SUBPROCESS and never sees the parent's module
mocks — so `fake-ecosystem-home.ts` (a `vi.mock` helper) is the WRONG instrument here and box 4's
literal wording ("routes through `fake-ecosystem-home.ts`") is unachievable for the spawn tests.
What box 4 actually asks for is its second clause, and that is what was implemented and measured:
a per-test `mkdtemp` fake home passed as `HOME` in the spawn env (`os.homedir()` honours `$HOME` on
POSIX).

Proven the only honest way — by COUNTING, since reading the spawn options shows intent, not effect:
a containment test asserts the real dir is unchanged across an indexing run, with a **load-bearing
positive control** (board exited 0 AND an index really appeared in the fake home; without it the
test passes when nothing indexed at all). **Neuter run**: dropping the redirect fails exactly that
test (1 failed | 11 passed) and grows the real dir by +2 — the leak reproduced on demand.

**Acceptance measured across the WHOLE suite**, which is what box 4 asks: a full 274-file run now
leaks **ZERO** files into the real state dir.

⚠️ **NOT CLEANED UP:** the 44 pre-existing leaked `t-*.sqlite` files are untracked data outside the
repo — RULE 0 forbids deleting them without explicit owner permission. Flagged, not touched.

## CLOSED 2026-07-30 (`004c12a4`) — box 3 uncovered a LIVE defect, and box 2 named the wrong document

**Box 3 was not a design question with three tidy answers. Answering it found a bug that was
already destroying builds.** `openIndex` carved out exactly ONE unhealable fault (`downgrade`) and
treated everything else as damage: log a heal, delete the file plus `-wal`/`-shm`, rebuild. But
`migrate` takes the write lock with `BEGIN IMMEDIATE`, so a second process opening an index that
still needed the ladder timed out on `busy_timeout` and landed in that branch — and the unlink
SUCCEEDS against a file the first process still has open, so writer one went on writing into an
unlinked inode and reported success with its entire build gone. `migrate` also stringified the
error, ERASING `err.code`, which is what made contention and a lying migration indistinguishable
at the one site that decides whether a healthy index survives. **This is janitor#123 one level up:
a condition that is not damage, reported as damage, deletes a healthy index.**

**THE BEHAVIOUR CHOSEN — wait, then re-check; NEVER answer stale.** `syncIndex` runs in ONE
`IMMEDIATE` transaction that SPANS the corpus read, which buys three things at once: the wait lands
at `BEGIN` where `busy_timeout` actually applies (a deferred BEGIN that reads before writing can
fail `SQLITE_BUSY_SNAPSHOT`, which `busy_timeout` does NOT retry — the old shape was safe only by
the accident that no SELECT preceded its first DELETE); the delta is computed under the lock, so a
second writer that gets in sees committed state and re-parses nothing instead of both writers doing
the whole job (two concurrent multi-GB builds at 10⁵); and **SQLite's own write lock IS the build
lock**, so there is no lockfile and no stale-lock heuristic — the OS releases it when a process
dies. `lib/server-lockfile.ts` was the alternative and is the wrong tool here (async, and it needs
a staleness guess).

`5000 ms` is kept deliberately: a WARM sync holds the lock for the freshness probe plus a small
write (0.59 s of it at 10⁵ — TRDD-31LJK1CX), so the common case never degrades; a COLD build holds
it far longer than any tolerable wait, so the second writer times out and answers from the WALK,
which is both correct AND faster than waiting (`board --no-index` walks 10⁵ in ~8 s).

**The rationale for the OPPOSITE choice was FACTUALLY WRONG** — it said holding the lock across the
parse "would block every other reader", but `applyPragmas` sets WAL two files over, and in WAL a
writer does not block readers at all. Recorded in the code rather than quietly replaced.

**Box 2's premise was wrong, and checking it is the only reason that was caught.** The card said the
inventory lives in the janitor-footprint rule; that rule contains **ZERO** mentions of
`~/.aimaestro/` — it documents what the JANITOR creates, and this path is ai-maestro's own. So it is
a LOCAL edit to this repo's CLAUDE.md "Runtime Install Tree (CANONICAL)" section, **not** a janitor
proposal. That section listed neither index dir, so the `kanban-index` precedent this card cites as
the pattern to follow was undocumented too; both now carry a SAFE-TO-DELETE classification and the
`busy`-is-not-damage warning.

**THREE OF THIS CARD'S FOUR BOXES HAD A WRONG PREMISE** — box 1 was already satisfied before the
card was worked, box 4's literal wording was unachievable, box 2 named the wrong document. Only
box 3 was as described, and it understated its own stakes. Measure a box before building for it.

Verified: `tsc` 0 · full suite **274 files / 4072 passed** (+4) · 0-IMPACT **45 → 45** ·
`pillars:lint` 328 documents exit 0 · `greptrdd validate` exit 0 / 0 ERRORs. Two neuter runs, each
failing only its named test — and the ordering one fails with `cannot read TRDD zone`, the predicted
discriminator, which is what proves it measures ORDERING and not merely "an error occurred". Live
end-to-end on the real 4.3 MB corpus index: holding its write lock makes `greptrdd board` print the
contention message, fall back to the walk, and still answer (114 open cards) — index intact, no heal
event written.

Also fixed in passing: `attempt` leaked its connection on every throw path, and on a `busy` throw
the caller degrades and KEEPS RUNNING, so that leak lasted the life of the process.

**Deliberately NOT done: a `3P-IDX-15` spec clause.** The invariant qualifies (its violation is
silent), but `MUYRIKN3` — the EHT that owned the 1.2.0 bump — is complete and archived, and
`3P-CHK-03`/`3P-VER-02` make every bump a notification the janitor consumes. A second bump hours
after the first, for a contract only we consume, is noise. It is a candidate for the NEXT spec bump,
batched. The invariant is meanwhile held by the ordering test, which fails if the lock moves.

## Acceptance

- [x] The index path is produced by `statePath('pillar-index', …)`, keyed per design-dir, never
      written inside `design/` — **ALREADY SATISFIED before this card was worked**:
      `lib/pillar/index-open.ts:130` is `indexPath(statePath('pillar-index'), corpusKeyFor(designDir))`,
      and `corpusKeyFor` hashes the REALPATH-resolved root (slug alone collides — every corpus is
      called `design`). Now also normative as `3P-IDX-02`
- [x] The runtime inventory lists it as regeneratable, with one line saying why (derived from
      markdown; deleting it loses nothing) — **DONE, in the RIGHT document.** This box named the
      janitor-footprint rule; that rule has **zero** mentions of `~/.aimaestro/` because it
      documents what the JANITOR creates. The owner is this repo's CLAUDE.md "Runtime Install Tree
      (CANONICAL)" section — a LOCAL edit, no janitor proposal. `kanban-index/` was missing from it
      too and is now listed beside `pillar-index/`
- [x] Concurrent-reindex behaviour is chosen, implemented, and covered by a test that runs two
      writers against one index — **DONE: WAIT (bounded), then re-check; never answer stale; on
      timeout the caller answers from the WALK.** `3P-IDX-10` already pinned `busy_timeout` before
      WAL; what this added is WHERE the lock is taken (before the first corpus read, so the wait
      lands at `BEGIN`) and that `busy` is a fault of its own that is NEVER healed — which is what
      stopped a second writer from deleting the first's build
- [x] Every index test routes through `fake-ecosystem-home.ts`; a run of the full suite leaves the
      real `~/.aimaestro/` byte-identical — **DONE via the spawn-env route, not the named helper**
      (see above: `vi.mock` cannot reach a subprocess, so the helper is the wrong instrument for the
      only tests that were leaking). Measured: full suite leak 0, was +1 per run

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
