---
trdd-id: 1CMK59SB
title: Sidebar team-grouping does not refresh after team creation
column: planned
created: 2026-07-07T12:36:45+0200
updated: 2026-07-07T14:17:52+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: MEDIUM
effort: S
labels: [scenario-improvement, scen-002, batch-backlog-20260707]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_002_2026-06-23T10-24-11Z.md", "reports_dev/scenarios-runner/SCEN-002_2026-06-23T10-24-11Z.report.md"]
---

# TRDD-1CMK59SB — Sidebar team-grouping does not refresh after team creation

## Problem
SCEN-002 S022: after `CreateTeam`, the Agents-tab sidebar kept the new
members grouped under "NO-TEAM"; the "SCEN-TEST-TEAM-ALPHA" group only
appeared after a full page reload. Clicking the "Refresh agents" button
(the `RefreshCw` icon, `aria-label="Refresh agents"`, at
`components/AgentList.tsx:759-766`) does not fix it — it re-fetches agents
but not teams.

## Root cause
Verified at HEAD (2026-07-07) in `components/AgentList.tsx`:
- The sidebar's team-based grouping reads a component-local `teams` state
  populated by `fetchTeams()` (line ~317-331), which calls `GET /api/teams`.
- `fetchTeams()` is invoked exactly once, via `useEffect(() => { fetchTeams()
  }, [fetchTeams])` (line 331), and `fetchTeams` is a `useCallback` with an
  empty dependency array — it never re-runs after mount.
- The `onRefresh` prop passed to the "Refresh agents" button (line 759,
  `aria-label="Refresh agents"`) is owned by the PARENT (`app/page.tsx`) and
  only re-fetches the agents list — it has no reference to `fetchTeams` and
  cannot trigger it.
- `subconsciousRefreshTrigger` (a prop AgentList also receives, used at line
  ~1624 for `SubconsciousStatus`) is likewise not wired to `fetchTeams`.
- Team membership itself is stored ONLY in `team.agentIds` (no denormalized
  `teamId` field on the agent record), so the sidebar's grouping is entirely
  dependent on this stale, mount-once `teams` state being current.

Net effect: any action that changes team membership or creates a team while
the sidebar is already mounted (which is the overwhelmingly common case)
leaves the sidebar showing the pre-mutation grouping until a full page
reload re-runs the mount effect.

## Proposed fix
In `components/AgentList.tsx`:
1. Expose `fetchTeams` upward (as a prop callback, or move it to a shared
   hook/context both `AgentList` and the team-creation dialog can call) so
   the `CreateTeam` success handler (wherever the Create Team dialog submits
   — likely in a sidebar `TeamListView`/`CreateTeamDialog` component) can
   invoke it directly after a successful `POST /api/teams`, OR
2. Simpler alternative: add `subconsciousRefreshTrigger` (or a new dedicated
   `teamsRefreshTrigger` prop, if reusing the subconscious one is judged too
   overloaded) to `fetchTeams`'s dependency-triggering `useEffect`, and have
   `app/page.tsx` bump that trigger whenever any team-mutating API call
   (`CreateTeam`, `ChangeTeam`, delete team) resolves successfully — mirroring
   the existing pattern already used for subconscious status refresh.
3. Either way, the CreateTeam POST response already returns the created
   team object — the sidebar can optimistically push it into local `teams`
   state immediately (zero round-trip latency) while the background refetch
   confirms/corrects it.

## Verification
1. Create a team via the UI Create Team dialog with 2+ members already
   visible in the sidebar under NO-TEAM.
2. Immediately after the dialog closes (no manual reload), the Agents
   sidebar shows the new team's group header with its members moved out of
   NO-TEAM.
3. Re-run SCEN-002 S022 and drop the "requires full page reload" workaround
   from the scenario's expected/actual note.

## Estimated risk
LOW. The fix is additive (re-fetch or optimistic state push on a known
success event); it does not change the grouping algorithm itself, only when
it re-runs. No external dependencies. Risk is limited to over-fetching
`/api/teams` slightly more often if a broad refresh-trigger approach is
chosen instead of a targeted callback.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
- 2026-07-07T14:17:52+0200 — IMPLEMENTED (wave W3): option 1 (callback prop) — added `onTeamsChanged?: () => void` to `TeamListView`, wired `AgentList.tsx` to pass its own `fetchTeams`; `TeamListView.tsx` now calls it after a successful create, edit, and delete, so the Agents-tab sidebar grouping refreshes immediately instead of requiring a full page reload.
