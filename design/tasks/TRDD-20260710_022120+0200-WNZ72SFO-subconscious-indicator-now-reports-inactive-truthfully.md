---
trdd-id: WNZ72SFO
title: The subconscious indicator now says Inactive for eight agents — decide what it should say
column: backburner
created: 2026-07-10T02:21:20+0200
updated: 2026-07-10T03:47:45+0200
current-owner: ai-maestro-session
assignee: null
priority: 2
severity: MEDIUM
effort: S
min-approval-requirement: none
mandate: true
mandated-by: self
derived: true
derived-kind: eht
task-type: bugfix
release-via: none
parent-trdd: TRDD-SCLSRS6E
npt: []
eht: []
blocked-by: []
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

**UNBLOCKED 2026-07-10T03:47 — QC8R79G5 is `complete` (`1dea8431`), and it
answered this TRDD's question by dissolving it.** The registry no longer evicts,
so every registered agent stays resident and `isRunning` is true for all 18. The
"Inactive for 8 of 18" problem this EHT was opened to handle **does not exist
any more**. No new badge state is needed: there is nothing left for an
`Evicted (not resident)` state to describe.

**What survives is smaller, and it is the tautology, not the badge.**
`isWarmingUp` is a hardcoded `false` (`agents-subconscious-service.ts:67`) and
always has been, while `AgentSubconsciousIndicator.tsx:85,93` branches on it. So
the UI carries a colour and a label the user can never see. Post-RAG,
`initialize()` opens no database; the `initializingAgents` window is now
sub-millisecond, and the indicator polls every 30 s — so "warming up" is not a
state that was merely unwired, it is a state that has become **unobservable**.
Wiring it would be building UI for an event nobody can witness.

**NEXT ACTION — narrowed:** delete `isWarmingUp` and the two branches that render
it, and give the indicator the test it never had (a component with no test is how
`initialized: true` and `isWarmingUp: false` both survived as tautologies for so
long). `Running` / `Inactive` is the whole state space, and both values are now
reachable.

`Inactive` remains reachable, truthfully, for an agent that is not resident —
which after `1dea8431` means an agent **created after boot**, since nothing
outside `initializeAllAgents` ever constructs one. That gap is real and is
recorded on QC8R79G5 as its own future work; it is not this EHT's to close.

---

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

**That is the truth.** Before `03159944` the badge read "Running" because polling
it had just started the subconscious it was reporting on. So this EHT is not a
regression to undo — it is the bill for telling the truth, and it must be paid
deliberately rather than by reverting to a comfortable lie.

*(Superseded: this paragraph used to add "and it is the truth for 8 of the 18
registered agents (LRU cap 10, startup loads 18)". True when written; false since
`1dea8431` deleted the cap. All 18 are resident. Do not carry that number
forward.)*

### Correction 2026-07-10T02:49 — the sibling edge was in the wrong field

This TRDD carried `npt: [TRDD-QC8R79G5]`. That was wrong, and the depth-1 rule the
USER stated today is what caught it. `npt:`/`eht:` are **derivation** edges — they
declare parenthood — so listing QC8R79G5 there claimed this TRDD had spawned it,
giving QC8R79G5 two parents and creating exactly the depth a derived TRDD may not
have.

QC8R79G5 is a **sibling**, not a child. The dependency is a runtime one and lives
in `blocked-by:` alone, which is where it already was. `npt:` is now `[]`, as a
derived TRDD's `npt:`/`eht:` always must be.

The same rule re-parented both of us. `03159944` landed under TRDD-4Q7WMPZK, but
4Q7WMPZK is itself derived, so it cannot be our parent. We are now siblings of it
in the flock of the nearest non-derived ancestor, **TRDD-SCLSRS6E**. The causal
lineage — this TRDD is an effect of 4Q7WMPZK's fix — is recorded here in prose,
which is where a flat graph puts it.

### Why it WAS blocked on TRDD-QC8R79G5 (resolved)

What the indicator *should* say depended on what the LRU cap was *for*. Written
2026-07-10T02:21, before that decision: *"If the cap decision keeps every
registered agent resident, `isRunning` becomes true for all of them and this EHT
collapses to a one-line no-op."* That is what happened — the cap was deleted, not
tuned — so the third state (`Evicted (not resident)`) is never authored. Deciding
the badge first would have been designing UI for a system whose semantics were
undecided, and it would have shipped a state that now describes nothing.

### Remaining work

1. **States: `Running` / `Inactive`.** Both reachable, both true. No third state.
2. **Delete `isWarmingUp`** — the field in `services/agents-subconscious-service.ts`
   and the two branches in `AgentSubconsciousIndicator.tsx` that render it. It is
   a tautology of the same family as the `initialized: true` this EHT's parent
   removed. It is worse than unwired: post-RAG the `initializingAgents` window is
   sub-millisecond and the poll is 30 s, so no user can ever observe it. A field
   that cannot be false and a state that cannot be seen both go.
3. Verify the empty-state: a valid agent with no subconscious object returns
   `initialized: true, isRunning: false, status: null` — already covered by
   `tests/unit/subconscious-authorization.test.ts`.

### Falsification

A unit test on the indicator's state mapping: given `{isRunning:false}` it must
not render "Running", and given `{isRunning:true}` it must not render "Inactive".
Today the component has no test at all, which is exactly why the tautology
survived: nothing ever asserted that the badge could say anything else.

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
