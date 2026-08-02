---
trdd-id: R6R9XHZI
title: trdd-doctor --fix bumps updated on mechanical repairs and silently reorders the board
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-02T23:03:55+0200
updated: 2026-08-02T23:03:55+0200
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
labels: [trdd-tooling, kanban, data-integrity]
external-refs: [Emasoft/ai-maestro#96]
---

# trdd-doctor --fix bumps updated on mechanical repairs and silently reorders the board

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-02

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

## Which repairs are which

Needs a per-branch verdict, not a blanket switch. First pass:

- **Mechanical (must NOT bump):** missing `derived:` / `derived-kind:` back-link insertion; frontmatter
  formatting/normalisation; anything the doctor describes as a format repair.
- **Semantic (SHOULD bump):** anything that changes a pipeline claim — a `column:` correction, a
  zone/folder reconciliation, a blocked-by edit.

The split is the work; the mechanism is one conditional.

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

## Acceptance

- [ ] each fixer branch classified mechanical vs semantic, with the verdict recorded here
- [ ] `updated:` bumped only for the semantic set
- [ ] a mechanical-only `--fix` run over the corpus changes ZERO `updated:` lines (the #96 corollary)
- [ ] a test pinning both directions, with a neuter showing which test each guard alone reddens
- [ ] the misleading comment at :1226 replaced with one that names the CURRENT rule and why

## Approval log

- 2026-08-02T23:03:55+0200 — SELF-MANDATE (min-approval-requirement: none). Bugfix inside the
  authoring agent's own scope; reversible, no baseline deviation, no cross-team reach. Sourced from
  `Emasoft/ai-maestro#96` law 8; no approval request was sent.
