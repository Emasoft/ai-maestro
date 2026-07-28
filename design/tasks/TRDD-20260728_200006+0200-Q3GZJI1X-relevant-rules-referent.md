---
trdd-id: Q3GZJI1X
title: Resolve what relevant-rules cites before a PRRD.md exists to make it ambiguous
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
updated: 2026-07-28T23:40:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: docs
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
external-refs: [Emasoft/ai-maestro-janitor#103]
---

# Resolve what relevant-rules cites before a PRRD.md exists to make it ambiguous

## The problem

`relevant-rules:` is carried by **234 TRDDs** in this corpus and is already overloaded across two
rule catalogues with two syntaxes. Measured 2026-07-28:

| form | examples | count |
|---|---|---|
| empty | `[]` | 150 |
| bare numbers | `[25]`, `[16, 23, 42]`, `[9]`, `[23]` | ~24 |
| `R`-prefixed | `[R6, R38]`, `[R50, R51, R18]`, `[R51.9]`, `[R32, R42]` | ~10 |

The IND base (`trdd-design-tasks.md`) defines the field as **PRRD** rule numbers —
`relevant-rules: [3, 27, 64.134]`, bare numbers, pinned versions allowed. But `R25` is the ratified
kanban vocabulary and `R50`/`R51` are the AIO transaction rules — those live in
`docs/GOVERNANCE-RULES.md`, a **different catalogue**.

**This repo has no `design/requirements/PRRD.md` at all**, which is itself a violation of the IND
base ("every project has exactly ONE authoritative rules document"). So today every value resolves,
by default, against GOVERNANCE-RULES.

## Why it blocks the parent

The parent bootstraps `PRRD.md`. The moment it exists, `[25]` means **either** PRRD G25 **or**
GOVERNANCE R25, across 234 files at once, with no way for a reader or a linter to tell. Bootstrapping
first and disambiguating later means writing a citation lint that is wrong on its first run — and a
lint that produces a wall of wrong findings is a lint that gets routed around.

## What must be decided

1. Does `relevant-rules:` cite PRRD only (IND base's definition), or is it polymorphic?
2. If polymorphic, what distinguishes the catalogues — the `R` prefix, a `PRRD `/`R` qualifier, or
   two separate fields?
3. Whichever wins: are the ~34 non-empty cards migrated, or does the parser accept both forms?

## Boundary — this task does NOT authorize an IND-base edit

The citation grammar lives in the janitor's shipped `~/.claude/rules/trdd-design-tasks.md`. This
TRDD may **investigate, decide for this repo, and FILE A PROPOSAL** (precedent: janitor#103, which
proposes `scope: user` + `project-id`). It may not edit the IND base — that is the janitor's file,
and a unilateral edit forks the contract every project on this machine loads.

## Verified 2026-07-28: EVERY non-empty citation in this corpus means GOVERNANCE, not PRRD

The bare form was assumed above to be the IND base's PRRD syntax used loosely. It is not — it is
the *governance* catalogue written without its prefix. Checked by matching each card's frontmatter
against the `R`-numbers its own body cites:

| card | `relevant-rules:` | `R`-refs in its body |
|---|---|---|
| `979dbdaa` | `[23]` | `R23` |
| `0KMDJVON` | `[9, 12, 29, 30, 31]` | `R9.8 R12 R12.1 R12.2 R29.1 R30.3 R31 R31.1 R31.2` |
| `HGE9T6VT` | `[9, 10, 17, 27, 28, 30, 32]` | `R9 R9.8 R42` |

So the split is not "some PRRD, some governance" — it is **100% governance, 0% PRRD**, which is
what you would expect of a repo that has a 51-rule governance catalogue and no PRRD. The field was
used for the only catalogue that existed.

**That makes the post-PRRD failure mode worse than this card first assumed.** A bare `[25]` once
`PRRD.md` exists is not a DANGLING reference — dangling is detectable, and the linter already has
`DANGLING-REF` for it. It is a **silent mis-resolution**: `[25]` resolves happily to PRRD G25, a
real rule about something else entirely. A wrong answer that validates is worse than no answer.

## DECISION (Tier 0, for this repo; the IND-base half is a PROPOSAL, never an edit)

1. **Referent — polymorphic over exactly two catalogues, never inferred.** `relevant-rules:` may
   cite the project PRRD *or* `docs/GOVERNANCE-RULES.md`, and the catalogue is carried by the
   citation itself.
2. **Syntax — a mandatory prefix class.** `R<n>[.<v>]` = GOVERNANCE-RULES; `G<n>[.<v>]` /
   `S<n>[.<v>]` = the PRRD. A **bare number is deprecated**: under the IND base it means PRRD, so
   every bare value in this corpus is wrong, and it must be MIGRATED rather than reinterpreted.
3. **Migration, not accept-both.** All ~34 non-empty cards move to the explicit prefixed form.
   Bare is a lint WARN now and an ERROR the moment `PRRD.md` exists — the point at which it stops
   being merely unqualified and starts resolving to the wrong rule.

**Why a prefix and not a second `governance-rules:` field.** One field keeps the catalogue visible
*in* the citation, so `grep 'R50'` and `grep 'G25'` each work without the reader knowing which
field to look in — and greppability is the stated reason the frontmatter is grep-first at all. Two
fields double the places a reader must check, and they drift independently.

**Why this does not contradict the IND base's load-bearing invariant.** The base says a tool MUST
accept the number alone and ignore any `G`/`S`, because promote/demote flips the letter while the
number stays stable. That remains exactly true *within* PRRD: `G`/`S` are interchangeable and
non-load-bearing. The refinement is only that the letter **class** — `{G,S}` vs `R` — selects the
CATALOGUE. No PRRD rule identity changes, and no citation-by-number becomes unstable.

## Acceptance

- [x] The two catalogues and the two syntaxes are stated in one place, with counts
- [x] A decision is recorded: referent + syntax + migration-or-accept-both
- [ ] If the decision needs the IND base changed, a janitor proposal issue is filed and linked here
- [x] `PRRD.md` is NOT created until this is closed — it does not exist; creating it is Phase 3

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
