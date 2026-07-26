---
spec: all-in-one
spec-version: 1.0.0
status: normative
created: 2026-07-26T04:05:00+0200
updated: 2026-07-26T05:02:00+0200
maintainer: ai-maestro
project-id: ai-maestro
requested-by: USER mandate 2026-07-26 ("the api implement the full all-in-one design")
implementations:
  - "the runner — lib/gate-transaction.ts (runAioPipeline, runGateSequence)"
  - "the 26 pipelines — services/element-management-service.ts (retrofit tracked in TRDD-DQ6XN2VP)"
  - "the rules it formalises — docs/GOVERNANCE-RULES.md R50, R51 (ratified, USER-set)"
  - "the authoring procedure — ~/.claude/skills/make-all-in-one/ (upstream, superseded here per AIO-SKILL)"
  - "the coverage inventory — docs/GOVERNANCE-ENFORCEMENT-MAP.md Part II, scripts/aio-gate-coverage.py"
---

# The all-in-one (AIO) function conformance SPEC

**This file is the SPEC, not a rule.** R50 and R51 in `docs/GOVERNANCE-RULES.md` are the ratified
rules — the constitution. This is the versioned, testable contract an implementation conforms to.
Where an implementation and this spec disagree, THE SPEC WINS; where this spec and R50/R51 disagree,
THE RULE WINS and this spec is the defect.

**Placement note.** The `design/specs/README.md` lifecycle starts a new spec in `proposals/`. This
one entered `design/specs/` directly because its `requested-by` is a USER mandate — the top of the
approval ladder, so it is born approved (per the mandate protocol in
`rules/aimaestro/aimaestro-trdd-approval.md`) — and because it formalises R50/R51, which are already
ratified. `design/requirements/` is currently EMPTY, so the PRRD-compliance gate is vacuous: there is
no PRRD requirement this could contradict. That absence is itself a gap, recorded as `AIO-MNT-03`.

## AIO-GREP — how to grep this spec

Every normative clause carries a stable `` `AIO-<FAMILY>-NN` `` anchor and a bold key-phrase, so you
grep to the clause instead of reading the file.

```text
AIO-GREP  all clauses of a family:  grep 'AIO-TXN'   (or META DEF RULE SHAPE PRE EXE POST VAR RES CALL CVG CHK ANTI MNT)
AIO-GREP  one clause by id:         grep 'AIO-TXN-04'
AIO-GREP  the phase skeleton:       grep -A8 '@spec:aio-phases'
AIO-GREP  the conformance table:    grep -A16 '@spec:aio-conformance'
AIO-GREP  the version stamp:        grep '^spec-version:'
AIO-GREP  families: META=arbiter DEF=definition RULE=the-3-absolutes SHAPE=phases PRE/EXE/POST=gates
AIO-GREP            VAR=variants TXN=transaction RES=result CALL=caller CVG=rule-coverage
AIO-GREP            CHK=conformance ANTI=anti-patterns MNT=maintenance
```

**Key words.** MUST / MUST NOT / SHOULD / MAY carry their usual normative force. A violated MUST is a
defect, not a style preference.

## AIO-META — the arbiter and the anti-drift discipline

`AIO-META-01` **arbiter** — this file is the single versioned normative source for AIO structure.
Implementations cite a clause id; they do not re-derive the contract.

`AIO-META-02` **not-a-mirror** — this spec MUST NOT re-narrate R50/R51 prose. It states VALUES,
`MUST`-assertions and the boundary tests; the teaching prose stays in the rules and the executable
logic in the code. A prose copy becomes a third artefact that disagrees with the other two — the
failure `3-pillars-spec.md 3P-META-02` names, and one this file's v1.0.0 draft committed before it
was caught in review.

`AIO-META-03` **why-it-exists** — R50/R51 answer *what must be true*; they deliberately do not
enumerate gate naming, the phase catalogue, the result shape, or what a caller may assume. Those were
carried only by an upstream authoring SKILL that predates R51 and contradicts it (`AIO-SKILL`), so
without this file every pipeline re-derives them and they drift.

## AIO-DEF — definition and the guarantee

`AIO-DEF-01` **definition** — an AIO function is a single pipeline function that is the ONLY way to
perform one specific mutating operation: PRE-gates verify requirements, EXE performs the mutation,
POST-gates apply consequences.

