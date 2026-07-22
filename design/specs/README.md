# `design/specs/` — the SPEC design documents

The **SPEC** is the middle of the three project design-document types. Authority runs strictly
top-to-bottom:

```
PRRD  (design/requirements/)  — WHAT must be true.       Discursive, anything-goes, golden/silver.
  ▲ a SPEC must COMPLY with the PRRD (else it is not approved)
SPEC  (design/specs/)         — HOW it is precisely defined. Formal, machine-parseable, this folder.
  ▲ a TRDD must COMPLY with the SPECs and the PRRD (else the MANAGER/COS will not approve it)
TRDD  (design/tasks/)         — the actionable WORK.       Kanban card, assignee, checklist.
```

A **PRRD** rule can be about anything and is written in prose ("the panel background must be blue",
"auth must use JWT", "the dialog corners must be `#1234a4` with a 7px drop shadow"). A **SPEC** is
the *implementation* of those requirements — as close to code as a document gets (many specs compile
directly into code: OpenAPI/Swagger, protobuf, JSON-Schema). So a SPEC MUST NOT be vague: it is
**formally consistent, complete, machine-parseable, versionable, validatable, diffable, and
greppable**. A **TRDD** is an actionable task that implements against the SPECs and PRRD.

## What makes a document a SPEC (the acceptance bar)

- **Versioned** — a semver `spec-version:` in frontmatter; a `MUST` change bumps it.
- **Diffable + greppable** — a structured, stable clause-ID scheme so any part is grep-addressable
  and a revision is a clean diff (e.g. the 3-pillars spec's `` `3P-<FAMILY>-NN` `` anchors + a
  grep cheat-sheet at the top).
- **Validatable** — a conformance check can assert implementations conform (a test, a schema
  validator, a linter). A spec with no way to validate conformance is a draft, not a spec.
- **PRRD-compliant** — it may not contradict any PRRD requirement.

**A SPEC is NOT a Claude Code rule file — do not conflate them.** A SPEC *describes* things,
including rule files (their content, exact paths, and install protocols). The operational rule
files the harness loads/installs are separate artifacts that live in their INSTALL folders and do
NOT belong here: the IND rules (`~/.claude/rules/`, shipped by the janitor) and the DEP overlays
(`rules/aimaestro/aimaestro-*.md`, seeded to agent workdirs). The reference SPEC in this folder is
`3-pillars-spec.md` — one file describing both the IND and DEP rule files. Whether the
governance-rules catalog / scenario-test rules are SPECs (that live here) or rule files (that stay
in their install folders) is decided per document by the same test: **is it loaded/installed by the
harness as a rule?** If yes, it is a rule file; if it only describes, it is a spec.

## Lifecycle (mirrors the TRDD lifecycle — approval-gated)

```
design/specs/proposals/   a DRAFT spec or spec revision, awaiting approval — not yet authoritative
      │  approved (MANAGER/COS verify PRRD-compliance + the acceptance bar above)
      ▼
design/specs/             the ACTIVE, authoritative specs
      │  superseded by a newer revision
      ▼
design/specs/archived/    older spec revisions, kept for history (frozen)
```

- A new spec or a revision to an existing one **starts in `proposals/`** and is only moved into
  `design/specs/` once approved. Until then it is a draft with no authority.
- Approval is **compliance-gated**: a spec that contradicts a PRRD requirement is refused; a TRDD
  that contradicts a SPEC or PRRD is refused. This is the same approval machinery as TRDDs
  (`min-approval-requirement:`, the approver tiers).
- When a spec is superseded, the old revision moves to `archived/` (frozen), the new one takes its
  place in `design/specs/`.

## Status

This folder + taxonomy is **ai-maestro's adoption** of the three-way doc-type split (ai-maestro#85).
The taxonomy is a UNIVERSAL 3-pillars concept, so the authoritative, cross-project definition (SPEC
as a first-class doc type alongside the janitor's `trdd-design-tasks.md` / `prrd-design-rules.md`)
is an IND-base delta being coordinated with the ai-maestro-janitor. Until that lands, this README is
the working reference and `3-pillars-spec.md` is the reference SPEC that establishes the shape.

## Current specs in this folder

Each is a DETAILED capture of a rule file — read the whole rule file, one rule at a time; a spec is
*more* detailed than its source, never a summary (the per-clause style is dry/greppable, not lossy).

- **`3-pillars-spec.md`** — the reference SPEC. The 17-column kanban vocabulary, the TRDD/PRRD
  contracts, the IND/DEP boundary test. Conformance-tested against `types/task.ts`.
- **`governance-spec.md`** — captures `docs/GOVERNANCE-RULES.md` (R1-R49 + 22 invariants + comm graph
  + the 8 titles + permission matrix), clause-for-clause. Tracks the catalog `version:`.
- **`scenario-tests-spec.md`** — captures `tests/scenarios/SCENARIOS_TESTS_RULES.md` (Rule 0-14) + the
  runner-agent contract + the test procedures, so the **ai-maestro-web-scenario-tester** plugin can
  validate its own agents/skills/scripts against it (the `STS-VAL` checklist).

The rule files these describe STAY in their own locations (the RULE FILE ≠ the SPEC, per the
distinction above); only the describing spec lives here.
