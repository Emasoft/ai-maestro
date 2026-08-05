---
trdd-id: X2JGDOSM
title: Add derived `since` to the hibernation response — computed server-side, never stored
column: todo
scope: project
project-id: ai-maestro
created: 2026-08-06T01:33:18+0200
updated: 2026-08-06T01:33:18+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-06T01:33:18+0200
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
relevant-rules: []
labels: [daemon, hibernation, owner-ours]
external-refs: [Emasoft/ai-maestro#113]
---
# Add derived `since` to the hibernation response — computed server-side, never stored

## The ruling (2026-08-06, under the USER's delegation)

The #113 asker wanted `since` (how long has this agent been hibernated). The thread's own
measurement: NO stored hibernation timestamp exists anywhere (`hibernatedAt` and friends:
zero hits repo-wide), and the transition archive already records each real state change as
a timestamped file — so `since` = the stamp of the newest archived transition into the
current state.

**Decision: derive it SERVER-SIDE and include it as a first-class FIELD of the response —
never store it.** One-writer-per-fact: a stored `hibernatedAt` would be a second writer of
what the transition archive already owns, and the two would drift (the exact defect class
the role field just exhibited). The consumer gets the ergonomic field it asked for; the
storage gains no duplicate.

## Scope

1. `lib/agent-hibernation.ts` (the ONE derivation module): compute `since` per classified
   agent from the transition archive — newest archived transition INTO the current state;
   absent/null when the archive has no matching transition (never guess).
2. Surface it through the existing chain untouched in shape: `GET /api/agents/hibernation`
   → `aimaestro-agent.sh hibernation` → the daemon file
   `<project>/.janitor/daemon_responses/hibernation.json`.
3. Answer on #113 that `since` ships as a derived response field (ruling recorded there).

## Acceptance criteria

- [ ] A hibernated fixture with an archived transition reports `since` == that transition's
      stamp; one with NO archived transition reports `since: null` — pinned, not guessed.
- [ ] No new persisted field anywhere (`hibernatedAt` stays zero-hits repo-wide outside
      the derivation) — a grep guard or test asserts it.
- [ ] The daemon response file carries the field; the #113 thread is answered.

## Approval log

- 2026-08-06T01:33:18+0200 — MANDATE under the USER's 2026-08-06 delegation ("decide by
  yourself after careful analysis. base your decision on verified facts and tests").
  Ruling recorded above; implementation queued Tier 0 (in-scope, reversible, local).
