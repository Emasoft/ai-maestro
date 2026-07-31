---
trdd-id: DQ6XN2VP
title: Make every all-in-one pipeline transactional — all-or-nothing with reverse compensation
column: dev
scope: project
project-id: ai-maestro
created: 2026-07-26T00:17:12+0200
updated: 2026-07-31T08:53:30+0200
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
implementation-commits: [8a47c5a2, 4191381e, ecd1a1b, 0e08912b, dc034515, e696a6ba, 3f2e0e1d, 944063f2, 778151e9, 72886dd1, 1b129db8]
---

## ⏵ MEASURED 2026-07-31 — 9 done, 10 left, and only ONE of the ten is worth doing

**The remaining work is not "10 pipelines". It is ONE** — `ChangeTitle`. Every candidate's
partial-state window was measured, per the standing rule that you measure the window before picking
by op count. The `InstallElement` row below was measured WRONG the first time and corrected the same
morning by reading the function; the correction is the finding, and it is recorded under the table.

| pipeline | gate ops | mutating calls | window | verdict |
|---|---|---|---|---|
| `ChangeTitle` | 131 | **~15** — `updateAgent` ×6, `blockAllTeams`/`unblockAllTeams`, `updateTeam` ×4, `revokeTokensForAgent`, `revokeTokensFromIssuer`, `installPluginLocally` ×4, `hibernateAgent` | **REAL, and the only one left** | retrofit |
| `InstallElement` | 101 | 13 — `mkdir` ×2, `saveJsonSafe` ×7 (5 local, 2 user), `execFileAsync` ×4, `rm` ×1 | **NONE that may legally be compensated** — see below | conformance only |
| `ChangeFolder` | 10 | 1 (`updateAgent`) | none | conformance only |
| `ChangeName` | 9 | 1 (`updateAgent`) | none | conformance only |
| `ChangeMetadata` | 7 | 1 | none | conformance only |
| `ChangeCLIArgs` · `ChangeHook` · `ChangeLSP` · `ChangeMCP` | 6 each | 1 each | none | conformance only |
| `ChangeAvatar` | 3 | 1 (`updateAgent`) | none | conformance only |

`ChangeFolder` and `ChangeName` were the two never previously measured, and they land with the other
six: one `updateAgent`, then only notes, a read-only verify, and the ledger emit — nothing abortable
after the mutation, so there is no state a compensation could restore. **8 of 10 are paperwork.**

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
| 1 | G03 | :2402 | `updateAgent({program})` — auto-fix an empty program | restore prior `program` |
| 2 | G06b / G9a | :2494, :2645 | `updateAgent({githubRepo})` | restore prior `githubRepo` |
| 3 | **G14** | **:2685** | **`updateAgent({governanceTitle})` — THE title write** | restore `oldTitle` |
| 4 | G10 | :2736-2741 | `removeManager()` + **`blockAllTeams()` — hibernates every team agent** | `unblockAllTeams()` + re-wake each. **`blockAllTeams()` RETURNS the hibernated list**, so the snapshot R51.4 asks for already exists. Each wake can fail ⇒ the honest R51.5 CRITICAL path. |
| 5 | G11 | :2758, :2774 | `updateTeam({chiefOfStaffId: null})` + `rejectGovernanceRequest` | restore the pointer; un-reject is a 3-field row restore (same shape verified for `DeleteAgent` G07) |
| 6 | G12 | :2796 | `updateTeam({orchestratorId: null})` | restore the pointer |
| 7 | G13 / G13b | :2814, :2846-2849 | set manager in `governance.json`, `unblockAllTeams`, re-point team COS/ORCH | restore prior manager + prior pointers |
| 8 | G14b | :2905 | `revokeTokensForAgent` (AID) | **the compensable twin ALREADY EXISTS** — `lib/aid-token.ts:542 revokeTokensForAgentCompensable` returns the removed `AIDTokenRecord[]`; `:587 revokeTokensForAgent` is a count-only wrapper. Built for `DeleteAgent`; ChangeTitle just calls the wrong one. Free win. |
| 9 | G14e | :2929 | `revokeTokensFromIssuer` (portfolio) | **BUILT 2026-07-31** — `revokeTokensFromIssuerCompensable` + a delegating count-only `revokeTokensFromIssuer`, mirroring the aid-token seam. Lossless `active → revoked` flip, undone from the touched `(subjectId, token_id)` list; 7 tests, 4 neuters. |
| 10 | G16 / G17 | :3193, :3272, :3317, :3327 | `installPluginLocally` ×4 | uninstall the installed plugin (shape D2 already ruled: CLI-uninstall with a CLI-reinstall undo) |
| 11 | G16b | :3231 | `updateAgent({programArgs})` — rewrites the `--agent` flag | restore prior `programArgs` |
| 12 | G17 | :3282-3285 | `updateAgent({roleMissing})` + `hibernateAgent` + ledger | restore the flag + re-wake |

**The two entries that make this pipeline the one worth doing** are #4 and #10: a failure anywhere
after G10 leaves the host with teams blocked and the fleet hibernated, and a failure after G16 leaves
a titled agent with the wrong role-plugin — R9.13 violated by the very pipeline that enforces it.
Nothing in the eight conformance-only pipelines is remotely this wide.

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

**Deliberately NOT hot-fixed here.** Wrapping the two halves by hand is a hand-rolled compensation —
the exact thing R51 says to replace with the runner — and it would be superseded by the retrofit
that is this card's next step. It is pinned instead, so the fix is checkable: the neuter that reds
that test IS the fix's own shape (un-wrap `blockAllTeams` so its failure aborts). **When the
retrofit lands, that characterization test MUST be updated — its failure is the signal the retrofit
worked.**

**NEXT ACTION:** the retrofit proper — restructure into `runAioPipeline` PRE/EXE/POST, preserving the
G14-first ordering above. **Do NOT switch G14b/G14e to the compensable forms yet:** without a `ctx` to
hold the returned handle there is nowhere to register the undo, so the switch would be churn that
LOOKS like progress. It belongs in the same change that introduces the gate array.

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
- [ ] `ChangeTitle` transactional — **`ChangeClient` and `ChangePlugin` are DONE**; this box is
      split because they were, and `ChangeTitle` (131 gate ops, the largest) is not
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
      `success: true`**. Pinned, not hot-fixed — the retrofit is the fix, and the neuter that reds
      that test is the fix's own shape
- [x] `ChangeTeam` / `DeleteTeam` transactional — both verified 2026-07-31 at their runner call
      sites (`ChangeTeam` runs TWO sequences, `runGateSequence(removeGates, tc)` and
      `(addGates, tc)`; `DeleteTeam` one). They had already left the hand-rolled list; this box was
      simply never ticked
- [ ] The remaining `Change*` / marketplace / element pipelines transactional — **9 of them, and
      MEASURED 2026-07-31 to buy ZERO safety.** See `## ⏵ MEASURED 2026-07-31` — eight are a single
      mutating call with nothing abortable after it, and the ninth is `InstallElement`, whose three
      pre-EXE mutations are ones a compensation is FORBIDDEN (R20.31, Explicit) or harmful to
      reverse. Retrofitting any of them moves the conformance ratchet and closes no window. Keep the
      box open (AIO-TXN-10 is still violated), but do NOT spend a session on them ahead of
      `ChangeTitle`
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
- [ ] tsc clean, full suite green

## Approval log

- 2026-07-26T00:17:12+0200 — MANDATE issued by USER (min-approval-requirement: none). Born approved.
