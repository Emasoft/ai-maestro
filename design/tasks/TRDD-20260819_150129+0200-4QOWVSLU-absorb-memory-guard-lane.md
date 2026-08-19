---
trdd-id: 4QOWVSLU
title: Absorb the memory-guard Tier-1 OOM lane into the server
column: planned
created: 2026-08-19T15:01:29+0200
updated: 2026-08-19T15:01:29+0200
current-owner: hub-session-brrjk57p-phase2
created-by: hub-session-brrjk57p-phase2
assignee: hub-session-brrjk57p-phase2
task-type: feature
scope: project
min-approval-requirement: none
mandate: true
mandated-by: self
derived: true
derived-kind: npt
parent-trdd: KCRMSNL7
npt: []
eht: []
blocked-by: []
implementation-commits: []
project-id: ai-maestro
labels: [family-a, janitor-absorption, npt]
release-via: none
---

# Absorb the memory-guard Tier-1 OOM lane into the server

Server-side reimplementation of janitor task_memory_guard (120s), carrying the
USER-SIGNED constraints (TRDD-7100178d Decision 1, 2026-05-31) VERBATIM: free-memory
probe; only under real pressure snapshot the process table TO A FILE; select the single
largest-RSS janitor-owned RUNAWAY via the Tier-1 truth table (signature allowlist +
protected pids + claude-session rejection + age gate); SIGTERM->SIGKILL; at most ONE kill
per beat; unknown reading = NO-OP. Tier 2 stays unimplemented — no code path, no flag.
DESTRUCTIVE => ships default-OFF behind its own flag. NEVER shells out to the janitor's
rolling cache (the 4OFMHOZ7 lesson).

The per-chore disposition table, the three cross-cutting axes (stamp+cadence contract,
claim-only-when-live, default-OFF destructive lanes), and the three measured incident
requirements live on the parent [[KCRMSNL7]] (DESIGN RESOLVED 2026-08-19 section) — read
that FIRST; this card does not restate it.

## Acceptance

- [ ] truth table reimplemented server-side with every USER-signed constraint cited line-by-line against the janitor original
- [ ] default-OFF flag; one-kill-per-beat and no-kill-on-missing-data pinned by tests (neuters recorded)
- [ ] stamp + cadence contract honored; claim token added only when live AND armed policy decided (surface to USER)

## Approval log

- 2026-08-19T15:01:29+0200 — MANDATE issued as Tier-0 self-mandate (derived NPT of [[KCRMSNL7]],
  server-internal, reversible, dark-shipped where destructive). No approval request sent.
