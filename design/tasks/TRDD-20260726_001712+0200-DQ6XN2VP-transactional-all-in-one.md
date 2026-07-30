---
trdd-id: DQ6XN2VP
title: Make every all-in-one pipeline transactional — all-or-nothing with reverse compensation
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-26T00:17:12+0200
updated: 2026-07-30T19:37:50+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-26T00:17:12+0200
relevant-rules: [R50, R51]
blocked-by: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-26

USER mandate (2026-07-26): *"An all-in-one function that failed to execute successfully even ONE
gate, must immediately revert back all the actions of the previous gates executed until now … one by
one going backward … until the system is returned to the exact state it was when the function was
called."* Codified as **R51** (GOVERNANCE-RULES v5.0.0).

**SUPERSEDED — do NOT carry forward:** TRDD-KERM18NX's stance that rollback was out of scope because
*"a delete that half-succeeded cannot be undone by re-creating an agent, and a fake rollback is worse
than an honest report"*. The premise was false. `DeleteAgent` writes its cemetery archive BEFORE
touching anything, so the restore substrate already exists — "unrevertable" was a MISSING SNAPSHOT,
not a property of the operation. KERM18NX's G10 post-condition is NOT superseded: it stays as the
belt to R51's braces, catching residue left by a *buggy* compensation.

**LANDED:** `lib/gate-transaction.ts` + 10 tests — reverse-order compensation, the exact R51.3
message, the R51.5 refusal to claim "no changes" when a rollback failed, and a pre-flight refusal to
start when any mutating gate lacks an `undo`.

**DECIDED 2026-07-26 (USER) — what "the exact state" means, and that restoring it is ALREADY a
fundamental ai-maestro requirement, not something R51 has to invent.** Codified as **R51.10**.
Verbatim: *"the exact state must be restored, where by exact state we are talking about the
configuration of the agent, its sessions and conversations transcripts, the AMP inbox and outbox,
any state or resource it owns and that will allow it to resume its job without interruption, so not
processes ids or values not necessary to this."* The mechanisms that make it reachable: an agent
delete is a **soft** delete into the cemetery (git preserved); **the soft-delete function and the
pack-for-relocation function are the SAME function** (a MANAGER may approve migrating an agent to
another host under a different MANAGER, restoring it and its tmux there and resuming its work
exactly where it stopped); the archive carries the whole workdir + every local/project-scoped JSON
config + the git workdirs + the plugin data folders + the conversation `.jsonl` with the Claude
metadata needed to restore or relocate it; and if configuration is lost the **ledger rebuilds it
exactly**, because it records every addition/change/removal of every agent's configuration
elements, including uid rotation. This is what "the janitor daemon makes agents immortal" means.

⇒ **Unblocks the tmux question**: re-launch is a valid compensation (a new pid is not a state
change, because a pid was never in the definition). ⇒ **And tightens the rest**: anything IN the
definition — transcript, AMP inbox/outbox, config the ledger cannot replay — MUST be snapshotted
before the gate that destroys it; "it was equivalent" is not available for those.

### RE-SCOPED 2026-07-30 — measured, and TWO of this card's premises are STALE

**"`lib/gate-transaction.ts` has ZERO production callers" is no longer true.** Measured
(`grep runGateSequence\|runAioPipeline`, excluding tests and the lib itself): **4 call sites**, so
**7 of the 26 pipelines are already retrofitted** — `ChangePlugin` (:3830), `ChangeSkill` (:4640),
`ChangeClient` (:6166/:6339), and `changeSimpleElement` (:4816), which serves `ChangeAgentDef`,
`ChangeCommand`, `ChangeRule` and `ChangeOutputStyle`. TRDD-EE5YX5LF and TRDD-B6NUEGMP landed them.
**19 pipelines still hand-roll**, `DeleteAgent` among them. `runAioPipeline` (the R51.8 PRE/EXE/POST
decomposition) still has **zero** callers — B6NUEGMP deferred it here explicitly.

