---
trdd-id: AQTGAY60
title: DeleteAgent leaves the agent's local plugin records behind in installed_plugins.json
column: dev
scope: project
created: 2026-07-29T21:30:09+0200
updated: 2026-07-30T05:43:47+0200
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
terminal, G09b exists, and the only open work is a test that drives `DeleteAgent` itself. The
paragraph below is kept because it records WHY the block existed.

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

**What is actually in the tree** (read, not inferred):

| piece | where |
|---|---|
| the gate | `DeleteAgent` **G09b**, inside the hard-delete-with-folder branch, right after the workdir is removed. Calls `removeLocalInstallRecords(resolvedDir)` and pushes a counted ops line |
| the post-condition probe | `lib/agent-teardown.ts` store id `plugin-records` — the thing that can PROVE the gate ran |
| the manifest pin | `AGENT_STORES` includes `plugin-records`, and `tests/unit/agent-teardown.test.ts` pins the id list, so adding a store without a probe now breaks a test |
| the probe's tests | 7 cases + 3 recorded neuter runs (commit `6c11bd7f`) |

**Box 2's premise was wrong, and the code is right.** The box asks for a compensation. G09b
deliberately has none, and says why: it runs **after** the folder is gone, at which point every
`{scope:'local', projectPath: resolvedDir}` record asserts a plugin is installed for a directory
that does not exist — the record is provably FALSE, so removing it cannot be the wrong call and
there is nothing a rollback would restore that anyone should want back. That is a better answer
than the box asked for; the box is rewritten below rather than ticked.

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

- [x] A `DeleteAgent` gate removes the deleted agent's `installed_plugins.json` records — G09b
- [x] ~~The gate registers a compensation~~ → **resolved by placement instead**: G09b runs after the
      folder is gone, so the records are provably false and no compensation is meaningful
- [x] A soft delete provably does NOT remove them — now DRIVEN, not merely true by construction:
      two cases (soft, and hard-without-folder) assert the workdir AND its records survive and that
      no `G09b:` op line was emitted. Neuter N1 (move the gate out of the branch) reddens exactly
      those two
- [x] Unit tests cover all three, each with a recorded neuter run — GATE: 6 tests in
      `tests/unit/deleteagent-g09b-plugin-records.test.ts` over the shared harness
      `tests/helpers/drive-delete-agent.ts`, with the complementary neuters N1/N2 recorded in
      `34849d8d`; PROBE: 7 tests / 3 neuters (`6c11bd7f`)
- [ ] Live: a create/hard-delete cycle leaves the local-record count unchanged
- [ ] The pre-existing 93 orphans are reported to the USER with a proposed reconcile — RULE 0
- [x] ai-maestro#102 answered with the measured topology and this defect
