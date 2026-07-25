---
trdd-id: KERM18NX
title: An all-in-one pipeline must never report success on a partial state
column: complete
scope: project
project-id: ai-maestro
created: 2026-07-25T23:45:05+0200
updated: 2026-07-25T23:45:05+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-25T23:45:05+0200
relevant-rules: []
implementation-commits: [bb746e64]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-25

USER mandate (2026-07-25): *"improve the api commands all-in-one. remember that if done correctly,
an all-in-one function NEVER leaves the system in an unstable or invalid state."*

Grounded in a live defect found the same day: `DeleteAgent` killed the tmux session but never
removed the agent's `PersistedSession` row. The row outlived the agent, the liveness path read
persisted-but-absent as a DEAD agent, and reviving it re-created the workdir — so a deleted agent
kept regrowing `<workdir>/.claude/rules/` no matter how many times it was removed by hand. Fixed as
gate **G05b** (commit `496355e5`). This TRDD addresses the SHAPE that let it hide, not that one bug.

**The measurement that defines the work:** `DeleteAgent` has 15 gates and **14 WARN-and-continue**
paths. Every store cleanup is wrapped in `try { … } catch { ops.push('Gxx: WARN …') }` and execution
proceeds. So a store can fail to be cleaned and the pipeline still returns success. G05b was worse
than a failing gate — it was an ABSENT one, and nothing in the design could notice a store nobody
had written a gate for.

NEXT ACTION: implement `lib/agent-teardown.ts` (the store manifest + `verifyAgentRemoved`) and wire
it as a terminal post-condition gate in `DeleteAgent`.

## Problem

"All-in-one" currently means *"one entry point that attempts everything"*. It must mean *"one entry
point that leaves a VALID state, or reports exactly why it could not"*. Three distinct gaps:

1. **The store set is implicit.** The stores an agent touches (registry, cemetery, team slots, tmux,
   persisted sessions, AMP keys, AID tokens, governance requests, transfers, groups, workdir,
   transcript dir) exist only as a sequence of hand-written gates. Nothing enumerates them, so
   nothing can notice one is missing — which is precisely how G05b stayed absent.
2. **Failure is silent.** 14 WARN-and-continue paths mean a partial teardown and a complete teardown
   produce the SAME success result. The caller cannot distinguish them, so nobody investigates.
3. **There is no post-condition.** `G08b` verifies the registry write landed — one store out of
   twelve. Nothing asks the question that actually matters: *does any store still claim this agent?*

## Proposed fix

**A. `lib/agent-teardown.ts` — the store manifest.** One exported array; each entry declares an
`id`, what it owns, and a `claims(ctx)` probe returning residue detail or `null`. The manifest is
the single place a new store is registered, and a test pins the manifest against the gate list so
adding a store without a gate (or a gate without a manifest row) fails loudly.

**B. `verifyAgentRemoved(ctx)`** — runs every probe and returns `{ clean, residue[] }`.

**C. A terminal post-condition gate in `DeleteAgent`** — run the verifier last. If residue exists,
the result carries `incomplete: true` plus the residue list. Success stops being assumable.

Deliberately NOT in this slice: rollback/compensation. A delete that half-succeeded cannot be undone
by re-creating an agent, and a fake rollback is worse than an honest report. The contract here is
**detect-and-report**, which is what turns an invisible partial state into a visible one. True
transactionality for the mutating pipelines (`ChangeTitle`, `ChangeClient`) is a separate TRDD.

## Verification

- Unit tests: a clean teardown verifies clean; a seeded residue in each store is detected; a probe
  that throws is reported as residue (fail-closed), never swallowed.
- A manifest/gate parity test.
- `bash scripts/with-node.sh npx tsc --noEmit` clean; `… yarn test` green.

## Estimated risk

LOW — additive. The verifier only reads; the new gate can only turn a silent partial success into a
reported one. No existing gate's behaviour changes.

## Acceptance

- [x] `lib/agent-teardown.ts` enumerates every store `DeleteAgent` touches, with a residue probe each
- [x] `DeleteAgent` runs the verifier as its terminal gate and reports `incomplete` + residue
- [x] A probe that throws counts as residue (fail-closed), never as clean
- [x] Manifest/gate parity is test-pinned, so a future store cannot be added without a gate
- [x] tsc clean, full suite green — 242 test files, 16 new teardown tests

## Approval log

- 2026-07-25T23:45:05+0200 — MANDATE issued by USER (min-approval-requirement: none). Born approved.
