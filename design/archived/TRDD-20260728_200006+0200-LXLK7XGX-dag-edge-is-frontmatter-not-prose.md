---
trdd-id: LXLK7XGX
title: The reference DAG constrains frontmatter edges not prose mentions
column: complete
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
updated: 2026-07-30T00:36:48+0200
implementation-commits: [1dee73c3, 89810d4b]
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

## VERIFIED 2026-07-29 — and the scope above is IMPRECISE in a way that still produces false positives

The resolution says *"the lint reads frontmatter edges, never bodies."* Implemented literally as
**frontmatter-not-body**, it is still wrong — just less wrong. Three TRDD ids live INSIDE spec
frontmatter blocks:

| file | field | the value |
|---|---|---|
| `all-in-one-spec.md` | `implementations:` | `- "the 26 pipelines — services/element-management-service.ts (retrofit tracked in TRDD-DQ6XN2VP)"` |
| `governance-spec.md` | `authority:` | `"… Specs come before the implementation (USER, 2026-07-22, TRDD-CJWC3JLU). …"` |

Both are **prose sentences that happen to be quoted frontmatter values**, not structured references.
A frontmatter-scanning lint flags them, so the naive scope trades 18 false positives for 3.

**The correct scope is structural, not positional:** the lint reads a fixed ALLOWLIST of
DEPENDENCY FIELDS — `blocked-by`, `npt`, `eht`, `parent-trdd`, `superseded-by`, `relevant-rules` —
and never a free-text field value, never a body. "Where the text sits" was never the discriminator;
"which field declares it" always was.

**Under that scope the result is stronger than this card claimed.** Every field a spec actually
carries is descriptive — `spec`, `spec-version`, `status`, `created`, `updated`, `maintainer`,
`project-id`, `requested-by`, `implementations`, `authority`, `reconciled-with`, `derived-from`,
`validated-by`. **Not one is a dependency field.** So `SPECS → TRDD` is not merely absent from the
live corpus, it is **unexpressible by construction**: the lint cannot flag a spec, today or after
any amount of prose churn, because specs declare no dependency edges at all. The rule and the
corpus agree for a structural reason, not a lucky one.

## Why it blocks the parent

