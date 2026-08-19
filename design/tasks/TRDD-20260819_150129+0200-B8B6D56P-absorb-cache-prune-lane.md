---
trdd-id: B8B6D56P
title: Absorb the cache-prune chore into the server
column: dev
created: 2026-08-19T15:01:29+0200
updated: 2026-08-19T15:07:46+0200
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

- [ ] lane implemented with the cardinal-safety cutoff; deletes logged with the cutoff arithmetic
- [ ] stamp + cadence contract honored; claim token added only when live
- [ ] test pins the cutoff (a version 'loaded' by a fake older session survives; one past cutoff is pruned)

## Approval log

- 2026-08-19T15:01:29+0200 — MANDATE issued as Tier-0 self-mandate (derived NPT of [[KCRMSNL7]],
  server-internal, reversible, dark-shipped where destructive). No approval request sent.
