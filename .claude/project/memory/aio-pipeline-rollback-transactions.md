---
name: aio-pipeline-rollback-transactions
description: "a pipeline failed halfway and left two stores disagreeing / should I wrap this whole pipeline in the gate runner / my rollback test passes with the undo deleted / which gates fuse and which stay split"
ocd: 2026-07-30
lmd: 2026-07-31
metadata:
  node_type: memory
  type: project
  tier: aspect
---

# aio-pipeline-rollback-transactions

**An all-in-one pipeline that fails at gate N must undo gates 1..N and tell the caller nothing
changed.** That is **R51**, and the implementation every pipeline must route through is
`lib/gate-transaction.ts` — `runGateSequence(gates, ctx)` with `Gate = {id, what, readOnly?, run,
undo?}`. It unwinds in reverse order, REFUSES TO START when a mutating gate declares no `undo`, and
registers each gate *before* running it so a gate that threw part-way is still compensated. When a
compensation itself fails it says **INVALID STATE** and names the gates it could not revert (R51.5)
rather than lying with "no changes were made" (R51.3).

The spec clause is **`AIO-TXN-10`** in `design/specs/all-in-one-spec.md` ("use the runner"), and
`tests/governance/aio-txn-10-runner-coverage.test.ts` is the ratchet that keeps the remaining
hand-rolled count from rising — it discovers pipelines from the AST, so a new one is in scope
without anyone remembering to list it.

**How to apply — the four questions, in this order:**

1. **Where does the sequence START and END?** First mutation .. the **LAST gate that can ABORT**.
   Not the last gate. An `undo` written past that point is unreachable code that reads as a
   guarantee. [^2]
2. **Is the whole function one window, or is it per BRANCH?** A pipeline with several actions can
   have a four-store window on one and none on the others. [^2]
3. **Do any two gates FUSE?** Reverse-order unwinding assumes the compensations commute in LIFO.
   When the forward order has a constraint whose reverse is *not* its mirror, the two are ONE
   gate. Apply the test in both directions — sometimes the answer is "correctly split". [^3]
4. **What does each `undo` decide from?** What `run` RECORDED in `ctx`, never a flag set up front
   and never a re-derivation of what "should" have happened. Record per unit, inside the loop. [^1]

**Verify by neuter, per undo.** Break each compensation and confirm a NAMED test reds. Three
vacuity shapes this campaign actually hit: a `<gate>: reverted` op line is emitted by an undo that
merely RETURNS; one gate's compensation can MASK another's on a shared field; and an undo whose
first line short-circuits reddens nothing unless the fixture drives real partial work (delete, then
throw). [^1] [^4]

**Where the work stands (2026-07-31):** 9 of 19 pipelines transactional. The 10 remaining are
either single-mutation with nothing abortable after them — so retrofitting buys conformance, not
safety — or `ChangeTitle` / `InstallElement`, which retrofitted pipelines now CALL from inside
their own gates, so converting either changes its callers' failure semantics. Governing card:
`TRDD-DQ6XN2VP`. [^5]

## Applies to

- [[agent-deletion-all-in-one-pipeline]] — `DeleteAgent`, the pipeline whose stores this rule was
  first written for.

## See also

- [[governance-enforcement-ratchet]] — the same ratchet pattern applied to rule enforcement.

## Notes and lessons learned

[^1]: [id:ATOM-7HQ2-N4KD, status:valid, keywords:"rollback_only_covered_one_failure compensation_exists_but_never_runs partial_state_after_error hand_rolled_undo_block looks_like_coverage", ocd:2026-07-31, lmd:2026-07-31]
  DO NOT trust a hand-rolled compensation because it is thorough, BECAUSE code can only roll back
  the failure it is written FOR: `DeleteTeam` had 45 correct lines of reverse-order restore fused
  inside one `if (revertFailures.length)`, so the other abort — the registry delete returning false
  — reported "deletion failed" over a team row that still existed and was an empty husk. DO put the
  decision of WHEN the undo runs in `runGateSequence`; that, not the undo, is what the runner buys.

[^2]: [id:ATOM-5KTW-J8PX, status:valid, keywords:"unreachable_undo_reads_as_guarantee wrap_whole_pipeline_in_runner boundary_of_the_sequence last_gate_that_can_abort per_branch_window", ocd:2026-07-31, lmd:2026-07-31]
  DO NOT wrap a whole pipeline to look thorough, BECAUSE an `undo` after the last ABORTABLE gate can
  never execute while reading as a promise — `CreateAgent` had ~150 lines of it, covering a shared
  AMP index row, and `ChangeMarketplace`'s `add`/`update` branches would each have gained one (with
  `update` having no honest undo at all: you cannot un-pull a marketplace). DO scope the sequence
  first-mutation..last-abortable-gate, PER BRANCH, and leave a comment naming what would make an
  excluded gate reachable.

[^3]: [id:ATOM-9WBR-C3QM, status:valid, keywords:"LIFO_trap reverse_order_is_not_the_mirror two_gates_should_be_one rollback_refused_by_a_gate fuse_or_split", ocd:2026-07-31, lmd:2026-07-31]
  DO NOT assume reverse-order unwinding is correct just because the runner does it, BECAUSE when the
  forward order exists to satisfy a constraint whose reverse is the SAME order (ChangeTitle Gate 9b
  refuses a demotion while the agent is still in a team, so join→title reverses as leave→demote),
  LIFO makes every rollback fail and report INVALID STATE about a fully recoverable system. DO fuse
  those into ONE gate — but apply the test in BOTH directions: `ChangeMarketplace`'s G02b+G03
  correctly stayed SPLIT because a reinstall needs the marketplace registered and the re-add runs
  first. After three fusions the reflex is to fuse.

[^4]: [id:ATOM-2FMD-L6VT, status:valid, keywords:"neuter_reddened_nothing undo_never_runs_in_practice last_gate_compensation_latent test_cannot_pin_it", ocd:2026-07-31, lmd:2026-07-31]
  DO NOT report the last abortable gate's own `undo` as covered, BECAUSE write-ahead registration
  makes it reachable only if `run` completes its mutation and THEN throws — and when nothing follows
  the mutation (a single `saveJsonSafe`), its recorded flag is either set with the write durable or
  never set with nothing to restore, so neutering it reds 0 tests. DO keep it (the runner requires
  it, the partial-work contract makes it correct), name the latency in the card, and pin what a test
  CAN pin: that this gate's FAILURE unwinds the gates before it.

[^5]: [id:ATOM-8XNC-P5RJ, status:valid, keywords:"which_pipeline_to_retrofit_next picked_by_gate_count no_partial_state_window conformance_not_safety", ocd:2026-07-31, lmd:2026-07-31]
  DO NOT pick the next pipeline to retrofit by op count, BECAUSE size is not risk: all five
  remaining sub-100-op candidates (`ChangeMCP`, `ChangeLSP`, `ChangeHook`, `ChangeMetadata`,
  `ChangeCLIArgs`) turned out to be ONE mutating gate with nothing abortable after, so each would
  move the ratchet and buy zero safety. DO measure the WINDOW first — five scoped greps for
  mutations vs abort points settled it — and say plainly when a retrofit is for conformance.
