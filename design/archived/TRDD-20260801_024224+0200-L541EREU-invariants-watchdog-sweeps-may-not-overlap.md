---
trdd-id: L541EREU
title: the invariants watchdog may not run two sweeps at once
column: completed
scope: project
project-id: ai-maestro
created: 2026-08-01T02:42:24+0200
updated: 2026-08-01T02:46:28+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-01T02:42:24+0200
relevant-rules: [R51]
npt: []
eht: []
blocked-by: []
implementation-commits: [aca5af67]
---

## ⏵ STATE — READ THIS FIRST ON RESUME

`startAgentInvariantsWatchdog` (`lib/agent-invariants.ts`) uses a bare `setInterval` with **no
re-entrancy guard**. When a sweep takes longer than the interval, the next tick fires anyway and
two sweeps run concurrently. Three consequences, all verified by reading the code:

1. **The repair opens the tamper window it exists to close.** `ensureAgentRules` compares bytes and,
   when they differ, calls `writeProtected`, whose FIRST act is `chmod(destPath, 0o644)` — it must
   make the file writable to overwrite its own 0444 protection. `writeFile` is not atomic, so a
   concurrent sweep can read a PARTIALLY-written rule file, conclude "bytes differ", and chmod it
   writable. A DEP rule is transiently 0o644 **because** the watchdog is repairing it.
2. **`stop()` can lie.** `void inFlightSweep.finally(() => { inFlightSweep = null })` nulls the
   SHARED variable unconditionally, so when sweep A finishes it clears sweep **B**'s handle.
   `stopAgentInvariantsWatchdog()` then returns `Promise.resolve()` while B is still writing —
   precisely the bug TRDD-F4UUM8RZ was written to prevent, surviving in the overlap case.
3. Overlapping sweeps duplicate every write for no benefit.

## How it was found

`tests/unit/agent-invariants.test.ts` fails under full-suite load with **`expected 420 to be 292`**
— decimal for **`0o644` vs `0o444`**, i.e. consequence 1 caught in the act. It passes in isolation,
which is exactly the signature of a concurrency defect, and the flake was being carried as
"pillar-graph-cli timeouts under load" because the three failing files were read as one known flake
rather than named individually.

Note the file's OTHER test ("stop() resolves only once the in-flight sweep has finished writing")
runs a **40-agent fleet at a 10ms interval** — a sweep over 40 workdirs is far longer than 10ms, so
that test is itself generating the overlap, and its assertion is the one consequence 2 breaks.

## Plan

One guard closes all three:

```ts
if (inFlightSweep !== null) return          // a sweep is still running — skip this tick
const sweep = (async () => { … })()
inFlightSweep = sweep
void sweep.finally(() => { if (inFlightSweep === sweep) inFlightSweep = null })
```

Skipping is correct, not lossy: the sweep is idempotent enforcement, so a tick that finds one
already running has nothing of its own to add. The identity check on `.finally` is defence in depth
— with the guard there is never a second sweep to clobber, and it costs one comparison to make that
independent of the guard staying correct.

**NOT changing `writeProtected` to an atomic tmp+rename.** It would also close the torn-read half,
but the torn read requires a concurrent reader, which the guard removes — and the mode dance
(`chmod 0644` → write → `chmod 0444`) exists because `writeFile`'s `mode` applies only at CREATE.
An atomic rewrite is a real improvement and a separate, larger change; do it only if a
second reader appears (a second server process would need it, and that is a singleton concern).

## Verification

- A test that pins the guard: fleet of 40 at a 1ms interval, count sweep STARTS via the
  `listAgents` supplier (it is called exactly once per sweep). Without the guard, starts scale with
  elapsed/interval (hundreds); with it, starts are bounded by sweeps COMPLETED (single digits).
- **Non-vacuity is mandatory**: assert starts > 1, or "few starts" is equally satisfied by a
  watchdog that never ran.
- **The neuter is the guard line**: delete `if (inFlightSweep !== null) return` and the start count
  must explode. A test asserting only "the rules got seeded" would pass either way.
- `bash scripts/with-node.sh npx tsc --noEmit` = 0 lines; the full suite green — specifically
  `tests/unit/agent-invariants.test.ts` must stop failing under full-suite load.

## Estimated risk

**LOW.** Three lines in one function. The behaviour change is confined to the case that is
currently a defect (a tick arriving while a sweep runs); in the normal case — a 5-minute production
interval and a sweep of milliseconds — nothing changes at all.

## Acceptance

- [x] the watchdog skips a tick while a sweep is in flight
- [x] `inFlightSweep` is cleared only by the sweep that set it
- [x] a test pins the guard, with an explicit non-vacuity assertion
- [x] neuter recorded by name; tsc 0 lines; the full suite green, agent-invariants included

## Outcome

**Test** — `tests/unit/agent-invariants.test.ts` :: *"never runs two sweeps at once — a tick
arriving mid-sweep is SKIPPED"* (the file is now 16/16).

**Neuter** — delete `if (inFlightSweep !== null) return`; that one test reds with
`ticks joined an in-flight sweep — the re-entrancy guard is gone: expected 96 to be less than 50`.
96 starts vs a guarded handful is a ~2x margin against the assertion and ~30x against the
unguarded tick count, so the direction is unmissable.

**Full suite: 324 files / 4598 passed / 2 skipped, exit 0** — up from 322/4587/2 with three files
failing. The three were being carried as one "pillar-graph-cli timeouts under load" flake; two were
genuine 5s timeouts and the third was this defect. Naming each failing file individually is what
separated them.

⚠ **A process note worth more than the fix.** While neutering, `git checkout --
lib/agent-invariants.ts` discarded the guard ALONG WITH the neuter, because the guard was still
uncommitted. Commit the work BEFORE neutering it, or revert the neuter with a targeted edit — a
`checkout --` cannot tell your fix from your sabotage.

## Approval log

- 2026-08-01T02:42:24+0200 — SELF-MANDATE (min-approval-requirement: none). Tier 0: a bugfix inside
  this agent's own assignment scope, reversible and local. Pre-approved: issuer authority >=
  required approver.
- 2026-08-01T02:46:28+0200 — COMPLETED by ai-maestro. 4/4 acceptance boxes; the neuter reds exactly
  one named test; tsc 0 lines; full suite 324 files / 4598 passed / 2 skipped, exit 0 (three files
  were failing before). Landed in aca5af67.
