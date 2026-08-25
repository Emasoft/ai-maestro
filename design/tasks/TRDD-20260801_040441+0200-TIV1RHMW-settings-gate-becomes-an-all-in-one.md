---
trdd-id: TIV1RHMW
title: convert the settings-gate API into a true all-in-one function
column: design
scope: project
project-id: ai-maestro
created: 2026-08-01T04:04:41+0200
updated: 2026-08-25T17:28:11+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: refactor
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-08-01T04:04:41+0200
relevant-rules: [R50, R51]
npt: [RYFP030K]
eht: []
blocked-by: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME

**DEFERRED ON PURPOSE by the USER (2026-08-01).** The settings-gate endpoint built in
TRDD-RYFP030K is a **gate**, not yet an R50/R51 all-in-one. Converting it is this card, and it is
NOT started.

**`column: blocked`, not `backburner` — corrected 2026-08-01T04:24.** It was filed as `backburner`
while carrying `blocked-by: [RYFP030K]`, which violates the rule that a non-empty `blocked-by`
means `column: blocked` (IND `trdd-design-tasks.md` §6; DEP overlay §D4 step 5b). Both corpus
linters caught it independently on the next full-suite run — `trdd-corpus-invariants` as
`blockedNotBlocked` and `trdd-doctor` as `GRAPH-BLOCKED-NOT-BLOCKED`. The USER's deferral is
recorded in `pre-block-column: backburner`, which is where this returns when RYFP030K closes; the
deferral and the blockage are two separate facts and the frontmatter now carries both instead of
collapsing them into one.

## Why it was deferred rather than built with the gate

The USER's reasoning, recorded verbatim in intent: a true AIO here means the function OWNS every
outcome of a settings mutation — and *"you need to know the consequences of changing ALL the
settings of claude code to do this, it may take a while."*

That is the real cost, and it is not code volume. An AIO's gates must each know what their field
means and what its blast radius is: `enabledPlugins` (a wrong write disables a plugin fleet-wide),
`permissions` (a wrong write grants or revokes tool access), `hooks` (a wrong write can execute
arbitrary commands on every tool call), `env`, `model`, `statusLine`, `mcpServers`,
`extraKnownMarketplaces`. Each needs its own gate + compensation, and several are irreversible in
effect even when reversible on disk (a hook that already fired, a plugin that already ran).

Building that blind — a generic "AIO" that treats every key the same — would be an AIO in shape and
not in substance: gate names with no gate knowledge, and an R51.5 CRITICAL verdict nobody can act
on. Deferring is the correct call, and it is the USER's.

## Prerequisite

**NPT: TRDD-RYFP030K** — the unified gate must exist and be the sole writer first. There is nothing
to convert until every writer is funnelled through one place.

## What this card must do when it runs

1. **Enumerate the Claude Code settings surface** and, per key, record: blast radius, whether a
   wrong write is detectable, and whether its EFFECT is reversible (not merely its bytes).
2. Give each a gate + compensation in the `runGateSequence` sense, per R51 — registered write-ahead,
   unwound LIFO.
3. Decide the honest verdict vocabulary. Note the trap already learned on TRDD-RO90UCKQ: a
   read-back verdict folded into `success` makes a correct COMPENSATION report
   "THE SYSTEM IS IN AN INVALID STATE". The gate reports; the caller decides.
4. Respect the ceiling RYFP030K documents — the `claude` CLI is a non-participating writer, so no
   AIO here can claim totality either.

## Estimated risk

**HIGH**, and that is why it is deferred. It touches the file that governs every agent's tool
permissions and hooks on the machine.

## Acceptance

- [ ] the per-key blast-radius/reversibility inventory exists and is reviewed
- [ ] gates + compensations per R51, registered write-ahead, unwound LIFO
- [ ] the verdict is reported, never folded into `success` (RO90UCKQ's lesson)
- [ ] tests + neuters recorded by name

## Approval log

- 2026-08-01T04:04:41+0200 — USER MANDATE to DEFER. The USER directed that the all-in-one conversion
  be a separate TRDD for the future, and that the immediate priority is ai-maestro's compliance with
  the governance rules and specs. Authority: USER >= any required approver.
