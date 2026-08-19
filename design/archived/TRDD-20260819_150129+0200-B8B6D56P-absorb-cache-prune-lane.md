---
trdd-id: B8B6D56P
title: Absorb the cache-prune chore into the server
column: completed
created: 2026-08-19T15:01:29+0200
updated: 2026-08-19T15:15:13+0200
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
implementation-commits: [669966ad]
project-id: ai-maestro
labels: [family-a, janitor-absorption, npt]
release-via: none
---

# Absorb the cache-prune chore into the server

Server-side reimplementation of janitor task_cache_prune (21600s): prune stale
~/.claude/plugins/cache/<mkt>/<plugin>/<version>/ dirs, keep {pinned ∪ newest-N}, and
carry the CARDINAL SAFETY verbatim — never prune a version a live session might have
loaded: the mtime cutoff is pulled back behind the OLDEST live claude session's start
(+margin). Process-table reads use the snapshot-to-file discipline (no self-match).

The per-chore disposition table, the three cross-cutting axes (stamp+cadence contract,
claim-only-when-live, default-OFF destructive lanes), and the three measured incident
requirements live on the parent [[KCRMSNL7]] (DESIGN RESOLVED 2026-08-19 section) — read
that FIRST; this card does not restate it.

## Acceptance

- [x] lane implemented with the cardinal-safety cutoff (lib/cache-prune.ts, line-faithful
      port incl. the #137 pinned-SET semantics and basename-exact session matching); the
      scheduler logs removed/failed counts WITH the cutoff arithmetic and oldest-session age
- [x] stamp on attempt via janitor-chore-stamp; 6h roster cadence (janitor stale bound 18h,
      comfortably clear); 'cache-prune' claimed in ABSORBED_CHORES in the SAME commit as the
      live lane + server.mjs wiring (claim-when-live)
- [x] tests pin the cutoff both at the unit and the fixture level: a version 20 days old
      (far past the 7-day floor) loaded by a 20-day live session SURVIVES; past-cutoff
      unprotected versions are pruned. NEUTER (fix committed first as 669966ad): dropping
      the session term from pruneCutoff reds EXACTLY those two tests (unit + safety box),
      16 green — clean attribution; restored 18/18.

## Approval log

- 2026-08-19T15:01:29+0200 — MANDATE issued as Tier-0 self-mandate (derived NPT of [[KCRMSNL7]],
  server-internal, reversible, dark-shipped where destructive). No approval request sent.
- 2026-08-19T15:15:13+0200 — COMPLETED by hub (standing USER Phase-2 delegation, BRRJK57P). Lane live at
  669966ad, claimed same-commit; neuter recorded above. Server now claims 6/13 chores.
