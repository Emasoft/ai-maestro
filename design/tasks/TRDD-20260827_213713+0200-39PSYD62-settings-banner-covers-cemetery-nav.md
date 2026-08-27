---
trdd-id: 39PSYD62
title: The Update Available banner overlaps the Settings Cemetery nav item so a click at its centre hits the banner
column: planned
created: 2026-08-27T21:37:13+0200
updated: 2026-08-27T21:52:00+0200
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

## Root cause — REVISED 2026-08-27 by reading the code; the inherited claim does not survive it

The parent card said "a z-order/layout overlap in the Settings sidebar". Read against the code,
that cannot be what happens:

- The "Update Available" element is an **inline `<span>`** in the page **footer**
  (`app/settings/page.tsx:113`, `components/VersionChecker.tsx:101-109`) — no `fixed`, no
  `absolute`, no z-index. The only `z-50` in the checker is its *modal overlay* (`:115`), which
  renders only after the badge is clicked.
- The page is `h-screen` flex-column (`:62`) → a `flex-1 overflow-hidden` row holding sidebar +
  content (`:77`) → a `flex-shrink-0` footer (`:109`). The footer is a **sibling below** the row,
  never over it. Nothing in this tree can paint the badge on top of a nav item.
- The nav itself is `flex-1 min-h-0 overflow-y-auto` (`components/SettingsSidebar.tsx:145`)
  holding **17 tabs**; `cemetery` is the 13th in declaration order.

So the probable mechanism is the opposite of an overlap: at the runner's viewport the nav is
**clipped**, the Cemetery item sits **below the fold** inside the scrollable nav, and
`document.elementFromPoint()` at its *computed* centre returns whatever is painted at that screen
coordinate — the footer, which holds the badge. The symptom the runner reported is real; the
cause it named is not. That changes the fix entirely: if this holds, the defect is the **probe
not scrolling the item into view** (a scenario-helper bug), not a CSS bug in the app, and
"render the banner above the nav flow" would change nothing.

**This is code-derived and NOT yet measured live**, which is exactly what the acceptance box
below requires. It needs a logged-in dev-browser session at the runner's viewport, and this
session declined to reach for the governance credential to get one. Parked here rather than
closed on a reading.

## Proposed fix

Render the banner above the nav flow rather than over it, or otherwise ensure it cannot cover a
nav target. Split from `TRDD-JU6Y2V7X` because its verification is a LIVE `elementFromPoint`
probe in the dashboard — a browser job, unlike that card's scenario-authoring items.

## Verification

`document.elementFromPoint()` at the Cemetery item's centre resolves inside that item, with the
banner visible.

## Acceptance

- [ ] FIRST, settle the mechanism live: at the SCEN-001 viewport (1280×800), with the nav
      unscrolled, read `getBoundingClientRect()` of the Cemetery item and of the nav's
      `overflow-y-auto` container. If the item's rect lies outside the container's visible rect,
      the revised root cause holds and the fix belongs in the scenario helpers
      (`scrollIntoView` before the click), not in the app.
- [ ] If instead the item IS in view and `elementFromPoint` still resolves to the footer, the
      original overlap claim holds after all — then fix the layout, and record what in the code
      above was misread.
- [ ] Whichever branch: `elementFromPoint` at the Cemetery nav centre is inside the nav item
      (measured via dev-browser, not asserted from CSS).
- [ ] The Update Available badge is still visible and clickable afterwards.

## Approval log

- 2026-08-27T21:37:13+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement:
  none). Split out of TRDD-JU6Y2V7X on implementation.
