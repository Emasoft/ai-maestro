---
trdd-id: YN8EQWYP
title: The pillar index is new server state shared by every agent on the host
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
updated: 2026-07-30T00:56:24+0200
implementation-commits: [62d9db33]
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

## Acceptance

- [x] The index path is produced by `statePath('pillar-index', …)`, keyed per design-dir, never
      written inside `design/` — **ALREADY SATISFIED before this card was worked**:
      `lib/pillar/index-open.ts:130` is `indexPath(statePath('pillar-index'), corpusKeyFor(designDir))`,
      and `corpusKeyFor` hashes the REALPATH-resolved root (slug alone collides — every corpus is
      called `design`). Now also normative as `3P-IDX-02`
- [ ] The janitor-footprint inventory lists it as regeneratable, with one line saying why (derived
      from markdown; deleting it loses nothing) — **REMAINING.** Note the inventory is the janitor's
      shipped rule file, so this routes as a janitor proposal, not a local edit
- [ ] Concurrent-reindex behaviour is chosen, implemented, and covered by a test that runs two
      writers against one index — **REMAINING, and the substantive one.** `3P-IDX-10` already pins
      `busy_timeout` before WAL; what is undecided is what a SECOND writer should do
- [x] Every index test routes through `fake-ecosystem-home.ts`; a run of the full suite leaves the
      real `~/.aimaestro/` byte-identical — **DONE via the spawn-env route, not the named helper**
      (see above: `vi.mock` cannot reach a subprocess, so the helper is the wrong instrument for the
      only tests that were leaking). Measured: full suite leak 0, was +1 per run

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
