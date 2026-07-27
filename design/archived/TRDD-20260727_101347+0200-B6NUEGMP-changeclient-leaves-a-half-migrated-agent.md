---
trdd-id: B6NUEGMP
title: ChangeClient leaves a half-migrated agent when any install fails
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-27T10:13:47+0200
updated: 2026-07-27T10:13:47+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
severity: high
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-27T10:13:47+0200
relevant-rules: [R50, R51, R18]
blocked-by: []
npt: []
eht: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-27

USER ruling 2026-07-27: *"every api function not relative to just dom rendering or low level
networking and i/o must be a all-in-one function. this means that it must leave the system in a
VALID state no matter what happens. I noticed many functions you just edited that can potentially
leave the system in an invalid state!"*

`ChangeClient` (`services/element-management-service.ts:5517-5908`) is the concrete instance found
while writing TRDD-H4Y9F25J batch 6. It is a **mutating pipeline with ZERO compensations**.

**HOW IT BREAKS, exactly.** G06 builds a conversion plan for every plugin and — correctly — aborts
before touching anything if any plugin cannot be resolved (that part is right, and is pinned by
R18.1's test). After that point there is no protection at all:

| step | what it mutates | what happens on failure |
|---|---|---|
| **G07** (:5729-5794) | uninstalls EVERY old-client plugin from the agent dir | per-plugin failure is swallowed into `console.warn` and the loop CONTINUES — a partial uninstall proceeds as though it succeeded |
| **G08** (:5810-5842) | installs each converted plugin, one at a time | **a throw on plugin `k` returns immediately** — old plugins already gone, `1..k-1` installed, `k..n` missing, nothing undone |
| **G08b** (:5848-5877) | Claude settings write-back | catch-and-warn |
| **G09** (:5882) | writes `program` to the registry | on failure the DIRECTORY is migrated but the REGISTRY still says the old client — the two disagree permanently |

The G08 case is the worst because it is the *likely* one: `newAdapter.install` shells out to a
client CLI, so a transient PATH/network/permission problem is enough. The agent is then left with
**neither** its old plugin set **nor** its new one — precisely the state R18.1 exists to prevent,
reached by a different door.

**Why nothing caught it.** R51.4 requires every mutating gate to declare its compensation; nothing
enforces that requirement mechanically, and `ChangeClient` declares none. It also does not use
`lib/gate-transaction.ts`, which `design/specs/all-in-one-spec.md::AIO-TXN-10` REQUIRES and which
has reverse-order compensation built in — the same finding as TRDD-DQ6XN2VP (the runner has zero
production callers while ~26 pipelines hand-roll their gates).

**Why the tests did not catch it, which is the lesson worth keeping.** Batch 6 wrote 15 tests
against this exact function and pinned the abort-BEFORE-uninstall path only. One of them —
*"does not write to the registry at all when the pipeline aborts"* — is TRUE for an early abort and
SILENT about a G08 failure, where the registry is indeed untouched but the filesystem is already
half-migrated. **A suite that pins the safe path and says nothing about the unsafe one reads as
coverage.** The campaign's own rule ("a guard that looks wrong is REPORTED, not fixed") was applied
to citation defects and not to the invalid-state defect in the same function.

NEXT ACTION: **write the failing test FIRST** — force `newAdapter.install` to throw on the 3rd of 5
plugins and assert the agent directory is left as it was before the call. It must FAIL against HEAD;
that failing test is the specification. Then fix, by retrofitting `ChangeClient` onto
`lib/gate-transaction.ts::runAioPipeline` with a compensation for G07 (reinstall the old-client
plugins) and G08 (uninstall what this run installed). Reuse TRDD-DQ6XN2VP's machinery rather than
hand-rolling a second rollback.

## Ordering against TRDD-DQ6XN2VP

DQ6XN2VP designates `DeleteAgent` as the first retrofit target. This TRDD does **not** jump that
queue — it records a specific, high-severity instance so the retrofit has a second named target with
a concrete acceptance test, and so the defect is not lost if the retrofit slips. If DQ6XN2VP starts
first, fold this in as its second target and mark this superseded.

## Acceptance

- [ ] A test forces a mid-G08 install failure and asserts the agent directory is UNCHANGED
- [ ] That test FAILS against HEAD before any fix lands (red-then-green; a test written after the
      fix proves nothing)
- [ ] G07 and G08 declare compensations; a partial uninstall no longer proceeds silently
- [ ] The registry write and the filesystem migration cannot disagree
- [ ] `ChangeClient` goes through `runAioPipeline` (AIO-TXN-10), not a hand-rolled gate chain
- [ ] The 15 existing R18 tests still pass — the SUCCESS path must not move
- [ ] `bash scripts/with-node.sh npx tsc --noEmit` clean; governance suite green

## Approval log

- 2026-07-27T10:13:47+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: the USER named the defect class directly. No approval request was sent.
