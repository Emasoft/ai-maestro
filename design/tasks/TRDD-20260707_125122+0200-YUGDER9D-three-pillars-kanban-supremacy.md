---
trdd-id: YUGDER9D
title: 3-pillars kanban supremacy — all surfaces align to the ratified 17-column design
column: planned
created: 2026-07-07T12:51:22+0200
updated: 2026-07-07T12:51:22+0200
current-owner: claude-fable-session
assignee: claude-fable-session
priority: 1
severity: HIGH
effort: M
labels: [kanban, governance, three-pillars, alignment]
task-type: refactor
parent-trdd: null
npt: []
eht: []
supersedes: []
relevant-rules: []
release-via: none
delivery: direct-push
target-branch: governance-rules
merge-strategy: squash
must-pass-tests-before-merge: true
test-requirements: [lint]
review-requirements: []
runtime-targets: [macos]
impacts: []
implementation-commits: []
external-refs: []
---

# TRDD-YUGDER9D — 3-pillars kanban supremacy — all surfaces align to the ratified 17-column design

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-07

USER-ordered 2026-07-07 (verbatim): *"the github kanban, the ai-maestro ui, the scripts and
the orchestrator plugin, all must align to the 3-pillars kanban design, not the opposite."*
This TRDD is the durable record of that supremacy rule + the alignment work-list.

**NEXT ACTION:** run the conformance sweep over the `batch-backlog-20260707` proposal TRDDs
(K3/K4 below), then land the two authoring-surface guards (K5), then the CLAUDE.md §7 doc fix.

## The ruling design (cite this, never restate a divergent one)

The kanban is pillar 3 of the fleet's 3-pillars governance (PRRD rules · TRDD v2 tasks ·
kanban pipeline). The **TRDD `column:` state machine IS the universal kanban vocabulary**
for every project and every surface:

- **14 lifecycle columns:** backburner, todo, design, dispatch, dev, testing, ai_review,
  human_review, complete, publish, published, deploy, live, live_auditing
- **3 exception columns:** blocked (RED, orthogonal), failed, superseded
- = the **ratified 17-column vocabulary**, 1:1 with the server `TaskStatus` default
  (`types/task.ts` — ratified in the 2026-06-20 14-stage redeploy, ai-maestro#43).

**Alignment direction is one-way:** GitHub Projects mirrors, the ai-maestro kanban UI, the
`amp-kanban-*.sh` scripts, and the orchestrator role-plugin all conform TO this design.
No consumer may introduce its own column set, map the vocabulary down to a legacy model,
or propose changing the protocol to fit a consumer's constraints.

## Surface inventory (verified 2026-07-07 at HEAD f992865c)

| Surface | State | Action |
|---|---|---|
| Server `TaskStatus` + ratified default | ALIGNED — `types/task.ts:11` (string) + 17-column default incl. `live_auditing` (:45) | none |
| ai-maestro kanban UI | ALIGNED — `types/team.ts:51` 17-column config; `TaskKanbanBoard.tsx:409` derives icons from the 17-column config | none |
| `amp-kanban-*.sh` scripts (deployed) | ALIGNED — Jun-20 redeploy (create-task grew relationship flags + 17-column `--status`) | none |
| CLAUDE.md §7 "Team Meeting Architecture" | STALE — still documents "5 statuses: backlog → pending → in_progress → review → completed" | rewrite to the 17-column model |
| Orchestrator role-plugin (`Emasoft/ai-maestro-orchestrator-agent`) | UNVERIFIED — may still teach the old 5-status vocab | audit; if stale, file issue/PR per the cross-project rule (never edit its tree directly) |
| GitHub Projects kanban (sync/mirror features, incl. any newly proposed) | RULED — any implementation maps GitHub Project columns 1:1 onto the 17-column vocabulary | enforced via proposal sweep + authoring guards |
| `batch-backlog-20260707` proposal TRDDs (converted May/June scenario reports) | SUSPECT — May-era sources predate the Jun-20 redeploy; may propose 5-status or divergent GitHub-kanban implementations | K3 sweep + K4 alignment rewrite |

## Work items

1. **K3 — conformance sweep:** grep every `design/proposals/*batch-backlog-20260707*`-labeled
   TRDD (all waves, incl. the 17 fork-authored ones) for kanban / GitHub-Projects /
   status-vocab markers; read flagged files only.
2. **K4 — align conflicts:** flagged proposals that push a divergent column set or a parallel
   kanban implementation get their `## Proposed fix` rewritten into alignment form
   ("conform to TRDD-YUGDER9D's ruling design"), never the reverse. No refusals authored by
   the batch author — subsumed proposals become alignment proposals; the approver screens.
3. **K5 — durable authoring guards:** add the kanban-conformance clause to
   `tests/scenarios/SCENARIOS_TESTS_RULES.md` Rule 11 and
   `.claude/agents/scenario-runner.md` (proposal-authoring phase): kanban-touching
   suggestions are authored only as 17-column-conformant alignment proposals or skipped
   as superseded.
4. **CLAUDE.md §7 doc fix:** replace the stale 5-status description with the 17-column model.
5. **Orchestrator plugin audit:** grep the plugin's cached copy for the old vocab; if stale,
   file an issue on `Emasoft/ai-maestro-orchestrator-agent` (cross-project rule — no direct
   edits from this session).

## Why

Consumer-driven drift is the failure mode: each surface (GitHub Projects' default columns,
a UI's legacy 5-status board, a plugin's hardcoded status list) pulls the vocabulary toward
its own convenience, and the pillars stop being one system. A single ruling vocabulary keeps
`column:` greppable across TRDDs, server tasks, boards, and mirrors — one state machine,
many views.

## Approval log

- 2026-07-07T12:51:22+0200 — AUTHORIZED directly as `planned` (Tier-3 USER directive given
  verbatim in-session; recorded above).

## Notes and lessons learned
