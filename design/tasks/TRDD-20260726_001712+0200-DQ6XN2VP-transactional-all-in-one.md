---
trdd-id: DQ6XN2VP
title: Make every all-in-one pipeline transactional — all-or-nothing with reverse compensation
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-26T00:17:12+0200
updated: 2026-07-31T20:09:49+0200
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
implementation-commits: [8a47c5a2, 4191381e, ecd1a1b, 0e08912b, dc034515, e696a6ba, 3f2e0e1d, 944063f2, 778151e9, 72886dd1, 1b129db8, 47feb243, bfc1f226, c1681c9d, 9d3c08d6, 2c5d2fcf, 653b894f, dd9ce737, 7fd5044c, da3ed3e5, 4ee79582, 61858167, 40cefbb8, 0db3f598, 4cd3d148, 353b9089, 1fa48129, 6baa7c8b, 6201ba8d, 8f2c9d71, 63e56bfa, aca4c858, be35ec55, 4d81aa69, 75a7d9e7, 73fa3db0, 790cd8cb, 2613c907]
---

## ⏵ EIGHT OF THE NINE LANDED 2026-07-31 (`2613c907`) — ONE left, and it is not more of the same

**⚠ SUPERSEDES the headline below.** The nine conformance rows are now **eight done, one left**.
`ChangeAvatar`, `ChangeName`, `ChangeFolder`, `ChangeMetadata`, `ChangeCLIArgs`, `ChangeMCP`,
`ChangeLSP` and `ChangeHook` each put their single mutating call under `runGateSequence` — the
runner every landed retrofit uses, per the *"Which runner do the nine conformance rows call?"*
measurement below. `MAX_HANDROLLED` 9 → **1**, `MIN_TRANSACTIONAL` 10 → **18**, and all eight are in
`MUST_BE_TRANSACTIONAL`, so a later un-retrofit cannot hide behind an unchanged total.

**WHAT IT BOUGHT, and the number NOT to quote back:** conformance, plus **ONE** real compensation.
The measurement below was right — seven of the eight have nothing abortable after the write, so
their `undo` is **LATENT BY CONSTRUCTION**: no failure path reaches it, and no neuter can redden a
test for it. That is written into each one's own comment rather than counted as rollback coverage,
per this repo's standing rule that an unreachable undo is *named*, not tallied. They exist because
`runGateSequence` REFUSES to start a mutating gate lacking one, and because a gate appended after
one of these must find the compensation already there rather than remember to write it.