Phase 4's lint cannot be written until its input set is fixed. Written against bodies it produces 18
findings naming no broken reader — the definition of a false positive under the FP-free construction
law (a check must mirror a CONSUMER's own drop/misread branch). Written against frontmatter it
produces findings that name a real dangling dependency.

## BUILT 2026-07-30 (`1dee73c3`) — and the extractor, not the scope, was the near-miss

`lib/pillar/dag.ts` + `scripts/pillars-lint.mjs` + `yarn pillars:lint`, 15 tests. The scope this
card decided held up exactly as written: 328 documents, 0 findings, and none of the 18 provenance
mentions flagged.

**The finding this card did not anticipate.** Getting the SCOPE right is not sufficient — the
EXTRACTOR can be blind, and a blind extractor passes this card's own box 2. The obvious choice is
each pillar's `citationRe`, and it would have been wrong, because the live corpus writes these
fields in more shapes than a prose-citation pattern admits (measured, not assumed):

| shape | example | `citationRe` sees it? |
|---|---|---|
| prefixed | `blocked-by: [TRDD-K2WJH7RF]` | yes |
| **bare** | `blocked-by: [Y916N7WL]` | **no** |
| lowercase v1 | `superseded-by: [TRDD-a1019073]` | no (case) |
| **YAML number** | `relevant-rules: [25]` | **no** (parsed as a number) |
| null | `parent-trdd: null` (×96) | n/a — no edge |

`normalizeId` is the right tool: it already absorbs the optional prefix and the case, per pillar,
and it is what the store compares ids with.

**Neuter C is the reason this is written down.** Swapping the extractor to `citationRe` reddens 4
tests — but the LIVE corpus still reports clean at **exit 0**, and the *prefixed*-form seeded
violation *also still passes*. So a lint blind to every bare-id edge would have shipped with box 2
AND the obvious seeded-violation test both green. Only the **bare-id** variant catches it.
Generalized: **a seeded violation must be seeded in every id form the corpus actually uses** — one
form proves only that form.

Neuters A (widen the input to the two prose fields → 4 named tests redden, and the CLI reproduces
the predicted FP wall, flagging the mangled path fragment `~/.CLAUDE/RULES/{TRDD-DESIGN-TASKS` as a
dependency) and B (make `spec → trdd` legal → the matrix test + both seeded-violation tests)
behaved first time. All three restored, residue-checked.

**Two corrections to the parent plan, recorded so they are not re-derived:**
1. The plan justified a separate script because the lint *"requires scanning SPECS/PRRD bodies,
   outside `trdd-doctor`'s contract"*. This card proves it must NOT scan bodies, so that rationale
   is void. It stays separate for a different reason — the doctor's contract is *every TRDD in every
   zone*, and this must also read the SPEC and PRRD corpora.
2. Phase 4 in the plan also lists *"a PROJECT TRDD must not cite a LOCAL one"*. That needs a second
   corpus root (the local `design/` tree) and is not one of this card's boxes. **Not implemented** —
   named here rather than silently folded into a Phase-4-complete claim.

**Also unblocked by construction:** sibling NPT `Q3GZJI1X` (the `relevant-rules:` two-catalogue
ambiguity, HELD FOR THE USER) does not gate this lint. An ambiguous target is still unambiguously a
TRDD → PRRD edge, and that direction is legal under either reading — the lint checks DIRECTION, not
resolvability.

## RECORDED 2026-07-30 (`89810d4b`) — the spec half, and two rot risks caught while writing it

`3P-DAG-01/-02/-03` landed in `design/specs/3-pillars-spec.md` at `spec-version: 1.2.0`, authorized
by the spec's OWN `3P-VER-01` ("MINOR = … incl. adding a clause"); no clause id was renumbered
(`3P-VER-03`). The `3P-GREP` cheat-sheet lists the new family, and `'DAG'` was added to the
conformance test's family array — that array is what stops a family shipping un-grepped.

**`-03` (id-forms) is a clause and not a footnote, because a checker can satisfy `-01` and `-02`
perfectly and still be blind.** That is this card's neuter-C finding promoted into the contract: the
obvious extractor requires the `TRDD-` prefix, so it yields ZERO edges for the bare and numeric forms
the corpus actually writes — and then reports a CLEAN corpus because it saw nothing.

Two rot risks were removed during drafting, both self-inflicted:
1. A first draft stated *"the live specs carry 18 provenance mentions"* — **a census this very commit
   invalidated**, since the clause text itself adds more. The dated count belongs here, in the card;
   the spec states the boundary test qualitatively and points at this id.
2. That draft also used four REAL TRDD ids as id-form examples, which would have minted **phantom
   provenance references inside the arbiter file itself**. Generic forms (`[ABCD1234]`,
   `[TRDD-abcd1234]`, `[25]`) state the identical contract and cannot rot.

Also corrected before commit: an accidental renumber of `3P-BND` from "Pillar 4" to "Pillar 5",
which left a numbering hole (DAG is a cross-pillar RELATION, not a pillar). Nothing outside the spec
cites the label, so it broke nothing — but it was churn this change did not need.

**The lint's live-corpus run is now itself a boundary test for `3P-DAG-02`:** this commit adds MORE
TRDD-id prose to a spec body, and `pillars:lint` still reports 328 documents / 0 findings.

**Deliberately NOT closed by this card** — both belong to EHT `MUYRIKN3`, not to this NPT, whose box
1 asked only that the allowlist decision be recorded in `3P-DAG`:
- the **`3P-IDX` family** — `MUYRIKN3` box 2 requires the cheat-sheet to list **both** `IDX` and
  `DAG`, and Phase 5's index shipped without ever being spec'd;
- the **janitor notification** (`MUYRIKN3` box 4). Safe to hold: `fork/governance-rules` is
  **65 commits behind local**, so 1.2.0 is not visible to any consumer
  and `3P-VER-02`'s detectable-mismatch harm cannot occur yet. Bundling the notification with `IDX`
  gives the janitor ONE coherent 1.2.0 instead of two bumps and two messages.

## Acceptance

- [x] The lint's input is the DEPENDENCY-FIELD ALLOWLIST only (`blocked-by`, `npt`, `eht`,
      `parent-trdd`, `superseded-by`, `relevant-rules`) — not "frontmatter", which still admits
      prose values; the decision is recorded in the spec clause it implements (`3P-DAG`, Phase 6)
      — **DONE, both halves.** IMPLEMENTATION: `DEPENDENCY_FIELD_TARGETS` in `lib/pillar/dag.ts`,
      the allowlist asserted verbatim, and neuter A (widening it to `implementations:`/`authority:`)
      reddens 4 named tests. RECORDING (`89810d4b`): `3P-DAG-01/-02/-03` in
      `design/specs/3-pillars-spec.md` at `spec-version: 1.2.0` — `-02` states that the allowlist
      IS the edge set and that a prose **or free-text-frontmatter** mention is PROVENANCE, which is
      exactly the distinction this card exists to fix. `DAG` was added to the conformance test's
      family array in the same commit; without it the new family ships UNGUARDED (neuter: renaming
      `3P-DAG-01` → `3P-ZZZ-01` fails exactly the named greppable test — 1 failed | 3 passed, read
      by COUNT — restored byte-clean).
- [x] `pillars:lint` yields **zero** findings on the live corpus (if it flags any of the 18
      provenance mentions, this decision was implemented wrong) — **DONE** (`1dee73c3`): 328
      documents (323 trdd · 5 spec), 0 findings, 0.34 s. Non-vacuity proven on BOTH sides: the
      scanned count is asserted (>300), and a separate test asserts the specs really do contain
      ≥18 `TRDD-XXXXXXXX` mentions (measured: 3 + 4 + 11 = 18) — without that, the zero could be
      true for a reason unrelated to the scope decision.
- [x] The lint still FAILS on a seeded frontmatter violation (a spec whose frontmatter declares a
      dependency on a TRDD), proven by mutation — **DONE**, and seeded in BOTH id forms, which
      turned out to be load-bearing (see the finding below). Paired with a control: the same file,
      same id, field renamed to a descriptive one ⇒ no finding.

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
