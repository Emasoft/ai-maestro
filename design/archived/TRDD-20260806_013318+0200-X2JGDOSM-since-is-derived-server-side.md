---
trdd-id: X2JGDOSM
title: Add derived `since` to the hibernation response — computed server-side, never stored
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-06T01:33:18+0200
updated: 2026-08-06T05:56:38+0200
implementation-commits: [b90f767e]
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

- [x] A hibernated fixture with an archived transition reports `since` == that transition's
      stamp; one with NO archived transition reports `since: null` — pinned, not guessed.
      (8 tests in tests/unit/agent-hibernation.test.ts; complementary neuter pair OBSERVED:
      kill-derivation → exactly 5 red, remove-never-guess-guard → exactly 3 red.)
- [x] No new persisted field anywhere — a grep guard asserts it. ~~`hibernatedAt` stays
      zero-hits repo-wide outside the derivation~~ **premise was STALE at implementation:**
      app/api/system/ledger-health/route.ts already exposes a `hibernatedAt` response field
      DERIVED from signed-ledger event timestamps — the same one-writer read-side pattern this
      ruling mandates, never a violation. The guard therefore encodes the RULE, not the count:
      tests/governance/no-stored-hibernation-timestamp.test.ts pins hits == the exact allowlist
      of verified derived-on-read sites (scan floor >500 files; allowlist doubles as the
      positive control).
- [x] The daemon response file carries the field (verified LIVE post-deploy: all 11 records
      carry `since`, all-null cross-checked contract-correct against the surviving archive —
      zero recorded transitions); the #113 thread is answered (comment 5200205202).

## Approval log

- 2026-08-06T01:33:18+0200 — MANDATE under the USER's 2026-08-06 delegation ("decide by
  yourself after careful analysis. base your decision on verified facts and tests").
  Ruling recorded above; implementation queued Tier 0 (in-scope, reversible, local).
- 2026-08-06T05:56:38+0200 — COMPLETED by ai-maestro (Tier 0). Implemented in `b90f767e`,
  deployed (build + pm2 restart, health 200), verified by effect on the live daemon file;
  #113 answered (comment 5200205202). All boxes checked; NPT/EHT empty → archive.
