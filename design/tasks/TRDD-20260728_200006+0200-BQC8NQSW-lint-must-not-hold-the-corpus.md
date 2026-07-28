---
trdd-id: BQC8NQSW
title: The linter holds the whole corpus in memory and does not survive 100000 documents
column: blocked
pre-block-column: todo
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
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
approval-datetime: 2026-07-28T20:00:06+0200
derived: true
derived-kind: eht
parent-trdd: L55IYKL4
priority: 1
severity: major
effort: medium
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: [CTEQX0ZA]
external-refs: []
---

# The linter holds the whole corpus in memory and does not survive 100000 documents

## The hole this handles

Adopting the 10⁵ target fixes the *search* path and leaves the *lint* path behind. `loadCorpus`
(`lib/trdd-doctor.ts:131-154`) returns `Card[]` where every card carries

```ts
raw: fs.readFileSync(file, 'utf8'),
```

plus the parsed frontmatter and body. At 298 files / 3.0 MB that is free. At 10⁵ × ~10 KB it is the
**entire corpus resident simultaneously** — roughly 1 GB before counting parse overhead, and more
than that once `body` and `raw` both exist per card.

Several of the 19 rules genuinely need cross-card state (`ID-DUPLICATE`, the blocked-by/npt edge
checks, zone consistency), so this is not a pure streaming problem — it is a question of what must
be held versus what can be reduced per file.

## Why it is an EHT and not just an optimisation

The parent's premise is that the pillar system works at 10⁵. Shipping an index-backed *search* while
`yarn trdd:doctor` OOMs at the same scale would leave the board unlintable at exactly the size where
lint matters most — and the linter is the thing that keeps the corpus honest. The parent cannot be
`complete` while its own gate cannot run.

## Shape of the fix

- Separate the rules into **per-card** (evaluable from one file, reduced immediately) and
  **whole-corpus** (need an accumulator — keep only the accumulator, never the cards).
- Drop `raw` from the hot path; it exists for the auto-fixer, which can re-read the one file it is
  about to repair.
- Where the index exists, source the whole-corpus rules from it instead of from a walk.

## Acceptance

- [ ] Peak RSS for a full lint over the 10⁵ fixture corpus is inside the CTEQX0ZA budget
- [ ] Findings over the live 298-file corpus are **identical** before and after (same rules, same
      ids, same order) — the refactor changes cost, never verdicts
- [ ] `report.scanned` still counts every file, so the non-vacuity guard keeps working
- [ ] No rule silently drops a card it used to evaluate — proven by the identical-findings check
      above, not by reading

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