`AIO-DEF-02` **the guarantee** — an AIO function ALWAYS leaves the system in a valid state (R51.0).
Every clause below derives from this; where a clause and the guarantee conflict, the clause is wrong.

`AIO-DEF-03` **valid** — the system satisfies every governance rule, every security-spec rule, and
every invariant the pipeline declares (`AIO-TXN-07`). Validity is a property of the SYSTEM, not of
the operation.

`AIO-DEF-04` **needs-an-AIO** — an operation MUST be an AIO function if ANY holds: it writes
persistent storage; it mutates runtime state (process, session, permission); it has authorization
requirements; partial failure could leave the system inconsistent; more than one place performs it;
it has cascading side effects.

`AIO-DEF-05` **not-an-AIO** — read-only operations (queries, lookups, projections) MUST NOT be AIO
functions. Gating a read costs the discipline and buys nothing.

## AIO-RULE — the three absolutes

`AIO-RULE-01` **one-function-per-operation** (R50.1) — exactly ONE AIO function per sensitive
mutation; no other code path performs it. Thin wrappers are FORBIDDEN: a second entry point drifts.

`AIO-RULE-02` **pure-helpers** — a helper MAY read, look up, transform. A helper MUST NOT write,
mutate, or call a mutating service. A mutating helper is a backdoor around every gate — the exact
shape of the store-primitive bypasses in TRDD-YB4T4RTL.

`AIO-RULE-03` **authorization-inside** — the caller establishes IDENTITY; every AUTHORIZATION
decision happens inside the pipeline. A caller MUST NOT duplicate the check: a route checking one
rule while the function checks another is two rules, and one is wrong.

## AIO-SHAPE — PRE → EXE → POST

`AIO-SHAPE-01` **the phases** (R51.8) — three, in order:

```text
@spec:aio-phases
Input → G00 → G01 → … → Gn → EXE → PG01 → PG02 → … → PGn → result
        ╰─── requirements ───╯   ╰chg╯  ╰────── consequences ──────╯
PRE   G00..G99   verify each requirement the change depends on
EXE   EXE        the change itself — smallest possible mutation, never a `G##`
POST  PG01..PG99 apply every derived change the change implies
```

`AIO-SHAPE-02` **no-change-in-isolation** — a value is constrained by dozens of others, so a change
is LEGAL only when its requirements hold (PRE) and leaves the system VALID only after its derived
changes are applied (POST). The phasing is the PRIMARY mechanism; rollback (`AIO-TXN`) is the
fallback for a failure at or after EXE.

`AIO-SHAPE-03` **naming** — `G00`–`G99` pre, `EXE` execution, `PG01`–`PG99` post. A suffix letter MAY
be appended when inserting into a published sequence (`G05b`).

`AIO-SHAPE-04` **no-renumbering** — a published pipeline MUST NOT be renumbered. Gate numbers are
cited in error messages, tests, TRDDs and reports; renumbering silently invalidates every citation.

`AIO-SHAPE-05` **EXE-is-not-a-gate** — EXE MUST NOT carry a `G##`. There is exactly one per pipeline,
and it is the SMALLEST possible mutation.

`AIO-SHAPE-06` **atomic-gates** — one gate, one check. A gate validating a name AND a scope AND
existence is three gates. The check MAY be a composite boolean over ONE subject; it MUST NOT span
unrelated subjects. Atomicity is what makes the ops log name the failing check.

`AIO-SHAPE-07` **pass-or-stop** — a gate passes or aborts; there is no third outcome. A gate MAY
perform actions before passing.

`AIO-SHAPE-08` **gates-in-the-body** — every gate lives in the AIO function's body, and its error is
reported with its gate code. A gate hidden behind a helper whose failure the pipeline cannot see is
not a gate.

`AIO-SHAPE-09` **irreversible-last** (R51.6) — irreversible or outward-facing effects (kill a
process, delete a directory, push to a remote, send a message) MUST be ordered as late as possible.
An irreversible effect placed early makes every later failure unrecoverable BY CONSTRUCTION.

## AIO-PRE — pre-execution gates

`AIO-PRE-01` **numbering-is-per-pipeline** — sequential from `G00`, stable once published. There is
NO global gate numbering: `G03` means "the fourth pre-gate of THIS pipeline". (`DeleteAgent`'s G03 is
the cemetery archive; a global scheme would contradict every shipped pipeline.)

