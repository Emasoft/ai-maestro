---
trdd-id: YN8EQWYP
title: The pillar index is new server state shared by every agent on the host
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-28T20:00:06+0200
updated: 2026-07-28T20:00:06+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: infra
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-28T20:00:06+0200
derived: true
derived-kind: eht
parent-trdd: L55IYKL4
priority: 1
severity: normal
effort: small
release-via: none
relevant-rules: []
npt: []
eht: []
blocked-by: []
external-refs: []
---

# The pillar index is new server state shared by every agent on the host

## The hole this handles

The parent creates a persistent SQLite index under `~/.aimaestro/pillar-index/`. That directory is
**new server state on a shared host**, and three things follow that the index task itself will not
notice:

1. **It must be a registered, documented path.** `~/.aimaestro/` has an owner
   (`statePath()` in `lib/ecosystem-constants.ts`) and a documented inventory in the
   janitor-footprint rule, which classifies every path as *real state* (never delete) or
   *regeneratable* (safe to delete). An unregistered directory that appears in `~/.aimaestro/` is
   exactly the thing a future agent finds and cannot classify. The pillar index is **derived and
   disposable** — that must be written down where someone about to delete it will read it.
2. **N agents share one host.** Every registered agent can run `greptrdd`, so several processes may
   reindex the same corpus concurrently. WAL + `busy_timeout` + `BEGIN IMMEDIATE` is the mechanism;
   what needs deciding is the behaviour when a second writer arrives mid-reindex — wait, skip, or
   read-only-degrade.
3. **Tests must never touch the real `~/.aimaestro/`.** `tests/helpers/fake-ecosystem-home.ts`
   already exists (with its own test) and is the containment seam — this is a *use it* item, not a
   *build it* item, and it is called out because the 0-IMPACT rule has been broken before by a
   suite that wrote the developer's real home.

The precedent to follow is `lib/kanban-index.ts:213` — `statePath('kanban-index', <hash>.json)`,
keyed by a hash of the resolved design dir, written outside the corpus so a fleet agent's repo is
never dirtied by a cache of itself.

## Acceptance

- [ ] The index path is produced by `statePath('pillar-index', …)`, keyed per design-dir, never
      written inside `design/`
- [ ] The janitor-footprint inventory lists it as regeneratable, with one line saying why (derived
      from markdown; deleting it loses nothing)
- [ ] Concurrent-reindex behaviour is chosen, implemented, and covered by a test that runs two
      writers against one index
- [ ] Every index test routes through `fake-ecosystem-home.ts`; a run of the full suite leaves the
      real `~/.aimaestro/` byte-identical

## Approval log

- 2026-07-28T20:00:06+0200 — MANDATE issued by USER (min-approval-requirement: none).
  Pre-approved: issuer authority >= required approver. No approval request was sent.
