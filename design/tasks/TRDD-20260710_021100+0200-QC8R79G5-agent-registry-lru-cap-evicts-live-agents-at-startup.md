---
trdd-id: QC8R79G5
title: The in-memory agent LRU cap of 10 evicts live agents during startup
column: backburner
created: 2026-07-10T02:11:00+0200
updated: 2026-07-10T02:11:00+0200
current-owner: ai-maestro-session
assignee: null
priority: 2
severity: MEDIUM
effort: S
approval-tier: 0
task-type: bugfix
release-via: none
parent-trdd: TRDD-4Q7WMPZK
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
attempts: 0
test-failures: 0
last-test-result: not-run
last-test-at: null
implementation-commits: []
external-refs: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-10

**Found while fixing `03159944`, not caused by it.** `AgentRegistry` is an LRU
with `maxAgents = 10` (`lib/agent.ts`, `new AgentRegistry()` takes no argument).
`initializeAllAgents()` calls `agentRegistry.getAgent(id)` once per discovered
agent, and `getAgent` runs `evictIfNeeded()` before each construct. So loading
the 11th agent shuts the 1st one down.

**Measured on this machine, 2026-07-10:** 18 live (non-tombstoned) registry
agents, all 18 with a `~/.aimaestro/agents/<id>/` dir — so
`discoverAgentDatabases()` (disk ∩ registry) returns 18 and startup initializes
18 into 10 slots. **Eight agents' subconscious is stopped by the time startup
finishes.** For those agents `status.json` and the TRDD-7123d51a config-change
tracker never update again until something reloads them.

**This was previously invisible, and that is the whole point.** Until
`03159944`, `GET /api/agents/[id]/subconscious` called the constructing
`getAgent()`, so *viewing* an evicted agent silently reloaded it — evicting a
different one to make room — and reported `initialized: true` because the read
had just made it true. The dashboard indicator polls that route every 30s for the
viewed agent, so the cap presented as a thrash nobody could see rather than as a
capacity limit. The read path now uses `getExistingAgent()` and reports
`initialized: false` for an evicted agent, which is the truth.

**NEXT ACTION:** decide what the cap means, then implement. It is a design call,
which is why this is captured rather than fixed inline.

**Do NOT just raise `maxAgents`** without answering the question below — the cap
exists to bound memory (each Agent holds a cerebellum + subsystems), and a fleet
can be arbitrarily large.

### The question

An LRU cache is the wrong shape if every entry must stay resident. Three
candidate answers, in the order I would evaluate them:

1. **The subconscious does not need the Agent resident.** Post-TRDD-70a521d9 it
   writes `status.json`, tracks activity + config drift, and (by default,
   disabled) polls messages. If that work can be driven without holding a full
   `Agent` + `Cerebellum` in memory, the registry stops being load-bearing and
   the cap stops mattering. Check what an evicted agent actually loses.
2. **Startup-initialized agents are pinned; only on-demand ones are evictable.**
   Keeps the memory bound for incidental loads, guarantees the fleet's own agents
   run. Needs a pin set and an eviction filter.
3. **The cap tracks the fleet** (`max(10, registry.length)`), with the memory
   cost measured first. Simplest, and honest about the fact that the registry is
   not really a cache.

### Falsification

Whatever is chosen, the test asserts the property, not the number: after
`initializeAllAgents()` over N > cap discovered agents, every agent that startup
claims it initialized is still resident and its subconscious `isRunning`. Today
that test fails for the first N − 10.

### Load-bearing facts

- `evictIfNeeded()` runs on the CREATE path only, so reads never evict. That is
  what makes `getExistingAgent()` safe and why `03159944` was the right first
  move regardless of how this TRDD resolves.
- `agent.shutdown()` → `cerebellum.stop()` → the subconscious's timers stop.
  Eviction is not a cache miss; it stops a running process.
- `discoverAgentDatabases()` filters disk dirs against the registry (ISSUE-005),
  so stale directories do not inflate the count. The 18 here are all real.

## Why this is Tier 0

Local, reversible, inside this project's own scope; no baseline deviation, no
governance change, no cross-project or release surface. Authored directly rather
than proposed. The *design decision* above is mine to make once the memory cost
of each option is measured.