**"The cemetery archive is not a true pre-mutation snapshot" is FIXED.** The archive is now **G01c**,
running BEFORE the G02 MANAGER demotion, and its comment names exactly that bug ("THIS GATE USED TO
RUN AFTER G02, AND G02 MUTATES … the cemetery zip recorded `autonomous`"). `G05b` (unpersist) also
exists now. Do not re-derive either as a finding.

**What SURVIVES, verified by reading 6932-7455:** zero `undo` declarations; and the concrete R51
violation is at the **G08/G08b hard-return**. By then G04 (team rows stripped), G05 (tmux killed),
G05b (session unpersisted), G06 (AMP keys + AID tokens revoked), G07/G07b (governance requests
rejected) and G07c (groups unsubscribed) have all committed — so "Registry deletion failed" leaves a
**gutted but still-registered agent** and reports failure with no rollback. Also verified: **no
vitest test forces a mid-pipeline failure and asserts the system unchanged** (`gate-transaction.test.ts`
drives synthetic gates only; the DeleteAgent tests assert return values).

### ⚠ RETRACTED 2026-07-30 — the "commit point" design I proposed here was wrong in BOTH halves

I proposed splitting the pipeline at a commit point because *"three gates have no honest `undo`"*.
**That premise is false, and I reached it by inferring irreversibility from a verb instead of
reading the mutation.** Verified first-hand after the advisor challenged it:

| gate | what I claimed | what the code does |
|---|---|---|
| G06 AMP keys | "a revoked key cannot be un-revoked; re-issuing yields a DIFFERENT key its correspondents do not hold" | `lib/amp-auth.ts:376-381` flips `key.status 'active'→'revoked'` **on the same record**. `key_hash` is never touched, and correspondents hold no key material the server could invalidate. Undo = flip the recorded rows back — EXACT. |
| G06 AID tokens | (same) | `lib/aid-token.ts:519-527` is a row `filter`. The rows are removed, not mangled; a snapshot restores them byte-for-byte. |
| G07/G07b requests | "a rejected request cannot be un-rejected" | `lib/governance-request-registry.ts:242-245` sets `status`/`updatedAt`/`rejectReason` on the same row. Undo = restore three fields. |

All three are lossless JSON row mutations. There was never a gate needing a dishonest compensation,
so the fork the split existed to resolve does not exist.

**And the split's failure semantics are FORBIDDEN by the rule it was trying to satisfy.**
`docs/GOVERNANCE-RULES.md:1748-1750`, verbatim: *"**There is no reporting option.** This supersedes
the 'detect and report the residue' contract of TRDD-KERM18NX … Reporting an invalid state is not an
alternative to preventing one."* My "irreversible tail, best-effort, failure is RESIDUE that G10
already reports" **is** the superseded contract, re-proposed under a new name. R51.8 (:1823-1824)
adds *"a failed post-gate reverts the CHANGE too."*

**What SURVIVES the retraction:** the ORDERING half. Running gates PRE → EXE → POST with the one
genuinely irreversible operation dead-last is just R51.8's decomposition, and it is still the target.
What dies is the idea that anything after a "commit point" may be left un-reverted.

### THE PATH (advisor-recommended, citations verified)

Wrap the WHOLE pipeline in `runAioPipeline`. Every mutating gate gets a real `undo`:

- **G01c** — writes the cemetery zip, which IS a mutation and had no `undo` in my plan. Its undo must
  DELETE the zip, or a rolled-back delete leaves a cemetery entry for a LIVE agent. (Hard delete
  writes no zip by design, so the hard path relies on per-gate row snapshots instead.)
- **G04 / G05b / G06 / G07 / G07b / G07c** — snapshot the affected rows into `ctx` before mutating;
  undo restores them. This is the `Gate.undo` contract in `lib/gate-transaction.ts:34-44`.
- **G05 tmux kill** — undo = relaunch. R51.10 already blesses this: a new pid is not a state change.
- **G06 STAYS WHERE IT IS.** Moving revocation after the registry write is a **security regression**:
  rollback machinery does not survive a process crash, so a crash between the two leaves a deleted
  agent with LIVE keys, permanently. Today's order fails closed, which is the stated intent at
  `element-management-service.ts:7156`. Since G06 is reversible, nothing ever forced it late.
- **G09 folder delete stays dead-last** as the sole true irreversible; a failure after it is the
  legitimate R51.5 CRITICAL (a rollback that itself failed), not a "reported residue".

### TWO DECISIONS — ruled 2026-07-30 under the standing USER delegation, stated so they can be overruled

**D1 — ⚠ RETRACTED WITHIN THE HOUR. I ruled it, then found it would have VIOLATED A GOVERNANCE RULE.**

I ruled that G02 should become a PRE refusal and the auto-demote be removed, on this stated ground:
*"the auto-demote was convenience, not mandate — its own comment (:7055-7057) says it exists to avoid
2 manual steps."* **The comment is not the authority.** `docs/GOVERNANCE-RULES.md:482`, verdict
**Explicit**, and its normative twin `design/specs/governance-spec.md:446`
(`R9.10 delete-manager-warns-demotes`) both say:

> "The system **auto-demotes the MANAGER to AUTONOMOUS** before proceeding with deletion."

It is also PINNED: `tests/governance/r3-r9-team-governance.test.ts:1134` drives it and asserts the
R9.2 cascade fires, under the title *"deleting G02 would delete the MANAGER and leave every team live
and ownerless."*

**How the error happened, because that matters more than the error.** The advisor wrote "the
auto-demote was convenience, not mandate (comment at 7055-7057)" and I carried it into a ruling
without checking the rule — the exact failure `~/.claude/rules/decide-on-facts.md` names, and the
same shape as this repo's `TITLE_PLUGIN_MAP` false positive. A sub-agent reading a CODE COMMENT is
not evidence about a RULE.

**And it was outside my authority regardless.** Removing the auto-demote rewrites a normative
governance rule, its spec clause, and the test that pins it. The USER's standing *"you solve them"*
delegates rulings; it does not delegate rewriting the governance corpus, which the tier table puts at
MANAGER/USER. A ruling that requires editing `GOVERNANCE-RULES.md` is by construction not a ruling I
may make alone.

**So G02 KEEPS the auto-demote, and its compensation problem is real and must be SOLVED, not
designed away.** The honest undo is `ChangeTitle(id,'manager')` (R51.8 permits a gate to call another
AIO) **plus relaunching the sessions the R10 cascade hibernated** — R51.10.1 blesses a rebuilt
equivalent, and without the relaunch the "undo" returns a system with the title restored and the
fleet asleep, which R51.10's *"resume its job without interruption"* forbids. That makes a MANAGER
delete's rollback depend on N wake operations that can each fail; when one does, R51.5's CRITICAL
path is the correct, honest outcome.

**OPEN FOR THE USER (a real R51-vs-R9.10 tension, not a preference):** R9.10 mandates a convenience
whose compensation is the most expensive in the pipeline. Either (a) implement record-and-relaunch as
above, or (b) amend R9.10 to require a refusal instead — which is a governance change only the USER
can authorize. Proceeding with (a) needs no approval, so that is the default unless overruled.

**D2 — the plugin uninstall takes shape A1 (CLI-uninstall with a CLI-reinstall `undo`), not A2.**

A2's "accept irreversibility by placing it last, so no `undo` is needed" is only sound while the gate
really is last. Under the corrected ordering it is NOT: it must run while the workdir still EXISTS,
so **G09's folder delete follows it and can fail**. A gate with a gate after it that can fail needs a
compensation — R51 admits no residue. `claude plugin install --scope local --cwd <dir>` is that
compensation, and R17's wake invariant already self-heals the core plugin independently, so the
residual exposure is non-core local plugins only.

**Overrule either in one sentence and the card adapts** — D1 costs a UI step, D2 costs one CLI call
in a rollback path that should almost never run.

### THE TEST, and the vacuous pass it must avoid

Seed all five stores (team slot, `sessions.json` row, group subscription, active AMP key, pending
request), inject a failure at G08, then assert **`failedGateId === 'G08'` AND per-store byte
equality** — plus a positive control that the success path empties them.

**The reason-assertion is load-bearing, not decoration.** Deleting an `undo` makes the pre-flight
REFUSE the whole pipeline (`gate-transaction.ts:126-139`): nothing runs, every store is trivially
unchanged, and a byte-equality-only test passes VACUOUSLY. Only `'G08' !== 'PRECHECK'` reddens.
Second neuter: empty an undo's BODY (keeping the property) → byte-equality reddens. This is the
fourth vacuous-assertion trap of the day and the only one caught before the test was written.

**COUPLED CARD — and it reached the SAME architecture independently.** TRDD-OWO449MR (task #103)
needs the local plugin-uninstall to run through the `claude` CLI, which requires the workdir to still
EXIST — so its gate must move from after the `rm -rf` to before it. Of its three shapes it
recommends **A2: "reorder, and accept irreversibility by placing the uninstall LAST among mutating
gates — no `undo`; instead the gate cannot be reached until every gate that could still fail has
passed"**, explicitly *"taken together with TRDD-DQ6XN2VP's DeleteAgent retrofit … doing A2 first, by
hand, means editing the same 500 lines twice."* That is this card's commit-point split, arrived at
from the other end. Two cards converging on one ordering is the strongest evidence available that the
ordering is the right one.

The convergence stands, but read A2 against the retraction above: what both cards genuinely share is
the ORDERING (the one irreversible operation dead-last), not A2's "no `undo`, accept
irreversibility" — which is the same clause R51:1748 supersedes. Whether the plugin uninstall is
reversible via `claude plugin install` decides A1-vs-A2, and it is open question 2 above.

Target ordering, post-retraction — every gate compensated, ONE irreversible, no residue contract:

```
PRE  (read-only, no mutation)   G00 auth · G01 exists · G01b ASSISTANT refusal · [G02 as a REFUSAL?]
EXE  (every gate has an undo)   G01c archive (undo: delete the zip) · G02? · G04 teams · G05 tmux
                                (undo: relaunch) · G05b unpersist · G06 revocations (STAYS EARLY —
                                fails closed across a crash) · G07/G07b requests · G07c groups ·
                                G08 registry + G08b verify · CLI plugin uninstall (workdir alive)
POST                            G09 folder delete — the SOLE true irreversible, dead-last; a
                                failure after it is the R51.5 CRITICAL, not a reported residue
                                G10 verification (kept as R51.7's success-path validation)
```

### A SEPARATE FINDING, surfaced by the D1 retraction — R9.10's map row is WRONG

`docs/GOVERNANCE-ENFORCEMENT-MAP.md:114` reads `| R9.10 | UNENFORCED | — | — |`. R9.10 has **two
clauses** and the row is right about one and wrong about the other:

| clause | reality |
|---|---|
| the Delete Agent dialog MUST warn "This agent holds the MANAGER title…" | genuinely UNENFORCED — that string appears NOWHERE in `components/` or `app/` |
| the system auto-demotes the MANAGER before deleting | **ENFORCED** at `element-management-service.ts` `DeleteAgent::G02`, and PINNED by `tests/governance/r3-r9-team-governance.test.ts:1134` |

**Why this matters now that the ratchet is at 0:** the ratchet counts ENFORCED rows lacking a proof.
An enforced clause hiding inside an UNENFORCED row is invisible to it — the "a rule enforced at N
sites, cited at one" shape, one level up. The verdict vocabulary has no PARTIAL, so this needs either
a split into R9.10a/R9.10b or a ruling on which verdict a half-enforced rule carries. Recorded here
rather than fixed in passing: changing the row is cheap, but choosing how the map represents a
half-enforced rule is a decision that affects every other multi-clause row.

NEXT ACTION: implement, with G02's auto-demote KEPT (R9.10). Order of work:
1. `ctx`-carried row snapshots + `undo` for G01c (delete the zip), G04, G05, G05b, G06, G07/G07b, G07c.
2. G02's undo: `ChangeTitle(id,'manager')` **plus** relaunch of the sessions the R10 cascade
   hibernated — record them in `ctx` during `run`, reverse only what is recorded (the `Gate.undo`
   contract in `gate-transaction.ts:34-44`).
3. Wrap in `runAioPipeline`; G09 folder delete dead-last as the sole irreversible.
4. The parity test: seed five stores, inject at G08, assert **`failedGateId === 'G08'`** AND
   per-store byte equality AND the success-path positive control. Then BOTH neuters — delete an
   `undo` (must red on the gate-id, not on byte equality) and empty an `undo` body (must red on byte
   equality).
5. Fold in OWO449MR's CLI uninstall under D2 and close both cards together.
6. Separately: rule on R9.10's map row (above).

OPEN, not yet traced: whether AMP routing validates on the key alone. If it does, the crash-window
argument for keeping G06 early is stronger still. It does not change the decision (G06 is
reversible, so nothing forces it late) — it only raises the cost of getting it wrong.

## Problem

26 all-in-one pipelines exist in `services/element-management-service.ts`. Every one is a linear
sequence of gates whose failure handling is `try { … } catch { ops.push('Gxx: WARN …') }` — execution
CONTINUES. So a pipeline that fails halfway leaves the system in whatever state it reached, and
returns success. The USER is explicit that this is never acceptable: a failure must leave the system
byte-for-byte as it was, and say so.

The USER also notes many gates are still MISSING from these pipelines — the API is not
feature-complete. That is a separate axis of work; R51 governs the gates that exist and every gate
added from now on.

## The 26 pipelines to retrofit

`InstallElement`, `ChangeTitle`, `ChangePlugin`, `InstallPlugin`, `UninstallPlugin`,
`CreateMarketplace`, `DeleteMarketplace`, `ChangeMarketplace`, `ChangeSkill`, `ChangeAgentDef`,
`ChangeCommand`, `ChangeRule`, `ChangeOutputStyle`, `ChangeMCP`, `ChangeLSP`, `ChangeHook`,
`ChangeTeam`, `ChangeName`, `ChangeFolder`, `ChangeAvatar`, `ChangeMetadata`, `ChangeCLIArgs`,
`ChangeClient`, `DeleteTeam`, `DeleteAgent`, `CreateAgent`.

Priority order — by blast radius of a partial failure:

1. **`DeleteAgent`** — proven partial-state defect; snapshot already exists (cemetery zip).
2. **`CreateAgent`** — a half-created agent is an ungoverned agent (no title, no role-plugin, no
   rules, no core plugin). Compensation is the cleanest of all: delete what was created.
3. **`ChangeTitle`, `ChangeClient`, `ChangePlugin`** — the multi-store mutators; a partial run is
   exactly the "conflicting titles and role-plugins" state the USER named.
4. **`ChangeTeam`, `DeleteTeam`** — dangling team references.
5. The remaining element-level `Change*` — smaller surface, same contract.

## Proposed fix

Per pipeline:

1. Express its gates as `Gate<Ctx>[]` (`lib/gate-transaction.ts`), keeping the existing `Gnn` ids so
   the ops log and every existing reference stay stable.
2. Mark genuinely read-only gates `readOnly: true` (authorization, validation, existence checks).
3. Write an `undo` for every mutating gate, AT THE SAME TIME as the gate. Where the undo needs prior
   state, the gate itself captures the snapshot as its first act (R51.4).
4. **Re-order for R51.6**: irreversible / outward-facing effects (tmux kill, folder removal, remote
   repo or message operations) move LAST, after everything revertible has already succeeded. An
   irreversible effect placed early makes every later failure unrecoverable by construction — this
   is a real re-ordering, not a formality.
5. Return `noChangesMessage(...)` on abort; keep the KERM18NX G10 post-condition as the final
   verification of the success path.

**The hard cases, named rather than discovered later:**
- **`rm -rf` of a workdir** cannot be undone from nothing → the gate must archive first (as
  `DeleteAgent` already does), or move-to-trash rather than delete, so the undo is a move back.
- **`claude plugin install/uninstall`** shells out to another tool; the undo is the inverse command,
  which can itself fail → precisely the R51.5 case, and it must report rather than pretend.
- **tmux session kill** is irreversible in-place; the compensation is re-launch, which produces a
  session with the same name but a NEW process. **DECIDED 2026-07-26 (USER) — re-launch IS a valid
  compensation.** See the STATE block: a pid was never part of "the exact state", so an equivalent
  rebuilt resource satisfies R51.2. What must survive the kill is the session's *conversation* —
  the transcript and the metadata needed to resume it — which the same archive already carries.

## Verification

- `tests/unit/gate-transaction.test.ts` — the runner's contract (landed, 10 tests).
- Per pipeline: a test that forces a mid-sequence gate failure and asserts (a) every prior gate was
  reverted, (b) the state matches the pre-call snapshot, (c) the R51.3 message names the right gate
  number, (d) no gate after the failure ran.
- A parity test: every pipeline's gate list has no uncompensated mutating gate
  (`findUncompensatedGates` returns `[]`).
- `tsc --noEmit` clean; full suite green after each pipeline.

## Estimated risk

HIGH — this rewrites the control flow of every mutating operation in the server. Mitigations: one
pipeline per commit, suite green in between, existing per-pipeline tests must pass unchanged
(behaviour on the SUCCESS path must not move), and the runner is already independently tested.

## Acceptance

- [x] `lib/gate-transaction.ts` — reverse compensation, R51.3 message, R51.5 invalid-state report,
      pre-flight refusal of uncompensated mutating gates, and the R51.7 success-path invariant check
      that aborts+reverts on a violated invariant (13 tests)
- [x] `design/specs/all-in-one-spec.md` — the normative engineering contract (v1.0.0), derived from the
      `make-all-in-one` skill and reconciled with R50/R51; Appendix A names the 3 places it
      supersedes the skill (chief among them: the skill returns on a gate failure, this spec
      compensates)
- [x] R51.9 coverage inventory — `docs/GOVERNANCE-ENFORCEMENT-MAP.md` **Part II**, regenerated by
      `scripts/aio-gate-coverage.py`. GATED 21 · ENFORCED 16 · DOC-ONLY 14 · UNMAPPED 0. Put in
      the existing map rather than a new file: a second doc answering "what enforces rule X" is a
      second source of truth (§2.1 of the spec, applied to documentation)
- [ ] `DeleteAgent` transactional
- [ ] `CreateAgent` transactional
- [ ] `ChangeTitle` / `ChangeClient` / `ChangePlugin` transactional
- [ ] `ChangeTeam` / `DeleteTeam` transactional
- [ ] The remaining 18 `Change*` / marketplace / element pipelines transactional
- [ ] Parity test: zero uncompensated mutating gates across all 26 pipelines
- [ ] Each pipeline declares its R51.7 INVARIANTS (not only its gates) — leftovers and
      contradictions are two different ways to be invalid, and the KERM18NX residue check only
      catches the first
- [x] The tmux-kill compensation question decided and recorded here (R51.10 — re-launch is valid;
      a pid is not part of "the exact state")
- [ ] tsc clean, full suite green

## Approval log

- 2026-07-26T00:17:12+0200 — MANDATE issued by USER (min-approval-requirement: none). Born approved.
