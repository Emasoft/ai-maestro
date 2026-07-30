---
trdd-id: DQ6XN2VP
title: Make every all-in-one pipeline transactional — all-or-nothing with reverse compensation
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-26T00:17:12+0200
updated: 2026-07-30T19:25:32+0200
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

**THE DESIGN FORK — decide before writing a single `undo`.** `runGateSequence` REFUSES to start when
a mutating gate lacks an `undo` (R51.7), and three of these gates have no honest one: a revoked AMP
key cannot be un-revoked (re-issuing yields a DIFFERENT key its correspondents do not hold), and a
rejected governance request cannot be un-rejected. Writing lossy undos to satisfy the pre-flight
would be the "fake rollback" G10's own comment warns against. The alternative, which the code half
implements already: **order by reversibility around an explicit COMMIT POINT** —

- *reversible prefix, wrapped in `runGateSequence`*: G04 teams, G05b unpersist, G07c groups — each
  compensated by snapshot-and-restore of the same JSON rows (cheap and EXACT);
- *the commit point*: G08/G08b, the registry write that decides the agent is gone;
- *irreversible tail, best-effort after the commit*: G05 tmux kill, G06 revocations, G07/G07b
  rejections, G09 folder — where a failure is RESIDUE (G10 already reports it), not a rollback question.

That is "check every precondition before the first mutation" applied to a pipeline whose mutations
are not all equal, and it needs no dishonest compensation.

**COUPLED CARD — and it reached the SAME architecture independently.** TRDD-OWO449MR (task #103)
needs the local plugin-uninstall to run through the `claude` CLI, which requires the workdir to still
EXIST — so its gate must move from after the `rm -rf` to before it. Of its three shapes it
recommends **A2: "reorder, and accept irreversibility by placing the uninstall LAST among mutating
gates — no `undo`; instead the gate cannot be reached until every gate that could still fail has
passed"**, explicitly *"taken together with TRDD-DQ6XN2VP's DeleteAgent retrofit … doing A2 first, by
hand, means editing the same 500 lines twice."* That is this card's commit-point split, arrived at
from the other end. Two cards converging on one ordering is the strongest evidence available that the
ordering is the right one.

The unified target ordering:

```
READ-ONLY PRELUDE     G00 auth · G01 exists · G01b ASSISTANT refusal        (hard-return, no mutation yet)
SNAPSHOT              G01c cemetery archive                                 (refuses the delete if it fails)
REVERSIBLE PREFIX     G02? · G04 teams · G05b unpersist · G07c groups       (runGateSequence; exact snapshot/restore undos)
COMMIT POINT          G08 registry delete + G08b on-disk verify             (the write that decides the agent is gone)
IRREVERSIBLE TAIL     G05 tmux kill · G06 revocations · G07/G07b rejections
                      · CLI plugin uninstall (OWO449MR A2, workdir still
                        present) · G09 folder rm -rf                        (best-effort; failure = residue, not rollback)
POST-CONDITION        G10 verify + residue on the result
```

G02's placement is the open question (a nested `ChangeTitle` is not obviously compensable) —
advisor consulted 2026-07-30.

NEXT ACTION: settle the commit-point design (advisor consulted 2026-07-30), read OWO449MR, then
retrofit the reversible prefix + write the mid-pipeline-failure parity test that is the real
acceptance criterion.

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
