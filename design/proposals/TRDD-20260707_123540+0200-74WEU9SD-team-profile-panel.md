---
trdd-id: 74WEU9SD
title: Add a Team Profile Panel for unified team management
column: proposal
created: 2026-07-07T12:35:40+0200
updated: 2026-07-07T12:35:40+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: LOW
effort: L
labels: [scenario-improvement, scen-024, batch-backlog-20260707]
task-type: feature
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_024_2026-05-04T11-36-31Z.md"]
---

# TRDD-74WEU9SD — Add a Team Profile Panel for unified team management

## Problem
Team management is scattered across disconnected surfaces: edit/delete happen via
sidebar hover icons on the team card, creation happens via a top-of-sidebar button,
and there is no unified admin/profile view analogous to the 5-tab Agent Profile Panel
(Overview / Config / Sessions / Advanced / Danger Zone) that agents already have.
Verified on 2026-07-07: `ls components/team-profile/` returns nothing — the directory
does not exist, confirming this gap is still open. A user who wants to add/remove
members, change the team description, audit R12/COS status, or delete the team must
hover the sidebar card and interact with small hover-only icons, which is inconsistent
with the rest of the app's element-management UX.

## Root cause
Team UI was built incrementally around the sidebar card and the (now-deprecated) team
meeting page, without a dedicated admin surface being carried forward when team
meetings were simplified.

## Proposed fix
Create `components/team-profile/TeamProfilePanel.tsx`, modeled directly on
`components/agent-profile/AgentProfilePanel.tsx`'s tab structure:
- **Overview**: team name, description, COS (name + label), member count, R12 status,
  blocked status.
- **Members**: list with avatars, governance titles, add/remove buttons (destructive
  member-removal gated behind sudo-mode per the existing sudo-token pattern).
- **Settings**: GitHub project URL, kanban sync toggle, description editing.
- **Advanced → Danger Zone**: Delete Team button opening the existing
  `DeleteTeamDialog` (full modal, replacing the sidebar hover-icon entry point per
  TRDD-RR883ETW).

Trigger: clicking the team card (not just hovering) selects the team AND opens the
profile panel; keep the Trash icon in the hover bar as a power-user shortcut that
still routes through the same modal.

Files: `components/team-profile/TeamProfilePanel.tsx` (new), `components/sidebar/TeamCard.tsx`
(wire `onClick` to open the panel), `app/page.tsx` (mount the panel next to
`AgentProfilePanel`'s existing mount point).

## Verification
Click a team card in the sidebar → the Team Profile Panel opens with the four tabs
populated from `GET /api/teams/[id]`. Add/remove a member via the Members tab and
confirm it round-trips through the existing team-membership API. Delete via Advanced
→ Danger Zone and confirm it opens the same `DeleteTeamDialog` used elsewhere.

## Estimated risk
LOW — additive UI feature using existing team API endpoints; no new backend routes
required. Dependencies: benefits from TRDD-RR883ETW (Delete-Team modal fix) landing
first so the Danger Zone tab has one canonical dialog to open, but is not blocked by it.

## Approval log
