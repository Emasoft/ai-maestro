---
trdd-id: F4UUM8RZ
title: stopAgentInvariantsWatchdog stops the schedule but not the sweep
scope: project
project-id: ai-maestro
column: dev
created: 2026-07-26T09:15:43+0200
updated: 2026-07-26T09:15:43+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-26T09:15:43+0200
relevant-rules: [R51]
blocked-by: []
npt: []
eht: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-26

Found while verifying TRDD-H4Y9F25J batch 2: the full suite failed once with
`ENOTEMPTY: directory not empty, rmdir '/var/folders/.../invariants-FR61MA'` in
`tests/unit/agent-invariants.test.ts`'s `afterEach`. The file passes 6/6 in isolation and only
fails under full-suite load, which is the signature of a race rather than a logic error.

The race is real and it is in PRODUCTION code, not in the test.

NEXT ACTION: make `stopAgentInvariantsWatchdog()` return a promise that resolves when the
in-flight sweep has finished, and have the sweep check a stop flag between agents.

## Problem

`lib/agent-invariants.ts:322` schedules the sweep as fire-and-forget:

```ts
watchdogTimer = setInterval(() => {
  void (async () => { /* keychain sweep, then per-agent enforceAgentInvariants */ })()
}, intervalMs)
```

and `stopAgentInvariantsWatchdog()` (`:355`) does only:

```ts
clearInterval(watchdogTimer); watchdogTimer = null
```

**So `stop()` stops the SCHEDULE, never the WORK.** A sweep already in flight when `stop()`
returns keeps running to completion — and `enforceAgentInvariants` is a *writer*: it re-creates
`.claude/`, rewrites the shipped `aimaestro-*.md` rules read-only, and seeds the managed
git-exclude block. The function's name and its docstring ("Stop the watchdog (tests, graceful
shutdown)") both promise something it does not deliver.

**Observed consequence today (a test):** `afterEach` calls `stop()` and immediately `rmSync`s the
temp workdir. Under load the last tick's sweep is still awaiting `enforceAgentInvariants`, so it
writes the rule file back while `rmSync` walks the tree — `ENOTEMPTY`.

**The consequence that matters (not yet reachable, deliberately stated as such):** grep shows the
ONLY caller of `stop()` is that test — production starts the watchdog at boot and never stops it,
and the timer is `unref`'d, so nothing hangs. That is why this surfaces as a flake rather than as
data loss. It is not a reason to leave it: the moment any real caller appears, the failure mode is
**a workdir that re-creates itself after deletion**, which is precisely the class of bug that
already cost this project a long hunt (a `PersistedSession` row outliving every `DeleteAgent` and
resurrecting agent workdirs, TRDD-KERM18NX).

And such a caller is imminent: `TRDD-DQ6XN2VP` is making `DeleteAgent` transactional. A correct
`DeleteAgent` must quiesce anything that writes into the workdir before removing it — and today
there is no primitive that lets it. A `stop()` that cannot be awaited is not a building block.

## Proposed fix

Small and contained, in `lib/agent-invariants.ts`:

1. Keep the in-flight sweep in a module-level `inFlightSweep: Promise<void> | null`, assigned by
   the interval callback and cleared when it settles.
2. Add a `stopping` flag checked between agents in the per-agent loop, so a stop takes effect
   promptly rather than after the whole fleet is swept.
3. Change `stopAgentInvariantsWatchdog()` to return `Promise<void>` resolving when the in-flight
   sweep has settled. Existing `void` call sites keep compiling; the ONE caller (the test) awaits
   it.

Deliberately NOT done: cancelling mid-`enforceAgentInvariants`. An invariant repair is itself a
small write sequence, and aborting halfway is exactly the partial state R51 exists to forbid. The
correct granularity is "finish the agent you are on, then stop" — which is what the between-agents
flag gives.

## Verification

- `tests/unit/agent-invariants.test.ts` `afterEach` awaits the stop; the file stays green in
  isolation AND the full suite stops producing the intermittent `ENOTEMPTY`.
- A new test proves the contract directly rather than relying on the flake disappearing: start the
  watchdog with a slow `listAgents`, call `stop()`, and assert that when the returned promise
  resolves no further write occurs (the workdir can be removed without `ENOTEMPTY`).
- `bash scripts/with-node.sh npx tsc --noEmit` clean; full suite green across repeated runs.

## Estimated risk

LOW. One module, one exported signature widened from `void` to `Promise<void>` with a single
caller. The behaviour change is strictly "stop now also means the work has stopped".

## Acceptance

- [ ] `stopAgentInvariantsWatchdog()` returns a promise that resolves only after the in-flight
      sweep has settled
- [ ] The sweep checks a stop flag between agents
- [ ] The test's `afterEach` awaits it
- [ ] A test pins the quiesce contract itself, not just the absence of the flake
- [ ] tsc clean; full suite green on repeated runs

## Approval log

- 2026-07-26T09:15:43+0200 — MANDATE (self, min-approval-requirement: none). Bugfix inside the
  project's own code, no governance surface touched; born approved.
