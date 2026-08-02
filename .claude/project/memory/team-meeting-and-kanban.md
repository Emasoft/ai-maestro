---
name: team-meeting-and-kanban
description: "how does the team meeting state machine work / where are team tasks stored / what are the 17 kanban columns / why does the kanban board use a different column set / how do groups differ from teams / where do groups persist"
ocd: 2026-08-02
lmd: 2026-08-02
metadata:
  node_type: memory
  type: reference
  tier: component
  topic: teams-and-governance
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
- Statuses = the ratified 3-pillars kanban vocabulary (17 columns, 1:1 with the TRDD
  `column:` field): 14 lifecycle (`backburner` → `todo` → `design` → `dispatch` → `dev` →
  `testing` → `ai_review` → `human_review` → `complete` → `publish` → `published` →
  `deploy` → `live` → `live_auditing`) + 3 exceptions (`blocked`, `failed`, `superseded`).
  `TaskStatus` is a string (per-team configurable) but the ratified 17-column default in
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

## See also

## Notes and lessons learned
