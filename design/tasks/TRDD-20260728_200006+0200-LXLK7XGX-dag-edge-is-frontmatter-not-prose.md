---
trdd-id: LXLK7XGX
title: The reference DAG constrains frontmatter edges not prose mentions
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
external-refs: []
---

# The reference DAG constrains frontmatter edges not prose mentions

## The problem

The parent records a USER-stated reference DAG — references point only UP the abstraction stack:

```
PRRD  ←────  SPECS  ←────  TRDD
```

with `SPECS → TRDD` and `PRRD → *` marked **NO**. A cross-pillar lint is supposed to enforce it.

**Measured 2026-07-28, the live specs violate it 18 times:**

| file | `TRDD-[A-Z0-9]{8}` mentions |
|---|---|
| `design/specs/governance-spec.md` | 11 |
| `design/specs/all-in-one-spec.md` | 4 |
| `design/specs/3-pillars-spec.md` | 3 |

Including **the arbiter itself** — `3-pillars-spec.md` is the file that declares it wins on any
disagreement, and a naive lint flags it on the first run.

## The resolution (from reading the source, not from amending the rule)

The parent's own edge table names the mechanism for every legal edge, and every one is a
**frontmatter field**:

| edge | the table's wording |
|---|---|
| TRDD → TRDD | "dependency (`blocked-by`/`npt`/`eht`)" |
| TRDD → PRRD | "yes (`relevant-rules:`)" |

So the DAG constrains **structured, machine-read dependency edges declared in frontmatter**. A prose
sentence like *"conformance-tested against `types/task.ts` (TRDD-QP07O1BK)"* is **provenance** — it
records which task produced the clause. It creates no dependency, nothing resolves it, and removing
it would delete history rather than break a link.

**Therefore the rule needs no amendment and the USER needs no decision** — it needs a *scope*: the
lint reads frontmatter edges, never bodies. This is the reading that makes the USER's table and the
live corpus both correct at once, which is the reading to prefer.

## Why it blocks the parent

Phase 4's lint cannot be written until its input set is fixed. Written against bodies it produces 18
findings naming no broken reader — the definition of a false positive under the FP-free construction
law (a check must mirror a CONSUMER's own drop/misread branch). Written against frontmatter it
produces findings that name a real dangling dependency.

## Acceptance

- [ ] The lint's input is frontmatter dependency fields only; the decision is recorded in the spec
      clause it implements
- [ ] `pillars:lint` yields **zero** findings on the live corpus (if it flags any of the 18
      provenance mentions, this decision was implemented wrong)
- [ ] The lint still FAILS on a seeded frontmatter violation (a spec whose frontmatter declares a
      dependency on a TRDD), proven by mutation

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
