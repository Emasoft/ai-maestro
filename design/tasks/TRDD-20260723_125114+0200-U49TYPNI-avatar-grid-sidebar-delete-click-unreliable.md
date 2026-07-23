---
trdd-id: U49TYPNI
title: avatar-grid sidebar view — agent card clicks unreliable, delete flow only reliable in compact view
column: planned
created: 2026-07-23T12:51:14+0200
updated: 2026-07-23T12:51:14+0200
current-owner: session
task-type: bugfix
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-23T12:51:14+0200
relevant-rules: []
eht: []
npt: []
implementation-commits: []
external-refs:
  - reports/scenarios-runner/SCEN-031_20260723T033213Z.report.md (ISSUE-002)
---

# TRDD-U49TYPNI — Avatar-grid sidebar view: agent card clicks unreliable, near-miss on Delete

## Problem

Run `SCEN-031_20260723T033213Z` (ISSUE-002, INFO) found that in the sidebar's **avatar-GRID** view,
agent cards use labels + off-screen scroll + footer overlays that **do not reliably trigger onClick**
— clicking a card's label/footer area intermittently fails to select the intended agent. Delete-agent
flows driven this way were unreliable; the runner's helper (`aim_delete_agent`) only worked
consistently when the sidebar was switched to **COMPACT view** first.

This is more than a cosmetic nuisance: a **near-miss occurred during the run** — a delete attempt in
avatar-grid view landed on the wrong agent (a pre-existing, protected `e2e-br-1783777802`), and was
only caught because a separate placeholder-identity guard (asserting the delete-confirmation dialog's
placeholder text matches the intended target) refused to proceed. Without that guard, an unreliable
click target in the primary sidebar view could delete the wrong agent — a real, if narrowly averted,
destructive-action risk in production UI, not just test tooling.

## Proposed fix

1. Locate the avatar-grid sidebar card component (likely in `components/AgentList.tsx` or a
   grid-view variant) and identify why label text / footer overlay elements do not propagate clicks to
   the card's `onClick` handler — likely a stacking/`pointer-events` issue, or the footer overlay
   intercepting the click without forwarding it, or off-screen-scrolled cards receiving stale
   coordinates.
2. Ensure the entire card surface (including label and footer overlay regions) is a single,
   consistently clickable target regardless of scroll position — consistent with the "no nested
   buttons; use div+cursor-pointer, not overlapping click targets" UI convention already used
   elsewhere in this codebase (see CLAUDE.md § UI Enhancement Patterns).
3. Because a destructive action (Delete Agent) can be reached through this unreliable click path,
   treat this as a genuine safety-relevant UI bug — not merely a test-automation inconvenience —
   even though the sudo-mode + placeholder-identity confirmation dialog is the last line of defense
   that actually prevented harm this run.

## Verification

- Manually (or via a UI scenario) drive agent selection and the Delete Agent flow entirely from
  avatar-grid view (no switch to compact view) and confirm the correct agent is targeted every time,
  including for a card that requires scrolling to reach.
- Confirm the placeholder-identity guard in the Delete Agent confirmation dialog remains in place as
  defense-in-depth regardless of this fix (do not remove it once the click target is fixed).

## Estimated risk

MEDIUM. Touches a shared sidebar rendering component used across the whole dashboard; must verify no
regression in compact view or other card interactions (rename, profile-open, drag-and-drop where
applicable). No dependency on other open TRDDs.

## Approval log

- 2026-07-23T12:51:14+0200 — MANDATE by USER (report→TRDD conversion, "you have my trust").
