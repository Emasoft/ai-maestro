---
trdd-id: 5THSI5ZB
title: trddgrep gains lint and validate, and the linter learns the overlay metadata it never checked
column: complete
created: 2026-07-28T17:19:10+0200
updated: 2026-08-01T22:50:24+0200
current-owner: ai-maestro-harness
created-by: ai-maestro-harness
assignee: ai-maestro-harness
task-type: infra
scope: project
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-28T17:19:10+0200
derived: false
priority: 1
severity: major
effort: medium
release-via: none
relevant-rules: [25]
npt: []
eht: []
external-refs: [Emasoft/ai-maestro#96, Emasoft/ai-maestro#98, Emasoft/ai-maestro#59, Emasoft/ai-maestro-janitor#119]
implementation-commits: [96035844]
---

# trddgrep gains lint and validate, and the linter learns the overlay metadata it never checked

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-28

USER-mandated 2026-07-28: *"read the open issues on github and ensure to most TRDDs have the
frontmatter missing important metadata. you should make the trddgrep tool like the janitor
memgrep: being able to lint and validate the TRDDs!"*

**DONE (2026-07-28):** `greptrdd lint` + `greptrdd validate [--strict]` shipped;
`APPROVAL-FIELD-CONFLICT` / `APPROVAL-TIER-DEPRECATED` / `META-MISSING` added to
`lib/trdd-doctor.ts`; 6 tests added (37/37 green, `tsc` clean); **both new guards neuter-verified**
(disable the guard → exactly the named test fails, filter matched 1 not 0).

**NEXT ACTION:** the corpus migration is a SEPARATE chore — 294 findings, all WARN:
108 `created-by`, 56 `assignee`, 23 `min-approval-requirement` missing on open cards, plus 93
deprecated `approval-tier`. `yarn trdd:fix` can decode the tier mechanically; the three missing
fields need authorship the tool cannot invent. Do NOT bump `updated:` while doing it — a
mechanical repair must not manufacture recency, and *the board sorts on it* (#96 law 8).

### Measured state of the corpus (2026-07-28, 297 TRDDs)

The IND-base five are complete; every field the **ai-maestro overlay** added is mostly absent:

| field | missing | note |
|---|---|---|
| `trdd-id` `title` `column` `created` `updated` | **0%** | IND base — clean |
| `current-owner` / `task-type` | 3% | IND base minimal set |
| `created-by` | **80%** | overlay: authorship, set once |
| `assignee` | **58%** | D4 watchdog step 5b reads it |
| `min-approval-requirement` | **50%** | the D4 floor comparison reads it |
| `approval-tier` (DEPRECATED) | present on **93** | overlay: decode-only, never written new |
| `description` | **100%** | the field does not exist yet — #96 law 1 |

### ⚠ RETRACTED — the "sharp finding" was a FALSE POSITIVE, and the retraction is the finding

I claimed 4 files carry BOTH approval fields and that **`WB3K4Y09` disagreed with itself**
(`approval-tier: 2` ⇒ MANAGER beside `min-approval-requirement: orchestrator` ⇒ tier 1), calling
it a live authority contradiction. **It is not.** `WB3K4Y09`'s frontmatter ends at line 17; the
`min-approval-requirement: orchestrator` is at line **31**, inside a fenced YAML *example* in the
prose — the TRDD is literally about mandates teaching a forgeable pattern. The other three files
carry both fields in real frontmatter and they **AGREE** (`2` ≡ `manager`).

So `0 errors` is the CORRECT answer, and `APPROVAL-FIELD-CONFLICT` has **no live instance**.

Three things worth keeping from the mistake:

1. **`grep -l` matched BODY text and I read it as frontmatter.** The exact failure
   `claim-verification.md` describes: a grep hit is a hypothesis, and "the field is present"
   is not the same claim as "the field is present *where a parser reads it*".
2. **The linter disagreed with me and the linter was right.** It reads parsed frontmatter, so it
   correctly ignored prose. When a green instrument contradicts a confident reading, the reading
   is the thing to re-check — the same inversion as the `TITLE_PLUGIN_MAP` episode.
3. **A rule with no live instance still ships**, because it guards a real class — but it MUST be
   pinned by a fixture test, or nothing distinguishes "no instances" from "never fires".

### What already exists (do NOT rebuild)

`lib/trdd-doctor.ts` is good: 19 rules, 297 scanned, **0 errors / 14 warnings**, and it already
covers most of the §D4 watchdog invariants (`MANDATE-FORGED`, `DERIVED-FLAG-MISSING`,
`BLOCKED-WITHOUT-BLOCKER`, `APPROVAL-INCONSISTENT`, `ZONE-MISMATCH`, `ORDER-NPT-VIOLATED`,
`ID-DUPLICATE`, `UNPARSEABLE`). The gap is **not** that linting is missing.

The gap is (a) `trddgrep` cannot lint — it has `board|next|show|why|unblocks|roots` and the
linter is a *separate binary* (`scripts/trdd-doctor.mjs`), so the retrieval tool and the write
gate are two tools where memgrep is one; and (b) no rule reads the overlay metadata above.

### The FP-free construction rule (janitor#96 law 2, #119 `WM-BENCH-08`)

**Every check must mirror a CONSUMER's own drop/misread branch** — it fires exactly when some
reader discards or silently misreads the input. Then the check is an observation of the
consumer's behaviour, not a guess about the author's intent, and there is nothing for it to be
wrong about. A check that cannot be stated that way does not belong at ERROR.

Corollary that shapes the scan: **a check fed by a PARSED collection is blind to exactly the
inputs that fail to parse** — so anything hunting malformed frontmatter runs over the RAW text.
`loadCorpus` already does this correctly (`unparsed` → `UNPARSEABLE`); keep it.

### Rules to add

| code | sev | fires when | the consumer it mirrors |
|---|---|---|---|
| `APPROVAL-FIELD-CONFLICT` | **error** | both approval fields present AND disagree after decoding | the §D4 floor check reads one field; a different reader reads the other; they get different approvers |
| `APPROVAL-TIER-DEPRECATED` | warn (autofix) | `approval-tier:` present | overlay says decode-only; the decode table is `0→none 1→chief-of-staff 2→manager 3→user` |
| `META-MISSING` | warn | a required overlay field is absent, **zone-scoped** | named per field below |

`META-MISSING` is emitted per missing field and **scoped so it names a real broken consumer**:

- `assignee` — OPEN cards only (`design/tasks/`). D4 step 5b asserts it is set; the kanban render
  has no owner to show. Archived work has no live owner, so scoping is what keeps this FP-free.
- `min-approval-requirement` (and no `approval-tier` to decode) — the D4 floor comparison has
  nothing to compare against, so the watchdog **silently cannot evaluate that card**.
- `created-by` — mandate provenance and the derived-TRDD invariant both read it.

### Deliberately NOT flagged (each would be a mass false positive)

- **`scope:`** — absent means `project` per the IND base. Legal, not a defect.
- **`project-id:`** — 85% absent, and the field is a *proposed* IND-base addition (janitor#103),
  not yet shipped. Flagging 253 files for a field that does not exist in the shipped base is
  exactly the "style opinion" lint #96 law 2 warns against.
- **`description:`** — introduce the field and rank on it, but do NOT warn corpus-wide on day
  one; 297 warnings is a wall nobody reads, and the wall is how a linter gets routed around
  (#119: a gate that blocks correct work costs you every finding it would ever have made).

### Load-bearing facts

- `AUTHORITY_RANK` (`lib/trdd-doctor.ts:67`) already encodes the ladder incl. `maestro: 4` as a
  read-alias for `user`. Decode `approval-tier` against the SAME table — never a second one.
- The linter must stay **exit 1 on error, 0 on warn** — 93 deprecated-field warnings must not
  turn the suite red, or the migration becomes a blocker instead of a chore.
- `updated:` must NOT be bumped by any autofix that changes no fact (#96 law 8, `WM-MIG-07`):
  a mechanical repair must not manufacture recency, because *the board sorts on it*.

## Verification

- `bash scripts/with-node.sh npx tsc --noEmit` clean.
- `bash scripts/with-node.sh yarn vitest run tests/unit/trdd-doctor.test.ts` green.
- `yarn trdd:doctor` still exits 0 (new findings are WARN except the one real conflict).
- Every new rule gets a **neuter run**: break the guard, confirm the named test FAILS.

## Acceptance
- [x] Commit `96035844` resolves and lands `trddgrep lint`/`validate` + the 3 new rules.
- [x] `APPROVAL-FIELD-CONFLICT`, `APPROVAL-TIER-DEPRECATED`, `META-MISSING` all confirmed live in `lib/trdd-doctor.ts` (lines 480, 489, 524).
- [x] `tests/unit/trdd-doctor.test.ts` exists on disk with 46 test cases, matching the card's own "46/46 tests pass live" claim.
- [x] The remaining corpus-wide field migration (294 findings) is explicitly labeled "a SEPARATE chore" in the card's own STATE block — out of this card's own defined scope.

## Approval log

- 2026-07-28T17:19:10+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
- 2026-08-01T22:50:24+0200 — CLOSED retroactively. This card's own STATE block already
  says "DONE (2026-07-28)"; the remaining corpus migration is explicitly out of its own
  scope. Re-verified this session: commit 96035844 resolves; all 3 new lint rules exist
  live in `lib/trdd-doctor.ts`; `tests/unit/trdd-doctor.test.ts` exists with 46 tests.
