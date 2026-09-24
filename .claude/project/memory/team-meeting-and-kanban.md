---
name: team-meeting-and-kanban
description: "how does the team meeting state machine work / where are team tasks stored / what are the 22 kanban columns / when did the kanban go from 17 to 22 columns / where do approval and the design review columns sit / why does the kanban board use a different column set / how do groups differ from teams / where do groups persist / the kanban index shows an archived card as work in progress / what is the (archived) bucket in byColumn"
ocd: 2026-08-02
lmd: 2026-09-24
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: teams-and-governance
publish-globally: false
---

# team-meeting-and-kanban

Team Meeting Architecture (v0.20.19+): the multi-agent meeting UI, its shared task/kanban
system, and (closely related — it replaced the "open teams" concept) the lightweight Groups
feature for broadcast messaging.

## State machine pattern

Team meetings use a `useReducer` with a `TeamMeetingState` that tracks meeting phase
(`idle` → `selecting` → `ringing` → `active`), selected agents, and UI state (sidebar mode,
right panel, kanban open).

## Task system

- Tasks stored per-team in `~/.aimaestro/teams/tasks-{teamId}.json`
- Statuses = the ratified 3-pillars kanban vocabulary (**22 columns since 3.0.0**, 1:1 with
  the TRDD `column:` field): 19 lifecycle (`backburner` → `approval` → `design` →
  `design_ai_review` → `design_human_review` → `todo` → `verify_assumptions` → `plan` →
  `dispatch` → `dev` → `testing` → `ai_review` → `human_review` → `complete` → `publish` →
  `published` → `deploy` → `live` → `live_auditing`) + 3 exceptions (`blocked`, `failed`,
  `superseded`). It was 17 until 2026-08-23, when the USER added five columns and MOVED
  `design` from after `todo` to before it — so a card reaching `todo` now asserts *approved
  AND designed*, which is why the missing-column fallback stopped being a flat `todo`
  (`3P-TRDD-11`). `approval` and `design_human_review` are RESTING columns: they wait on
  another party's decision, so a card sitting in one is parked, not stalled.
  `TaskStatus` is a string (per-team configurable) but the ratified 22-column default in
  `types/task.ts` rules every kanban surface — UI boards, GitHub Project mirrors,
  `amp-kanban-*.sh` — per TRDD-YUGDER9D; **consumers align to it, never the reverse**
- Dependency chains: tasks can block other tasks, auto-unblock on completion
- `useTasks` hook polls every 5s for multi-tab sync

## Kanban board

- Full-screen overlay (`fixed inset-0 z-40`) matching agent picker overlay pattern
- Native HTML5 drag-and-drop (same pattern as AgentList.tsx)
- `KanbanCard`: `draggable={!task.isBlocked}`, stores taskId in `dataTransfer`
- `KanbanColumn`: `onDragOver`/`onDrop` handlers update task status
- Escape key closes modals in priority order: detail view → quick-add → board
- Blocked tasks show lock icon, not draggable

## Groups feature (v0.25+)

Groups are lightweight agent collections for broadcast messaging — replacing the removed
"open teams" concept. Unlike teams, groups have no governance, no COS, no kanban — just a
subscriber list.

### Types

- `types/group.ts` — `Group` interface (id, name, description, subscriberIds, timestamps)
- `types/group.ts` — `GroupsFile` (version + groups array)

### Storage

Groups persist in `~/.aimaestro/teams/groups.json` via `lib/group-registry.ts`.

### API endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/groups` | List all groups |
| POST | `/api/groups` | Create a group |
| GET | `/api/groups/{id}` | Get group by ID |
| PUT | `/api/groups/{id}` | Update group |
| DELETE | `/api/groups/{id}` | Delete group |
| POST | `/api/groups/{id}/subscribe` | Subscribe agent to group |
| POST | `/api/groups/{id}/unsubscribe` | Unsubscribe agent from group |
| POST | `/api/groups/{id}/notify` | Broadcast message to all subscribers |

### Key files

- `types/group.ts` — Group type definitions
- `lib/group-registry.ts` — File-based CRUD with validation
- `services/groups-service.ts` — Business logic layer
- `services/headless-router.ts` — Groups routes for headless mode
- `app/api/groups/` — Next.js API routes

### Migration from Open Teams

Open teams were removed in the governance simplification (2026-03-27). All teams are now
closed (isolated messaging with COS gateway). Groups replace the "open, unstructured
collection of agents" use case that open teams served, but without governance overhead.


^ATOM-OLFR-6UZ6 [desc: "the kanban index puts an archived card whose column is not finished into an (archived) bucket, never into its column, so history is not counted as WIP (7bf577be0)", keywords: kanban_shows_an_archived_card_as_work_in_progress archived_card_in_dev_column (archived)_bucket_in_byColumn kanban_index_counts_archived_cards WIP_count_wrong_after_archiving archived_failed_card_on_the_board byColumn_has_an_extra_key kanban-index_archived_column trddgrep_next_lists_an_archived_card board_shows_definitive_history_as_live, type: reference, trdd: TRDD-MQE5D28T, ocd: 2026-09-24, lmd: 2026-09-24]

Archiving keeps a card's column (TRDD-MQE5D28T D2: "photographed forever"), so a card archived from
`dev`, `blocked` or `failed` still says so. `buildKanbanIndex` (lib/kanban-index.ts) used to bucket
`byColumn` by column alone and would have counted that definitive history as live work. Since commit
7bf577be0 a row with `zone === 'archived'` and a column outside DEFINITIVE_COLUMNS goes to the
`(archived)` bucket (ARCHIVED_COLUMN). Archived cards in a finished column keep their own bucket, and
the `rows` array is unchanged. The kanban API route spreads the index, so API consumers see
`(archived)` as an extra byColumn key next to `(unknown)`; no component in components/ reads byColumn.
`scripts/trdd-doctor.mjs --board` groups its own cards from tasks/ only (unless --all).
Not yet fixed: `readyQueueFrom` (`trddgrep next`) has the same column-only reading.

## See also

## Notes and lessons learned
