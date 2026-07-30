---
trdd-id: OWO449MR
title: Shape A for installed_plugins.json needs DeleteAgent reordered, because a local CLI uninstall needs the folder
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
column: todo
created: 2026-07-30T12:59:10+0200
updated: 2026-07-30T12:59:10+0200
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
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-30

This is the ONE piece of TRDD-0GCIMQ9F's Shape-A ruling that could not be executed as a
find-and-replace, and the reason is a real ordering constraint, not reluctance.

NEXT ACTION: decide between the three shapes below. Do NOT start editing DeleteAgent before that
decision — it is the highest-blast-radius pipeline in the system and its current ordering is
deliberate and commented.

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
