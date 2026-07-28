---
trdd-id: Q3GZJI1X
title: Resolve what relevant-rules cites before a PRRD.md exists to make it ambiguous
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
updated: 2026-07-28T20:00:06+0200
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

## Acceptance

- [ ] The two catalogues and the two syntaxes are stated in one place, with counts
- [ ] A decision is recorded: referent + syntax + migration-or-accept-both
- [ ] If the decision needs the IND base changed, a janitor proposal issue is filed and linked here
- [ ] `PRRD.md` is NOT created until this is closed

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
