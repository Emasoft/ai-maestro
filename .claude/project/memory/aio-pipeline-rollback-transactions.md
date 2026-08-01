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

**Where the work stands:** see the status atom below — `ChangeTitle` is DONE and NO pipeline has an
open window left; the remaining nine are conformance-only and retrofitting them buys zero safety.
[^5] [^6] [^7] [^10]

## Applies to

- [[agent-deletion-all-in-one-pipeline]] — `DeleteAgent`, the pipeline whose stores this rule was
  first written for.

## See also

- [[governance-enforcement-ratchet]] — the same ratchet pattern applied to rule enforcement.
- [[lenient-json-reader-destroys-the-file]] — the stores these pipelines mutate are JSON files, and a
  reader that cannot tell "absent" from "unreadable" makes both the gate's verification vacuous and
  its compensation destructive.


^ATOM-2U3W-0C2K [desc:"Where the R51 retrofit stands: ChangeTitle is DONE and no pipeline has an open window left — the remaining nine are conformance-only and retrofitting them buys zero safety", keywords: which_pipeline_still_needs_the_runner is_the_R51_retrofit_finished ChangeTitle_window_closed InstallElement_conformance_only compensation_is_forbidden_here retrofit_buys_zero_safety, ocd: 2026-07-31, lmd: 2026-07-31]

