---
trdd-id: L55IYKL4
title: Adopt the wikimem/memgrep solutions into the 3-pillars system and its grep tool
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-26T15:51:58+0200
updated: 2026-07-28T20:00:06+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-26T15:51:58+0200
relevant-rules: [R25]
blocked-by: []
npt: [Q3GZJI1X, LXLK7XGX, 7JK3NCV4, CTEQX0ZA]
eht: [BQC8NQSW, C069SK9E, 8KDIB2LT, MUYRIKN3, YN8EQWYP]
external-refs: [Emasoft/ai-maestro#96, Emasoft/ai-maestro#98, Emasoft/ai-maestro-janitor#118, Emasoft/ai-maestro-janitor#123, Emasoft/ai-maestro-janitor#126, Emasoft/ai-maestro-janitor#127]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-28

**UNBLOCKED.** The artefact this TRDD was waiting for landed: **`Emasoft/ai-maestro#96` — "Transfer:
12 measured design laws from the wikimem retrieval engine"** (2026-07-26), with `#98` (3-pillars
guidance) beside it. Read #96 before touching anything here; L2, L7, L8 and L10 are the load-bearing
ones.

**USER mandate 2026-07-28:** *"report every issue to the janitor github repo. make sure adopt
stronger safety mechanisms for the trddgrep, prrdgrep and specsgrep indexer db. make the whole thing
a lesson learned and improve the code accordingly. we need the 3-pillar system working and solid as
a rock."* Full plan: `~/.claude/plans/iterative-foraging-wadler.md` (top section).

### Decisions taken (USER-set; do not re-litigate)

- **Scale target is 10⁵ documents.** I measured 298 TRDDs / 3.0 MB → `validate` in 0.57 s and
  recommended staying stateless; the USER overruled it on the growth curve — *"when you will get
  100000+ TRDDs, PRRDs, and specs … without a db the search will become slow."* Correct. **Build
  the DB.**
- **SQLite + FTS5**, memgrep-shaped safety (FTS5 confirmed available in the bundled
  `better-sqlite3`, SQLite 3.51.3; `('integrity-check', 1)` parity form works).
- **A shared `lib/pillar/` seam** serving all three pillars; `lib/trdd-store.ts` is re-expressed on
  it with its **public API frozen**, so its 20 existing tests passing unchanged is the proof the
  abstraction fits.
- **Two of memgrep's postures are deliberately NOT copied** — full-walk fallback (at 10⁵ the
  fallback IS the outage → incremental repair) and per-file `git hash-object` (→ one
  `git ls-files -s`). Recorded in CTEQX0ZA.

### The flock (authored 2026-07-28; the parent is not `complete` until every EHT is terminal)

| kind | id | what |
|---|---|---|
| NPT | `Q3GZJI1X` | `relevant-rules:` cites two catalogues in two syntaxes across 234 cards — resolve BEFORE a `PRRD.md` makes `[25]` ambiguous |
| NPT | `LXLK7XGX` | the DAG constrains **frontmatter** edges, not prose — 18 live provenance mentions in specs are not violations |
| NPT | `7JK3NCV4` | choose the fail-loud posture once at the store API seam |
| NPT | `CTEQX0ZA` | write the 10⁵ budget down before designing the index |
| EHT | `BQC8NQSW` | the linter holds the whole corpus (`raw` per card) — ~1 GB at 10⁵ |
| EHT | `C069SK9E` | graph + board at 10⁵ |
| EHT | `8KDIB2LT` | propagate the new CLI contract (exit trichotomy, `--design-dir`, two new tools) |
| EHT | `MUYRIKN3` | the spec bump 1.1.1 → 1.2.0 is consumed by the janitor (`3P-CHK-03`, `3P-VER-02`) |
| EHT | `YN8EQWYP` | the index is new shared server state — register it, handle N writers, contain the tests |

### NEXT ACTION

Phase 1 of the plan: **make the corpus reader fail loud** — `lib/trdd-store.ts` `listTrddFiles`
(`:112-114` `catch { return [] }`), both CLIs' `process.cwd()` assumption and missing non-vacuity
guard, and the divergent read-error handling between `lib/trdd-doctor.ts:137-140` (reports it) and
`greptrdd.mjs:63` / `lib/kanban-index.ts:143` (silently drops it). Gated by NPT `7JK3NCV4`.

### SUPERSEDED — do NOT carry forward

