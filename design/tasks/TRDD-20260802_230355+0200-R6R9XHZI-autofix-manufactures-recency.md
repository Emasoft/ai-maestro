---
trdd-id: R6R9XHZI
title: trdd-doctor --fix bumps updated on mechanical repairs and silently reorders the board
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-02T23:03:55+0200
updated: 2026-08-05T04:23:17+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-02T23:03:55+0200
severity: medium
effort: small
relevant-rules: []
npt: []
eht: []
blocked-by: []
release-via: none
implementation-commits: [4f1e3b06]
labels: [trdd-tooling, kanban, data-integrity]
external-refs: [Emasoft/ai-maestro#96]
---

# trdd-doctor --fix bumps updated on mechanical repairs and silently reorders the board

## ⏵ STATE — DONE, 2026-08-05. Shipped in `4f1e3b06`.

The bump is now conditional on the repair being SEMANTIC. All 8 fixer branches record a verdict
through a `record(kind, msg)` helper whose kind is a REQUIRED argument, so a new branch cannot be
added without classifying it — an implicit default is how this shipped in the first place. The
per-branch verdicts and the neuter table are below; `FixResult.bumped` and a per-file CLI badge
make the distinction visible to a reader of `trddgrep fix`.

**SUPERSEDED — do NOT carry forward:** the NEXT ACTION below (it is done), and the code excerpt
under it (that block now reads `if (semantic) { … }` and its comment names the current rule).

## ⏵ The original diagnosis — 2026-08-02

Found by verifying law 8 of the janitor's knowledge transfer (`#96`) against our code rather than
agreeing with it. `lib/trdd-doctor.ts:1225-1229`:

```ts
if (changes.length > 0) {
  // Any repair bumps `updated:` — the board sorts on it.
  text = /^updated:/m.test(text)
    ? text.replace(/^updated:.*$/m, `updated: ${stamp}`)
    : text.replace(/^(created:.*)$/m, `$1\nupdated: ${stamp}`)
```

**Every** autofix bumps `updated:`, unconditionally — including the purely mechanical repairs the
fixer specialises in. The block immediately above it inserts a missing `derived: true` /
`derived-kind:` back-link, which changes **no fact the card asserts**; it repairs a denormalized
pointer. A corpus-wide `yarn trdd:fix` therefore reorders the entire board while nothing has changed.

**NEXT ACTION:** make the bump conditional on the repair being SEMANTIC, not mechanical — classify
each fixer branch, and bump only for the semantic set.

## Why this is a real defect and not pedantry

The board sorts on `updated:`. So the damage is not a wrong timestamp — it is that **the ordering
every human and agent reads becomes an artefact of when someone last ran a formatter**, with nothing
in the output saying so. A stale-but-honest board is navigable; a freshly-reordered one is not, and
the reorder is invisible.

The rule already forbids this. `~/.claude/rules/trdd-design-tasks.md:99` (shipped 2026-07-31):

> BUMP `updated:` on every edit that CHANGES WHAT THE TRDD ASSERTS — not just column changes. The
> board sorts on it, so a MECHANICAL repair (a format/syntax pass that changes no fact) must NOT bump
> it, or the repair silently reorders the whole board.

## The instructive part — why nothing caught it

**The code's comment cites the same clause as its justification.** The *old* rule said "the board
sorts on it" as the reason **to** bump; the *current* rule uses that identical clause as the reason
**not** to. The code was written against the earlier reading, the rule was later corrected, and
nothing flagged the inversion — because a tool cites a rule's WORDS, not its VERSION.

Worth generalising: **a rule can be corrected while every tool implementing it stays silently on the
old semantics.** Grep for the rule's distinctive phrasing in code comments when a rule changes; the
comment that quotes it is the tool that needs re-reading.

## Which repairs are which — the verdict, per branch

The test applied to each: **does the repair change WHAT THE CARD ASSERTS?** Eight branches:

| # | Branch | Verdict | Why |
|---|---|---|---|
| 1 | full frontmatter built from the H1 | **semantic** | the card asserted nothing structured and now asserts a whole field set, `column: todo` among them |
| 2 | drop a redundant `status:` that **agrees** with `column:` | **mechanical** | the card said one state twice and now says it once — the assertion set is unchanged |
| 3 | drop a `status:` that **disagrees** with `column:` | **semantic** | two competing pipeline claims, one now deleted; `column:` was always authoritative, but a claim is gone |
| 4 | migrate `status: X` → `column: X` | **semantic** | the VALUE is unchanged, yet nothing reads `status:` for a pipeline position — the card was column-less to the board and JOINS it here |
| 5 | insert a missing `column: todo` | **semantic** | invents a state nobody chose; the clearest case |
| 6 | uppercase `trdd-id` | **mechanical** | ids match case-insensitively everywhere — a re-spelling of an unchanged identity |
| 7 | lift `title:` from the H1 | **mechanical** | the title was already in the document; this denormalizes it, like #8 |
| 8 | insert the `derived:` / `derived-kind:` back-link | **mechanical** | the parent's own `npt:`/`eht:` already asserted the derivation — the headline case, and the one a corpus-wide pass fires most |

Branches 2 and 3 are ONE branch whose verdict is **computed** (`agrees ? 'mechanical' : 'semantic'`),
not fixed. Neuters D1/D2 below show a blanket verdict there fails one side or the other.

**When in doubt, choose mechanical.** An under-bumped card carries a stale `updated:` until its next
real edit corrects it; an over-bumped one reorders the board with nothing saying why, and no later
edit can undo that.

## Verification

```bash
sed -n '1225,1229p' lib/trdd-doctor.ts     # the bump must be conditional
# The corollary from #96, and the acceptance proof:
git stash list >/dev/null; cp -R design /tmp/design-before
yarn trdd:fix
diff -r /tmp/design-before design | grep -c '^[<>].*updated:'   # target: 0 for a mechanical-only run
```

That last check is the point — *"no `updated:` changed" is a cheap, mechanical proof that a migration
really was mechanical*, and a run that bumped dates can never be audited as lossless afterwards.

## Estimated risk

LOW-MEDIUM. One conditional; the risk is entirely in mis-classifying a branch. Getting it wrong in
the safe direction (treating a semantic repair as mechanical) leaves a card's `updated:` stale, which
is recoverable; the unsafe direction is what we have today.

## The neuters — which test each guard alone reddens

Five mutations, run through `scripts/dev/neuter` (it refuses unless the file is committed, and
verifies the restore by blob hash). 9 new tests; A and B are exact complements over all 9.

| Neuter | Mutation | Red |
|---|---|---|
| **A** | `if (semantic)` → `if (true)` — **the shipped bug, restored** | **5** — all four MECHANICAL tests + the corpus proof |
| **B** | `if (semantic)` → `if (false)` | **4** — all three SEMANTIC tests + the mixed-card test |
| **C** | branch 8's verdict `'mechanical'` → `'semantic'` | **2** — the derivation-back-link test + the corpus proof |
| **D1** | branch 2/3's computed verdict forced always-`'mechanical'` | **1** — the DISAGREEING test only |
| **D2** | the same forced always-`'semantic'` | **2** — the AGREEING test + the corpus proof |

A reddening exactly the mechanical set and B exactly the semantic one, with no overlap, is what
shows the conditional is load-bearing in BOTH directions rather than merely present. C, D1 and D2
are the per-branch proof: a verdict is pinned individually, so reclassifying one branch cannot pass
unnoticed.

Every MECHANICAL test asserts TWO things — that the repair LANDED, and that `updated:` did not
move. The second alone is vacuous: *"no `updated:` changed"* is satisfied just as well by a fixer
that repaired nothing at all.

## Acceptance

- [x] each fixer branch classified mechanical vs semantic, with the verdict recorded here
- [x] `updated:` bumped only for the semantic set
- [x] a mechanical-only `--fix` run over the corpus changes ZERO `updated:` lines (the #96 corollary)
- [x] a test pinning both directions, with a neuter showing which test each guard alone reddens
- [x] the misleading comment at :1226 replaced with one that names the CURRENT rule and why

## Approval log

- 2026-08-02T23:03:55+0200 — SELF-MANDATE (min-approval-requirement: none). Bugfix inside the
  authoring agent's own scope; reversible, no baseline deviation, no cross-team reach. Sourced from
  `Emasoft/ai-maestro#96` law 8; no approval request was sent.
- 2026-08-05T04:23:17+0200 — CLOSED `todo → complete` by ai-maestro. All five acceptance boxes met
  in `4f1e3b06`; gates green (tsc 0 lines · 360 files / 5066 pass / 2 skip). Five neuters recorded
  above, each with a distinct attribution.
