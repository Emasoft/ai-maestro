---
trdd-id: 39PSYD62
title: The Update Available banner overlaps the Settings Cemetery nav item so a click at its centre hits the banner
column: planned
created: 2026-08-27T21:37:13+0200
updated: 2026-08-27T21:37:13+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub-session
approval-datetime: 2026-08-27T21:37:13+0200
derived: true
derived-kind: eht
parent-trdd: JU6Y2V7X
priority: 2
severity: minor
effort: small
labels: [scenario-improvement, scen-001, ui]
---

## Problem

In the Settings view, `document.elementFromPoint()` at the centre of the "Cemetery" nav item
resolves to the "Update Available" banner (`components/VersionChecker.tsx`), so a click at that
point activates the banner instead of the nav item (SCEN-001, 2026-07-29 run). Every scenario's
cleanup phase reaches Cemetery to purge test entries, so this is on the critical path of Rule 1.

## Root cause

A z-order/layout overlap in the Settings sidebar. Last measured 2026-08-21: no `z-index` /
`z-[` styling in `VersionChecker.tsx` or the settings sidebar — the only `z-50` is the checker's
modal overlay (`:115`), not the banner.

## Proposed fix

Render the banner above the nav flow rather than over it, or otherwise ensure it cannot cover a
nav target. Split from `TRDD-JU6Y2V7X` because its verification is a LIVE `elementFromPoint`
probe in the dashboard — a browser job, unlike that card's scenario-authoring items.

## Verification

`document.elementFromPoint()` at the Cemetery item's centre resolves inside that item, with the
banner visible.

## Acceptance

- [ ] With the Update Available banner shown, `elementFromPoint` at the Cemetery nav centre is
      inside the nav item (measured via dev-browser, not asserted from CSS).
- [ ] The banner is still visible and clickable in its new position.

## Approval log

- 2026-08-27T21:37:13+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement:
  none). Split out of TRDD-JU6Y2V7X on implementation.
