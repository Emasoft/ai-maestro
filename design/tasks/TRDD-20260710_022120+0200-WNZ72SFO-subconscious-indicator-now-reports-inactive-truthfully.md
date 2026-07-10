---
trdd-id: WNZ72SFO
title: The subconscious indicator now says Inactive for eight agents — decide what it should say
column: backburner
created: 2026-07-10T02:21:20+0200
updated: 2026-07-10T02:21:20+0200
current-owner: ai-maestro-session
assignee: null
priority: 2
severity: MEDIUM
effort: S
approval-tier: 0
mandate: true
mandated-by: self
derived: true
derived-kind: eht
task-type: bugfix
release-via: none
parent-trdd: TRDD-4Q7WMPZK
npt: [TRDD-QC8R79G5]
eht: []
blocked-by: [TRDD-QC8R79G5]
pre-block-column: backburner
supersedes: []
superseded-by: []
relevant-rules: []
labels: [subconscious, ui]
test-requirements: [unit]
audit-requirements: []
review-requirements: []
runtime-targets: [macos, linux]
impacts: []
attempts: 0
test-failures: 0
last-test-result: not-run
last-test-at: null
implementation-commits: []
external-refs: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-10

**This is an EHT — an Effects Handling Task.** It exists because `03159944`
(TRDD-4Q7WMPZK) changed an observable behavior, and a change that alters what a
user sees is not finished when its own tests go green. It is finished when the
hole it opened downstream is closed.

### The effect

`03159944` made `GET /api/agents/[id]/subconscious` a real read: it reports
`initialized: false` when the agent is not resident in the in-memory registry,
instead of constructing the agent (which made `initialized` unconditionally
`true`) on the way to answering.

`components/AgentSubconsciousIndicator.tsx` — mounted in `app/page.tsx:917` for
the viewed agent, polling every 30s — renders
`isRunning ? 'Running' : isWarmingUp ? 'Warming Up' : 'Inactive'`. A non-resident
agent now yields `isRunning: false` and `isWarmingUp` is hardcoded `false` in the
service, so **the badge reads "Inactive"**.

**That is the truth**, and per TRDD-QC8R79G5 it is the truth for **8 of the 18
registered agents** (LRU cap 10, startup loads 18). Before `03159944` the badge
read "Running" because polling it had just started the subconscious it was
reporting on. So this EHT is not a regression to undo — it is the bill for
telling the truth, and it must be paid deliberately rather than by reverting to
a comfortable lie.

### Why it is BLOCKED on TRDD-QC8R79G5

What the indicator *should* say depends on what the LRU cap is *for*. If the cap
decision keeps every registered agent resident, `isRunning` becomes true for all
of them and this EHT collapses to a one-line no-op. If the cap stays and eviction
is expected, the badge needs a third state that distinguishes "the subconscious
stopped because we evicted it" from "the subconscious is broken". Deciding the
badge first would be designing UI for a system whose semantics are undecided.

### NEXT ACTION (after QC8R79G5 resolves)

1. Decide the states. Candidate: `Running` / `Evicted (not resident)` / `Inactive`
   / `Warming up`.
2. **`isWarmingUp` is a hardcoded `false`** in `services/agents-subconscious-service.ts`
   and always has been — a second tautology of the same family as the
   `initialized: true` this EHT's parent removed. The registry already tracks
   `initializingAgents`; there is no accessor for it. If a warming state is kept,
   make it a fact (add the accessor) or delete the field and the two UI branches
   that render it. Do not leave a third field that cannot be false.
3. Verify the empty-state: a valid agent with no subconscious object returns
   `initialized: true, isRunning: false, status: null` — already covered by
   `tests/unit/subconscious-authorization.test.ts`.

### Falsification

A unit test on the indicator's state mapping: given `{initialized:false}` it must
not render "Running", and given whatever "evicted" shape is chosen it must not
render the same string as a genuinely broken subconscious. Today the component has
no test at all, which is why the tautology survived: nothing asserted that the
badge could ever say anything else.

### Load-bearing facts

- The badge reads `isRunning` and `isWarmingUp`. It does **not** read
  `initialized`, though the type declares it (`AgentSubconsciousIndicator.tsx:8`).
- `GET …/subconscious` is the only consumer of `getSubconsciousStatus` in the UI.
  `components/SubconsciousStatus.tsx` reads the *global* `/api/subconscious`
  (`services/config-service.ts`), a different function with the same name.

## Verified NON-effect, recorded so nobody re-derives it

`03159944` also made `getSkillSettings` / `saveSkillSettings` return a real 404
for an agent absent from the file registry (unknown **or soft-deleted**), where
they previously returned 200 because the dead null-check could not fire. This
looked like a second EHT. It is not: `skills/settings` has **zero consumers** —
no component, no hook, no script, no CLI wrapper. Grepped across
`components/ hooks/ app/ lib/ services/ scripts/`; the only references are the
route, the headless-router entry, and the service itself.

The endpoint is a dead API surface whose per-agent `skill-settings.json` nothing
reads back. Recorded, not acted on: deleting a route is a separate decision from
fixing a read path, and this TRDD is not the place to make it.

## Why this is Tier 0

Derived from an already-landed Tier-0 fix, local, reversible, no governance or
release surface. Authored directly per the DERIVED-TASK rule: a TRDD that changes
observable behavior must ship its EHTs, and the EHT is what makes the parent's
`complete` transition legitimate.