- *"wait for the janitor's issue to land"* — it landed (#96). The poll loop is over.
- *"Do NOT start rewriting `greptrdd.mjs` yet"* — lifted by the same fact.
- My own earlier reading that memgrep's v5→v6 ladder *"was never attempted"* — **wrong**;
  janitor#123 is right (a version skew described as damage). Both indexes on this host verified at
  `user_version = 6` with `atoms.status` present; correction posted to janitor#124.

## The isomorphism the USER identified

| wikimem | 3-pillars |
|---|---|
| notes are LOCAL / PROJECT / USER scoped | `design/` files are LOCAL / PROJECT / USER scoped |
| collaborators sync PROJECT + USER scope | agents on one repo sync PROJECT + USER scoped design files |
| notes `[[link]]` other notes | TRDDs reference TRDDs (`blocked-by`, `npt`, `eht`, `parent-trdd`, `supersedes`) |
| pages have tiers (hub / aspect / component) | the three pillars are a strict layering (below) |
| `memgrep` = recall by SYMPTOM + a SQLite sidecar index | `greptrdd.mjs` = a dependency walker with **no recall and no index** |

## The reference DAG (USER-stated; currently enforced by NOTHING)

References point only **UP** the abstraction stack — concrete may cite abstract, never the reverse:

```
PRRD  ←────  SPECS  ←────  TRDD
  ↑                          │
  └──────────────────────────┘
```

| edge | allowed? |
|---|---|
| TRDD → TRDD | **yes** — dependency (`blocked-by`/`npt`/`eht`) and other technical reasons |
| TRDD → SPECS | **yes** |
| TRDD → PRRD | **yes** (`relevant-rules:`) |
| SPECS → PRRD | **yes** |
| SPECS → TRDD | **NO** |
| PRRD → SPECS | **NO** |
| PRRD → TRDD | **NO** |

All three pillars share the same lifecycle states — **proposal / active / archived** — expressed as
folders under `design/`.

**The live-recompute hazard the USER called out explicitly:** a change to a PRRD **golden or silver**
rule *immediately* alters the required approval authority of **every TRDD that cites that rule** —
its judge/approver changes underneath it, at any time. So a TRDD's `min-approval-requirement:` is a
**derived** value that can go stale the moment a rule is promoted, demoted, or revised. Today it is a
hand-written frontmatter field with nothing recomputing it.

## Verified state of the tooling (measured 2026-07-26, not assumed)

- `scripts/greptrdd.mjs` (11.9 KB) — subcommands `why`, `unblocks`, `roots`, `next`, `show`, `board`.
  It is a **dependency-graph walker**. It has **no recall-by-symptom**, no full-text search, no
  ranking, and no `description`-indexed lookup — i.e. it cannot answer *"is there already a TRDD
  about X?"*, which is memgrep's entire reason to exist.
- **No index anywhere**: no SQLite sidecar, no cache. `design/` holds **295 markdown files**
  (6 specs · 35 proposals · 100 tasks · 136 archived · 18 refused), rescanned per invocation.
- `lib/trdd-doctor.ts` + `scripts/trdd-doctor.mjs` lint zone/column consistency. **Nothing lints the
  reference DAG above** — a SPECS citing a TRDD, or a PRRD citing either, is currently invisible.
- The IND base rule already forbids one cross-scope edge (*"A PROJECT TRDD MUST NOT cite a LOCAL
  one"* — a dangling reference for every other contributor). That is the same class as wikimem's
  scope-leak detector, and it is likewise unenforced here.

## Why this matters beyond tidiness

Every hazard above is the *same family* as the defects this repo has been fighting all session: a
documented invariant that nothing mechanically checks, so it rots silently and reads as healthy.
wikimem already paid for these lessons. Re-deriving them here would be waste.

## Acceptance

- [ ] The janitor's wikimem SPECS + issue are read in full before any design work
- [ ] A design decision is recorded per adopted solution (index, recall-by-symptom, DAG lint, scope-leak lint, live-recompute of `min-approval-requirement`) — each either ADOPTED with rationale or REJECTED with rationale
- [ ] The reference-DAG lint exists and FAILS on a seeded violation (proven by mutation, not by reading)
- [ ] Whatever replaces/extends `greptrdd.mjs` can answer "is there already a TRDD about X?"
- [ ] `bash scripts/with-node.sh npx tsc --noEmit` clean; suite green

## Approval log

- 2026-07-26T15:51:58+0200 — MANDATE issued by USER (min-approval-requirement: none). Born approved.
