---
trdd-id: RR883ETW
title: Replace onMouseLeave reset on Delete-Team confirm with modal or timeout
column: complete
created: 2026-07-07T12:35:40+0200
updated: 2026-07-07T14:58:53+0200
current-owner: scenario-runner
approval-tier: 2
priority: 0
severity: MEDIUM
effort: S
labels: [scenario-improvement, scen-024, batch-backlog-20260707]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_024_2026-05-04T11-36-31Z.md"]
implementation-commits: [ec4e307d]
---

# TRDD-RR883ETW — Replace onMouseLeave reset on Delete-Team confirm with modal or timeout

## Problem
`components/sidebar/TeamCard.tsx` implements a 2-step inline "confirm" pattern for
deleting a team: clicking the Trash icon sets `confirmDelete=true` (line 23 declares
the state, line 138 sets it true on the Trash click), which swaps the Trash icon for
a "Confirm" button (line 128 onward). That Confirm button carries
`onMouseLeave={() => setConfirmDelete(false)}` (line 132), which silently resets the
confirm state the instant the pointer leaves the button — verified still present at
these line numbers on 2026-07-07 (component structure unchanged since the report was
written on 2026-05-04).

This is bad on two fronts:
1. **Automation-hostile**: any browser-driven click that moves the mouse cursor to
   the Confirm button's coordinates (the standard `page.mouse.click(x, y)` pattern)
   resets the state before the click lands, because the mouse necessarily transits
   through/near the button before arriving. Only a same-JS-turn `.click()` with no
   intervening mouse move works, which is a Rule 6 (STICK-TO-UI) automation-fragility
   risk — test authors are tempted toward DOM-bypass shortcuts out of frustration.
2. **Inconsistent with Delete Agent**: `DeleteAgentDialog` (used for the Delete Agent
   flow: Profile → Advanced → Danger Zone) uses a proper modal with explicit
   Cancel/Confirm buttons and no hover-driven state reset. Delete Team is the only
   destructive-action surface in the app still using the fragile inline-hover pattern.

## Root cause
`onMouseLeave` was added as a lightweight guard against accidental double-clicks,
without considering it would also fire on any real mouse movement toward the Confirm
button itself, and without considering automated testing at all.

## Proposed fix
Preferred: open the existing `DeleteTeamDialog` modal (already used elsewhere in the
codebase for the team-deletion password + checkbox flow) directly from the Trash icon
click in `components/sidebar/TeamCard.tsx`, removing the inline 2-step
Trash→Confirm affordance and its `confirmDelete` state entirely. This matches the
Delete Agent pattern exactly and removes the automation-hostile hover coupling.

Fallback (minimal diff, if the dialog isn't wired at this call site yet): replace the
`onMouseLeave` handler with a `useEffect` that resets `confirmDelete` after a 5-second
timeout instead of on pointer-leave:
```tsx
useEffect(() => {
  if (!confirmDelete) return
  const t = setTimeout(() => setConfirmDelete(false), 5000)
  return () => clearTimeout(t)
}, [confirmDelete])
```
and delete the `onMouseLeave={() => setConfirmDelete(false)}` prop.

Files: `components/sidebar/TeamCard.tsx` (state + handlers), and if the modal route is
chosen, verify `DeleteTeamDialog`'s existing props (password, checkbox, Cancel/Confirm)
already cover the sidebar Trash-icon entry point.

## Verification
Drive a scenario's team-delete step with the standard `page.mouse.click(x, y)` pattern
(no same-JS-turn DOM `.click()` workaround) and confirm the delete action completes
without the confirm state resetting. Manual: hover the team card, click the Trash
icon, move the mouse elsewhere, and confirm the Confirm affordance (or modal) is still
present/open.

## Estimated risk
LOW — isolated to one component's local state; no API or data-model changes.
Dependencies: none. If the modal route is chosen, verify `DeleteTeamDialog` is already
imported/available for use from `TeamCard.tsx`, or plumb a callback from the parent.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2). Prefer the modal route (matches DeleteAgentDialog pattern).
- 2026-07-07T14:17:52+0200 — IMPLEMENTED (wave W3): took the preferred modal route — `components/sidebar/TeamCard.tsx`'s Trash icon now calls `onDelete(team)` directly (removed `confirmDelete` state + the onMouseLeave-reset 2-step affordance); `TeamListView.tsx` already owns the password+checkbox delete modal via `onDelete`, so no new wiring was needed there.
- 2026-07-07T14:58:53+0200 — COMPLETED (implementation-commits recorded); archived per the TRDD lifecycle.