`AIO-PRE-02` **the role catalogue** — a checklist of roles to CONSIDER, not a numbering. Every AIO
function MUST consider each and either implement it or be able to say why it does not apply:
authorization · input validation (one gate per field) · context resolution · resolved-context
validation · path/location security · resource existence · protected-resource guard · governance
guard (`AIO-CVG`) · idempotency · dependency · system-status · snapshot (`AIO-TXN-03`) · variant
detection + per-variant gates (`AIO-VAR`).

`AIO-PRE-03` **rejection-is-free** — a rejected operation MUST cost nothing to undo. This is WHY
requirements are checked before the change rather than compensated after it, and it makes the common
failure (a bad request) free.

## AIO-EXE — execution

`AIO-EXE-01` **mutation-only** — EXE performs the mutation and nothing else. Validation in EXE is a
misplaced pre-gate; repair in EXE is a misplaced post-gate.

`AIO-EXE-02` **idempotent-skip** — when the system is already in the desired state, EXE is skipped
and every POST-gate STILL runs. A no-op change does not imply valid consequences: a previous attempt
may have died between its EXE and its post-gates, and that is precisely the state needing repair.
Skipping post-gates on an idempotent call disables the one thing that could heal it.

## AIO-POST — post-execution gates

`AIO-POST-01` **consequences-are-mandatory** — post-gates are not the caller's job and not
best-effort. Canonical cases, each a governance rule made executable: AUTONOMOUS title ⇒ install the
AUTONOMOUS role-plugin; MEMBER role-plugin uninstalled ⇒ install the default; agent removed from a
team ⇒ reset to AUTONOMOUS title AND autonomous role-plugin; core plugin uninstalled ⇒ hibernate the
agent (nothing runs in ai-maestro without it).

`AIO-POST-02` **derive-them** — for every field EXE mutates, ask what elsewhere assumes the old
value. Each answer is a post-gate that repairs the invariant, or a gate that fails (`AIO-POST-05`).

`AIO-POST-03` **post-gates-call-AIO-functions** (R50.1) — a cascaded mutation MUST go through that
operation's own AIO function. Inlining it bypasses that operation's gates and is the same defect as
any other second path. A defense-in-depth post-gate MAY recurse into its own function.

`AIO-POST-04` **the role catalogue** — verify the mutation took effect (read-back) · update
flags/metadata · scope consistency · dependent-entity repair (→ another AIO) · protected-resource
defense in depth (→ recursive) · composition integrity · duplicate detection · restart/notification.

`AIO-POST-05` **a-failed-post-gate-reverts-the-change** — a change whose consequences could not be
applied leaves the system invalid, so the change itself must go. "The mutation worked, the cleanup
didn't" is a failure, not a partial success.

## AIO-VAR — variant-specific gates

`AIO-VAR-01` **one-gate-per-variant** — where behaviour differs by variant (client, backend,
platform), each variant gets its own sequential gate prefixed in brackets (`G12: [Codex] convert
plugin format`), never one gate with an if/else tree. Only the matching variant runs; others skip
with a log entry.

`AIO-VAR-02` **no-shared-mutable-state** — a variant gate holds that variant's complete logic and
shares no mutable state with another's.

`AIO-VAR-03` **do-not-split-what-is-identical** — when the operation is identical across variants,
use ONE gate.

## AIO-TXN — the transaction (formalises R51; see AIO-META-02 — assertions, not narration)

| Clause | MUST-assertion | Rule |
|---|---|---|
| `AIO-TXN-01` | **all-or-nothing** — any gate failure aborts the operation and reverts every executed gate | R51.1 |
| `AIO-TXN-02` | **reverse-order** — compensations run last-executed-first, until the pre-call state is restored | R51.2 |
| `AIO-TXN-03` | **snapshot-first** — "unrevertable" is a MISSING SNAPSHOT, not a property of the operation; the gate that destroys state captures it first | R51.4 |
| `AIO-TXN-04` | **no-uncompensated-mutator** — a mutating gate without an `undo` makes the pipeline REFUSE TO START, before anything executes | R51.4 |
| `AIO-TXN-05` | **fixed-abort-message** — the abort returns the R51.3 wording naming the gate NUMBER and stating that no changes were made | R51.3 |
| `AIO-TXN-06` | **never-lie** — when a compensation itself fails, the function MUST report an INVALID STATE naming every unreverted gate, and MUST NOT claim the system is unchanged | R51.5 |
| `AIO-TXN-07` | **invariants-on-success** — before returning success the pipeline checks its declared invariants; a violation aborts and reverts exactly like a gate failure, and an invariant that cannot RUN is also a failure | R51.7 |
| `AIO-TXN-08` | **exact-state** — what must be restored is configuration, sessions, conversation transcripts, AMP inbox/outbox, and any owned state needed to resume — NOT process ids | R51.10 |
| `AIO-TXN-09` | **equivalent-rebuild-suffices** — relaunching a killed tmux session with a new pid IS a valid compensation, because a pid was never part of the state | R51.10 |
| `AIO-TXN-10` | **use-the-runner** — a pipeline MUST use `lib/gate-transaction.ts`; a hand-rolled compensation loop is a second implementation of the transaction semantics (`AIO-RULE-01` applied to the runner) | — |

