---
trdd-id: QC8R79G5
title: The in-memory agent LRU cap of 10 evicts live agents during startup
column: complete
created: 2026-07-10T02:11:00+0200
updated: 2026-07-10T03:47:45+0200
created-by: ai-maestro-session
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 2
severity: MEDIUM
effort: S
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-session
approval-datetime: 2026-07-10T02:11:00+0200
derived: true
derived-kind: eht
task-type: bugfix
release-via: none
parent-trdd: TRDD-SCLSRS6E
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
labels: [agent-registry, subconscious, capacity]
test-requirements: [unit]
audit-requirements: []
review-requirements: []
runtime-targets: [macos, linux]
impacts: []
attempts: 1
test-failures: 0
last-test-result: pass
last-test-at: 2026-07-10T03:46:00+0200
implementation-commits: [1dea8431]
external-refs: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-10

**DONE — `1dea8431`. The eviction is deleted. The registry has no cap.**
`column: complete`, tests pass, nothing is left open here.

**The decision was none of the three options this TRDD proposed.** The question
"what should the cap mean" has no good answer because the premise is false: an
`AgentRegistry` is not a cache. Exactly ONE call site in the codebase constructs
an in-memory Agent — `initializeAllAgents()` at boot — and nothing anywhere
reloads one on demand (verified by grep across `app/`, `lib/`, `services/`,
`server.mjs`; every other caller uses `getExistingAgent`). An eviction policy is
only meaningful when eviction can be followed by re-population on a miss. There
are no misses. So the LRU could only ever destroy: it stopped 8 of 18 live
subconsciouses at every boot, chosen by `readdir` order, permanently.

**The fleet was already bounded, where a fleet is created.** `maxAgentsPerHost`
(Security Settings; default 50, hard max 500) refuses agent number N+1 at
CreateAgent gate G01c. So the registry's `maxAgents = 10` was a *second,
tighter, silent* bound on the same quantity — two sources of truth, and the one
that won was the one nobody wrote down, enforcing itself by killing processes
rather than by refusing creation. Residency now follows the fleet.

**The cap's stated reason had expired.** Its comment said it evicted "to prevent
memory bloat ... including CozoDB". The CozoDB left with the RAG subsystem in
TRDD-70a521d9. Measured 2026-07-10: a resident Agent is a Cerebellum + two
subsystems — an 8 KB terminal ring, ~13 JSON strings of the agent's `.claude/`
inventory, one 30 s timer. The dominant term is a duplicated copy of the user's
**45,892-byte** `~/.claude/settings.json`, once per agent; the whole 18-agent
fleet costs single-digit MB. The eviction was defending a database that no longer
exists, by killing the process that replaced it.

### Two bugs fell out with it

1. **The batch race.** `initializeAllAgents` loads with `CONCURRENCY = 5`. All
   five callers entered `evictIfNeeded()` and each `shift()`ed a *different*
   victim before any reached the `agents.delete()` that follows
   `await agent.shutdown()`. Five evictions decided against one stale reading of
   `agents.size`.
2. **The zombie window.** `evictIfNeeded` and `shutdownAgent` both awaited
   `agent.shutdown()` while the Agent was still in the map — and it is dead the
   instant that call begins (cerebellum stopped, `initialized` false). A
   concurrent `getExistingAgent()` in that window got the corpse *and* `touch()`ed
   it back onto `accessOrder`, leaving a phantom id there after the delete. The
   next eviction would shift the phantom, find nothing, and evict an extra LIVE
   agent to compensate.

Both are gone. `shutdownAgent`/`shutdownAll` now **unindex before tearing down**,
so the window cannot exist; if `shutdown()` throws, an unindexed dying agent
still beats an indexed one that callers keep receiving.

### Falsification (`tests/unit/agent-registry-residency.test.ts`, 7 tests)

The property, not the number: load 25 agents — sequentially, then concurrently —
and all 25 stay resident while `cerebellum.stop()` is never called. Against the
old code both fail *by construction*: `activeAgents` cannot reach 25 past a cap
of 10. The spy is proven live rather than dead by the two teardown tests, where
it fires exactly 1× and 3×.

Gate: `tsc` 0 errors · vitest 153 files / 2386 passed, 2 skipped · `node --check
server.mjs` OK. (No eslint config ships in this repo, so no lint claim is made.)

### What the removal obliged

Removing a bound obliges you to surface the resource use it was badly hiding.
`initializeAllAgents` now WARNS when the discovered fleet exceeds
`maxAgentsPerHost` — and starts them all anyway. Going quiet was the old
behaviour's whole crime.

### SUPERSEDED — do NOT carry forward

- *"The cap exists to bound memory ... a fleet can be arbitrarily large."* Both
  halves are false: the memory it bounded is gone, and the fleet is bounded at
  G01c.
- *"Option 1 — the subconscious does not need the Agent resident."* Refuted as
  phrased: the subconscious IS a subsystem of the Agent's Cerebellum. Post-RAG
  the Agent is *nothing but* that cerebellum, so the Agent is the subconscious's
  process container. Discarding the container to reclaim memory is killing the
  process.
- *"Option 2 — pin the startup-initialized agents."* It collapses into option 3:
  startup initializes *every* discovered agent, so the pin set is the whole
  fleet and the eviction filter can never fire.
- *"This TRDD BLOCKS its sibling WNZ72SFO."* It did; it no longer does.
  WNZ72SFO's `blocked-by:` is cleared.

### Load-bearing facts (still true)

- `getAgent()` is a get-or-CREATE and still starts a real process. Reads must use
  `getExistingAgent()`. That is TRDD-YEE33F3A's rule and it outlives this change.
- `agent.shutdown()` → `cerebellum.stop()` → the subconscious's timers stop. A
  shutdown is not a cache release; it stops a running process. There is no path
  that restarts one.
- `discoverAgentDatabases()` filters disk dirs against the registry (ISSUE-005),
  so stale directories do not inflate the count. The 18 measured here were real.

### Noticed, not fixed — each is its own TRDD, not a platelet of this one

Neither is an *effect* of removing the eviction; both predate it and are
independent. So they are new work, not EHTs (a derived TRDD may not spawn derived
TRDDs — depth is exactly 1).

- **The subconscious set is fixed at boot.** Nothing constructs an Agent outside
  `initializeAllAgents`, so an agent *created* after boot never gets a
  subconscious, and *waking* one does not start it. Residency arguably should
  track agents with a live session — which is also the only state in which the
  config-drift tracker's quarry (client-internal installs) can occur.
- **One registry entry has `workingDirectory: "/"`.** Surfaced by the measurement
  script; unrelated to this change.

## Why this is Tier 0

Local, reversible, inside this project's own scope; no baseline deviation, no
governance change, no cross-project or release surface. Authored directly rather
than proposed, as a self-mandate. The design decision was mine to make once the
memory cost was measured — and measuring it is what dissolved the question.
