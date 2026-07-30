---
trdd-id: OWO449MR
title: Shape A for installed_plugins.json needs DeleteAgent reordered, because a local CLI uninstall needs the folder
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
column: completed
created: 2026-07-30T12:59:10+0200
updated: 2026-07-30T21:58:42+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-30T12:59:10+0200
derived: true
derived-kind: npt
parent-trdd: 0GCIMQ9F
relevant-rules: [R50, R51, R21]
blocked-by: []
npt: []
eht: []
implementation-commits: [f1e4d7ec, 5861db3b]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30 20:35

**THE CODE IS DONE AND VERIFIED.** Shape A1 is implemented, tested, and both neuters ran. The card
is `blocked` rather than `complete` only because the work opened one hole — TRDD-RCL2HC9Y — and this
card cannot be honest about completion while that hole is open. Nothing further is owed here except
that sibling.

**RCL2HC9Y is a SIBLING, not a child, and the distinction is load-bearing.** This card is itself
`derived: true`, and the depth-1 rule forbids a derived TRDD from owning an `npt:`/`eht:` or from
being anyone's `parent-trdd:`. So the platelet is registered in the PARENT's (`0GCIMQ9F`) `eht:`,
and the ordering lives here in `blocked-by:` — exactly the shape the rule prescribes. I got this
wrong on the first write (registered it as my own EHT) and `trddgrep validate` caught it with two
ERRORs, `GRAPH-DEPTH1` and `GRAPH-PARENT-IS-DERIVED`, on my own board.

DONE (`f1e4d7ec` code, `5861db3b` gate test):
- All THREE hand-writers of `installed_plugins.json` are gone, not the one this card described.
  `removeLocalInstallRecords` → the read-only, fail-closed `listLocalInstallRecords`;
  `restoreLocalInstallRecords` deleted; `installPluginLocally`'s local-only tracking row deleted.
- `G09b` → **`G08c`**, inside the gate sequence, BEFORE `G09`'s folder delete, using the CLAUDE
  adapter with a CLI-reinstall compensation.
- Both allowlist entries left `ALLOWED_OUT_OF_ROOT_WRITES`; the UNRATIFIED-inventory test is now a
  RATCHET on the empty set, plus a new guard that no `INSTALLED_FILE` write survives anywhere.
- `uninstallPluginLocally`'s CLI call is now serialized on `INSTALLED_FILE` like the install side.

**TWO THINGS A READER SHOULD NOT MISTAKE FOR DONE:**

1. **The argv is asserted at the ADAPTER boundary, not literally.** The card asked for a test
   proving `--scope local --cwd <workdir>`; the test drives a fake adapter and asserts
   `targetDir === <workdir>` and `scope === 'local'`. The mapping from those to that argv is
   `lib/client-plugin-adapters/claude-adapter.ts`'s own contract, not something this test observes.
2. **Pre-existing orphan rows are now UNCLEANABLE by us, and that is the correct outcome.** A row
   the CLI does not believe in (the six hand-forged local-marketplace rows measured on this host)
   cannot be retracted by `claude plugin uninstall`, and we have renounced hand-editing. G10 will
   report them honestly as residue. Removing them is the USER's call, and it is the same question
   already owed on TRDD-AQTGAY60 (the 93 orphans) — not a new debt this card created.

## Historical — the decision, kept because the reasoning is the record

This was the ONE piece of TRDD-0GCIMQ9F's Shape-A ruling that could not be executed as a
find-and-replace, and the reason was a real ordering constraint, not reluctance.

**Shape A1 was chosen** (D2, commit `869e23be`), NOT the A2 recommended below: A2's "place it last
so no undo is needed" holds only while it really is last, and under the corrected ordering it is
not — the folder delete follows it and can fail.

**The hazard the reorder nearly shipped**, caught in review and verified first-hand: G09b was nested
inside `hard && deleteFolder` AND inside G09's `startsWith(agentsRoot)` check. Lifting it out of
that branch without carrying BOTH guards would strip the plugins of an adopted `~/Code/<project>`
workdir that G09 then correctly refuses to delete. Both conditions moved with the gate, and a test
now pins the adopted case.

**A design bug the test forced out:** G08c is the LAST gate, so the runner can never reach its undo
from a later-gate failure — yet D2 required compensation precisely because G09 can fail, and G09
runs after the sequence commits. The compensator is now a named function with two callers.

## Problem

Shape A says: **`installed_plugins.json` is the `claude plugin` CLI's file; ask the owner, never
hand-edit.** Two allowlisted out-of-root writes implement the hand-edit today, both in
`services/element-management-service.ts`:

| allowlist key | what it does |
|---|---|
| `… :: saveJsonSafe :: INSTALLED_FILE` | `removeLocalInstallRecords()` rewrites the file to drop local records rooted at a workdir |
| `… :: mkdir :: CLAUDE_DIR` | creates `~/.claude/plugins/` for the write above |