## AIO-RES — the result contract

`AIO-RES-01` **shape** — `{ success: boolean, error?: string, operations: string[], …domain }`.

`AIO-RES-02` **operations-is-the-trail** — it MUST record every gate in order, including skips and
compensations. Debugging an AIO function means reading its gate log, never tracing a call graph.

`AIO-RES-03` **success-means-valid** — `success: true` asserts the full pipeline completed AND the
invariants hold, not merely that no gate threw.

## AIO-CALL — the caller contract and the ONE path

`AIO-CALL-01` **caller-MUST** — supply identity context; trust the result (`success` ⇒ invariants
hold; `!success` ⇒ nothing mutated, modulo `AIO-TXN-06`).

`AIO-CALL-02` **caller-MUST-NOT** — duplicate the pipeline's checks; perform cleanup after the call;
catch and suppress its error; or exist as a second path for the same operation.

`AIO-CALL-03` **button-equals-endpoint** (R50.2/R50.3) — every UI button has a corresponding server
API command; that command IS the AIO function; the button calls exactly it. The endpoint requires the
same authentication regardless of caller and works only with a valid signed token.

`AIO-CALL-04` **bypass-is-forbidden** (R50.4) — creating, renaming, changing, assigning, deleting,
configuring or migrating an agent by hand (CLI, in-process script, direct file edit) is prohibited
without exception: it corrupts the ledger, holes the operation sequence so restoration becomes
impossible, mutates with no signed token outside the audit path, and produces exactly the invalid
states this spec exists to prevent.

`AIO-CALL-05` **a-missing-auth-path-is-a-BUG** — when a legitimate caller has no way to authenticate
to the endpoint, that is a BLOCKING gap to fix in the API. It is NEVER a licence to bypass it.

## AIO-CVG — rule coverage

`AIO-CVG-01` **one-gate-per-rule** (R51.9) — for each governance rule there is a gate; for each
security-spec rule there is a gate; for each spec rule there is a gate. A rule with no gate is not
enforced — it is documentation, and the state it forbids will occur.

`AIO-CVG-02` **the inventory** — the mapping lives in `docs/GOVERNANCE-ENFORCEMENT-MAP.md` **Part
II**, regenerated by `scripts/aio-gate-coverage.py`, classifying every rule GATED / ENFORCED (real
guard, wrong shape) / DOC-ONLY / UNMAPPED. It is in the EXISTING map, not a new file: a second
document answering "what enforces rule X" is a second source of truth (`AIO-RULE-01` applied to
documentation).

`AIO-CVG-03` **GATED-is-evidence-not-proof** — a script can see that a gate exists near a citation,
never that the gate checks what the rule SAYS. Confirming that is human review (`AIO-CHK` C10).

`AIO-CVG-04` **a-guard-must-cite-its-rule** — enforcement code MUST name the rule id it enforces.
The scan reads rule ids out of code, so a guard that does not cite its rule is indistinguishable from
a guard that does not exist (observed: R48's console-presence guard read as unenforced for exactly
this reason).

`AIO-CVG-05` **route-enforcement-is-not-gate-enforcement** — a rule enforced at a ROUTE holds for
callers of that route; a rule enforced at a GATE holds for every path to the mutation, which under
`AIO-RULE-01` is the only path. An `ENFORCED`-but-not-`GATED` rule is a real hole, not bookkeeping.

## AIO-CHK — conformance

