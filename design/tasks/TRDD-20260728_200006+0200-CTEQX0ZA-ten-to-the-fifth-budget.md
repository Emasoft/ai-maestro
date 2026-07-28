---
trdd-id: CTEQX0ZA
title: State the 100000-document budget before designing the pillar index
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
updated: 2026-07-28T20:00:06+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: spike
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-28T20:00:06+0200
derived: true
derived-kind: npt
parent-trdd: L55IYKL4
priority: 0
severity: major
effort: small
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
external-refs: [Emasoft/ai-maestro#96]
---

# State the 100000-document budget before designing the pillar index

## Why this exists

I measured today's corpus — 298 TRDDs / 3.0 MB, `greptrdd validate` in **0.57 s** — and recommended
staying stateless on that number. The USER overruled it on the growth curve:

> *"you are only thinking that the grep is fast now. but when you will get 100000+ TRDDs, PRRDs, and
> specs, you will realize that without a db the search will become slow."*

That is correct, and it is the whole design input. **0.57 s is a measurement of today, not a
budget.** At ~10⁵ × ~10 KB ≈ 1 GB the walk is minutes, and a design validated only against 298 files
is a design validated against nothing.

## What must be written down

A number per operation, at 10⁵, that the implementation is then measured against:

| operation | budget | notes |
|---|---|---|
| `validate` / full lint | ? | today 0.57 s at 298 |
| recall-by-symptom (`is there already a TRDD about X?`) | ? | the capability the parent exists to add |
| `board` render | ? | needs paging at 10⁵ regardless |
| dependency graph / cycle detection | ? | must stay near-linear |
| incremental reindex after 1 file changes | ? | the common case; must be ~O(1) |
| cold full index build | ? | the rare case |
| **resident memory, any operation** | ? | the binding constraint — see below |

## The two consequences that are already visible

1. **Memory, not time, is the first wall.** `loadCorpus` (`lib/trdd-doctor.ts:131`) builds an array
   of every card *including* `raw: fs.readFileSync(file, 'utf8')`. At 10⁵ that is the entire corpus
   resident at once. The linter has to stream or be index-backed before the index is even relevant.
2. **Two of memgrep's postures do not survive the target and must NOT be copied:**
   - it falls back to a **full live walk** on staleness *or any error* — at 10⁵ that fallback IS the
     outage. Replace with incremental repair: freshness is per-file, so a stale index re-indexes
     only what changed; a full rebuild is reserved for schema/integrity failure.
   - it shells out to `git hash-object` **per file** — at 10⁵ that is a fork storm. One
     `git ls-files -s` for tracked blob shas, `stat` for untracked, batched
     `git hash-object --stdin-paths` as fallback.

   Copying the *safety* while discarding these two is the point of writing the budget down first.

## Why it blocks the parent

Without a number, "the index is fast enough" is unfalsifiable, and the fallback policy (walk vs
incremental repair vs refuse) has no basis. Every acceptance criterion in the index phase is stated
against this table.

## Acceptance

- [ ] The table above is filled in with numbers and a stated rationale for each
- [ ] A generated 10⁵-document fixture corpus exists and is reproducible from a script
- [ ] The correctness guarantee is restated for a world where the full walk is NOT an available
      fallback: index-backed and walk-backed answers proven byte-identical on a *small* corpus,
      including result ORDER
- [ ] A degradation policy is chosen for "index unavailable at 10⁵" — refuse with a clear message
      plus an explicit `--no-index` escape hatch, never a silent multi-minute walk

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
