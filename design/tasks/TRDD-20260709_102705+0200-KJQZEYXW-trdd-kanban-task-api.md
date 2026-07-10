---
trdd-id: KJQZEYXW
title: 3-pillars task API for TRDD-file lifecycle and kanban get-one keyword-search full-edit
column: complete
created: 2026-07-09T10:27:08+0200
updated: 2026-07-10T04:20:51+0200
implementation-commits: [b196337b, 40aeab53]
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 1
severity: HIGH
effort: L
task-type: feature
release-via: none
parent-trdd: TRDD-SCLSRS6E
derived: true
derived-kind: npt
npt: []
eht: []
relevant-rules: []
labels: [task-api, trdd, prrd, kanban, 3-pillars, script-layer]
test-requirements: [unit, integration]
review-requirements: [human-review]
impacts: [public-api]
external-refs: []
---

# TRDD-KJQZEYXW — 3-pillars task API (TRDD-file tooling + kanban gaps)

> **Graph correction 2026-07-10 (corpus sweep).** This TRDD's `eht:` named
> TRDD-280DF70U, the shared script-wrapper platelet. But an `npt:`/`eht:` edge
> declares *parenthood*, and 280DF70U has exactly one parent — the epic
> TRDD-SCLSRS6E, which still claims it. Five siblings named the same platelet, so
> the one-parent law read it as five parents. What the edge really said is "the
> task API needs `aimaestro-trdd.sh`" — a dependency on a sibling, which belongs in
> `blocked-by:`. Moot now: 280DF70U is complete, and `blocked-by:` carries only
> OPEN blockers. This TRDD is itself an NPT of the epic; a derived TRDD carries no
> children of its own (depth is exactly 1). Fitting, since this TRDD built the very
> tooling that would have caught the mistake.

Give governance agents API access to the two currently-disconnected task systems in
this project: the git-tracked TRDD-file corpus under `design/` (today only
manipulable by hand — no `findtrdd`/`get-prrd`/`prrd-edit` tooling exists in this
repo) and the GitHub-Projects-backed kanban (which has small but real gaps: no
get-one route, no keyword search, no full-field edit).

## What exists today

- Kanban CRUD, backed by GitHub Projects via `teams-service`:
  `GET/POST /api/teams/[id]/tasks`, `PUT/DELETE /api/teams/[id]/tasks/[taskId]`,
  and scripts `amp-kanban-{list,create-task,move,archive}.sh`.
- Missing on the kanban side: a `GET /api/teams/[id]/tasks/[taskId]` route. The
  service function it needs already exists — `getTeamTask` at
  `teams-service.ts:994` — it is simply not exported as a `GET` route yet (a
  trivial fix). There is also no keyword search (the list route is filter-only,
  not full-text), and no script/route for a full-field edit (only status changes
  via `move`).
- TRDD files: **no tooling at all**. `findtrdd`, `get-prrd`, `prrd-edit`, `findprrd`
  do not exist in this repo; there is no `PRRD.md`. The entire lifecycle —
  proposal → planned promotion, archiving completed/cancelled/superseded TRDDs — is
  100% manual `git mv` + hand-editing frontmatter today.
- The kanban `status` field and the TRDD `column:` field are TWO PARALLEL,
  disconnected state machines with no automatic link between them.

## What to build

**(A) Trivial kanban fixes:**
1. Add `GET /api/teams/[id]/tasks/[taskId]` — wire the existing `getTeamTask`
   service function to a route (`teams-service.ts:994` already has the logic).
2. Add a keyword-search query param to the existing task list route.
3. Add a full-field kanban edit path (not just status via `move`).

**(B) New TRDD-file API + service:**
1. `lib/trdd-store.ts` — parses, reads, searches, and edits the
   `design/{proposals,tasks,archived,refused}/*.md` corpus, frontmatter-aware
   (grep-first parsing per the TRDD v2 spec), and performs the LIFECYCLE
   transitions with `git mv` (proposal → planned into `tasks/`; proposal → refused
   into `refused/`; archive completed/cancelled/superseded into `archived/`), each
   transition bumping `updated:` and appending an `## Approval log` line to the
   file body.
2. Routes:
   - `GET /api/trdd` — search (by column, id, keyword).
   - `GET /api/trdd/[id]` — read one TRDD (full frontmatter + body).
   - `PATCH /api/trdd/[id]` — edit column/fields.
   - `POST /api/trdd/[id]/approve` / `.../promote` / `.../archive` — lifecycle
     transitions. Strict-classify these (they mutate git-tracked state and change
     what's authorized to execute).
3. Respect the project's DEP overlay rule (`aimaestro-trdd-approval.md`): approval
   tiers, the `design/{proposals,tasks,archived,refused}` folder lifecycle, and the
   approval-log format must match what that rule defines — this API is an
   implementation of that rule, not a new state machine.
4. Optionally mirror a TRDD's `column:` to a kanban card's `status` (one-way,
   TRDD-as-SSOT) so the two state machines stay loosely in sync without duplicating
   authority — keep the TRDD the single source of truth per the overlay rule.

## Files to touch

- NEW `lib/trdd-store.ts`.
- NEW `app/api/trdd/route.ts`.
- NEW `app/api/trdd/[id]/route.ts`.
- NEW `app/api/trdd/[id]/approve/route.ts`, `.../promote/route.ts`,
  `.../archive/route.ts`.
- edit `app/api/teams/[id]/tasks/[taskId]/route.ts` — add the `GET` handler.
- edit the existing task list route — add keyword-search query support.

## Tests

- TRDD search by `column:`, by id, and by free-text keyword each return the
  expected file(s).
- Reading a TRDD by id returns the full parsed frontmatter + body.
- Editing a TRDD's `column:` via `PATCH` updates the file in place and bumps
  `updated:`.
- Promoting a proposal (`proposal → planned`) performs the `git mv` into
  `design/tasks/`, updates the frontmatter, and appends the `## Approval log`
  line — verified by re-reading the moved file.
- Archiving a completed/cancelled/superseded TRDD performs the `git mv` into
  `design/archived/` with the correct terminal `column:` value.
- Kanban `GET .../tasks/[taskId]` returns the single task by id (currently 404s /
  doesn't exist).
- Kanban keyword search returns tasks matching a free-text query that the existing
  filter-only list route would miss.

## Approval log
