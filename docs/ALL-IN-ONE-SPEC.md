# All-In-One Function Specification

**Status:** normative · **Version:** 1.0.0 · **Governs:** every mutating operation in the AI Maestro
server · **Ratified:** 2026-07-26 (USER)

## 0. Scope, and how this relates to the rules and the skill

`docs/GOVERNANCE-RULES.md` **R50** and **R51** are the constitution: they say an operation has exactly
one function, that the UI button calls that function's endpoint, and that the function is a
transaction. They are short on purpose — a rule that runs to five pages stops being cited.

This file is the **engineering contract** that implements them: what an all-in-one function (AIO) is
made of, how its gates are named and numbered, what each phase may and may not do, what it returns,
and what a caller may assume. It is written to be **checkable** — every clause is either satisfied or
violated by a specific piece of code, and §12 lists the tests that decide.

It derives from the `make-all-in-one` skill (`~/.claude/skills/make-all-in-one/`), which is a
*procedure* for authoring one. A procedure and a spec answer different questions ("how do I build
this?" vs "is this one?"), and the skill predates R51 — so in three places this spec **supersedes**
it. Those divergences are listed explicitly in Appendix A rather than left for someone to discover
by following the skill and producing a non-conforming function.

**Key words.** MUST / MUST NOT / SHOULD / MAY carry their usual normative force. A violation of a
MUST is a defect, not a style preference.

---

## 1. Definition and the guarantee

**AIO-1.1** An **all-in-one function** is a single pipeline function that is the **only** way to
perform one specific mutating operation. It is a deterministic, linear sequence of numbered gates:
PRE-gates validate that the operation is permitted and its requirements hold, EXE performs the
mutation, POST-gates apply the consequences the mutation implies.

**AIO-1.2 — THE GUARANTEE.** No matter when, from where, or from whom it is called, an AIO function
**always leaves the system in a valid state**. Everything else in this document is derived from that
sentence; when a clause and the guarantee appear to conflict, the guarantee wins and the clause is
the defect.

**AIO-1.3 — What "valid" means.** The system satisfies every rule in `docs/GOVERNANCE-RULES.md`, every
rule in the security specs, and every invariant this spec's §11 enumerates. Validity is a property of
the *system*, not of the operation: a run in which every gate succeeded but the result contradicts a
rule is a FAILED run (R51.7).

**AIO-1.4 — An operation needs an AIO function if ANY of these hold:** it writes to persistent storage
(registry, ledger, config file, database); it modifies runtime state (a process, a session, a
permission); it has authorization requirements; its partial failure could leave the system
inconsistent; more than one place currently performs it; or it has cascading side effects.
Read-only operations (queries, lookups, projections) MUST NOT be AIO functions — gating a read costs
the same discipline and buys nothing.

---

## 2. The three absolute rules

**AIO-2.1 — One function per operation** (R50.1). For every sensitive mutation there is exactly ONE
AIO function, and no other code path performs that mutation. Thin wrappers are **forbidden**: a
wrapper is a second entry point, and a second entry point drifts.

**AIO-2.2 — Helpers must be pure.** A helper MAY read, look up, or transform. A helper MUST NOT
write, mutate, call a mutating external service, or produce a side effect. A mutating helper is a
backdoor around every gate — which is precisely how the store primitives tracked in TRDD-YB4T4RTL
became bypasses.

**AIO-2.3 — Authorization inside, not outside.** The caller establishes *identity* (who is asking).
Every *authorization* decision (may this identity do this operation on this target?) happens inside
the pipeline, at its authorization gate. A caller MUST NOT duplicate the check — a route that checks
one rule while the function checks another is two rules, and one of them is wrong.

---

## 3. Shape: PRE → EXE → POST

**AIO-3.1** Every AIO function has exactly three phases, in this order (R51.8):

```
Input → G00 → G01 → … → Gn → EXE → PG01 → PG02 → … → PGn → result
        ╰─── requirements ───╯   ╰chg╯  ╰────── consequences ──────╯
```

**AIO-3.2 — NO CHANGE EXISTS IN ISOLATION.** This is the reason for the shape. A value is constrained
by dozens of other values, so a change is *legal* only when its requirements hold (PRE) and leaves the
system *valid* only after its derived changes are applied (POST). The phasing is the PRIMARY mechanism
that keeps the system valid; rollback (§8) is only the fallback for a failure at or after EXE.

**AIO-3.3 — Gate naming.** `G00`–`G99` for pre-gates, `EXE` for the execution, `PG01`–`PG99` for
post-gates. A suffix letter MAY be appended when a gate is inserted into a published sequence
(`G05b`) — renumbering a published pipeline is forbidden, because gate numbers are cited in error
messages, tests, TRDDs and reports.

**AIO-3.4 — EXE is not a gate.** It MUST NOT carry a `G##` number. There is exactly one EXE per
pipeline, and it is the *smallest possible* mutation: everything before it is validation, everything
after is repair.

**AIO-3.5 — Gates are ATOMIC: one gate, one check.** A gate that validates a name AND a scope AND a
target's existence is three gates. The check MAY be a composite boolean over one subject; it MUST NOT
be several unrelated subjects. Atomicity is what makes the ops log say *which* check failed, lets each
gate be tested alone, and keeps a gate number a stable reference.

**AIO-3.6 — A gate passes or stops. There is no third outcome.** Stopping means aborting the whole
operation per §8. A gate MAY perform one or more actions before passing.

**AIO-3.7 — All gates live in the body of the AIO function.** A gate MUST NOT be hidden behind a
helper whose failure the pipeline cannot see, and a gate's error MUST be reported with its gate code.

**AIO-3.8 — Ordering is a safety property, not a formality** (R51.6). Irreversible or outward-facing
effects — killing a process, deleting a directory, pushing to a remote, sending a message — MUST be
placed as late as possible, after every revertible gate has already succeeded. An irreversible effect
early in the sequence makes every later failure unrecoverable by construction.

---

## 4. Pre-execution gates

**AIO-4.1 — Numbering is per-pipeline, sequential from `G00`, and stable once published.** There is
no global gate numbering: `G03` means "the fourth pre-gate of *this* pipeline". (`DeleteAgent`'s G03
is the cemetery archive; a different pipeline's G03 is something else. A global numbering would
contradict every shipped pipeline and would have to be renumbered on every insertion — see AIO-3.3.)

**AIO-4.2 — The role catalogue.** The list below is a **checklist of roles to consider**, not a fixed
numbering. Every AIO function MUST consider each role and either implement it or be able to say why it
does not apply.

| Role | The one question it answers |
|---|---|
| Authorization | May this identity perform this operation on this target? |
| Input validation (one gate per field) | Is this field well-formed? |
| Context resolution | Can the target and its related records be looked up? |
| Resolved-context validation | Does the resolved entity carry the fields the operation needs? |
| Path / location security | Is every path safe — no traversal, no forbidden directory? |
| Resource existence | Does the target location exist, or must it be created? |
| Protected-resource guard | Is this a system-critical resource that MUST NOT be removed or disabled? |
| Governance guard | Does a governance rule forbid this operation in this configuration? (§11) |
| Idempotency | Is the system already in the desired state? (§5.2) |
| Dependency | Are the prerequisites present (marketplace registered, parent exists)? |
| System-status | Is the system in a state that permits this now (busy, hibernated, mid-setup, reindexing)? |
| Snapshot | Has the state this operation will destroy been captured, so it can be restored? (§8.3) |
| Variant detection + per-variant gates | Which variant is this, and what does that variant require? (§7) |

**AIO-4.3 — A rejected operation MUST cost nothing to undo.** This is why requirements are checked
*before* the change rather than compensated after it, and it is the practical payoff of the shape:
the overwhelmingly common failure (a bad request) is free.

---

## 5. Execution

**AIO-5.1** EXE performs the mutation and nothing else. Validation in EXE is a misplaced pre-gate;
repair in EXE is a misplaced post-gate.

**AIO-5.2 — Idempotency: EXE MAY be skipped; POST-gates MUST still run.** When the idempotency gate
finds the system already in the desired state, EXE is skipped and every post-gate still runs. A no-op
change does **not** imply valid consequences: a previous attempt may have died between its EXE and its
post-gates, and that is exactly the state needing repair. Skipping the post-gates on an idempotent
call turns the one thing that could heal that state into a no-op.

---

## 6. Post-execution gates

**AIO-6.1 — Post-gates apply CONSEQUENCES, and they are not optional.** They are not the caller's job
and they are not best-effort. Canonical examples, each a governance rule made executable:

- create an agent with the AUTONOMOUS title ⇒ install the AUTONOMOUS role-plugin (no agent may exist
  without a role-plugin compatible with its title);
- uninstall the role-plugin of a MEMBER agent (MEMBER has several compatible) ⇒ install the default;
- remove an agent from a team ⇒ reset it to the AUTONOMOUS title AND an autonomous role-plugin;
- uninstall the core `ai-maestro-plugin` ⇒ hibernate the agent immediately, because nothing runs in
  ai-maestro without it.

**AIO-6.2 — Designing them.** For every field EXE mutates, ask: *what elsewhere in the system assumes
this field still has its old value?* Each answer is a post-gate that repairs the invariant — or, when
repair is impossible, a gate that fails (AIO-6.5).

**AIO-6.3 — Post-gates call other AIO functions** (R50.1). A cascaded mutation MUST go through that
operation's own AIO function; inlining it bypasses that operation's gates and is the same defect as
any other second path. A defense-in-depth post-gate MAY call its own function recursively when it
finds an invariant a pre-gate should have prevented.

**AIO-6.4 — The role catalogue** (again a checklist, not a numbering): verify the mutation took effect
(read-back); update flags/metadata; scope consistency (the same resource active at two scopes);
dependent-entity repair (→ another AIO); protected-resource defense in depth (→ recursive call);
composition integrity (does the parent team/group still meet its minimum?); duplicate detection;
restart/notification signalling.

**AIO-6.5 — A failed post-gate reverts the CHANGE too** (R51). A change whose consequences could not
be applied leaves the system invalid, so the change itself must go. "The mutation succeeded, the
cleanup didn't" is not a partial success; it is a failure with extra steps.

---

## 7. Variant-specific gates

**AIO-7.1** When behaviour differs by variant (client type, backend, platform), each variant gets its
own sequential gate prefixed with the variant in brackets — `G12: [Codex] convert plugin format` —
rather than one gate with an if/else tree. Only the matching variant's gate runs; the others are
skipped with a log entry.

**AIO-7.2** A variant gate contains that variant's complete logic and shares no mutable state with
another variant's gate. When the operation is identical across variants, use ONE gate — a
variant-split that splits nothing is noise.

---

## 8. Transactionality — the part that supersedes the skill

**AIO-8.1 — An AIO function is a TRANSACTION** (R51). On any gate failure, every gate already executed
is undone in **reverse order**, until the system is byte-for-byte the state it was in when the
function was called. The caller is then told the operation made no changes — and that sentence must be
TRUE when it is said.

**AIO-8.2 — Every mutating gate declares its compensation, written at the same time as the gate**
(R51.4). A gate that mutates and declares no `undo` MUST cause the pipeline to refuse to start,
before anything executes. Discovering it mid-flight is too late: the un-undoable change has already
happened and the guarantee is already broken. A read-only gate declares `readOnly: true` and needs no
compensation.

**AIO-8.3 — "Unrevertable" is almost always a MISSING SNAPSHOT, not a property of the operation.**
Before a gate destroys state, a gate captures it. `DeleteAgent` already does this — it writes the
cemetery archive before touching anything — which is why the earlier claim that a delete could not be
rolled back was false.

**AIO-8.4 — What must be restored** (R51.10): the configuration, the sessions and conversation
transcripts, the AMP inbox and outbox, and any state or resource the agent owns that lets it resume
its job without interruption — **not** process ids, and not values unnecessary to resuming. Two
consequences: a rebuilt-but-equivalent resource satisfies the guarantee (relaunching a killed tmux
session with a new pid is a valid compensation); and anything IN that list MUST be snapshotted before
the gate that destroys it, where "it was equivalent" is not available as an argument.

**AIO-8.5 — A failed compensation is a CRITICAL incident, never a silent "no changes"** (R51.5). If a
compensation itself fails, the system really is invalid: the function MUST say so, name every gate it
could not revert, and MUST NOT claim the system is unchanged. This is the one case where the guarantee
cannot be met, and the only correct response is to be loud. The runner keeps reverting the remaining
gates — reverting 2 of 3 is strictly better than stopping at the first compensation failure.

**AIO-8.6 — The abort message is fixed** (R51.3), so every pipeline says the same thing and the wording
is greppable:

> `THE COMMAND FAILED TO ACCOMPLISH THE REQUESTED OPERATION BECAUSE GATE NUMBER <n> (<id>) FAILED, SO
> NO CHANGES WERE MADE TO THE SYSTEM. Cause: <cause>`

**AIO-8.7 — The success path is validated too** (R51.7). Before returning success, the pipeline checks
its declared INVARIANTS. A violation is treated exactly like a gate failure — same reverse
compensation, same message — because "every gate ran" and "the system is valid" are different claims,
and returning success on a self-contradicting system is what the guarantee forbids. An invariant check
that *cannot run* is also a failure: unknown validity is not validity.

**AIO-8.8 — Implementation.** `lib/gate-transaction.ts` provides `runAioPipeline({pre, exe, post})`
and the flat `runGateSequence`. A pipeline MUST use it rather than hand-rolling the compensation loop;
a hand-rolled one is a second implementation of the transaction semantics (AIO-2.1 applied to the
runner itself).

---

## 9. The result contract

**AIO-9.1** Every AIO function returns:

```ts
{
  success: boolean          // did the FULL pipeline complete AND the invariants hold?
  error?: string            // the AIO-8.6 message, naming the gate
  operations: string[]      // ordered log: one entry per gate outcome
  …domain fields            // ids, counts, flags (e.g. restartNeeded)
}
```

**AIO-9.2 — `operations` is the debug trail** and MUST record every gate in order, including skips and
compensations:

```
G00: Name 'user-42' valid
G05: Not a protected resource
G09: State change needed (currently active, desired: deleted)
EXE: Deleted from registry
PG01: Verified — record removed
PG04: Removed from 3 group(s) via RemoveGroupMember()
INVARIANTS: verified (12 gate(s) ran, system valid)
```

**AIO-9.3** On failure the log ends at the failing gate and continues into the compensations, so the
trail shows both what stopped and what was undone. Debugging an AIO function means reading its gate
log — never tracing a call graph across files.

---

## 10. Caller contract, and the ONE path (R50)

**AIO-10.1 — A caller MUST:** supply the identity context the authorization gate needs; trust the
result (`success` ⇒ every invariant holds; `!success` ⇒ nothing was mutated, modulo AIO-8.5).

**AIO-10.2 — A caller MUST NOT:** duplicate the pipeline's checks before calling; perform cleanup
after it (the post-gates did it); catch and suppress its error (that error is an invariant violation
and must be visible); or exist as a second path for the same operation.

**AIO-10.3 — The UI button and the API command are the SAME operation** (R50.2/R50.3). Every button
in the UI has a corresponding server API command; that command is the AIO function; pressing the
button calls exactly that command. The endpoint requires the same authentication regardless of caller
— it works only when a valid signed token is presented.

**AIO-10.4 — Bypassing the endpoint is FORBIDDEN** (R50.4). Creating, renaming, changing, assigning,
deleting, configuring, or migrating an agent by hand — via CLI, via an in-process script, via direct
file edits — is prohibited without exception. It corrupts the ledger; it punches holes in the
operation sequence so restoration becomes impossible; it performs a privileged mutation with no signed
token and outside the audit path; and it reliably produces exactly the invalid states this whole spec
exists to prevent (conflicting titles and role-plugins, missing rules in agent folders, stale
configuration, dangling team and project references, lost AMP messages, invalid launch arguments).
The correct path is the UI button, or the same endpoint with a valid signed token. **A missing auth
path for a legitimate caller is a BLOCKING gap to be fixed in the API — never a licence to bypass it.**

---

## 11. Completeness — one gate per rule

**AIO-11.1** (R51.9) For each governance rule there is a gate. For each security-spec rule there is a
gate. For each spec rule there is a gate. **A rule with no gate is a rule the system does not enforce**
— it is documentation, and the state it forbids will occur.

**AIO-11.2** The mapping is tracked in **`docs/GOVERNANCE-ENFORCEMENT-MAP.md` Part II**, regenerated
by `scripts/aio-gate-coverage.py`. It classifies every rule as GATED / ENFORCED (real guard,
wrong shape) / DOC-ONLY / UNMAPPED, and separates the three kinds of hole — behavioural rules no gate
*can* enforce, guards that merely sit outside the pipeline, and genuinely missing enforcement.

It lives in that file, not a new one, on this spec's own §2.1 grounds: a second document answering
"what enforces rule X" is a second source of truth, and it would drift from the first. Part I answers
*is it enforced*; Part II answers *is it enforced as a gate*. Same file, one dimension apart.

**AIO-11.2.1** A `GATED` verdict is evidence, not proof: a script can see that a gate exists near the
citation, never that the gate checks what the rule says. Confirming that is a human review step, and
it is part of conformance row C10 (§12).

**AIO-11.3** A gate MAY enforce more than one rule only when they constrain the same subject (AIO-3.5).
A rule MAY be enforced by gates in several pipelines — a rule about titles is enforced wherever a title
can change, not only in `ChangeTitle`.

---

## 12. Conformance

A function conforms when all of the following hold. Each row names what decides it.

| # | Requirement | Decided by |
|---|---|---|
| C1 | Exactly one code path performs the mutation | `tests/unit/all-in-one-single-path.test.ts` (the bypass ratchet — may only shrink) |
| C2 | No mutating gate lacks a compensation | `findUncompensatedGates()` returns `[]`; the runner refuses to start otherwise |
| C3 | A mid-sequence failure reverts every prior gate, in reverse | per-pipeline test forcing a gate failure |
| C4 | The abort message names the right gate number | same test, asserting the AIO-8.6 wording |
| C5 | No gate after the failure ran | same test |
| C6 | Post-gates run when EXE was skipped as idempotent | per-pipeline idempotency test |
| C7 | The pipeline declares its R51.7 invariants | per-pipeline: `invariants` is non-empty |
| C8 | Every gate is atomic (one check) | review against AIO-3.5 |
| C9 | Irreversible effects are ordered last | review against AIO-3.8 |
| C10 | Every rule that constrains this operation has a gate | `docs/AIO-GATE-COVERAGE.md` |
| C11 | The success path is verified, not assumed | terminal post-condition + invariants |

**AIO-12.1** Conformance is per-pipeline and is tracked in TRDD-DQ6XN2VP; the 26 existing pipelines
are being retrofitted one per commit, with the suite green in between and their success-path behaviour
unchanged.

---

## 13. Anti-patterns — refuse these

| Anti-pattern | Why it is wrong | Instead |
|---|---|---|
| A helper that "also writes" | Bypasses every gate | Make it an AIO function |
| A convenience wrapper calling the AIO with defaults | Two paths; one will drift | Call the AIO directly |
| Authorization in the route *and* in the function | Two rules; one is wrong | Authorization only inside |
| Cleanup after the AIO call, in the caller | Post-gates own the consequences | Add a post-gate |
| Skipping post-gates for performance | Invalid state is never acceptable | Every post-gate, every time |
| All validations in one gate | Hides which check failed | One check per gate |
| `G##` for the execution step | EXE is the mutation, not a gate | Use `EXE:` |
| Variants in one if/else block | Tangled and untestable | `[Variant]`-prefixed gates |
| Inlining a cascaded mutation in a post-gate | Bypasses that operation's gates | Call its AIO function |
| Shelling out to a CLI that does the same mutation | Bypasses the whole pipeline (R50.4) | Call the AIO function |
| A `fetch('localhost/api/…')` loopback | Fragile, adds latency, loses auth | Import and call the service |
| `catch { ops.push('WARN …') }` and continue | The pre-R51 defect: returns success on a broken system | Abort and compensate (§8) |
| Reporting residue instead of preventing it | Reporting an invalid state is not an alternative to not creating one | Compensate; report only what compensation could not undo |

---

## Appendix A — Divergences from the `make-all-in-one` skill

The skill remains the authoring procedure. Where it and this spec differ, **this spec governs**;
these are the three places, named so nobody has to find them the hard way.

**A.1 — Failure handling. The skill returns; this spec compensates.** The skill's Step-5 pseudocode
does `ops.push("G02: DENIED — …"); return result` on a gate failure, leaving every prior gate's effect
in place. That predates R51 and directly contradicts AIO-1.2: a pre-gate failure is harmless only
because nothing has mutated yet, but the same pattern after EXE returns a half-applied operation. Every
abort goes through §8.

**A.2 — The pseudocode tags the mutation `G04`.** The skill states EXE is not a gate (its own
"EXE is unique" rule) and then numbers it in the example. `EXE:` is required (AIO-3.4).

**A.3 — The pre-gate table numbers two different roles `G10`** (dependency check and status check).
This spec resolves it by making the catalogue a **role checklist** with per-pipeline sequential
numbering (AIO-4.1/4.2), which also matches the shipped pipelines — whose `G03` is already not the
skill's `G03`.

**A.4 — Additions with no counterpart in the skill:** the transaction semantics (§8), the exact-state
definition (AIO-8.4), the success-path invariant check (AIO-8.7), rule-completeness (§11), and the
button↔endpoint↔signed-token identity plus the bypass prohibition (§10.3/10.4).