**`ChangeLSP` is the exception the op-count screen could not see.** Its write is a bare `writeFile`,
NOT the atomic tmp+rename of `saveJsonSafe` — so a torn write leaves a truncated `.lsp.json` that
every later load parses as `{}`, silently discarding every OTHER language server the file held. Its
undo restores the bytes read before the write and is **pinned**
(`tests/services/element-management-service.test.ts`, *"restores the prior .lsp.json when the write
dies part-way"*). Neutered by making the undo write the POST-mutation state back: exactly one test
reds, and it dies on the **byte-equality** assertion rather than on the write-COUNT — which is what
distinguishes *a compensation ran* from *a compensation restored the right thing*. A no-op undo
would have died on the count; both assertions are therefore live.

**Three places a quieter choice would have shipped a LYING compensation:**

| pipeline | the choice | why the quiet alternative lies |
|---|---|---|
| `ChangeMCP` (remove) | the undo **THROWS** | restoring a removed server means re-adding it with the config it had, and nothing here READ that config. An early `return` still earns the runner's `G04: reverted` line — a claimed restore that never happened. Its `add` undo *is* exact (`mcp remove` inverts `add-json`), and both branches record the completed unit in ctx so `undo` reverses only what landed. |
| `ChangeName` | the undo goes back through **`updateAgent`** | `updateAgent` also renames every live tmux session (`computeSessionName`). Restoring the field by hand leaves the sessions on the NEW name and the registry on the old — undo through the mechanism that performed it. |
| `ChangeHook` · `ChangeLSP` | validation moved **OUT** of the write path | a gate that legitimately does nothing still earns its op line from the runner, so a "hook not found" check left inside the mutation records an edit that never happened. |

**`InstallElement` is the one left, and it is a DIFFERENT problem, not a ninth of the same.** It is
the large pipeline that retrofitted pipelines CALL, so converting it changes its callers' failure
semantics; and three of its pre-EXE mutations are ones a compensation is FORBIDDEN (R20.31, verdict
**Explicit**) or harmful to reverse — see the `⚠ CORRECTED` section below, which measured exactly
that. It wants its own card. **Do not fold it into a "finish the last one" session.**

Verified at `2613c907`: `tsc --noEmit` = 0 lines; `yarn test` = **313 files / 4528 passed / 2
skipped** (+1, the new ChangeLSP test; the 310/4453 baseline recorded further down predates the
three oauth-rotator test files that landed for TRDD-CVQJNW3A); `trddgrep validate` = exit **1** with
only `7123D51A` and `C7A81642`.

## ⏵ MEASURED 2026-07-31 — 10 done, 9 left, and NONE of the nine has a compensable window

**⚠ SUPERSEDED HEADLINE — do NOT carry forward "the remaining work is ONE pipeline, `ChangeTitle`".**
`ChangeTitle` LANDED (runner at `:4204`) and its rollback coverage is COMPLETE — thirteen of its
fourteen mutating undos pinned by a named neuter, the fourteenth (G15's) unreachable by construction.
The nine below are **conformance only**: each is one mutating call with nothing abortable after it,
so there is no state a compensation could restore. The paragraph below is kept because its MEASURING
DISCIPLINE is the load-bearing part.

**The remaining work is not "10 pipelines". It is ONE** — `ChangeTitle`. Every candidate's
partial-state window was measured, per the standing rule that you measure the window before picking
by op count. The `InstallElement` row below was measured WRONG the first time and corrected the same
morning by reading the function; the correction is the finding, and it is recorded under the table.

| pipeline | gate ops | mutating calls | window | verdict |
|---|---|---|---|---|
| `ChangeTitle` | 131 | **~15** — `updateAgent` ×6, `blockAllTeams`/`unblockAllTeams`, `updateTeam` ×4, `revokeTokensForAgent`, `revokeTokensFromIssuer`, `installPluginLocally` ×4, `hibernateAgent` | **REAL — CLOSED** (runner `:4204`, 13/14 undos pinned) | **DONE** |
| `InstallElement` | 101 | 13 — `mkdir` ×2, `saveJsonSafe` ×7 (5 local, 2 user), `execFileAsync` ×4, `rm` ×1 | **NONE that may legally be compensated** — see below | conformance only |
| `ChangeFolder` | 10 | 1 (`updateAgent`) | none | conformance only |
| `ChangeName` | 9 | 1 (`updateAgent`) | none | conformance only |
| `ChangeMetadata` | 7 | 1 | none | conformance only |
| `ChangeCLIArgs` · `ChangeHook` · `ChangeLSP` · `ChangeMCP` | 6 each | 1 each | none | conformance only |
| `ChangeAvatar` | 3 | 1 (`updateAgent`) | none | conformance only |

`ChangeFolder` and `ChangeName` were the two never previously measured, and they land with the other
six: one `updateAgent`, then only notes, a read-only verify, and the ledger emit — nothing abortable
after the mutation, so there is no state a compensation could restore. **8 of 10 are paperwork.**

### Which runner do the nine conformance rows call? `runGateSequence` — measured 2026-07-31 19:5x

All **10** landed retrofits call `runGateSequence` directly, across 9 pipelines (`ChangeSkill` and
`ChangeTeam` carry two windows each). **`runAioPipeline` has ZERO production callers** — its only
drivers are 4 tests in `tests/unit/gate-transaction.test.ts`.

That is not a reason to be cautious about it: `runAioPipeline` is **not separate machinery**, it is
PRE/EXE/POST sugar that flattens to `runGateSequence([...pre, exeGate, ...post], ctx, opts)` — the
engine underneath is the one with 10 production call sites. But it does decide which name the nine
conformance rows should use: **prefer `runGateSequence`**, matching every landed retrofit, unless a
row genuinely has a skippable EXE (`skipIf` is the only thing the sugar adds). A row that reaches
for `runAioPipeline` merely because the spec's prose names it would be the first production caller
of an arrangement nothing else uses.

*Correction owed to the record:* an older plan artifact framed this work as *"wrap DeleteAgent —
`runAioPipeline` still has zero callers"*, which read as risk. `DeleteAgent` was **already
retrofitted** when that was written (runner at `:8738`, 11 gates, 10 carrying `undo`); the zero-caller
fact is true of the sugar and irrelevant to the engine.

### ⚠ CORRECTED 2026-07-31 — `InstallElement` was picked on two wrong numbers and one wrong claim

I first wrote *"`InstallElement` is the one to do first … 13 `saveJsonSafe` writes span BOTH the
agent-local settings and the USER-scope `settings.json`, so a mid-pipeline failure leaves two scopes
disagreeing about what is installed."* Reading `services/element-management-service.ts:562-1481`
refutes every part of it:

- **7 `saveJsonSafe`, not 13**, and `installPluginLocally` is **not called from this pipeline at all**
  (it is `ChangeTitle`'s). Both numbers came from a mis-scoped grep, not from the function.
- **The two USER-scope writes are REPAIRS, not creators of a disagreement.** `PG03` (:1253) and
  `PG07` (:1448) fire only after a *local* install succeeds, and each one *turns OFF* an
  already-enabled user-scope copy. When either fails, user scope is left exactly as the caller found
  it — so R51's "return to exactly the state it was in" is satisfied by doing nothing. The
  disagreement they address PRE-DATES the call.

**And the deeper reason the retrofit would have been wrong: every pre-EXE mutation here is one a
compensation is FORBIDDEN or harmful to reverse.**

| mutation | why it cannot be undone |
|---|---|
| `G07`/`EXE` `mkdir(<agentDir>/.claude)` (:713, :889) | `.claude/` is the `claude-dir` row of the agent-invariant registry (`lib/agent-invariants.ts:69`) — guaranteed to exist. A compensation deleting it fights the watchdog that re-creates it. |
| `G11` `claude plugin marketplace add` (:824) | a SHARED, idempotent registration in the user's Claude config. Deregistering it on rollback breaks every other agent installing from that marketplace. |
| `G13` `convertAndStorePlugin` + `emitForClient` (:867-868) | writes into `~/agents/custom-plugins/` — **R20.31, verdict Explicit**: *"AI Maestro NEVER DELETES a plugin folder from them … Removing a source folder is explicitly the user's responsibility."* A compensation deleting it VIOLATES a governance rule. |

What is left is a single `withSettingsLock` + `saveJsonSafe` on ONE settings file, with a CLI→direct
fallback and a write-back that self-heal. There is no window a legal compensation could close, so
retrofitting `InstallElement` would move the ratchet and buy **zero** safety — the same verdict the
other eight got, reached for a different reason.

**THE GENERALIZABLE LESSON — a mutation is not a WINDOW just because it is a mutation.** Every prior
measurement on this card asked "does anything abortable follow the write?". That question is
necessary and not sufficient: it finds a window that a rule may then FORBID you to close. Ask both —
*is there abortable work after the mutation*, **and** *is reversing it legal and harmless?* Three of
`InstallElement`'s mutations pass the first test and fail the second, one of them against a rule
marked **Explicit**. Had I retrofitted by op count I would have written a compensation that deletes
a user-owned source folder and called it R51 compliance.

### THE `ChangeTitle` WINDOW MAP — measured 2026-07-31, before touching a line of it

`services/element-management-service.ts:2286-3505` (1219 lines, 131 gate ops). The mutation sites
are measured from the call sites; the **undo column is the DESIGN, not yet implemented**.

**⚠ THE LABEL ORDER IS NOT THE EXECUTION ORDER, and building the gate array from the labels would
destroy a tested safety property.** `G14` — the `updateAgent({governanceTitle})` write — is at
**:2685**, which executes **BEFORE** `G10`-`G13b` at **:2736-2847**. This is deliberate, commented at
length (:2651-2671), and pinned by a test (`2e099953`, TRDD-EE5YX5LF — *"the G14-before-G10 ordering
that keeps a failed demotion harmless"*). Its own words:

> Running it FIRST makes such a failure a clean no-op instead. … the residual failure mode inverts to
> the strictly milder one — if the title lands and a later governance write throws, the result is a
> STALE manager pointer (visible, non-blocking, one call to repair) rather than NO manager (invisible
> until the next team operation, and blocking everything).

**And this ordering SURVIVES the retrofit — it is not replaced by rollback.** It defends against
*process death* mid-pipeline, and rollback machinery does not survive a crash. Same argument the card
already recorded for `DeleteAgent`'s G06 (*"moving revocation after the registry write is a security
regression"*): a compensation covers a THROW, never a `kill -9`, so a crash-safe ordering and a
compensation are orthogonal defences and the retrofit must keep both.

| # | gate | line | mutates | undo (design) |
|---|---|---|---|---|
| 1 | G03 | :2402 | `updateAgent({program})` — auto-fix an empty program | **EXCLUDED — see the window-start correction below.** Its undo would restore `program: ''`, re-breaking a self-heal. |
| 2 | G06b / G9a | :2494, :2645 | `updateAgent({githubRepo})` | **LANDED `61858167`** — restore prior `githubRepo`, captured write-ahead |
| 3 | **G14** | **:2685** | **`updateAgent({governanceTitle})` — THE title write** | **LANDED `61858167`** — restore `oldTitle`; the flag is set BEFORE the verification, because every abort below it is a case where the write LANDED |
| 4 | G10 | :2736-2741 | `removeManager()` + **`blockAllTeams()` — hibernates every team agent** | **LANDED `40cefbb8`** — pointer FIRST (the wake guard refuses a team agent while `getManagerId()` is null), then `unblockAllTeams()`, then re-wake each from the list `blockAllTeams()` returned. Failures are collected and THROWN at the end ⇒ the honest R51.5 CRITICAL path. A mixed-blocked corpus REPORTS rather than over-restoring. |
| 5 | G11 | :2758, :2774 | `updateTeam({chiefOfStaffId: null})` + `rejectGovernanceRequest` | **LANDED `40cefbb8`** — restore the pointer; un-reject patches only the 3 fields `rejectGovernanceRequest` writes, per recorded id. Deliberately NARROWER than `DeleteAgent` G07's whole-file snapshot: a ChangeTitle rollback must not clobber approvals another writer made meanwhile. |
| 6 | G12 | :2796 | `updateTeam({orchestratorId: null})` | **LANDED `40cefbb8`** — restore the pointer, per team id recorded (once nulled, "which teams had this agent" is no longer answerable) |
| 7 | G13 / G13b | :2814, :2846-2849 | set manager in `governance.json`, `unblockAllTeams`, re-point team COS/ORCH | **LANDED `0db3f598`** — re-block FIRST then restore the pointer (G10's rule read backwards). `priorManagerId` is NOT always null: replacing an existing MANAGER is the same write, and "restore no manager" would block every team as a rollback side effect. G13b restores the slot's PRIOR occupant for the same reason, and records nothing on the already-correct branch. |
| 8 | G14b | :2905 | `revokeTokensForAgent` (AID) | **the compensable twin ALREADY EXISTS** — `lib/aid-token.ts:542 revokeTokensForAgentCompensable` returns the removed `AIDTokenRecord[]`; `:587 revokeTokensForAgent` is a count-only wrapper. Built for `DeleteAgent`; ChangeTitle just calls the wrong one. **LANDED `4cd3d148`** — and it was NOT free: see the harness note under the NEXT ACTION. |
| 9 | G14e | :2929 | `revokeTokensFromIssuer` (portfolio) | **BUILT 2026-07-31** — `revokeTokensFromIssuerCompensable` + a delegating count-only `revokeTokensFromIssuer`, mirroring the aid-token seam. Lossless `active → revoked` flip, undone from the touched `(subjectId, token_id)` list; 7 tests, 4 neuters. **LANDED `4cd3d148`** — its `emitPortfolioOp` is the SAME append-only problem as G14c and moves out on the same terms, in the same final slice. |
| 10 | G16 | the Claude `installPluginLocally` path and the non-Claude `adapter.install` path | installs the NEW role-plugin | **LANDED (slice 4c)** — records WHICH mechanism ran and undoes through that same one; G17's own `installPluginLocally` retries are covered by G15/G16 and are deliberately NOT compensated again |
| 11 | G16b | the `--agent` flag rewrite | `updateAgent({programArgs})` | **LANDED (slice 4c)** — restores the prior string and THROWS on failure (a stale `--agent` wakes the wrong persona = invalid state, not a warning) |
| 12 | G17 | `enforceRoleOrHibernate` | `updateAgent({roleMissing})` + `hibernateAgent` + ledger | **LANDED (slice 4c)** — restores the flag BEFORE re-waking (`wakeAgent` refuses while it is set); compensates ONLY the quarantine, never G17's plugin repairs |

**⚠ THREE ROWS WERE MISSING — added 2026-07-31, after commit 2 put every gate in the array.** The
table above was written from the pre-restructure reading and skipped three mutating gates. A
mutating gate absent from this map is one the runner will REFUSE TO START on, so the gap would have
surfaced as a dead pipeline mid-edit rather than as a design question:

| # | gate | mutates | undo (design) |
|---|---|---|---|
| 13 | **G14c** | **ledger emit** (`change_title`) | **DECIDED 2026-07-31 — MOVE IT OUT OF THE ARRAY; write no undo.** See "⚠ G14c IS DECIDED" below for the three measurements that settle it. Emit AFTER the transaction, gated on **`txn.ok` (the transaction COMMITTED)** — NOT on the function returning success. |
| 14 | **G14d** | `ChangePlugin(action:'uninstall', rolePluginSwap:true)` per stale role-plugin | reinstall each entry it recorded — `run` must push `{name, marketplace}` per SUCCESSFUL uninstall into ctx, and `undo` reinstalls from that list. It already loops over `roleEntries`, so this is the loop shape the Gate docs prescribe. |
| 15 | **G15** | `uninstallAllRolePlugins(agentDir)` on BOTH branches (swap, and the stale-clean branch) | reinstall `ctx.g15Uninstalled` (the `currentPluginName` it removed). **Note the second branch uninstalls with `.catch(() => {})` when there is no current plugin** — record nothing there, since nothing known was removed. |

**AND COMMIT 3 IS NOT ONLY UNDOS — IT OWES THE TESTS THAT PIN THEM.** This card already records that
*"no test anywhere in the repo forces a mid-pipeline failure and asserts the system was left
unchanged"* for `DeleteAgent`; the same is true here, and commit 2 measured two instances of it
directly (G22's aborts and G15's R9.13 abort were each unpinned — disabling them left the suite
green). **G22 has since been pinned — `TRDD-DFP0HWRX`, commit `8ca58c05`; G15's R9.13 abort has
NOT**, and is unreachable by any test today. The memory page's rule is **verify by neuter, PER
UNDO** — break each compensation, confirm
a NAMED test reds. With ~14 undos and essentially no rollback coverage today, **writing the
characterization tests is the larger half of commit 3, not a follow-up.** Lowering
`MAX_HANDROLLED` 10 → 9 on undos nobody neutered would move the ratchet on a guarantee that was
never verified — the exact failure this card exists to prevent.

**⚠ COMMIT 3 IS NOT ONE ATOMIC COMMIT — CORRECTED 2026-07-31, and this is what has been making it
look too big to start.** This card said *"swapping the driver and writing the undos is ONE commit,
not two"*. That is TRUE as a constraint on ORDER and FALSE as a constraint on COMMIT COUNT, and the
difference is the whole risk profile. Measured:

- `undo` is **OPTIONAL** on `Gate<Ctx>` (`lib/gate-transaction.ts:19-45`).
- The refusal — `findUncompensatedGates` — is called at **`:126`, INSIDE `runGateSequence`**. Nothing
  else invokes it.
- ChangeTitle does **not call `runGateSequence` yet**; its hand-rolled loop does `await gate.run()`
  and nothing else.

So **an `undo` added today is INERT** — it type-checks, ships, and never executes until the driver
swaps. Commit 3 therefore slices exactly the way commit 2 did (8 slices, zero behaviour change
each): N slices adding undos a few gates at a time, each `tsc`-clean with the suite at the exact
baseline, then **ONE final small slice** that swaps the driver, routes G22 to `invariants`, moves
G14c out, and lowers `MAX_HANDROLLED` 10 → 9. A slice that runs out of room is a slice not written,
never a half-converted pipeline.

**The one prerequisite, and it is one line:** the array is annotated
`const gates: Array<{ id: string; what: string; run: () => Promise<void> }>` (`:2685`), so it must
be widened with `undo?: () => Promise<void>` before any undo can be attached.

**The ctx:** today's `run: async () => {…}` takes no argument and closes over lexical state, so the
undo ledger is introduced as a plain `const ctx` declared above the array that runs WRITE and undos
READ. That works identically under both drivers — when the driver swaps, the same object is passed
as the runner's ctx and no undo is rewritten. (Plan, not yet measured.)

**⚠ COMMIT 3 IS COMPLETE — `ChangeTitle` IS TRANSACTIONAL.** Eight slices. The driver is
`runGateSequence`; all 15 mutating gates carry compensations; G19/G20/G21 are declared `readOnly`;
G22 is the runner's `invariants` hook; and the three append-only tails — the `change_title` ledger
entry (G14c), G14e's portfolio entry, and G18's mesh broadcast — left the array and fire only on
`txn.ok`. `MAX_HANDROLLED` 10 → **9**, `MIN_TRANSACTIONAL` 9 → **10**, `ChangeTitle` added to
`MUST_BE_TRANSACTIONAL` (the membership guard that a bare count cannot make).

**NEXT ACTION — EVERY REACHABLE UNDO IS NOW PINNED. ChangeTitle's rollback coverage is DONE.**
**THIRTEEN of the fourteen mutating gates are pinned**, all in
`tests/services/change-title-window.test.ts`, each by a named neuter; the fourteenth, **G15's undo,
is UNREACHABLE** on any compatibility-altering title change (below) and is recorded as such, not as
a gap. The card's remaining work is the OTHER pipelines — this one is closed.

| undo | pinned by | commit |
|---|---|---|
| **G14** | *"reverts the title write when removeManager fails"* — two neuters that fail DIFFERENTLY (`throw` ⇒ R51.5 INVALID STATE, silent `return` ⇒ `expected 'autonomous' to be 'manager'`), so the assertion discriminates a no-op compensation from a failed one | earlier |
| **G10** | the pointer restored BEFORE the fleet is woken (`['setManager','unblockAllTeams','wakeAgent']`) + the `nowLive` skip-check | `8f2c9d71` |
| **G16b** · **G16** | the `--agent` flag restored byte-for-byte; the plugin assertion + `not.toMatch(/INVALID STATE/)` is what caught G16's broken undo | `63e56bfa` |
| **G14b** · **G14e** | both token stores back at their seeded counts — INDEPENDENTLY (`+0 to be 3` / `+0 to be 2`) | `aca4c858` |
| **G14d** | the old title's role-plugin reinstalled; attributed by measurement, NOT by array order | `be35ec55` |
| **G9a** | `githubRepo` restored on a rolled-back MAINTAINER assignment | `4d81aa69` |
| **G11** · **G12** · **G13** · **G13b** | the governance pointers, each on the ONE transition that reaches it; G13 asserts BOTH halves of its cascade (pointer AND team block) | `75a7d9e7` |
| **G17** | the R9.13 quarantine lifted BEFORE the re-wake — reachable only via `AIM_SHIM_FAIL_INSTALL`, a nominated-failure branch in `installClaudeShim` | `790cd8cb` |
| **G15** | **UNREACHABLE** on any compatibility-altering title change — not a gap; see below | — |

The harness now has `failOn`, an observation ledger where every collaborator variant records under
its OWN name, a live `awake` set, token stores modelled as STATE, `armLateDriftAbort(extra,
driftTitle)` armed on BOTH revocations, a `driveChangeTitle(id, title, extra)` options bag, and
`AIM_SHIM_FAIL_INSTALL` (a nominated plugin the fake `claude` refuses to install, so G16 fails and
G17's quarantine is the only way the pipeline can proceed).
Verify: `tsc` 0 lines + the suite at **310/4453/2** + `trddgrep validate` exit 1 with only
`7123D51A` and `C7A81642`.

**THE G17 TEST NEEDED A THIRD NEUTER TO STOP BEING VACUOUS ABOUT THE ONE THING IT NAMES.** Its claim
is an ORDER (`wakeAgent` refuses while `roleMissing` is set, so the flag must be lifted first), and
an order is invisible to an end-state assertion — the end state is the same either way. Two traps,
both measured: (a) the probe originally recorded the LAST wake, and **G10's undo re-wakes too**,
later in the unwind and after G17 has already restored the flag, so a swapped G17 undo read G10's
`false` and passed — the probe now records only the FIRST wake; (b) with the end-state assertion
placed first, both of the obvious neuters died on it and the order line never executed, so no
mutation could reach the assertion the test exists for. Order assertion first, and the proof is
explicit: under the order-swapped service, commenting out that one line turns the file GREEN.

**TWO FIXTURE FACTS THE POINTER GATES MEASURED.** (a) **The abort anchor had to move**: G14e runs
only when the OLD title was an issuer and the new one is not, so on a PROMOTION it never fires and
an abort armed on it alone never arms — the pipeline succeeds and the test asserts a rollback that
never happened. G14b has no title condition and sits beside it in the array (…G13b, **G14b**, G14e,
G14d…). Both are armed now, `extra` hooks COMPOSED rather than replaced, and `driftTitle` is a
parameter because writing `'manager'` is not a drift when the title being assigned IS manager.
(b) **G11 is reachable only in the dangling-pointer state**: the obvious COS-of-my-own-team demotion
is refused earlier by **G08b** (R4.7), so a demotion that reaches G11 is one where the agent is out
of every team's `agentIds` while a team still lists them as `chiefOfStaffId` — the state G08b's own
comment says the legitimate transfer flow produces, and **G11 is what cleans it up**.

**G15's UNDO IS UNREACHABLE ON ANY COMPATIBILITY-ALTERING TITLE CHANGE — measured, not read.**
G14d runs FIRST and uninstalls every role-plugin incompatible with the new title, so by the time
G15's detection reads `settings.local.json` there is nothing left: `currentPluginName` is null, G15
takes its *"Cleaned stale role-plugins"* branch, and `ctx.g15Uninstalled` is never set. Neutering
G15's undo left the file **15/15 GREEN**; neutering G14d's reddened the test with `expected [] to
include 'ai-maestro-assistant-manager-agent'`. The gate is not wrong — its reachability is narrower
than the array order suggests (it is live only where a plugin survives G14d and G15 still swaps
it). **Two gates that produce the same observable are indistinguishable without the neuter.**

**THE G16b TESTS FOUND A REAL BUG IN SLICE 4c — G16's UNDO WAS IMPOSSIBLE BY CONSTRUCTION**
(fixed in `63e56bfa`). Its Claude branch installs with `installPluginLocally` DIRECTLY; the undo
routed the uninstall through `ChangePlugin`, importing gates the forward path never ran. One of
them — ChangePlugin's G08 — refuses to uninstall the plugin the agent's CURRENT title requires, and
on a reverse unwind that title is still the NEW one (G14's undo is EARLIER in the array, so it runs
LATER). Every rollback past G16 reported R51.5 CRITICAL over a fully recoverable system. **Same
shape as Gate 9's join-then-title**: a constraint whose reverse order is not the mirror of its
forward order. Fixed by symmetry — call `uninstallPluginLocally` (the documented mirror) directly —
never by widening `rolePluginSwap` to bypass G08, which would change behaviour for four existing
callers and the RoleTab dropdown. The primitive best-efforts the CLI and does not throw, so the undo
VERIFIES BY EFFECT (re-reads `settings.local.json`); an undo that cannot detect its own failure
cannot report R51.5 at all.

**TWO FIXTURE FACTS THE G16b TESTS MEASURED, both of which produced a vacuous pass first.**
(a) **The workdir is SHARED across this file's tests** — `seedAgent` only `mkdir -p`s it, so a
plugin an earlier test installed survives; G15 then keeps it, G16b prints `Skipped (plugin
unchanged)`, and the gate under test never runs. Each test now WRITES its plugin set (`null` is a
write, not an omission). (b) **G15's undo MASKS G16b's**: it reinstalls via
`ChangePlugin(action:'install', rolePluginSwap:true)`, and THAT pipeline's G11b rewrites
`programArgs` to the reinstalled plugin's main-agent — so on a fixture where G15 removed something,
neutering G16b's undo left the file 13/13 green. The undo test therefore seeds NO role-plugin.

**Slices landed so far:** slice 1 `61858167` (ctx + widened annotation + rows 2-3: G9a, G14) ·
slice 2a `40cefbb8` (rows 4-6: the OLD-title teardown — G10, G11, G12) · slice 2b `0db3f598`
(row 7: the NEW-title setup — G13, G13b) · slice 3 `4cd3d148` (rows 8-9: the two revocations) ·
slice 4a `353b9089` (row 14: G14d's per-entry uninstall loop) · slice 4b `1fa48129` (row 15: G15's
role-plugin sweep) · slice 4c `6baa7c8b` (rows 10-12: G16, G16b, G17 — the last plugin rows) ·
**FINAL slice (the driver swap)**. Through slice 4c every undo shipped INERT and was proven so by
the same neuter: make the new ones throw unconditionally, and the two files that force mid-pipeline
aborts stay green (29/29). The neuter was not vacuous — `change-title-window` drives a
`governanceTitle: 'manager'` agent, so G10's branch really does run and record.

**THE FINAL SLICE'S NEUTER IS THAT SAME ONE, INVERTED — and that is the proof the swap took.** Make
G14's undo `throw` and `change-title-window` now REDS, where for seven slices it stayed green.
Running both mutations distinguishes what the assertion actually pins: `throw` gives R51.5's
CRITICAL INVALID STATE, a silent `return` gives `expected 'autonomous' to be 'manager'`.

**Two tests changed, both for the right reason, and neither was wrong before.**
`change-title-window`'s *"a failure at removeManager leaves the mild residue the G14-first ordering
promises"* was a CHARACTERIZATION test whose own header predicted this retrofit would change it. Its
subject no longer exists: G14's undo restores the title, so there is no residue to grade, and it now
asserts the restoration plus R51.3's wording (and the ABSENCE of R51.5's). The second is subtler —
`createagent-g06-g07-ordering`'s R51.5 test asserted `not.toMatch(/no changes were made/i)` on
CreateAgent's message. ChangeTitle is now itself a transaction, so when ITS gates roll back cleanly
it returns R51.3's "…NO CHANGES WERE MADE…" and CreateAgent quotes that verbatim as the `Cause:` of
its own CRITICAL. **Both claims are true and they are about different systems** — the inner one made
no changes, the outer one did and could not undo them. A bare substring cannot tell them apart, so
the assertion is now anchored to the START of the message, which is where the VERDICT lives.

**Slice 4c's three shapes, and the one ordering that is not obvious.** G16 records WHICH MECHANISM
installed — the Claude `installPluginLocally` path or the non-Claude `adapter.install` path — and
undoes through that same mechanism, because the two write different stores (the CLI writes
`.claude/settings.local.json`; an adapter writes per-client manifest files the CLI cannot see), so
undoing one with the other's verb leaves the install half-standing. The adapter's `StoredPlugin` is
bound ONCE as a `const` and handed back verbatim to `adapter.uninstall` — its `providerId` is a
narrow `ProviderId`, not `string`, so a re-derived shape does not even type-check. G16b restores the
prior `programArgs` and THROWS on failure: a stale `--agent` flag on the restored title wakes the
agent with the wrong persona, which is the jack-bot symptom the gate exists to prevent, i.e. an
invalid state (R51.5), not a warning. G17 compensates **only its own R9.13 quarantine** — the flag
and the hibernate — and deliberately not its plugin repairs, which G15's and G16's undos already
cover; compensating them twice would leave the agent with no plugin at all. **The ordering inside
G17's undo is the mirror of G10's:** clear `roleMissing` BEFORE waking, because `wakeAgent` refuses
while the flag is set — that refusal IS the quarantine, so waking first fails every time.

**A COVERAGE GAP FOUND BY SLICE 4c, not caused by it: G16 AND G16b ARE ENTIRELY UNPINNED.** Measured
by a two-run attributed neuter. Run 1 broke all three forward writes (G16's adapter-success branch,
G16's Claude `installPluginLocally`, G16b's `updateAgent`, G17's `roleMissing`) → **3 named tests
red, all of them G17's**: `r3-r9-team-governance.test.ts:1777` (TRDD-C9LXXT76) and
`element-management-assistant-title.test.ts:350, :383`. Run 2 restored ONLY G17 and left G16 + G16b
broken → **310 files, ZERO red.** So the 3 failures are attributable to the G17 break alone, and the
suite never observes whether the new role-plugin was installed or whether the `--agent` flag was
rewritten. The complement run is the whole point: with a single combined neuter there would have been
one failure and two candidate causes. Worth a test — G16b's regression is precisely the 2026-05-06
jack-bot bug — but pre-existing, so it does not block this card.

**Slice 3 was NOT the free win the map promised, and the reason is worth keeping.** Switching to the
compensable forms reddened 5 tests, and none of them was wrong. `tests/helpers/drive-change-title.ts`
exported both variants but only the count-only ones called `step()` — the compensable stubs were
DECORATIVE, present so a destructure would not throw and absent from the observation ledger. So the
parity assertions saw no revocation at all, and the three G22 post-condition tests' `after` hook,
keyed on `revokeTokensFromIssuer`, silently never fired: they had been passing over a pipeline
nothing perturbed. Every variant now records its OWN name, which additionally makes "which form does
the pipeline call" a pinnable claim — **NEUTER: revert both gates to the count-only wrapper ⇒ 5 NAMED
tests red.** That makes slice 3 the first slice of commit 3 whose behaviour is pinned rather than
inert.

**A COVERAGE GAP FOUND BY SLICE 4b, not caused by it.** G15's detection loop lost its `break` so the
whole role-plugin set could be recorded before the sweep removes it; `currentPluginName` still takes
the FIRST match, and that was verified by neuter — making the loop LAST-wins left the full suite
green at **310/4441/2**. So first-vs-last is UNPINNED, and always was (the old `break` was equally
unpinned). It only differs on an agent carrying TWO role-plugins, which is exactly the state
G14d/G15 exist to clean up. Worth a test; not worth blocking this card.

**Three facts measured while writing slice 2, worth not re-deriving:**
1. **G10 / G11 / G12 are mutually exclusive** — all three branch on the SAME `oldTitle` — and G10 /
   G13 are too, because `manager → manager` short-circuits at Gate 6 as unchanged. So the
   `getManagerId()` each undo reads is the value its own forward run saw; there is no sibling gate
   moving the pointer underneath them.
2. **`validateTeamMutation` carries NO blocked-team refusal.** That is what makes reverse order the
   mirror here: G13's undo re-blocks, and the G12/G11 undos that unwind after it can still write
   their team pointers. Had it refused, the rollback would have been designed-in to fail.
3. **`blocked` is all-or-nothing by construction** — written nowhere but `blockAllTeams` /
   `unblockAllTeams`. Both undos still record the split (which teams they FLIPPED vs which were
   already in that state) and REPORT rather than over-restore in a mixed corpus, because
   unblock/block-all would touch teams the pipeline never touched, and calling that a revert is the
   lie R51.3 forbids.

**The two entries that make this pipeline the one worth doing** are #4 and #10: a failure anywhere
after G10 leaves the host with teams blocked and the fleet hibernated, and a failure after G16 leaves
a titled agent with the wrong role-plugin — R9.13 violated by the very pipeline that enforces it.
Nothing in the eight conformance-only pipelines is remotely this wide.

### ⚠ CORRECTED 2026-07-31 — the window starts at **G9a**, not G03

Two claims above were measured one question short. Both were caught by reading the landed precedent
and `lib/gate-transaction.ts` before converting a line, and both change what commit 2 IS.

**1. The window starts at G9a (`:2645`), not G03 (`:2402`).** G03 *is* the first mutation — that part
was right — but "first mutation" is only the first of the TWO questions this card already answers for
`InstallElement`: reversing it must also be **legal and harmless**. G03's write heals a corrupt empty
`program` field (`'' → 'claude'`, inferred from filesystem evidence); its undo would restore
`program: ''`, deliberately re-breaking a repair the system wants whether or not the title change
succeeds. Same shape as `.claude/` being an agent invariant a watchdog re-creates — so EXCLUDE, and
name what would change the answer: if `program` ever gains a meaning where empty is legitimate, it
comes back in.

**2. `G06`/`G06b` early-return `success: true` (`:2481-2483`, `:2495-2497`), which the runner cannot
express at all.** `runGateSequence` gives a gate exactly two outcomes — return, or throw and unwind;
there is no "stop here and report SUCCESS". Had the array started at G03, those two branches would
sit inside it with nowhere to go, and the conversion would have died on them mid-edit. Starting at
G9a puts every early-SUCCESS return and every read-only validation before the array as a plain early
return — exactly the landed shape.

Between G03's self-heal and G9a the only mutation is G06b's `githubRepo` write, and it is followed
immediately by `return result`: a terminal branch with nothing abortable after it, i.e. its own
single-mutation mini-pipeline with no window — the same verdict this card already reached for the ten
conformance-only pipelines.

**So the window is G9a (`:2645`) → G22 (`:3467`).** G22 is still the last abortable gate (G23 only
WARNs; the terminal only chooses a verdict), so that half of the earlier measurement stands.

**The one missing primitive is now BUILT** (2026-07-31): `lib/portfolio-store.ts` grew
`revokeTokensFromIssuerCompensable`, so both token stores G14b/G14e touch can be undone. It landed
standalone, under the current hand-rolled structure, which is the point — a compensable primitive is
useful and testable before any restructuring, and it is the half of the retrofit that carries real
risk if rushed.

**Its expiry rule DIVERGES from the aid-token twin, deliberately, and the reason is not the obvious
one.** I first wrote *"`loadPortfolio` prunes nothing"*; it prunes, and the module header says so.
Both stores prune — the difference is HOW. `loadTokens` prunes by REMOVING rows and `saveTokens`
persists that, so re-inserting an expired row writes a row the next read drops. `pruneStatuses`
(`lib/portfolio-store.ts:78`) only DERIVES a status in memory (`active → expired`), never touching a
`revoked` row and never removing one — so restoring to `active` reproduces the exact bytes that would
be on disk had the revoke never happened. Skipping it is what would be inexact. A neuter that
"fixes" this into agreement with the sibling reds exactly one named test.

**The DRIVER now has a caller, and writing it falsified two things reading had not** (`4529c77e`).
`tests/services/change-title-window.test.ts` drives the real 1219-line pipeline end to end — a
MANAGER on no team demoted to AUTONOMOUS while one team exists, which is the exact shape that makes
G10 fire (`removeManager()` then `blockAllTeams()`). Three tests, 0-IMPACT clean, two neuters with
disjoint red sets. What the caller found, and neither would have surfaced from a `success` assertion:

- **`stubs.ibctScopeCheck` returned `{allowed: true}`; the real `checkIbctScope` returns
  `string | null`.** G0b does `if (scopeErr) { result.error = scopeErr; return result }`, so a
  SUCCESS verdict became the failure reason and EVERY ChangeTitle in the harness died at gate 0b.
  Only asserting `result.error` caught it — `expect(success).toBe(false)` would have passed forever.
- **`installClaudeShim` was a pure no-op.** Since TRDD-0GCIMQ9F the CLI is the ONLY writer of
  `<agentDir>/.claude/settings.local.json`, and G17 reads it back to enforce R9.13 — so a shim that
  exits 0 makes G16 look successful, leaves G17 nothing to find, and gets a healthy agent "recovered"
  into `roleMissing: true` + hibernated on every run, which the test would then call the happy path.
  The shim now models that one write.

Plus a test-side trap worth carrying forward: **`H.world` must be created once and reset IN PLACE.**
A `vi.mock` factory closes over the object it was handed at first import and that capture survives
`vi.resetModules()`, so reassigning it per test left the mocks writing to the PREVIOUS world — the
pipeline really did call `removeManager()` and the assertion read an untouched object.

**THE WINDOW IS NOW CHARACTERIZED** (`74de88d7`), and the exercise found a live defect.

*The injection point this card named did not exist.* It said `failOn = { updateTeam: 1 }` at G11 —
but G11/G12/G13b are gated on `oldTitle` being chief-of-staff/orchestrator or `newTitle` being one
of those, so **`updateTeam` is NEVER CALLED on a manager→autonomous demotion**. Probing all four
post-G10 collaborators is what found the two that are reachable:

| injected failure | `success` | manager | teams |
|---|---|---|---|
| `removeManager` | **false** | INTACT | unblocked |
| `blockAllTeams` | **TRUE** | **GONE** | **unblocked** |
| `revokeTokensForAgent` / `revokeTokensFromIssuer` | true | gone | blocked |

Row 1 is the G14-first ordering paying off, observed rather than argued: `removeManager()` is
unwrapped so its failure aborts, and because G14 already wrote the title the residue is exactly the
mild one the ordering comment promises — a stale manager pointer, not a decapitated host.

**Row 2 is a LIVE DEFECT, not merely a missing rollback.** G10 is a CASCADE — remove the manager,
*then* block every team, because a team must not operate without one. Only the second half is
wrapped (`catch { ops.push('G10: WARN — blockAllTeams failed') }`), so when it fails the pipeline
CONTINUES and returns `success: true` over a host with **no manager and unblocked teams** — the
precise state the cascade exists to prevent, reported to the caller as a clean success. The only
trace is an op nobody reads. That is R51's *"swallowing a per-item failure into a warn converts one
bad item into an invalid system"*, in production, on the governance-critical pipeline.

### ✅ FIXED 2026-07-31 (`47feb243`) — and the shape this card recorded for the fix was WRONG

The line above used to end: *"the neuter that reds that test IS the fix's own shape (un-wrap
`blockAllTeams` so its failure aborts)"*. **That shape is a SECURITY REGRESSION as a standalone
change**, and it was one session away from being implemented on the strength of this card.

G14 writes the title **before** G10 (deliberately — crash-safety). So an abort at G10 skips
G14b/G14e and leaves a demoted MANAGER holding AID governance tokens that **embed `manager`**
(`element-management-service.ts:2901` says so outright: *"existing tokens embed the old title →
revoke them"*). And the retry cannot repair it: Gate 6 sees the title already changed and
**returns `success: true` at `:2483`** before ever reaching revocation. The tokens are stranded
permanently. Every step of that was verified first-hand before acting on it.

**The landed fix withholds the VERDICT, not the WORK — a DEFERRED fail.** `g10CascadeFailed` is
recorded at Gate 10; every alignment gate still runs (they align the agent with the title G14 wrote:
drain both token stores, swap the role-plugin); the terminal converts success into a failure NAMING
the residue. The residue is real and is deliberately NOT repaired — this is a report, not a
compensation, so it is **not** the hand-rolled undo R51 exists to replace. It is ~10 lines that
disappear in commit 3 below, and until then a live governance API stops lying.

**Why the original "defer it, the retrofit supersedes it" no longer held:** the deferral assumed the
recorded fix shape was correct and merely premature. It was not correct. Correcting the card was
mandatory regardless of whether anything shipped, because the next reader would have implemented it.

`tests/services/change-title-window.test.ts` now pins the fix, and **its load-bearing assertion is
`world.calls` containing both revocations** — that is what discriminates the deferred fail from the
abort. Proven, not asserted: NEUTER A (implement abort-at-G10) passes `success:false`, both error
regexes, both residue assertions AND the ops assertion, and fails ONLY on `calls ==
['removeManager','blockAllTeams']`. NEUTER B (disable the verdict guard) reds on `expected true to
be false` — a disjoint cause.

**⚠ COMMIT 2 IS COMPLETE — 2026-07-31, eight slices, `bfc1f226 … 4ee79582`. NEXT ACTION is COMMIT
3.** ChangeTitle's array now holds all 20 gates in execution order:
`G9a G14 G10 G11 G12 G13 G13b G14c G14b G14e G14d G15 G16 G16b G17 G18 G19 G20 G21 G22`.
`tsc` 0 lines and the suite at the exact baseline (310 files / 4437 passed / 2 skipped) on every
slice; the driver is still the hand-rolled loop, so the ratchet still counts ChangeTitle as
hand-rolled and nothing is claimed that is not yet true. **That 4437 is the baseline commit 2's
slices were verified against — it is NOT the number commit 3 should expect. It is now 4441; see
correction 2 below.**

**Two corrections the slices produced, both measured:**

1. **The window's tail is G17→G22, not "G17 and G22".** Earlier text here listed only those two as
   remaining. **G18-G21 must move as well**, because gates are appended in EXECUTION order and G22
   cannot precede them without reordering — and array order IS the G14-before-G10 crash-safety
   property. Verified before moving: G18 is a best-effort mesh broadcast, G19/G20/G21 are pure
   decisions writing `result` fields + ops. **None writes a persistent store, so none owes an undo
   in commit 3.**
2. **G22 WAS ENTIRELY UNPINNED — now CLOSED by `TRDD-DFP0HWRX` (commit `8ca58c05`).** Disabling BOTH
   of its drift aborts left the full suite GREEN (310/4437/2, zero red). Its own comment records that
   it was promoted from a silent WARN precisely because callers claimed success while
   `governanceTitle` stayed null on disk (SCEN-007 P0-003, SCEN-020 BUG-001, SCEN-002 P0-001) — so
   the guard that exists because a false success shipped had no test. **The gap PRE-DATED the
   retrofit; it was not a hole this change opened and therefore NOT an EHT of this card**, which is
   why it was filed and closed as its own TRDD. That same mutation is now the **N0 neuter** and reds
   both drift tests by name (2 failed | 7 passed).

   **Two things this changes for commit 3.** (a) **Step 4** (route G22 to the `invariants` hook) now
   lands on a gate whose abort conditions a named test already holds — rollback-on-invariant-violation
   is far safer to build on that than on an unpinned gate, which is why DFP0HWRX was done FIRST.
   (b) **The suite baseline is now 310 files / 4441 passed / 2 skipped.** Verify commit 3's slices
   against THAT number, not the 4437 recorded above — every slice checks the exact counts, so a
   reader using the stale figure would read +4 as a regression.

   Three facts DFP0HWRX measured that commit 3's own rollback tests will need, because each one
   silently produces a VACUOUS test: **(i)** G14 checks its write twice (the return value of
   `updateAgent` for memory, then a fresh disk read), so a perturbation applied inside `updateAgent`
   reds G14, never G22; **(ii)** a perturbation must RE-APPLY after every registry flush, because
   G16b calls `updateAgent` again (programArgs) and mirrors the store to disk; **(iii)** `failOn`
   cannot reach a post-condition gate at all — it makes a collaborator THROW, aborting before the
   gate — which is why `tests/helpers/drive-change-title.ts` gained `world.after` (fires only on
   SUCCESS, so the hook running is itself proof the call it anchors to ran).

**⚠ G14c IS DECIDED — 2026-07-31. MOVE IT OUT OF THE ARRAY; it gets NO undo.** It was the last open
DESIGN question. Three measurements settle it, and the first two eliminate the alternatives
outright — so this is a forced move, not a preference:

1. **The ledger is a HASH-CHAINED SIGNED log, not an append-only convention.**
   `lib/signed-ledger.ts::append` stamps every entry with `seq: this.nextSeq()`,
   `prevHash: this.lastHash()`, and a `signature` over the canonicalized entry. An `undo` that
   DELETED the entry would not merely "falsify history" — it would break `prevHash` for every later
   entry and fail verification. **That option never existed.** (This repo has already corrupted this
   exact ledger once by renumbering `seq`. Do not go near it.)
2. **A COMPENSATING entry — the ledger-native reversal, and the obvious second choice — is defeated
   by the emit being FIRE-AND-FORGET ASYNC.** `lib/ledger-emit.ts::emitAgentOp` returns `void` and
   calls `registryLedger.append(…).catch(…)`: the append is never awaited and its failure is
   swallowed into a console `AUDIT GAP` line. G14c's own `try/catch` can therefore only catch a
   SYNCHRONOUS throw (the dynamic import) — **the gate cannot know whether the entry it would
   compensate ever landed**, so an undo appending a reversal risks recording the reversal of a
   non-event. That is a worse lie than the one it fixes.
3. **Moving it loses NO audit coverage**, which is what makes the move cheap. The per-op entry is
   granularity ON TOP of the save-level bulk diff emitted by `agent-registry.ts::saveAgents()` — the
   gate's own comment calls that "a belt-and-braces safety net". A rolled-back ChangeTitle still
   leaves the bulk diff for the transient write AND for the undo's restore, so the fact that the
   write briefly landed stays on the record either way.

**THE PREDICATE IS `txn.ok` (the transaction COMMITTED), NOT `result.success` — and this card's
earlier one-liner ("emit on success only") was WRONG about it.** ChangeTitle has a DEFERRED FAIL: a
broken G10 cascade returns `success: false` while the title write **STANDS** (deliberately not
reverted). Emitting on `success` would skip the per-op entry for a title change that really did
persist — a silent audit gap in precisely the failure case an auditor cares most about. In commit
3's end state the two predicates coincide, because fusing G10 deletes the deferred fail; they are
still not the same predicate, and only `txn.ok` stays correct if any deferred-fail construct
survives the fuse.

**DO NOT LAND THE MOVE AHEAD OF THE UNDOS — it is COUPLED to rollback existing, and landing it early
would CREATE the audit gap this decision exists to prevent.** The move LOOKS independent of the
driver swap (it only relocates one emit) and it is not. TODAY an abort at a LATER gate — G15's R9.13
denial, G22's drift — returns early with the title write already landed and **NOT reverted**, because
there is no rollback yet. So today's mid-array position is CORRECT: the per-op entry records a change
that genuinely persisted. Relocate the emit before the undos exist and those same aborts would skip
it, leaving a persisted title change with no per-op entry. Once the undos land, an abort reverts the
write and skipping the emit becomes the correct behaviour. **Same edit, opposite correctness, either
side of the undos** — so it ships INSIDE commit 3 or not at all.

**⚠ COMMIT 3'S TWO MECHANICAL QUESTIONS ARE MEASURED — 2026-07-31.** Both were open, both looked
like they could widen the edit, and both turned out contained. Read the landed sibling
(`ChangePlugin`'s EXE-a/EXE-b block, `:3998-4024`) — it is the precedent for BOTH:

```ts
const txn = await runGateSequence([...], ctx, opts)
if (!txn.ok) { ops.push(...txn.ops); result.error = txn.message; return result }
ops.push(...txn.ops)
```

1. **The ops array.** `runGateSequence` keeps its OWN `ops` (`:122`) and pushes one
   `${gate.id}: ${gate.what}` per gate, plus `reverted` / `ROLLBACK FAILED` lines. ChangeTitle's
   gates ALSO push their detailed lines into the OUTER `ops` (lexical closure), so the merge is
   just `ops.push(...txn.ops)` — the runner's summary lines land AFTER the detailed ones. Op
   ORDER changes; every existing assertion uses `.some(op => /…/.test(op))`, so none depends on it.
2. **The error message — the one that looked expensive, and is not.** On failure the runner returns
   `message`, which R51.3 fixes as *"THE COMMAND FAILED … SO NO CHANGES WERE MADE TO THE SYSTEM.
   **Cause: ${cause}**"*, and `cause` **IS the gate's own error string** — so the specific message
   is EMBEDDED, not replaced. Measured against the three files that assert ChangeTitle's `error`
   (`r19-maintainer-title`, `r3-r9-team-governance`, `change-title-window`): every assertion is
   `toMatch(/…/)` or `toContain('…')`, and **none asserts by exact equality**, so all of them
   survive the swap. Two more reasons the radius is small: most of those errors come from gates
   BEFORE the window (G1-G9 validation), which commit 2 deliberately left as plain early returns
   with their exact strings; and `/G10 cascade broken/` is the TERMINAL check, which runs after the
   array. **Do not take this as "no test will move"** — re-run and read the count; it is a
   prediction from the message shape, not a suite run.

**Also landed in commit 2, and load-bearing for commit 3:** the const-snapshot idiom. A `let`
assigned inside one gate's closure loses TypeScript narrowing inside EVERY other nested function,
so G16/G16b/G17 each open with `const target = targetPluginName`. Never `!` — an assertion silences
the checker and stops protecting the site the day the guard changes. Expect one such site per `let`
a future slice moves.

*(Historical, kept for the reasoning:)* The retrofit is NOT irreducibly
big-bang, which was the open question this card had been stalling on.

**Correction to the shape:** it is **`runGateSequence` with a gate array**, NOT `runAioPipeline`.
The latter takes `pre[] + ONE exe + post[]` (`lib/gate-transaction.ts:256-287`) and cannot express
13 mutations; all 9 landed retrofits call `runGateSequence` directly. Measured, not assumed.

**The window is G03 (`:2402`, first mutation) → G22 (`:3438-3457`, the final on-disk verification,
which aborts)** — essentially the whole function. Validation that runs BEFORE the first mutation
stays OUTSIDE the array as early returns with their exact strings; validation INTERLEAVED after a
mutation cannot be hoisted and becomes a `readOnly` gate INSIDE it — see the measured section below,
which supersedes the simpler "all validation stays outside" reading of the landed pattern.

| commit | contents | why it is safe to stop here |
|---|---|---|
| **1 ✅ `47feb243`** | the G10 deferred fail + its test | pipeline working, defect closed, zero structural change |
| **2 ✅ COMPLETE — 8 slices** (`bfc1f226` G9a+G14 · `c1681c9d` G10 · `9d3c08d6` G11-G13b · `2c5d2fcf` G14c/G14b/G14e · `653b894f` G14d · `dd9ce737` G15+hoists · `7fd5044c` G16/G16b · `da3ed3e5` G17-G21 · `4ee79582` G22) | restructured **G9a→G22** into a `const gates = [ … ]` array driven by a small imperative loop, converting each abort from `return result` to `throw new GateAbort`; the ctx stays EMPTY | **zero behaviour change**; suite at the exact baseline on every slice; the ratchet still counts ChangeTitle as hand-rolled, so nothing is claimed that is not true |
| **3** | swap the driver for `runGateSequence`; undos per the window map; G10 fused into ONE gate (run + undo restore both halves); G14b/G14e → the compensable forms; G22 → the `invariants` hook; lower `MAX_HANDROLLED` 10 → 9 | the ratchet moves only when the guarantee is real |

**⚠ THE CTX IS AN UNDO LEDGER, NOT A REIFICATION OF THE FUNCTION'S LOCALS — corrected 2026-07-31.**
This card said commit 2 should "reify `ChangeTitleCtx` (the ~10 threaded locals)", and a later
measurement inflated that to *117 declarations, ~12-15 genuine cross-gate carriers* — i.e. a
whole-function edit threading a dozen locals through an object, which is what made the previous
session defer commit 2 as too large to finish. **The landed precedent says otherwise.**
`ChangeClient`'s `MigrationCtx` (`:6441-6446`) has **FOUR fields, every one of them something `run`
RECORDS so `undo` can reverse it** (`uninstalledOld`, `installedNew`, two settings snapshots).
`plans`, both adapters, `agentDir`, `agentId`, `oldProgram`, `normalized` and the helper closures
appear in no ctx at all — a gate defined inside the pipeline body already sees them lexically.

So the ctx's CONTENT is decided by the undos, which are commit 3's work: there is nothing coherent to
"reify" in commit 2. Commit 2 is therefore the RESTRUCTURE alone (gates + loop, empty ctx), and
commit 3 adds each `undo` together with the ledger field it reverses. That also shrinks commit 2 from
a whole-function rewrite to a mechanical wrap.

**The card's earlier objection to touching G14b/G14e early was about ORDERING, not about staging** —
"no compensable forms before a `ctx` exists" dissolves once commit 3 introduces the ledger. It does
not rule out this decomposition.

**G22 → `invariants` is an upgrade, not a translation.** `runGateSequence`'s invariant hook
(`lib/gate-transaction.ts:204-218`) routes a violation through `abort()`, so a failed final
verification **reverts** instead of merely reporting — strictly better than today's G22.

**RULING for commit 3 — keep G17's R9.13 quarantine as in-gate self-heal.** `enforceRoleOrHibernate`
(`:3269-3299`) retries the install, then sets `roleMissing: true` + hibernates, and never throws.
Replacing that with a title-rollback would rewrite behaviour that R9.13 documents — a
governance-corpus edit outside this card's authority. Commit 3 throws only if the **quarantine
itself** fails.

**Preserve G14-before-G10** (crash-safety, orthogonal to rollback) by ARRAY ORDER — never sort the
gates by label.

### ⚠ MEASURED — the landed pattern does NOT transfer wholesale, because ChangeTitle interleaves

The obvious plan is "keep the read-only validation OUTSIDE the array as early returns, exactly like
the landed retrofits". Checked against a real one before relying on it:

**`ChangeClient` (`:6471` `const gates = [` … `:6586` `runGateSequence(gates, mig)`) puts THREE gates
in its array — G07, G08, G09, all mutating — and nothing else.** Every validation precedes it and
stays an early `return result` (`:6381`), and the array declares no `readOnly` gate at all. Clean
split, because in that pipeline all validation happens before all mutation.

**ChangeTitle is not that shape.** Its aborts are INTERLEAVED with its mutations:

| abort | line | sits after |
|---|---|---|
| G14's own post-write verification (×5 DENIED) | `:2688-2729` | G14's `updateAgent` write |
| G15 DENIED — no compatible role-plugin | `:3139-3141` | G14 **and** the whole G10-G13b governance cascade |
| G22 (×3 DENIED) | `:3438-3457` | everything |

So a validation cannot simply be hoisted "before the array": an interleaved abort must still unwind
the mutations that precede it. The rule for commit 3 is therefore:

- validation **before the first mutation** (G0b, G01, G02) → stays outside as an early return;
- validation **after any mutation** (G14's verify, G15's DENIED) → becomes a **`readOnly: true` gate
  INSIDE the array**. `runGateSequence` supports it (`lib/gate-transaction.ts:29`) and
  `findUncompensatedGates` (`:97`) correctly exempts it from the no-undo refusal;
- the FINAL verification (G22) → the `invariants` hook, which aborts *and reverts*.

This is why the array is not "only the mutating gates", and it is the detail that would have been
discovered mid-conversion rather than before it.

### ✅ MEASURED — commit 3 needs NO new primitive; it is pure restructuring

The biggest unknown left was whether the retrofit first has to BUILD compensable machinery, the way
`revokeTokensFromIssuerCompensable` had to be built. Checked every mutating gate's undo mechanism:

| gate mutation | its undo | status |
|---|---|---|
| `updateAgent` ×6 | write the prior value back | plain, no primitive needed |
| `removeManager` + `blockAllTeams` | `setManager(old)` + `unblockAllTeams` + re-wake — and `blockAllTeams` RETURNS the hibernated list, so the R51.4 snapshot already exists | available |
| `updateTeam` ×4 | restore the pointer | plain |
| `rejectGovernanceRequest` | 3-field row restore — the shape already verified for `DeleteAgent` G07 | ruled |
| `revokeTokensForAgent` | **`revokeTokensForAgentCompensable`** (`lib/aid-token.ts:542`) | ✅ built |
| `revokeTokensFromIssuer` | **`revokeTokensFromIssuerCompensable`** (`lib/portfolio-store.ts:321`) | ✅ built |
| `installPluginLocally` ×4 | **`uninstallPluginLocally`** (`services/element-management-service.ts:1747`) — signature is IDENTICAL to install's `(pluginName, agentDir, marketplaceName = MARKETPLACE_NAME): Promise<void>`, so the undo is the same three args recorded in ctx | ✅ exists, symmetric |
| `hibernateAgent` | wake | available |

**So commit 3 writes no new library code** — it is restructuring plus wiring, which is exactly the
risk profile the decomposition assumed. (`lib/amp-auth.ts:398 revokeAllKeysForAgentCompensable` is
the third built twin; `ChangeTitle` does not touch AMP keys, so it is not in this table.)

**⚠ BUT ONE GATE HAS NO HONEST UNDO, AND THE RUNNER WILL NOT LET IT PASS — G17.** It mutates
(`uninstallAllRolePlugins`, `installPluginLocally`, `updateAgent({roleMissing})`, `hibernateAgent`),
it sits INSIDE the window (G22 aborts after it), and every one of those mutations is a **RECOVERY** —
so reversing them re-breaks what the gate just repaired, the identical objection that excludes G03's
self-heal above. `findUncompensatedGates` (`lib/gate-transaction.ts:97`) REFUSES TO START a sequence
containing a mutating gate with no `undo`, so this cannot be left to be discovered mid-conversion:
commit 3 must either give G17 a defensible `undo` or move it out of the array, and marking it
`readOnly: true` would be exactly the lie that check exists to catch. This is distinct from the
RULING above (keep the R9.13 quarantine as in-gate self-heal): the ruling fixes G17's BEHAVIOUR; this
is the separate question of what a ROLLBACK does to that behaviour.

**RESOLVED IN DESIGN 2026-07-31 (not yet implemented, not yet tested) — G17 STAYS IN, and its `undo`
covers ONLY the quarantine it set.** Split its mutations by who already compensates them:

- **The plugin repairs** (`uninstallAllRolePlugins` + `installPluginLocally` in the `>1` and
  MISMATCH branches, and the retry inside `enforceRoleOrHibernate`) need NO undo of their own,
  because G15's and G16's compensations are **state-restoring, not delta-based**: G16's undo removes
  what G16 installed and G15's reinstalls what G15 removed, which lands on the pre-transaction
  plugin set regardless of what G17 did on top. G17 only ever installs `targetPluginName` — the same
  plugin G16 targets — so it cannot introduce a plugin those two undos do not cover. Compensating it
  separately would DOUBLE-undo.
- **The quarantine** (`updateAgent({roleMissing: true})` + `hibernateAgent`) is the part that does
  need reversing, because a rollback returns the agent to its OLD title with its OLD plugin, at
  which point the quarantine is no longer warranted. It must be **ledger-driven** — `undo` clears
  `roleMissing` and wakes the agent ONLY if `run` recorded that IT set them. Un-hibernating an agent
  that was already hibernated before the call would be a new action masquerading as a compensation.

So commit 3 has no open design question left; the remaining risk is in the WIRING and in proving each
`undo` with a neuter.

**Do NOT re-assert the G14-before-G10 ordering in the new file.**
`tests/governance/r3-r9-team-governance.test.ts` already pins it, and by the stronger route (inject a
G14 failure, assert governance untouched). A weaker happy-path copy only couples two files that were
meant to fail independently.

**NUMBERS IN THE 2026-07-30 BLOCK BELOW ARE STALE — do NOT carry them forward.** It says 14 to go and
`MAX_HANDROLLED = 14`; both are now **10**, and `CreateAgent`, `ChangeTeam`, `DeleteTeam` have since
landed. The ratchet already reads 10, so the CODE was ahead of the CARD.

**Two instrument notes, because each nearly produced a false finding:**
- The runner is reached by **`await import('@/lib/gate-transaction')`**, never a static import, so
  `grep "from '@/lib/gate-transaction'"` returns NOTHING across `services/` and `lib/` and reads as
  "no pipeline uses the runner at all".
- An `awk` brace-COUNTER bounding each function reported **0 runner calls for `CreateAgent`,
  `ChangeTeam` and `DeleteTeam`** — all three demonstrably have them. Mapping each
  `runGateSequence` line to its nearest preceding `export async function` is what got it right.
  Had I trusted the counter I would have "discovered" three completed retrofits were never done.

## ⏵ MEASURED 2026-07-30 — the count was wrong, and there is now a ratchet that keeps it honest

**14 pipelines still hand-roll their gates, not 21 and not 19.** Every prior number on this card
was a hand count of the 26-NAME LIST below, and that list is not an inventory of pipelines:

| the list says | reality |
|---|---|
| `CreateMarketplace`, `DeleteMarketplace`, `UpdateMarketplace` | one-line delegators — `return ChangeMarketplace({action: …})`. Not pipelines. |
| `ChangeAgentDef`, `ChangeCommand`, `ChangeRule`, `ChangeOutputStyle` | one-line delegators — `return changeSimpleElement(…)`. Not pipelines. |
| — | `changeSimpleElement` IS a pipeline, is already transactional, and the list omits it. |

Real inventory AS MEASURED THAT MORNING — **19 pipelines · 5 transactional · 14 to go**; superseded
the same day by the CreateAgent section below, which took it to 6 and 13. Transactional then were
`DeleteAgent`, `ChangeClient`, `ChangePlugin`, `ChangeSkill`, `changeSimpleElement`. Remaining:
`ChangeTitle` (131 gate ops), `InstallElement` (101), `CreateAgent` (62), `DeleteTeam` (37),
`ChangeTeam` (18), `ChangeMarketplace` (12), `ChangeFolder` (10), `ChangeName` (9),
`ChangeMetadata` (7), `ChangeCLIArgs`/`ChangeHook`/`ChangeLSP`/`ChangeMCP` (6 each), `ChangeAvatar` (3).

**`AIO-TXN-10` had an empty Guard and no checker at all** — the clause every one of these 14
violates was DOC-ONLY, so nothing could notice a NEW hand-rolled pipeline either.
`tests/governance/aio-txn-10-runner-coverage.test.ts` is now that checker: it parses the service's
AST (not its text — a needle counts this file's JSDoc gate manifests, 764 by text vs 492 real
emissions), discovers pipelines rather than reading a list, and holds `MAX_HANDROLLED = 14` as a
ratchet that only ever goes down. Retrofitting one and forgetting to lower it is green; raising it
is not possible without editing the constant deliberately.

Two things it gets right that a grep cannot, both learned by neutering it:
- **A pipeline OWNS its ops array; a helper receives one.** `gate0Auth` emits a real `G00:` line
  into its *caller's* array, so by gate ops alone it is indistinguishable from a pipeline — and it
  would have sat in the violation list forever as something that cannot be fixed, because there is
  nothing there to wrap. The discriminator drops it and nothing else.
- **An ALIASED runner import reads as hand-rolled** (`{runGateSequence: seq}`). A false positive
  that reddens, so it fails the safe way — but worth knowing before someone re-retrofits a pipeline
  that was already fine.

Neuters, disjoint red sets: aliasing `ChangeSkill`'s runner call at the SOURCE reddened 3 (the
floor 5→4, the ratchet 14→15, and the by-name pin naming `ChangeSkill`) while the non-vacuity test
correctly stayed green — the pipeline did not vanish, it left the runner. Dropping the
ops-ownership discriminator reddened only the ratchet.

**Also fixed en route: `CreateAgent` G07b was the FOURTH R51.5 site and `4520ef9a` had missed it**
(`dc034515`). That commit gave G06's two branches and G07c the "keep the orphan addressable when
the revert fails" shape; G07b kept `result.agentId = null` unconditional. Nothing reddened because
the R51.5 test drives G06 only — a fix at three of four sites is indistinguishable from a complete
one until someone reaches the fourth. G07b's orphan is the worst of them: it is reachable only on
the team path, so the agent has ALREADY JOINED the team when the caller is told it does not exist.

**R51.5 SWEEP — NEGATIVE, so do not redo it.** After fixing G07b I grepped for the SHAPE rather
than the symptom (the rule the fix itself produced). Every hand-rolled rollback in the codebase:
CreateAgent's four (G06 ×2, G07b, G07c — all now two-branch) and `DeleteTeam` at :6635-6688, which
already reports via `noChangesMessage`/`invalidStateMessage`. Nothing outside
`services/element-management-service.ts` hand-rolls a compensation at all. So `DeleteTeam` is
R51.5-compliant while still violating AIO-TXN-10 — correctly counted as hand-rolled above; the two
are different claims and it satisfies one of them.

**`ChangeAvatar` is NOT the next one to convert, despite being the smallest.** It has exactly ONE
mutating gate (`G03 updateAgent`) with nothing after it that can fail, so it has no partial-state
window: retrofitting it buys AIO-TXN-10 conformance and zero safety. Converting it would move
`MAX_HANDROLLED` 14→13 without making anything safer, which is gaming the ratchet rather than
using it. Do it last, with the other ceremonial ones.

## ⏵ CreateAgent RETROFITTED 2026-07-30 (`3f2e0e1d`) — 13 to go, and where the sequence ends

Real inventory now: **19 pipelines · 6 transactional · 13 to go.** Ratchet lowered
(`MAX_HANDROLLED` 14→13, `MIN_TRANSACTIONAL` 5→6, `CreateAgent` pinned in `MUST_BE_TRANSACTIONAL`).

**THE SEQUENCE ENDS AT G07c, AND THAT IS A FINDING, NOT A SHORTCUT.** G07c is the last gate that
can abort: `G08` (explicit plugin), `G09` (session), `G10` (keypair), `G11` (core plugin) and
`G12` (AMP identity) are all WARN-and-continue, and nothing after them can fail either. A gate's
`undo` runs only when a LATER gate fails — so undos written for those five could never execute.
That is ~150 lines of unreachable code that READS as a guarantee, which is worse than no code:
the next reader would believe the AMP index row is compensated. They stay outside, exactly as
DeleteAgent's irreversible G09 runs after its sequence commits. ⚠ **If any of G08..G12 is ever
made fatal it MUST move into the list with a real compensation** — that is the one change that
makes them reachable, and the code carries this warning at the gate list.

**What the retrofit actually BOUGHT** (the four ad-hoc rollbacks each reverted exactly one thing —
the registry row — so all of this was uncompensated before): the workdir when this pipeline
created it, recursively and bounded to `~/agents/`; the team membership (`ChangeTeam(null)`); the
role-plugin when the workdir survives; and R51.5 decided in ONE place instead of four.

**G04's undo re-throws NAMING the record.** The runner reports an unrevertable gate as
`<id> (<error>)`, so `G04 (registry locked)` would tell a human nothing about WHICH agent is
stranded — and R51.5 exists precisely so the orphan stays findable.

**Three neuters, disjoint red sets:** G03's undo neutered reds the new parity test ALONE; the
`txn.rolledBack ? null : …` ternary and G04's naming re-throw each red exactly the two
orphan-addressable tests (two halves of one claim — the return value and the message).

**A test was propped up by the old imprecision.** The G07b invalid-state message hardcoded
`joined team <id>` whether or not the join had succeeded, and the rollback never left the team —
so the string was doing double duty as an apology for the missing compensation. Under the runner
G07 records the join and its undo reverses it, so a team is named only when one is genuinely
still occupied. The `/team-xyz/` assertion is gone and the reason is written into the test.

### OPEN, and named rather than left to be discovered

1. ~~G07's team-leave undo is UNPINNED.~~ **CLOSED `944063f2`** — stateful team double + a seeded
   MANAGER (team ops are manager-gated, so a manager-less host refuses at ChangeTeam's G01b and
   never reaches the join), aborting at G07c's R9.13 reject. **Two assertions were VACUOUS and
   only the neuter said so**, both passing with the undo entirely disabled: `G07: reverted` is the
   runner's line for a compensation that did not THROW — and an empty undo does not throw either;
   and `not.toContain(result.agentId)` compared against NULL, because a clean rollback is exactly
   the case where the pipeline nulls agentId. Both replaced by the `updateTeam` call sequence (the
   id goes in on the join, comes out on the undo), which is where membership actually moves.
2. **G05 does not un-append the managed `.git/info/exclude` block** when the workdir pre-existed.
   Deliberate: the block is marker-delimited, additive, idempotent and re-created by the
   invariants watchdog, while re-deriving the `.git` location (dir / gitdir-file / worktree
   commondir) in a SECOND place is exactly the duplicated path logic that drifts from the seeder.
3. **G04's undo is a SOFT delete, so a tombstone row survives the rollback** — unchanged from all
   four hand-rolled sites. `getAgentByName` and the G03 overlap check both filter tombstones, so
   a retry is unblocked, but it is not literally "the exact state". Soft→hard is a behaviour
   decision that deserves its own change, not a ride-along in a refactor of the most-used
   pipeline on the host.

**NEXT ACTION: `ChangeTeam` (18 gate ops) or `ChangeName` (9).** Not `ChangeTitle` (131) or
`InstallElement` (101) yet — both are called BY the pipelines already retrofitted, so converting
one changes the failure semantics of its callers, and that wants its own card. Not `ChangeAvatar`
either, for the reason below.

> **SUPERSEDED 2026-07-31 — `ChangeName` was the wrong half of that sentence, for the same reason
> `ChangeAvatar` is excluded two paragraphs down.** Measured: `ChangeName` has ONE mutating gate
> (G04 `updateAgent`) and everything after it — G05's restart flag, G06's verification WARN, the
> `tryEmitLedgerOp` that swallows its own failure — cannot abort. Neither can `ChangeFolder`
> (G05 is its only mutation). So both have NO partial-state window, exactly like `ChangeAvatar`:
> retrofitting them moves the ratchet and buys zero safety. Picking by GATE-OP COUNT is what put
> `ChangeName` in that sentence; the criterion is whether the pipeline can leave two stores
> disagreeing. `ChangeTeam` was the half that was right, and it is done below.

## ⏵ ChangeMarketplace RETROFITTED 2026-07-31 (`1b129db8`) — 10 to go, and the window is now EXHAUSTED

Real inventory now: **19 pipelines · 9 transactional · 10 to go.** Ratchet lowered
(`MAX_HANDROLLED` 11→10, `MIN_TRANSACTIONAL` 8→9, `ChangeMarketplace` pinned in
`MUST_BE_TRANSACTIONAL`).

**THE FINDING.** `remove` runs four stores in sequence — cascade-uninstall every plugin the
marketplace shipped, from every target (G02b) → deregister the marketplace and drop its cache
(G03/G04) → strip the `extraKnownMarketplaces` entry (G05). Three of them can abort after the
first has already mutated, and nothing rolled back. So a `marketplace remove` that failed for any
reason other than the tolerated `"not found"` returned a bare CLI error over a host where **every
agent had already lost that marketplace's plugins**, with the marketplace still registered. The
operator sees a failed removal and an intact-looking marketplace; the plugins are gone fleet-wide.

**THE BOUNDARY IS PER BRANCH, NOT PER FUNCTION — and that is the new rule this one adds.** Only
`remove` is wrapped. `add` and `update` each have exactly ONE mutating gate with nothing abortable
after it, so an `undo` there would be unreachable code that reads as a guarantee (the CreateAgent
lesson); and `update` has no honest compensation at all — you cannot un-pull a marketplace —
which is exactly the case `runGateSequence`'s refuse-to-start check exists to reject. Wrapping the
whole function to look thorough would have manufactured two fake guarantees to buy one real one.

**THE LIFO TRAP, AND ITS MIRROR — both in one pipeline.**

- **G03+G04 FUSE.** `claude plugin marketplace add <source>` restores the CLI registration AND
  re-clones the cache in ONE call. Split, the unwind would run restore-the-cache *before* the
  re-add that re-creates it — reverse order that is not the mirror ⇒ one gate. Third sighting
  after ChangeTeam and DeleteTeam.
- **G02b+G03 STAY SPLIT**, by the *same* test reaching the opposite answer: a reinstall needs the
  marketplace registered, and reverse unwinding runs G03's undo (the re-add) *before* G02b's. The
  dependency and the unwind agree, so fusing them would be superstition. Worth stating, because
  after three fusions the reflex is to fuse.

**The source is snapshotted before anything mutates**, from `extraKnownMarketplaces[name].source`
— because G05 is about to delete the very store that holds it. `marketplaceAddArg` (a pure
top-level helper, invisible to the ratchet's pipeline detection since it owns no `ops` array)
returns null when the entry names no source, and G03's undo then THROWS rather than silently
no-op'ing: the marketplace really is deregistered and its cache really is gone, so R51.5's INVALID
STATE is the honest answer. G03's undo also decides from what `run` RECORDED, so the orphan path
(CLI never knew the name, no cache dir) correctly re-adds nothing.

**Four neuters** (`tests/integration/change-marketplace-rollback.test.ts`, 4 tests):

| neuter | reds |
|---|---|
| G02b's undo → return | tests 1 and 2 |
| G03's undo → return | tests 2 and 3 |
| `addArg` forced non-null | ONLY test 3 (the R51.5 path) |
| **G05's `run` stops recording `ekmRemoved`** | **NOTHING** — see below |

**THE FOURTH ROW IS A FINDING, NOT A GAP IN THE TESTS.** G05 is the LAST gate that can abort. The
runner's write-ahead registration makes a failing gate's own `undo` reachable *in principle* — it
is called even when `run` threw part-way — but G05's only mutation is its `saveJsonSafe`, and
nothing after that save can throw. So `c.ekmRemoved` is either set with the write durable (no
failure) or never set (the write failed and there is nothing to restore). Its compensation is
**latent by construction**, and no fixture can red it without adding a throw to production code
purely to be tested. It stays because the runner requires it and because the partial-work contract
is what makes it correct — but it is named here rather than counted as coverage. The generalisation:
*the last abortable gate in any sequence has a latent undo; its FAILURE is what unwinds the others,
and that — not its own undo — is what a test can pin.*

**The new test file is deliberately separate** from `delete-marketplace-pipeline.test.ts`. That
file drives the same pipeline against the developer's REAL `$HOME` and only gets away with it
because its fixture name is absent from the real `settings.json`, so G05's
`ekm[name] !== undefined` is false and nothing is ever written. These tests must SEED that entry,
so they need a fake home — and arming one inside the existing file would silently arm it for its
five other cases (the "never add the arming mock to an existing multi-case file" lesson).

### MEASURED 2026-07-31 — the remaining 10 have no window, so the ratchet and safety have parted

Measured before picking, exactly as the DeleteTeam next-action demanded, and the measurement is
what makes this the LAST safety-motivated retrofit on this card:

| pipeline | mutating gates | window |
|---|---|---|
| `ChangeMCP` | one (`claude mcp add-json`/`remove`) | none |
| `ChangeLSP` | one (`writeFile` lsp.json) | none |
| `ChangeHook` | one (`saveJsonSafe` settings; the `if (result.error) return` after it is a refusal set BEFORE the write) | none |
| `ChangeMetadata` | one (`updateAgent`) | none |
| `ChangeCLIArgs` | one (`updateAgent`) | none |
| `ChangeName` / `ChangeFolder` / `ChangeAvatar` | one each | none (already recorded) |
| `ChangeTitle` (131 ops) / `InstallElement` (101) | many | real, but both are now CALLED from inside retrofitted pipelines' gates |

**NEXT ACTION — this card's safety work is DONE; what remains is a deliberate choice, not a queue.**
Retrofitting any of the eight single-mutation pipelines moves `MAX_HANDROLLED` and buys nothing;
doing it for conformance is legitimate but should be named as such. The two that WOULD buy safety
are `ChangeTitle` and `InstallElement`, and converting either changes the failure semantics of the
pipelines that call it (`ChangeTeam` and `DeleteTeam` both call `ChangeTitle` from inside a gate,
and its own Gate 9/9b bidirectional constraint is the source of the LIFO trap) — so each wants its
own card with that blast radius stated up front, not a line in this one.

## ⏵ DeleteTeam RETROFITTED 2026-07-31 (`72886dd1`) — 11 to go; a compensation that only covered ONE abort

Real inventory now: **19 pipelines · 8 transactional · 11 to go.** Ratchet lowered
(`MAX_HANDROLLED` 12→11, `MIN_TRANSACTIONAL` 7→8, `DeleteTeam` pinned in `MUST_BE_TRANSACTIONAL`).

**THE FINDING, and it is a NEW shape — not a missing compensation, a MIS-SCOPED one.** DeleteTeam
already had a careful hand-rolled restore: 45 lines, reverse order, per-agent records, the R51.3/R51.5
messages, even a comment explaining the ordering constraint. It ran on exactly **one** abort — the
per-agent revert failure it was written beside, inside the same `if (revertFailures.length > 0)`
block. The far likelier abort, `deleteTeam` returning false at **G04**, reached a bare `return
result`. So the operator was told *"Team deletion from registry failed"* over a team row that still
existed and looked intact in `teams.json`, and was in fact an **empty husk**: every member already
pulled out of `agentIds`, demoted to AUTONOMOUS with its role-plugin stripped, its legacy `team`
field cleared, and hibernated.

Generalised: **code can only roll back the failure it is written for.** A compensation fused to one
abort site is invisible to every other one, and it looks like coverage — this one was more thorough
than most gates that have none. What the runner buys is not the undo (that existed) but *deciding
when the undo runs*.

**Sequence:** `G03..G04`. G04 is the last gate that can abort; G05/G06/G07 are WARN-and-continue, so
an `undo` for them would be unreachable code that reads as a guarantee (the BOUNDARY RULE).
Read-only G00/G00c/G00b/G01/G02 keep their early returns and exact strings.

**THE LIFO TRAP RECURRED, in a second pipeline, for the same reason** — so it is a property of R3,
not of ChangeTeam. G03 removes membership BEFORE `ChangeTitle`, because Gate 9b refuses a demotion
while the agent is still listed in a team; the mirror holds coming back, so the undo must re-add
membership FIRST and only then restore the title. Same order, not its mirror ⇒ **ONE gate**. The
existing code already had the right undo order *and a comment saying why* — what it lacked was the
constraint that keeps a future edit from splitting them, which the neuter now supplies.

**G04's undo, and why `saveTeams` and not `createTeam`.** `createTeam` MINTS A NEW uuid, so it cannot
restore a row — every agent, session and pending transfer naming the old id would dangle. The undo
writes the G02 snapshot back with `saveTeams`, and it decides by READING the store (`if
(teams.some(...)) return`) rather than trusting a flag, so it is correct whether `run` deleted
nothing or deleted and then threw.

**A latent abort outside the boundary, fixed so the boundary claim is TRUE.** G07's `await
import('@/lib/agent-registry')` sat outside any try. It runs after the transaction closes, so a throw
there hit the function's outer catch and reported *total failure* over a delete that had in fact
succeeded — with nothing rolled back. Per-agent cascade failures were already non-fatal by design;
the setup now matches them.

**Also fixed, a message the old path got wrong:** its abort ops line interpolated an array of objects
and printed `[object Object]` for every stranded agent. The runner formats it.

**Four neuters, disjoint red sets** (`tests/governance/r3-r9-team-governance.test.ts`, 3 tests):

| neuter | reds |
|---|---|
| G03's undo → return | all 3 |
| **G04's undo → return** | **ONLY the throw-after-delete test** |
| title BEFORE membership (simulating LIFO) | the 2 ordering tests, verbatim `CRITICAL … GATE NUMBER 1 (G03)` and `… GATE NUMBER 2 (G04) … INVALID STATE` |
| G04 stops aborting on a `false` return | ONLY the return-false test |

**The second row is why there are three tests and not two.** With the registry merely REFUSING,
nothing was deleted, so G04's compensation short-circuits on its first line and deleting it entirely
reddens nothing — the near-vacuous shape this campaign keeps finding. Only a fixture that really
drops the row and THEN throws (the partial-work case write-ahead registration exists for) makes that
undo load-bearing. Its non-vacuity control is the thrown message appearing in `result.error`: without
it, "the team still exists" cannot be told from a delete that never happened.

**A masking relationship worth knowing before the next edit.** In the throw-after-delete case G04's
undo restores the **pre-G03** snapshot, whose `agentIds` already contains every agent — so it also
restores membership, and the LIFO neuter leaves that third test GREEN. G03's undo is still
load-bearing there (title + `team` field), which neuter A confirms. Two compensations overlapping on
one field is not a bug, but a test written only against that path could not see G03's membership half.

### Deliberate, and named rather than left to be discovered

1. **The undo does NOT wake the agents it left hibernated**, preserving the existing choice and its
   stated reason (waking is heavier and side-effectful; an offline agent is recoverable, not
   corrupted). It IS an R51.10 gap — *"resume its job without interruption"* — of exactly the shape
   D1 identifies for the MANAGER demote. Wiring N wake calls into a rollback path is its own change.
   The operator is told: the error names how many remain asleep.
2. **G04's undo writes outside the registry's `withLock`.** `withLock` is module-private and
   unexported, so `saveTeams` is the only way to restore an exact row; it races a concurrent team
   mutation. Acceptable only because it runs on the rollback path of an operation that already has
   the operator's attention — but it is a real, named limit, not an oversight.
3. **`deleteTeam` also unlinks `docs-<id>.json`, and the undo does not restore it.** Legacy back-compat
   only (the registry's own comment says local task/doc files no longer exist), so no snapshot was
   built for it. If that file ever becomes load-bearing again, it needs one.

**NEXT ACTION** *(SUPERSEDED 2026-07-31 — `ChangeMarketplace` was re-measured, it did have the
window, and it is done in `1b129db8`. Read the ChangeMarketplace section above instead: the
measurement it demanded also showed the remaining eight small pipelines have NO window at all.)*
**— pick by WINDOW, not by gate count.** `ChangeMarketplace` (12 ops) is the remaining
named candidate with a plausible multi-store window; re-measure before committing to it. Still not
`ChangeTitle` (131) or `InstallElement` (101) — both are now called BY retrofitted pipelines
(`ChangeTeam` and `DeleteTeam` each call `ChangeTitle` from inside a gate), so converting one changes
its callers' failure semantics and wants its own card. **Never**
`ChangeName`/`ChangeFolder`/`ChangeAvatar`.

## ⏵ ChangeTeam RETROFITTED 2026-07-30 (`778151e9`) — 12 to go, and the LIFO trap

Real inventory now: **19 pipelines · 7 transactional · 12 to go.** Ratchet lowered
(`MAX_HANDROLLED` 13→12, `MIN_TRANSACTIONAL` 6→7, `ChangeTeam` pinned in `MUST_BE_TRANSACTIONAL`).

**THE FINDING, and it generalises beyond this pipeline.** `ChangeTitle` Gate 9 enforces R3 in BOTH
directions: a team title REQUIRES membership, and a standalone title (autonomous/manager/maintainer)
is REFUSED while the agent still is a member — the SCEN-001 BUG-002 guard. So the forward order is
join-then-title and the reverse order is leave-then-demote: **the reverse is not the mirror of the
forward, it is the same order again.** Reverse-order unwinding gives LIFO, which would demote FIRST
while the agent is still a member, Gate 9 would refuse, the undo would throw, and EVERY rollback of
this pipeline would report the R51.5 "INVALID STATE" form about a system that was fully recoverable.
So membership+title are **ONE gate** whose `undo` performs both in the order R3 permits. Found by
reading ChangeTitle before writing a line — not by watching a test fail.

**Sequences:** `G04b..PG01` (remove) and `G06..PG01` (add). `PG01` is the last gate that can abort in
either branch — the ledger emit below it is `tryEmitLedgerOp`, which swallows its own failure by
construction. Read-only gates (G00/G01/G01b/G02/G03, G04a's COS-immutability refusal, G05's
single-team check) keep their early returns and their exact strings.

**What it bought:** nothing here was compensated before. A throw at PG01 left the team registry and
the agent registry disagreeing about the same membership — the agent inside `team.agentIds` and
titled, with its own `team` field still naming the old team. That is the drift CreateAgent's G07 undo
cleans up from outside.

**Four neuters, disjoint red sets** (`tests/governance/r3-r9-team-governance.test.ts`):

| neuter | reds |
|---|---|
| `restoreMembershipAndTitle` → return | ADD + REMOVE |
| G04b's orchestrator undo → return | the orchestrator case ONLY |
| **title BEFORE membership (simulating LIFO)** | ADD + REMOVE, with `INVALID STATE … Could not revert: G06` — which is what makes the R51.3-wording assertion an ORDERING pin |
| both PG01 undos → return | ADD + REMOVE, on the `team`-field assertion only |

**A test was vacuous and only the neuter said so.** "G04b restores the orchestratorId" passed with
G04b's undo DELETED: ChangeTitle owns that field too (Gate 12 clears it, Gate 13b re-sets it), so the
title restore in the next undo put the slot back and G04b's compensation was masked. Rewritten to
fail the forward title write, so `titleChanged` stays false, no title restore runs, and G04b is the
only thing that can restore the slot.

**The fixture writes and THEN throws, deliberately** — a mock that throws first leaves nothing behind,
so PG01's own compensation would be satisfied by having nothing to do and no assertion could tell it
from a deleted one.

### Deliberate, and named rather than left to be discovered

1. **No new abort conditions.** `updateAgent`/`updateTeam` return values stay unchecked, exactly as
   before. A silent null return still proceeds. Turning those into failures is a behaviour change
   that deserves its own card, not a ride-along in a compensation refactor.
2. **A MANAGER moving between teams cannot be rolled back.** Its `titleBefore` is `manager` while it
   is still a member of the ORIGINAL team, so restoring it is refused by the very guard the ordering
   respects; the undo throws and R51.5 names it. Honest — the system really cannot be put back by
   this path.
3. **A `null` previous title is not restorable and does not need to be** — ChangeTitle Gate 1
   normalizes null to `autonomous`, so a null-titled agent demoted to AUTONOMOUS is already back.

**NEXT ACTION — pick by WINDOW, not by gate count.** *(SUPERSEDED 2026-07-31 — `DeleteTeam` is done;
see the section above for the current next action.)* `DeleteTeam` (37 ops) and `ChangeMarketplace`
(12) are the remaining candidates with plausible multi-store windows. Still not `ChangeTitle` (131)
or `InstallElement` (101) — both are called BY retrofitted pipelines (and `ChangeTeam` now calls
`ChangeTitle` from inside a gate), so converting one changes its callers' failure semantics and wants
its own card. **Never** `ChangeName`/`ChangeFolder`/`ChangeAvatar`: one mutating gate each, nothing
abortable after it, zero safety bought — see the superseded-note above.

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

### MEASURED 2026-07-30 — step 1 is NOT symmetric: 2 of the 6 stores need a new module-owned seam

The plan said "row snapshots + `undo`" as if every store were alike. Measured — which stores export a
writer at all, and what shape their mutation has:

| store | writer exported? | mutation shape | undo |
|---|---|---|---|
| `lib/team-registry.ts` | ✅ `loadTeams`/`saveTeams` | field edits + array filter | restore the rows |
| `lib/group-registry.ts` | ✅ `loadGroups`/`saveGroups` | array filter | restore the rows |
| `lib/governance-request-registry.ts` | ✅ `load`/`saveGovernanceRequests` | 3 fields on a row | restore the fields |
| `lib/session-persistence.ts` | ✅ `load`/`savePersistedSessions`, `persistSession` | row removal | re-persist |
| **`lib/amp-auth.ts`** | ❌ `loadApiKeys`/`saveApiKeys` are **module-private** | `status 'active'→'revoked'` **in place** | flip the recorded ids back |
| **`lib/aid-token.ts`** | ❌ `loadTokens`/`saveTokens` are **module-private** | rows **REMOVED** by filter | re-insert the recorded rows |

**Exporting the two private writers would be a CONCURRENCY REGRESSION, not a convenience.** Every
mutation in both modules runs inside `withLock('amp-api-keys')` / `withLock('governance-tokens')`; a
caller doing its own load/save from outside would bypass that serialization entirely. So the
compensation seam belongs INSIDE each module — which is already this codebase's stated pattern:
`lib/aid-token.ts:533-540` says `countTokensForAgent` exists *"so a teardown POST-CONDITION can ask
… without reaching around the module to its JSON file."*

**And the two undos are NOT the same code**, because the two mutations are not the same shape: a
status FLIP is undone from a list of ids, a row REMOVAL is undone from the rows themselves. The
token undo therefore has to carry actual token records in `ctx` for the pipeline's lifetime — in
memory only, never persisted — which needs saying out loud in the code rather than discovered later.

Existing signatures both return a COUNT, which is insufficient for either undo (a count cannot say
WHICH rows). Add companions rather than change them — `revokeAllKeysForAgent` has a second caller in
`services/amp-service.ts`.

> **⚠ THE LIST BELOW IS STALE — steps 0-6 have ALL LANDED. Do not re-do them.** Verified by
> measurement 2026-07-30, not by reading this card: `DeleteAgent` calls
> `runGateSequence(deleteGates, dc)`; the array holds **11 gates, 10 with `undo` + 1 `readOnly`** —
> full compensation coverage; `tests/unit/deleteagent-rollback-parity.test.ts` exists and is green
> (5 tests). Step 5's CLI uninstall landed as `G08c` (`5861db3b`). Step 6 is ruled below.
>
> **NEXT ACTION: the remaining 21 pipelines.** `runGateSequence` has **5** callers in
> `services/element-management-service.ts` against ~26 hand-rolled pipelines, so `AIO-TXN-10` is
> still violated by the majority of them. DeleteAgent was the designated first target because it is
> the irreversible one; it is done, and it is not the job.
>
> **A card whose STATE block lists landed work as pending is worse than one with no list** — it
> spends the next session's context re-deriving what shipped. This block is the authority; the
> ordered list is kept only because its per-step reasoning is still the record.
>
> **STEP 6 — RULED 2026-07-30. How a MULTI-CLAUSE rule gets ONE verdict.**
> R9.10 has two clauses with different verdicts: (A) the delete dialog must warn that the agent
> holds MANAGER — **absent**, the string is nowhere in `components/` or `app/`; (B) the system
> auto-demotes that MANAGER — **enforced and tested** at `DeleteAgent::G02` via
> `ChangeTitle(agentId,'autonomous')`, pinned by `r3-r9-team-governance.test.ts:1143`. The row said
> `UNENFORCED | — | —`.
>
> **RULING: a row's verdict describes the rule's ENFORCED SURFACE — the strongest clause, never the
> weakest.** `UNENFORCED` is precisely the verdict the ratchet IGNORES (it demands no citation), so
> a live guard sitting under one is invisible: deleting `G02` would have reddened nothing. Marking
> by the weakest clause trades a real guard's protection for the appearance of caution. **Proved by
> neuter:** with the row upgraded, breaking the gate qualifier now reds a named test —
> *"R9.10: DeleteAgent() no longer pushes a G99 gate — the guard this row cites is gone"*. Before
> the upgrade, no ratchet test looked at R9.10 at all.
>
> The unenforced clause is NOT absorbed by the verdict — it is recorded in the map's
> `## Notes on individual rows`, in prose, **outside the table**, because the Guard column is
> machine-parsed (split on commas, each piece resolved as a path) and an explanatory phrase in a
> cell breaks the ratchet instead of informing anyone.
>
> `PARTIAL` was considered and rejected — `VERDICTS` is a closed union and a machine cannot act on
> "partly"; it must decide whether to demand a citation. Splitting into R9.10a/R9.10b was rejected
> too — sub-rule ids are parsed out of `GOVERNANCE-RULES.md`, so ids that document does not contain
> would decouple the map from the only thing defining it.
>
> **Owed, not done:** this was one row found by chance. Whether OTHER `UNENFORCED` rows (117 remain)
> also hide live clauses is unmeasured, and a blind sweep at the end of a long turn is exactly how a
> wrong verdict gets committed at scale. It needs its own card.

NEXT ACTION (SUPERSEDED — see the block above): implement, with G02's auto-demote KEPT (R9.10). Order of work:
0. ~~Add the two module-owned seams~~ **DONE 2026-07-30 (`8a47c5a2`)** —
   `revokeAllKeysForAgentCompensable` (`lib/amp-auth.ts`) and
   `revokeTokensForAgentCompensable` (`lib/aid-token.ts`), each returning a `restore` CLOSURE so no
   key hash or token record crosses the module boundary. Both existing revokers now delegate to
   them, so there is ONE implementation of each mutation. 13 tests
   (`tests/unit/store-revocation-compensation.test.ts`), three neuters run, each reddening exactly
   one test: restore-ignores-the-hashes → the already-revoked security test; in-place-mutation →
   the failed-save residue test; expiry-skip-removed → the expired-between-calls test.
   Two properties worth carrying into G06's gate: the undo restores ONLY what this call flipped (a
   blanket reactivate would resurrect a rotated-out key), and a failed save now leaves NO residue
   (copy-then-publish), so "run did none of it" is true rather than merely tolerated.
1. `ctx`-carried row snapshots + `undo` for G01c (delete the zip), G04, G05, G05b, G07/G07b, G07c —
   and G06 is now just `ctx.keyRevocation = await revokeAllKeysForAgentCompensable(id)` in `run`,
   `await ctx.keyRevocation?.restore()` in `undo` (same shape for the token revocation).
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
- [x] `DeleteAgent` transactional — `runGateSequence(deleteGates, dc)`, 11 gates (10 `undo` +
      1 `readOnly`), `tests/unit/deleteagent-rollback-parity.test.ts` green
- [x] `CreateAgent` transactional — `runGateSequence(createGates, cc)` over G03..G07c, the last
      gate that can abort (`3f2e0e1d`). Its four hand-rolled rollbacks collapsed into one `undo`
      chain; parity test asserts the workdir removal, three neuters have disjoint red sets
- [x] G07's team-leave `undo` PINNED (`944063f2`) — stateful team double + a seeded MANAGER so the
      join genuinely lands, aborting at G07c's R9.13 reject. Asserted on the `updateTeam` call
      sequence (id in on the join, out on the undo); the neuter reds that test and only it
- [x] `ChangeTitle` transactional — **`ChangeClient` and `ChangePlugin` were DONE first**; this box
      was split because they were. `ChangeTitle` (131 gate ops, the largest) now runs on
      `runGateSequence(gates, ctx)` at `:4204`, its window opening at G9a and closing at G17, with
      **THIRTEEN of the fourteen mutating gates pinned by a named neuter** in
      `tests/services/change-title-window.test.ts` and the fourteenth (G15's) recorded as
      UNREACHABLE rather than untested. The rollback coverage found and fixed one real bug —
      G16's undo routed through `ChangePlugin`, whose G08 refuses to uninstall the plugin the
      CURRENT title requires, so every rollback past G16 reported R51.5 CRITICAL over a fully
      recoverable system (`63e56bfa`)
- [x] A DRIVER for `ChangeTitle`, with a caller (`d3694d48` + `4529c77e`) —
      `tests/helpers/drive-change-title.ts` and `tests/services/change-title-window.test.ts`.
      Three layers of containment + a `claude` PATH shim that MODELS the CLI's one settings write;
      3 tests, 0-IMPACT clean, two neuters with disjoint red sets. Writing the caller falsified two
      stubs a read had passed over: an inverted `checkIbctScope` shape (killed every call at G0b)
      and a no-op shim (made G17 "recover" a healthy agent on every run)
- [x] CHARACTERIZE the window before restructuring (`74de88d7`) — the card's own injection point
      (G11 `updateTeam`) turned out UNREACHABLE on a manager→autonomous demotion; probing all four
      post-G10 collaborators found the two that are, and with them a LIVE DEFECT: a failure in
      `blockAllTeams` leaves the host with no manager and unblocked teams **and returns
      `success: true`**
- [x] The LIVE G10 DEFECT FIXED (`47feb243`) — a DEFERRED fail: the verdict is withheld at the
      terminal while every alignment gate still runs. **This box supersedes the claim this checklist
      used to make**, that the fix's shape was "the neuter that reds that test" (un-wrap
      `blockAllTeams` so it aborts). That shape strands AID tokens embedding the old title, because
      G14 writes the title first and Gate 6 short-circuits the retry — see the STATE block. Two
      neuters with disjoint red causes; the discriminating assertion is `world.calls`
- [x] `ChangeTeam` / `DeleteTeam` transactional — both verified 2026-07-31 at their runner call
      sites (`ChangeTeam` runs TWO sequences, `runGateSequence(removeGates, tc)` and
      `(addGates, tc)`; `DeleteTeam` one). They had already left the hand-rolled list; this box was
      simply never ticked
- [ ] The remaining `Change*` / marketplace / element pipelines transactional — **8 of the 9 LANDED
      2026-07-31 (`2613c907`); `InstallElement` is the one left.** `ChangeAvatar`, `ChangeName`,
      `ChangeFolder`, `ChangeMetadata`, `ChangeCLIArgs`, `ChangeMCP`, `ChangeLSP` and `ChangeHook`
      are under `runGateSequence`; `MAX_HANDROLLED` 9 → 1, `MIN_TRANSACTIONAL` 10 → 18, all eight
      pinned by name. The MEASUREMENT that said they buy zero safety was RIGHT for seven of them —
      their undos are latent by construction and are named as such rather than counted — and WRONG
      for `ChangeLSP`, whose bare `writeFile` really can leave a truncated `.lsp.json`; that undo is
      reachable and is pinned by a neuter. **The box stays open on `InstallElement` alone, and it is
      not a ninth of the same:** it is the pipeline other retrofitted pipelines CALL, and three of
      its pre-EXE mutations are ones a compensation is FORBIDDEN (R20.31, Explicit) or harmful to
      reverse. It wants its own card — do not fold it into a "finish the last one" session
- [x] An enforceable ratchet for `AIO-TXN-10` — `tests/governance/aio-txn-10-runner-coverage.test.ts`
      discovers the inventory from the AST and fails when a pipeline hand-rolls beyond
      `MAX_HANDROLLED`. NOT the parity box below: this asks "is it under the runner", which is
      answerable today; that one asks "are its gates compensated", which `findUncompensatedGates`
      already guarantees at runtime for every pipeline that IS under the runner
- [ ] Parity test: zero uncompensated mutating gates across all 19 pipelines — unreachable until
      all 19 are retrofitted, since the runtime pre-flight only sees pipelines that use the runner
- [ ] Each pipeline declares its R51.7 INVARIANTS (not only its gates) — leftovers and
      contradictions are two different ways to be invalid, and the KERM18NX residue check only
      catches the first
- [x] The tmux-kill compensation question decided and recorded here (R51.10 — re-launch is valid;
      a pid is not part of "the exact state")
- [x] tsc clean, full suite green — **measured at `790cd8cb`**: `bash scripts/with-node.sh npx tsc
      --noEmit` = 0 lines; `bash scripts/with-node.sh yarn test` = **310 files / 4453 passed / 2
      skipped**; `bash scripts/with-node.sh yarn trddgrep validate` = exit **1** with only the two
      known `BODY-STATE-CLAIM` cards (`7123D51A`, `C7A81642`). Dated because it is a MEASUREMENT,
      not a standing property — the three boxes still open above will each need it re-run

## Approval log

- 2026-07-26T00:17:12+0200 — MANDATE issued by USER (min-approval-requirement: none). Born approved.