**The CLI cannot be dropped in where the hand-edit sits.** Local-scope uninstall is
`claude plugin uninstall <key> --scope local --cwd <dir>` (`lib/client-plugin-adapters/claude-adapter.ts:104-108`)
— it needs the directory to EXIST. And DeleteAgent's G09b runs **after** the workdir is deleted, on
purpose; its own comment says why:

> Placed AFTER the folder is gone deliberately: at this point the records are false, so removing them
> cannot be wrong and needs no compensation.

That sentence is the whole difficulty. The current ordering buys **irreversibility for free**: a
false record cannot be wrongly removed, so the gate needs no `undo` (R51). Moving the uninstall
BEFORE the delete makes it a mutation of a LIVE agent, which R51 then requires to be compensated —
and under Shape A the compensation cannot be `restoreLocalInstallRecords()`, because writing the
records back by hand is the very thing being removed.

## The three shapes, and what each costs

**A1 — reorder: CLI-uninstall before the folder delete, compensate by CLI-reinstall.** Honest and
symmetric. Cost: a real `undo` that shells out to `claude plugin install` for each key removed, and
a failure mode where the compensation itself fails, leaving an agent whose folder survives with its
plugins uninstalled. Note the R17 wake invariant already self-heals exactly that state for the CORE
plugin (`core-plugin` in `lib/agent-invariants.ts`), so the residual exposure is non-core local
plugins only.

**A2 — reorder, and accept irreversibility by placing the uninstall last among mutating gates.**
No `undo`; instead the gate cannot be reached until every gate that could still fail has passed.
Cheaper, and it needs the ordering argument written down rather than assumed — which is what
TRDD-DQ6XN2VP's `runAioPipeline` retrofit exists to make checkable.

**A3 — do nothing at delete time; let the owner's own pruning handle it.** Rejected on evidence, not
on taste: measured 2026-07-29, **93 of 101** local records on this host pointed at deleted agents,
65 of them written by our own R17 invariant. The janitor reads this file to derive fleet plugin
topology and reached a wrong conclusion from four of those ghosts (ai-maestro#102), and
janitor#137's `cache_prune` decides which cached versions are still in use from the same rows. So
"stale records are harmless bookkeeping" is already falsified.

Recommendation: **A2, taken together with TRDD-DQ6XN2VP's DeleteAgent retrofit**, since that work is
already going to re-express these gates with explicit compensation and ordering. Doing A2 first, by
hand, means editing the same 500 lines twice.

## Verification

- The two allowlist entries leave `ALLOWED_OUT_OF_ROOT_WRITES` (they are the only two still marked
  UNRATIFIED), and `tests/unit/write-boundary.test.ts`'s UNRATIFIED-inventory test is updated to an
  empty set — that test is the ratchet that makes this card's completion visible.
- A test drives DeleteAgent with a fake adapter and asserts the CLI uninstall was invoked with
  `--scope local --cwd <workdir>` while the workdir still EXISTS. Proven by a neuter: move the call
  back after the delete → the assertion reds.
- `tests/unit/agent-teardown.test.ts`'s `plugin-records` probe must still find zero records after a
  hard delete — it is the post-condition that proves the new path does the same job as the old one.

## Estimated risk

HIGH — not because the change is large, but because DeleteAgent is irreversible by nature and the
current ordering is what makes one of its gates safe. A wrong reorder uninstalls plugins from an
agent that then survives.

## Approval log

- 2026-07-30T12:59:10+0200 — MANDATE (self, min-approval-requirement: none). Split out of
  TRDD-0GCIMQ9F rather than improvised inside it: the parent's other Shape-A items were removals,
  this one is a pipeline reorder with a compensation question, and folding it in would have hidden a
  HIGH-risk design decision inside a card whose other changes were deletions.
- 2026-07-30T21:58:42+0200 — UNBLOCKED then COMPLETED by ai-maestro. The sibling this card was
  waiting on, `TRDD-RCL2HC9Y`, reached `completed` (`c0ebd710`, `6396ace2`), so `blocked-by` is
  empty and the STATE block's one stated condition — *"nothing further is owed here except that
  sibling"* — is satisfied. This card's own code was already done and verified at f1e4d7ec /
  5861db3b; nothing in it changed on the way out.

  Worth recording for the sibling ordering, because it worked: RCL2HC9Y found that
  `claudeAdapter`'s `--cwd` failed OPEN, which means **this card's G08c gate had been a silent
  no-op from the moment it shipped**. The `blocked-by` edge is what made that discoverable — had
  this card been marked `complete` when its tests went green, the hole would have been recorded as
  closed while the gate did nothing.