**Status (end of 2026-07-31): `ChangeTitle` is DONE and NO pipeline has an open partial-state window
left.** It runs on `runGateSequence` at `element-management-service.ts:4204`, and **13 of its 14
mutating gates have their `undo` pinned by a named neuter** in
`tests/services/change-title-window.test.ts`; the 14th (**G15's**) is UNREACHABLE on any
compatibility-altering title change, because G14d runs FIRST and removes everything incompatible
with the new title, so G15's detection finds nothing and its ledger stays empty — recorded as
unreachable, not as a gap. Governing card: `TRDD-DQ6XN2VP`.

**The remaining nine are conformance-only and retrofitting them buys ZERO safety** — eight are a
single mutating call with nothing abortable after it, and `InstallElement` is measured PERMANENTLY
conformance-only because its three pre-EXE mutations are ones a compensation is FORBIDDEN or harmful
to reverse (R20.31 verdict *Explicit* protects the local plugin source; `.claude/` is a guaranteed
agent invariant a watchdog re-creates; the marketplace registration is SHARED across agents). They
stay open on the `AIO-TXN-10` **conformance ratchet alone**.

**The durable shape facts** (these outlive the status above): the window opens at **G9a**, not at
the first mutation — G03 mutates earlier but HEALS a corrupt field, so its undo would re-break the
repair, and starting there would enclose two gates that early-return SUCCESS, which the runner
cannot express at all. The shape is a **gate ARRAY**, not `runAioPipeline` (that takes
`pre[] + ONE exe + post[]` and cannot express 13 mutations). **G14 before G10 is deliberate**
(TRDD-EE5YX5LF) — the array order IS the crash-safety property, so do not sort it. And the live G10
lie the characterization exposed is CLOSED (`47feb243`) by a DEFERRED FAIL: the verdict is withheld
at the terminal while every alignment gate still runs, because an abort at G10 would have been a
security regression. [^6] [^7] [^8] [^9] [^10]


^ATOM-LF4Q-1PAS [desc:"A pipeline that is ALSO called as an R51 compensation must report a verification verdict as its own field, never fold it into success", keywords: pipeline_is_also_a_compensation verification_wired_to_abort rollback_reports_INVALID_STATE_but_state_is_fine verified_tri_state_not_a_boolean report_the_verdict_do_not_fold_it isCompensation_flag_is_fail_dangerous, ocd: 2026-07-31, lmd: 2026-07-31]

**`ChangePlugin` reports its G11 read-back verdict as `ChangePluginResult.verified?: 'ok' |
'mismatch' | 'unknown'`, and leaves `success` untouched.** The obvious alternative — fail the
operation when the settings read-back disagrees — was implemented and REVERTED the same session
(neuter **N17** reproduces it): `ChangeMarketplace::remove`'s R51 compensation reinstalls THROUGH
`ChangePlugin`, so on that path a failed read-back does not report "the reinstall did not verify",
it escalates to **R51.5** and tells the user the system is in an INVALID STATE requiring manual
repair — about a system that was restored.

**The shape is FAIL-SAFE by construction:** a caller that ignores the field behaves exactly as
before, so the compensation path needs no change and cannot regress. The rejected `isCompensation`
INPUT flag has the inverse property — a compensation that forgets to set it gets the catastrophic
behaviour.

**THREE values, not a boolean:** `mismatch` (read cleanly, the change did not land — a positive
VIOLATION) and `unknown` (unreadable) are the two things `TRDD-K71FV649` separated; an invariant may
act on a violation and never on an unknown. Callers check `=== 'mismatch'`, never `!== 'ok'`, so the
idempotent no-op path (which returns before G11 and leaves the field unset) can never read as a
violation.

Cards: `TRDD-RO90UCKQ` (the design) and `TRDD-K71FV649` (the violation-vs-unknown split). [^11]

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
[^6]: [id:ATOM-MUOZ-V2O8, status:valid, keywords:"mutation_without_a_legal_undo retrofit_buys_zero_safety deleting_the_users_source_folder shared_registration_cannot_be_reversed is_this_really_a_window", ocd:2026-07-31, lmd:2026-07-31] DO NOT treat every mutation before an abort point as a partial-state window, BECAUSE reversing it must also be LEGAL and HARMLESS: three of `InstallElement`'s passed the "is there abortable work after it?" test and failed the second one — R20.31 (verdict *Explicit*) forbids deleting from the local plugin source, `.claude/` is an agent invariant the watchdog re-creates, and the marketplace registration is SHARED, so deregistering it breaks every other agent. Retrofitting by op count would have written a compensation that deletes a user-owned folder and called it R51 compliance. DO ask BOTH questions before scoping a sequence.
[^7]: [id:ATOM-FTR8-IT18, status:valid, keywords:"gate_reported_success_but_state_is_inconsistent half_of_a_cascade_landed warn_and_continue_swallowed_it only_the_second_half_is_try_wrapped cascade_not_atomic", ocd:2026-07-31, lmd:2026-07-31] DO NOT wrap only the SECOND half of a cascade, BECAUSE the operation then returns success over the exact state the cascade exists to prevent: ChangeTitle's G10 removes the manager and THEN blocks every team (a team must not run without one), only the block is try/caught, so a failure there yields `success: true` on a host with no manager and unblocked teams — traced solely by an op nobody reads. DO make the cascade ONE gate whose undo restores both halves, and CHARACTERIZE the current residue first so the retrofit has a state to invert.
[^8]: [id:ATOM-TNAF-2FQD, status:valid, desc:"The interim fix for a half-wrapped cascade is a deferred fail, not an abort", keywords:"obvious_fix_is_a_security_regression abort_strands_what_an_earlier_gate_wrote half_wrapped_cascade retry_short_circuits_before_the_repair withhold_the_verdict_not_the_work", ocd:2026-07-31, lmd:2026-07-31] DO NOT fix a half-wrapped cascade by making it ABORT, BECAUSE the abort strands whatever an EARLIER gate already wrote: ChangeTitle writes the title at G14 BEFORE G10, so aborting at G10 skips the revocation gates and leaves a demoted MANAGER holding AID tokens embedding `manager` — and the retry cannot repair it, because Gate 6 sees the title already changed and returns success first. DO withhold the VERDICT at the terminal while the alignment gates still run; abort is correct only once that earlier write is itself compensable.
[^9]: [id:ATOM-B1Y7-TS5F, status:valid, keywords:"how_big_is_the_ctx_reify_the_locals_gate_runner_retrofit_size_undo_ledger_not_locals_whole_function_edit_estimate", ocd:2026-07-31, lmd:2026-07-31] DO NOT size a gate-runner retrofit from the function's LOCAL count, BECAUSE the ctx is an UNDO LEDGER — the landed sibling's has 4 fields, all recorded by `run` for `undo`, with adapters and plans closed over lexically; sizing it at "117 declarations, ~12-15 carriers" deferred the work a whole session. DO read a sibling's ctx first.
[^10]: [id:ATOM-XDZ3-F87P, status:valid, desc:"G16's undo was impossible by construction until it stopped routing through ChangePlugin", keywords:"undo_through_a_wrapping_pipeline rollback_reports_critical_but_state_is_recoverable gate_refuses_during_reverse_unwind undo_must_use_the_primitive verify_by_effect_not_by_return", ocd:2026-07-31, lmd:2026-07-31] DO NOT undo a mutation by calling a higher-level PIPELINE that wraps the primitive, BECAUSE the wrapper imports gates the forward path never ran and one of them can make the undo impossible by construction: ChangeTitle G16 installed with `installPluginLocally` directly but undid through `ChangePlugin`, whose G08 refuses to uninstall the plugin the CURRENT title requires — and on a reverse unwind that title is still the NEW one, so EVERY rollback past G16 reported R51.5 CRITICAL over a fully recoverable system. DO reverse through the same PRIMITIVE that performed it, and VERIFY BY EFFECT when that primitive best-efforts its subprocess and cannot signal failure.
[^11]: [id:ATOM-PJJT-EEXN, status:valid, desc:"A pipeline called as a compensation must not gain a failure mode; and 'should this gate abort?' presupposes a window that may not exist", keywords:"should_this_gate_abort verification_gate_only_warns wire_the_verdict_into_success my_rollback_now_reports_CRITICAL where_does_the_transaction_CLOSE gate_is_outside_the_window", ocd:2026-07-31, lmd:2026-07-31] DO NOT add a failure mode to a pipeline that is ALSO called as an R51 compensation — not even a verification you can prove correct — BECAUSE on the undo path a "the read-back disagrees" failure is not reported as a weak verify, it becomes R51.5 "the system is in an INVALID STATE, manual repair required" about a system that was just restored; wiring `ChangePlugin`'s G11 verdict into `success` reddened both `change-marketplace-rollback` tests with exactly that message. DO report the verdict in its OWN field and let each CALLER decide (user routes 409, the compensation ignores it) — fail-safe, because a caller that never reads it cannot regress. AND before debating abort at all, LOCATE THE TRANSACTION'S CLOSE: `ChangePlugin`'s only `runGateSequence` closes at `:4874` while G11 is at `:4960`, with three of five actions never entering the window — so there was nothing to abort into, and the real question was the much larger "should the window be widened across five actions?".
