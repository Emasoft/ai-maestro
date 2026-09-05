---
trdd-id: AQTGAY60
title: DeleteAgent leaves the agent's local plugin records behind in installed_plugins.json
column: human_review
scope: project
created: 2026-07-29T21:30:09+0200
updated: 2026-09-05T02:29:36+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-29T21:30:09+0200
derived: false
npt: [FHBGF0WG]
eht: []
severity: major
priority: 1
review-after: 2026-09-02
release-via: none
relevant-rules: [R17, R20.30]
implementation-commits: [c08e8303, 6c11bd7f, 34849d8d]
external-refs: [https://github.com/Emasoft/ai-maestro/issues/102, https://github.com/Emasoft/ai-maestro-janitor/issues/137]
---

# DeleteAgent leaves the agent's local plugin records behind in installed_plugins.json

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-29

**The defect:** `DeleteAgent` removes the agent from every store it owns — cemetery archive,
team slots, tmux session, `sessions.json`, AMP keys, AID tokens, governance requests,
transfers, groups, the registry row, and (on a hard delete) the workdir — and does **not**
remove the agent's records from `~/.claude/plugins/installed_plugins.json`. Every agent the
server has ever deleted still has a local plugin record pointing at a workdir that no longer
exists.

**Measured first-hand 2026-07-29 21:30 (not inferred):**

| fact | value |
|---|---|
| local-scope records in `installed_plugins.json` | **101** |
| of those, `projectPath` absent from disk | **93 (92%)** |
| orphans that are `ai-maestro-plugin@ai-maestro-plugins` | **65** — installed by our own R17 core-plugin invariant |
| orphans that are `ai-maestro-janitor@ai-maestro-plugins` | **4** — NOT installed by us (see below) |
| `DeleteAgent` gate labels | `G01 … G09` — none mentions a plugin |
| the removal code that exists | `services/element-management-service.ts:1718` "Remove from installed_plugins.json" — in the **plugin-uninstall** path, which `DeleteAgent` never calls |

**NEXT ACTION:** add a `DeleteAgent` gate that removes every record whose `projectPath` is the
deleted agent's workdir. It is a MUTATING gate, so under R50/R51 it needs a compensation
registered before it runs — and it must land where the workdir path is still known (before
`G09` deletes the folder, and before the registry row is gone at `G08`).

**⚠ SUPERSEDED 2026-07-30 — no longer blocked, and the gate is built.** Read
`## ⏵ UNBLOCKED + PARTLY BUILT` below before acting on anything in this STATE block: the NPT is
terminal, the gate exists (as ~~`G09b`~~ **`G08c`** since TRDD-OWO449MR), and the only open work
is a test that drives `DeleteAgent` itself. The paragraph below is kept because it records WHY the
block existed.

**AND THE NEXT ACTION ABOVE WAS RIGHT ALL ALONG — noted 2026-09-05.** It asked for a compensation
registered before the gate runs, landing *"before `G09` deletes the folder"*. That is precisely
where `G08c` sits today, with `undo: compensateG08c`. What went wrong in between was not the
design but a mid-card rebuttal that argued the compensation away on a placement that later moved;
see the withdrawal below. **A superseded design note can be more accurate than the "resolution"
that replaced it**, which is a reason to re-read the original before trusting a later rewrite of
it.

**BLOCKED on NPT TRDD-FHBGF0WG.** The helper at `element-management-service.ts:1718` CANNOT be
reused as-is: `installed_plugins.json` maps a key to an ARRAY of per-install records, and that
code does `delete pluginsMap[pluginKey]` — the whole array, every agent, BOTH scopes. Reusing
it from `DeleteAgent` would turn "clean up one agent's records" into "wipe every agent's
records for that plugin, plus the user-scope row". FHBGF0WG makes the surgery record-scoped
first.

**Load-bearing facts / gotchas**

- **We do not install the janitor.** All 11 `ai-maestro-janitor` mentions in `lib/`,
  `services/`, `app/`, `scripts/`, `server.mjs` are comments or DATA-dir paths the
  oauth-rotator reads (`lib/oauth-rotator/{global-state,slots,safe-storage}.ts`). There is no
  install call site. The janitor is enabled at **USER** scope in
  `~/.claude/settings.json` (`enabledPlugins["ai-maestro-janitor@ai-maestro-plugins"] = true`),
  which is how it runs in every project. Whatever wrote those four local janitor records, it
  was not this codebase — that is an open question for ai-maestro#102, not an assumption to
  encode here.
- **Enablement and install-record are two different registries.** `settings.json`
  `enabledPlugins` says what is ON; `installed_plugins.json` says what is INSTALLED and where.
  Reading only the second one makes a user-scope-enabled plugin look absent. (Note
  `ai-maestro-plugin@ai-maestro-plugins = false` at user scope — that is R20.30 working: the
  core plugin is LOCAL per agent workdir, deliberately not user-scope-enabled.)
- **A soft delete keeps the workdir**, so its records are NOT orphans and must be preserved —
  the gate keys on the deletion being hard, or on the workdir actually going away, never on
  "DeleteAgent was called".
- The file is **Claude Code's own store**, outside the repo and not git-tracked. The server
  already writes it as a normal part of install/uninstall (`INSTALLED_FILE`,
  `element-management-service.ts:89`), so adding a delete-time cleanup is in scope. A one-time
  prune of the 93 EXISTING orphans on this machine is a deletion of untracked data outside the
  project and needs the USER's word first (RULE 0).

## Problem

Agent deletion is an all-in-one pipeline precisely so that no store is left disagreeing with
the others. This one store was missed, so the disagreement is total and monotonic: 92% of the
local plugin records on this host describe agents that do not exist. Nothing reports it,
because a stale record is indistinguishable from a live one to anything that only reads the
file.

## Root cause

`DeleteAgent` (`services/element-management-service.ts`) has no plugin-record gate. The
capability exists — the plugin-uninstall path removes records at `:1718` — but deletion and
uninstallation were built as separate flows and deletion never calls the other one. The agent's
plugin records were simply never on the list of things an agent owns.

## Downstream impact (why this is major and not cosmetic)

1. **It corrupts a peer's measurements.** The janitor reads `installed_plugins.json` to learn
   the fleet's plugin topology. On ai-maestro#102 it read the four orphaned janitor records —
   all four workdirs gone, none of the four agents in the registry even as tombstones — and
   concluded the fleet is "local-scope-per-agent, with no user-scope record", which would make
   its `--scope user` update path structurally unable to keep the fleet current. That
   conclusion was drawn from four ghosts.
2. **It under-protects `cache_prune`** (janitor#137). Pruning decides which cached version
   directories are still in use from these records. 93 ghosts make deleted agents look like
   live holders of old versions — the opposite of the "prune a version out from under a
   running agent" risk that issue is about, and just as wrong.
3. **It grows without bound.** Every scenario run creates agents and deletes them in its
   cleanup phase; every one leaves records. 65 `ai-maestro-plugin` orphans is the accumulated
   total of every agent this server has ever deleted.

## Proposed fix

1. **A `DeleteAgent` gate** that removes every `installed_plugins.json` record whose
   `projectPath` equals the agent's workdir. Placed where the workdir is still resolvable, with
   a compensation that restores the removed records if a later gate fails (R51).
2. **Soft-delete safety:** a soft delete preserves the workdir, so it must preserve the
   records; only the path that actually removes the workdir removes them.
3. **A reconcile for the existing 93** — proposed, NOT run unilaterally. Two shapes worth
   weighing: a one-time sweep, or a boot-time reconcile that drops records whose `projectPath`
   is absent. The second is self-healing but silently deletes on every boot, so it needs the
   same care as any self-heal: log the event, never repair what an observer merely measures.

## Verification

- A unit test hard-deletes an agent with a local plugin record and asserts the record is gone
  from the fixture `installed_plugins.json` — failing against HEAD.
- A test soft-deletes and asserts the record SURVIVES (the split is the point; a gate that
  removes on both paths would break re-adoption over a tombstone).
- A test forces a later gate to fail and asserts the records are restored (R51 compensation).
- Live: create a throwaway agent, confirm a record appears, hard-delete it, confirm the record
  is gone and the count drops by exactly one.

## Estimated risk

LOW for the new gate — it removes records for a workdir that is being destroyed anyway, and the
compensation covers the partial-failure case. MEDIUM for the reconcile of the existing 93,
because it deletes data outside the repo on the user's machine; that half stays a proposal
until the user rules on it.

## Approval log

- 2026-07-29T21:30:09+0200 — SELF-MANDATE by ai-maestro (min-approval-requirement: none).
  Tier 0: a defect in this repo's own deletion pipeline, inside the authoring agent's
  assignment scope, reversible and local. The reconcile of pre-existing orphans is explicitly
  carved out as USER-gated and is not covered by this mandate.

## ⏵ UNBLOCKED + PARTLY BUILT — read this before the Acceptance list — 2026-07-30

**The NPT is terminal.** TRDD-FHBGF0WG reached `complete` (5/5 boxes, each neutered) and sits in
`design/archived/`, so the record-scoped remover this card was waiting on exists and is exported.
`column:` moved `todo → dev` — the code landed, the card had simply never been advanced.

**⏹ COLUMN CORRECTED 2026-09-05 — `todo` → `human_review`. The whole story, in four clauses:**
the field was `dev` (`41d4e5b7`, 2026-07-30); a 2026-08-02 triage moved it to `todo`
(`947d36cb`); that was a **misfile** — this card belonged with `44RGLOO8`, which the same sweep
sent to `human_review` for a STATE that forbids agent action; and **the sweep left no in-card
note by design**, which is why nothing here ever explained the move.

**What `947d36cb` shows, at its real strength:** it CLASSIFIED rather than bulk-moved (a four-way
taxonomy — deferred by its own text / gated on a human / blocked externally / pending with nobody
on it — is not what a uniform operation produces) and it demonstrably OPENED at least one card,
quoting 44RGLOO8's own STATE. That eight went to one destination is consistent with assessing all
nine, and also with defaulting the rest; "assessed each card individually" claimed more than the
evidence carries.

**The finding is not the misfile — it is that the sweep annotated its own defect and shipped
anyway.** Its body records *"The nine cards moved today carry no in-card note — a recorded debt,
not an oversight"*, AND that an earlier pass was recoverable "ONLY because the per-card reasons
were written", AND that reasons-in-the-log-not-the-cards was **the wrong call**. So it diagnosed
the failure mode, wrote down that it was committing it, and committed it. **A column move without
an in-card reason is the artifact that rots** — that is the transferable lesson, and calling this
"an ordinary misclassification" credited candor where the process needs fixing.

**Where the gap became MY error, kept separate because they are different failures:** the sweep
left a documentation gap. Filling it with three successive causal inventions — blamed the editor,
then credited the editor, then declared it unread — instead of running one `git show` was mine,
and merging the two lets me share my error with a commit that only left a gap. The three
superseded versions are in this card's commit trail (`e9057a97`, `a69c3b31`, `d460405e`,
`e37f72b7`); they are NOT restated here, by the same reasoning that withdrew a superseded number
on TRDD-601KG45D rather than flagging it — superseded REASONING outlives its caveats exactly as
superseded numbers do.

Now `human_review`, which is the honest
column, because the remaining box is OPERATOR-GATED by the card's own text — a real create +
hard-delete on this host against a sudo-gated route, i.e. a UI-driven scenario run plus a
destructive op on an untracked directory, which the card says in as many words must NOT be run
from the main context. It is not `blocked` (no `blocked-by:` TRDD gates it) and it is not `dev`
(the pending step is not agent work). It waits on a human, which is what `human_review` means.

**And the column history supplies an argument for `human_review` that I had not made:** the
mechanism that produced the wrong column was a **`dev`-reduction sweep**, so any column inside
that sweep's target set is one this card can silently fall back into. `human_review` is not in
it. **Stated at its real strength: this SPECIFIC historical failure mode cannot recur in this
column — that is not a general stability property of `human_review`, and a future triage pass
could sweep any column.**

**Not touched, deliberately:** the open box itself. Nothing about finding a stale column
authorizes running the destructive verification the box defers.

**⚠ THE CONTRADICTION IS RESOLVED, AND THIS CARD WAS THE STALE SIDE (TRDD-XNW6THVC, 2026-09-05).**
XNW6THVC asserted a disagreement and deliberately named no stale side, because neither the code
nor OWO449MR had been read. Both are now read, and they agree with each other against this card:

| claim | measured |
|---|---|
| the gate's id and position | **`G08c`** at `services/element-management-service.ts:9510`, inside the AIO gate sequence and **BEFORE** `G09`'s folder delete at `:9656-9668`. **Established from CONTROL FLOW, not line order**: `await runGateSequence(deleteGates, dc)` at `:9647` drains the sequence, and G09's bare `if` block starts at `:9656`. Corroborated behaviourally by the gate test named *"uninstalls every local plugin for the doomed workdir, at local scope, **before the folder goes**"* |
| its tombstone | `:9674` — *"G09b USED TO SIT HERE … It is now G08c, inside the gate sequence and BEFORE this deletion"* |
| `removeLocalInstallRecords` | **does not exist as a callable symbol.** ⚠ An earlier version of this row said "one tree-wide hit" off a grep scoped to `services/ lib/ app/` — re-run genuinely tree-wide, there are **TWO** hits and both are comments: `:1716` here, and `tests/unit/installed-plugins-records.test.ts:6`. The conclusion holds; the count did not. It became the read-only, fail-closed `listLocalInstallRecords` (`:1732`), called at `:9548` |
| the compensation | **it has one, and the body was read (not taken from OWO449MR's prose)**: `undo: compensateG08c` (`:9603`) re-installs each uninstalled key via `adapter.install(…, dir, {scope:'local', marketplace})`, emits a `restore_plugin_records` op, and **throws** on any partial failure — deliberately, so the runner emits the CRITICAL INVALID STATE message rather than reporting "no changes were made" (R51.5) |
| OWO449MR | `column: completed`, archived. Its STATE: *"`G09b` → **`G08c`**, inside the gate sequence, BEFORE `G09`'s folder delete, using the CLAUDE adapter with a CLI-reinstall compensation."* Commits `f1e4d7ec` (code), `5861db3b` (gate test) |

**So box 2's premise was RIGHT and this card's rebuttal of it was wrong** — see below; the box is
re-opened. The relocation was not a preference: `claude plugin uninstall --scope local --cwd <dir>`
needs `<dir>` to still exist, so handing the mutation to the file's owner forces it ahead of the
folder delete, which is exactly what turns a free irreversible step into one R51 requires be
compensated.

**A second finding, about XNW6THVC itself.** Its NEXT ACTION told the reader to grep for the
placement of the `removeLocalInstallRecords` call — a symbol that has not existed since
`f1e4d7ec`. That card was written from THIS card's description rather than from source, so it
inherited the dead symbol along with the stale placement. It is the card's own thesis, confirmed
by the card.

**What is actually in the tree** (read, not inferred):

| piece | where |
|---|---|
| the gate | ⚠ **STALE — corrected above.** Was: `DeleteAgent` **G09b**, inside the hard-delete-with-folder branch, right after the workdir is removed, calling `removeLocalInstallRecords(resolvedDir)`. It is now **`G08c`** (`:9510`), inside the gate sequence and BEFORE the folder delete, calling read-only `listLocalInstallRecords` (`:9548`) and asking the `claude` CLI to do the mutation, with `undo: compensateG08c`. Both of the old branch's guards moved with it (`hard && deleteFolder`, and the `~/agents/` prefix check) — the comment at `:9526` says losing them would strip an adopted workdir that `G09` then correctly refuses to delete |
| the post-condition probe | `lib/agent-teardown.ts` store id `plugin-records` — the thing that can PROVE the gate ran |
| the manifest pin | `AGENT_STORES` includes `plugin-records`, and `tests/unit/agent-teardown.test.ts` pins the id list, so adding a store without a probe now breaks a test |
| the probe's tests | 7 cases + 3 recorded neuter runs (commit `6c11bd7f`) |

**~~Box 2's premise was wrong, and the code is right.~~ WITHDRAWN 2026-09-05 — the premise was
right.** The argument was: G09b deliberately has no compensation because it runs **after** the
folder is gone, at which point every `{scope:'local', projectPath: resolvedDir}` record asserts a
plugin is installed for a directory that does not exist — provably FALSE, so removing it cannot be
wrong and a rollback would restore nothing anyone wants back.

That reasoning was sound **for the placement it described**, and the placement is gone. The gate
now runs BEFORE the folder delete, so at the moment it mutates, the records are still TRUE and a
rollback restores something real — which is why the code that replaced it carries
`undo: compensateG08c`. The comment at `:9518` reaches the same conclusion in the opposite
direction: Shape A *"turns a free irreversible step into a mutation with a fallible gate after it,
which R51 requires be compensated; hence the undo below."*

**The transferable error is not the stale fact, it is what the stale fact was used FOR.** This
paragraph did not merely record an out-of-date placement; it spent that placement to overturn an
acceptance box and tick it, so one unverified detail became a closed requirement. A card that
argues *from* a fact it has not re-read converts staleness into false completion.

**The probe was VACUOUS before this session, in a way worth recording.** Its body was
*unreachable*: the shared guard pair returns null unless `expectFolderGone` is true AND the workdir
is under `~/agents/`, and the fixture CTX is deliberately neither — so no test reached the file
read. The two filesystem-probe tests that did exist are `not.toContain` assertions, which pass
whenever a probe returns null **for any reason**. Same shape for `workdir` and `transcript-dir`, so
all three got positive controls in the same pass.

**Neuter B is the honest part.** Dropping `scope === 'local'` reddened NOTHING — a today-shaped
user row has no `projectPath`, so the path comparison alone already excluded it and my first draft
of that test pinned nothing. Re-seeded with a user row that DOES carry the workdir path (the
"future record shape" the probe's own comment names as the reason the check exists) and the same
neuter then reddened exactly that one test.

**What is still open, precisely:**

> **⚠ EVERYTHING IN THIS NUMBERED BLOCK DESCRIBES THE PRE-RENAME WORLD (banner added 2026-09-05).**
> It reasons about a gate called `G09b`, a test file
> `tests/unit/deleteagent-g09b-plugin-records.test.ts`, and a neuter "move G09b out of the
> folder-deleted branch" — **none of which exist.** The gate is `G08c`, the file is
> `deleteagent-g08c-plugin-uninstall.test.ts`, and that branch structure is exactly what moved, so
> N1's recipe is no longer performable as written. Kept because it records why the tests were built
> and what the harness had to solve; **do not read any of it as a description of the current tree**,
> and do not follow its neuter recipes. The current state is the STATE correction above and
> boxes 1-4 below.

1. **✅ CLOSED 2026-07-30 (commit `34849d8d`) — `DeleteAgent` is now driven.** Built exactly as
   sized below: a shared harness `tests/helpers/drive-delete-agent.ts` (both mock layers, real
   `fs`, collaborators stubbed on BOTH their gate and their G10-probe halves) plus a thin
   `tests/unit/deleteagent-g09b-plugin-records.test.ts` — 6 tests, 2 recorded neuters that are
   exact complements: **N1** (move G09b out of the folder-deleted branch) reddens the 2
   soft/no-folder cases and leaves the 3 hard ones green, so those two are what pin the
   PLACEMENT; **N2** (delete the gate) reddens the 3 hard cases — including the G10-residue
   case, which is the independent confirmation that the probe really does report
   `plugin-records` when the gate is absent — and leaves the 2 soft ones green. Every
   behavioural test falls to exactly one neuter, so none passes for an unknown reason; the
   containment test correctly survives both, because it is about the sandbox and not the gate.
   Containment was then checked from OUTSIDE the run (real `~/agents` still 20 entries, real
   `installed_plugins.json` still 101 local records) rather than from the in-process assertion.
   The paragraphs below are kept because they are the WHY the shape had to be a shared helper.

   **The original finding —** The probe tests prove the VERIFIER behaves correctly;
   they do not prove G09b removes on hard-delete and leaves alone on soft-delete. That split is
   true **by construction** (the gate sits inside the folder-deleted branch) and I read the code to
   confirm it — but "true by construction" is a claim about the code, not a guard against the next
   edit. This is the same distinction the FHBGF0WG gap was: implemented, and pinned by nothing.

   **And it is harder than it looks — measured, so the next session does not walk into it.** Five
   test files DO drive `DeleteAgent` end-to-end (`tests/governance/r3-r9-team-governance.test.ts`
   with both `hard: true` and `hard: false`, `tests/services/element-management-assistant-title.test.ts`,
   …), and **none of them can reach G09b.** They contain themselves with **layer 2 only** — the
   `@/lib/ecosystem-constants` path functions — and deliberately do NOT `vi.mock('os')` (the file's
   own comment explains why layer 2 is the reliable one). But `element-management-service.ts`
   resolves `const HOME = homedir()` at MODULE LOAD, so in those files `agentsRoot` is the
   **developer's real `~/agents`** while the fixture workdir is under a temp `FAKE_HOME/agents/` —
   `resolvedDir.startsWith(agentsRoot)` is false, and the whole branch is skipped.

   So the very containment that makes those hard-delete tests SAFE (no real `rm -rf`, no real
   record write) is what makes the branch **unreachable**: `rm -rf`, the transcript-dir purge, and
   G09b are all inside it, and no test has ever executed any of them. Adding `vi.mock('os')` to one
   of those existing files is NOT the fix — it would flip `agentsRoot` to the fake home and thereby
   ARM the real `rm -rf` for every existing hard-delete case in a ~1 400-line file at once.

   The fix is a **dedicated file** that mocks BOTH layers from the start, so the branch is armed
   only against a temp tree it owns: seed `FAKE_HOME/agents/<name>/`, seed the store with one local
   record for it plus a sibling and a user row, drive `DeleteAgent(hard)`, assert the folder is gone
   AND only that record went; then `DeleteAgent(soft)` and assert both the folder and the record
   survive. Neuter: move G09b out of the branch and confirm the soft case reddens.

   **Arming the `rm -rf` is safe BY CONSTRUCTION, and that is worth stating rather than trusting.**
   If either mock layer fails, `agentsRoot` stays the developer's real `~/agents` while
   `resolvedDir` is built from `FAKE_HOME` — `startsWith` is false and the branch is **skipped**. So
   a broken mock makes the test FAIL INERT (the fixture folder survives, the assertion reddens) and
   can never delete something real. The "folder is gone" assertion doubles as the containment proof:
   it can only pass if the fake root took effect.

   **Measured cost, so the next session scopes it right:** the two existing scaffolds carry **200
   and 460 lines of mock preamble** before their first `describe` (20 and 26 `vi.mock` calls), and
   the containment idiom is now hand-rolled in **9+ files**. Copying a third slab is the wrong
   move — the remaining work is really *a shared `driveDeleteAgent(ctx)` test helper* (the natural
   sibling of `tests/helpers/fake-ecosystem-home.ts`, which already owns layer 2) *plus* a thin
   file that uses it. Sized that way it also unblocks the pipeline tests TRDD-DQ6XN2VP will need,
   which is why it is worth building as a helper rather than inlined once.
2. The live create/hard-delete cycle.
3. The 93 pre-existing orphans — untracked data outside the repo on the USER's machine, so RULE 0
   holds it. This card IS the report; the ruling is not mine.

## Acceptance

- [x] A `DeleteAgent` gate removes the deleted agent's `installed_plugins.json` records — ~~G09b~~
      **G08c** (`services/element-management-service.ts:9510`), via the `claude` CLI
- [x] The gate registers a compensation — **RE-OPENED then RE-CLOSED on evidence, 2026-09-05.**
      The tick had been argued away (~~"resolved by placement instead"~~: G09b ran after the folder
      was gone, so the records were provably false and no compensation was meaningful). That
      placement no longer exists, so the argument was withdrawn and the box re-opened. Re-reading
      the replacement closes it on the original terms rather than the substituted ones: `G08c`
      **does** register a compensation — `undo: compensateG08c` at `:9603`, a CLI reinstall. The
      requirement this card wrote in the first place is met by the code as it now stands — and it
      is met BEHAVIOURALLY, not just structurally: the compensation's body was read (a per-key CLI
      re-install that throws rather than under-report), so this tick does not rest on a symbol
      merely existing, which was the error that put the box here
- [x] A soft delete provably does NOT remove them — DRIVEN, not merely true by construction.
      ⚠ The original wording cited a `G09b:` op line that is no longer emitted (the gate pushes
      `G08c:`, 6 sites). The behaviour survived the rename and gained a case: the current file
      drives **three** skip paths, not two — soft delete, hard-without-folder, and an ADOPTED
      workdir outside `~/agents/` whose folder `G09` refuses to delete
- [ ] Unit tests cover all three, each with a recorded neuter run — **UN-TICKED 2026-09-05: the
      coverage half holds, the neuter half does not.** ⚠ **the path this box cited,
      `tests/unit/deleteagent-g09b-plugin-records.test.ts`, DOES NOT EXIST**; it was renamed with
      the gate. GATE, re-measured 2026-09-05: **8 tests** in
      `tests/unit/deleteagent-g08c-plugin-uninstall.test.ts` over the shared harness
      `tests/helpers/drive-delete-agent.ts` (which does exist), including a rollback case
      ("FAILS the whole delete when the CLI refuses, and re-installs what it already took") that
      drives the compensation box 2 asked for, and a containment case asserting the developer's
      real `~/agents` and `installed_plugins.json` were never touched. PROBE: 7 tests / 3 neuters
      (`6c11bd7f`). **The neuter runs N1/N2 recorded in `34849d8d` were run against the DELETED
      file, so they pin nothing that exists today — no neuter has been recorded for these 8.**
      ⚠ Two honesty markers on this box's own numbers: **8 is a FLOOR, not a proven count**
      (`grep -c "^\s*it("` misses `it.each(`/`test(`/other indentation, though it correctly
      excludes `it.skip(`); and the `34849d8d` claim is **INFERRED from the rename, not read** —
      N1's recipe was "move G09b out of the folder-deleted branch", a shape that no longer exists,
      which is why un-ticking is the safe direction even if the inference is wrong
- [ ] Live: a create/hard-delete cycle leaves the local-record count unchanged — **THE SEQUENCING
      BLOCKER IS LIFTED as of 2026-07-31; the box is now READY TO RUN, and what it waits on is an
      operator, not a dependency.** Verified first-hand: TRDD-OWO449MR is `completed` (archived), so
      the A2 relocation has landed, and DeleteAgent is one of the pipelines DQ6XN2VP's STATE lists as
      ALREADY transactional — so both named changes are in. DQ6XN2VP itself is still `column: dev`
      with 13 hand-rolled pipelines to go, and that is NOT a blocker here: this box names the
      DeleteAgent retrofit, not the whole card. (Do not read the todo list for this — it recorded
      DQ6XN2VP as completed while the card said `dev`, and the card governs.)

      NOT RUN FROM THE MAIN CONTEXT, deliberately. It is a real create + hard delete on this host
      against a sudo-gated route, which makes it a UI-driven scenario run (the scenario rules put
      those in a forked runner, never in the orchestrator's context) and a destructive op on an
      untracked directory. Both of those are the operator's call to schedule, not something to
      improvise unattended at the tail of another card.

      The original sequencing note, kept because it is why the box was deferred at all — and note
      that it CALLED THIS CORRECTLY: the relocation it anticipates below has since LANDED (the gate
      is now `G08c`, before the folder delete), so the deferral was well-founded rather than
      cautious. What follows is that note as written, in its original future tense:
      G09b's placement is one of the gates
      that retrofit MOVES: TRDD-OWO449MR's shape A2 relocates the local-plugin cleanup to BEFORE the
      `rm -rf` (the `claude plugin uninstall --scope local --cwd` it replaces the hand-edit with
      needs the workdir to still exist), and DQ6XN2VP re-orders the whole pipeline around a commit
      point. A live cycle measured against today's ordering is invalidated by that change, so
      running it now buys a number that has to be thrown away — and, being a real create + hard
      delete on this host, it is not free to repeat.
- [x] The pre-existing 93 orphans are reported to the USER with a proposed reconcile — RULE 0.
      **Re-measured 2026-08-05 (read-only; nothing was touched).** Still exactly **93** of 101
      local-scope records, only **8** live — and the count being UNCHANGED over 7 days is itself the
      useful number: **the population is CLOSED, not growing**, so a one-time reconcile finishes the
      problem instead of being a treadmill. Newest orphan in either group predates the gate landing.

      **The reconcile is TWO different problems, which is why "delete the 93" would have been the
      wrong proposal:**

      | group | n | `projectPath` | cause | the gate covers it? |
      |---|---|---|---|---|
      | **A** | **77** | under `~/agents/` | deleted agent workdirs — this card's subject | **yes, going forward.** These are the historical backlog the gate was built to stop |
      | **B** | **16** | under `/private/tmp` (11 in Claude Code session **scratchpads**) | **never an agent workdir.** Something installed a plugin at local scope with `projectPath` set to an ephemeral per-session dir | **NO — and it never will.** No agent owns them, so no DeleteAgent gate can ever reach them |
      | **C** | 0 | elsewhere | — | — |

      Group A spans 2026-03-16 → 2026-07-29 over 21 distinct days; group B spans 2026-07-08 →
      2026-07-22 and is 65% `ai-maestro-plugin@ai-maestro-plugins`, the rest `dev-browser`.

      **Group B is a SEPARATE defect and is recorded here rather than filed as its own card,**
      because this card cannot close anyway (the live-cycle box is the operator's) and a 16-record
      cosmetic leak does not earn a card of its own on a board this size. What it wants, if anyone
      chases it: find who installs local-scope into `$CLAUDE_*/scratchpad` and give it `user` scope
      or no install at all.

      **PROPOSED RECONCILE — not executed. RULE 0: `~/.claude/plugins/installed_plugins.json` is the
      USER's global file, outside this repo and untracked, so it is not mine to edit.** For the
      USER: back the file up, then drop every `scope: local` record whose `projectPath` is absent
      from disk (all 93 qualify; the 8 live ones are untouched). It is a pure prune of dangling
      pointers — no plugin is uninstalled, no cache is touched, and a wrong entry costs at most a
      re-install. Verify after with the same read-only census that produced this table.
- [x] ai-maestro#102 answered with the measured topology and this defect