```text
@spec:aio-conformance
C1   exactly one code path performs the mutation      tests/unit/all-in-one-single-path.test.ts (ratchet; may only shrink)
C2   no mutating gate lacks a compensation            findUncompensatedGates() === [] ; runner refuses otherwise
C3   mid-sequence failure reverts every prior gate    per-pipeline forced-failure test
C4   the abort message names the right gate number    same test, asserting the AIO-TXN-05 wording
C5   no gate after the failure ran                    same test
C6   post-gates run when EXE was skipped              per-pipeline idempotency test
C7   the pipeline declares its invariants             per-pipeline: `invariants` non-empty
C8   every gate is atomic (one check)                 review against AIO-SHAPE-06
C9   irreversible effects ordered last                review against AIO-SHAPE-09
C10  every constraining rule has a gate               docs/GOVERNANCE-ENFORCEMENT-MAP.md Part II
C11  the success path is verified, not assumed        terminal post-condition + AIO-TXN-07
```

`AIO-CHK-01` **per-pipeline** — conformance is per-pipeline, tracked in TRDD-DQ6XN2VP; the 26
existing pipelines are retrofitted one per commit, suite green in between, success-path behaviour
unchanged.

## AIO-ANTI — anti-patterns to refuse

| Anti-pattern | Why it is wrong | Instead |
|---|---|---|
| a helper that "also writes" | bypasses every gate | make it an AIO function |
| a convenience wrapper with defaults | two paths; one drifts | call the AIO directly |
| authorization in the route AND the function | two rules; one is wrong | authorization only inside |
| cleanup after the call, in the caller | post-gates own consequences | add a post-gate |
| skipping post-gates for performance | invalid state is never acceptable | every post-gate, every time |
| all validations in one gate | hides which check failed | one check per gate |
| `G##` for the execution step | EXE is the mutation, not a gate | use `EXE:` |
| variants in one if/else block | tangled, untestable | `[Variant]`-prefixed gates |
| inlining a cascaded mutation | bypasses that operation's gates | call its AIO function |
| shelling out to a CLI that does the same mutation | bypasses the pipeline (R50.4) | call the AIO function |
| a `fetch('localhost/api/…')` loopback | fragile, adds latency, loses auth | import and call the service |
| `catch { ops.push('WARN …') }` and continue | the pre-R51 defect: success on a broken system | abort and compensate |
| reporting residue instead of preventing it | reporting an invalid state is not an alternative to not creating one | compensate; report only what compensation could not undo |

## AIO-SKILL — divergences from the upstream authoring skill

`~/.claude/skills/make-all-in-one/` remains the authoring PROCEDURE. Where it and this spec differ,
THIS SPEC GOVERNS. Named so nobody finds them by producing a non-conforming function:

`AIO-SKILL-01` **failure handling** — the skill's Step-5 pseudocode does
`ops.push("DENIED"); return result`, leaving every prior gate's effect in place. That predates R51
and contradicts `AIO-DEF-02`: harmless for a pre-gate, a half-applied operation after EXE. Every
abort goes through `AIO-TXN`.

`AIO-SKILL-02` **EXE numbering** — the skill states EXE is not a gate, then tags the mutation `G04`
in its own example. `EXE:` is required (`AIO-SHAPE-05`).

`AIO-SKILL-03` **duplicate G10** — the skill's pre-gate table numbers two different roles `G10`.
Resolved by making the catalogue a ROLE CHECKLIST with per-pipeline numbering (`AIO-PRE-01/02`),
which also matches the shipped pipelines.

`AIO-SKILL-04` **additions with no counterpart** — the transaction semantics (`AIO-TXN`), the
exact-state definition (`AIO-TXN-08/09`), the success-path invariant check (`AIO-TXN-07`),
rule-completeness (`AIO-CVG`), and button↔endpoint↔signed-token + the bypass prohibition
(`AIO-CALL-03/04`).

## AIO-MNT — maintenance

`AIO-MNT-01` **versioning** — a changed `MUST` bumps `spec-version:` (minor for an added clause,
major for a changed/removed one); `updated:` bumps on every edit.

`AIO-MNT-02` **clause ids are permanent** — an id is never reused or renumbered; a retired clause is
marked SUPERSEDED in place with its replacement's id.

`AIO-MNT-03` **open gap — no PRRD exists** — `design/requirements/` is empty, so the README's
PRRD-compliance gate cannot be evaluated for this or any spec. Recorded rather than silently treated
as passing: "no PRRD to contradict" is not the same as "verified compliant".
