---
trdd-id: 39PSYD62
title: The Update Available banner overlaps the Settings Cemetery nav item so a click at its centre hits the banner
column: complete
created: 2026-08-27T21:37:13+0200
updated: 2026-08-28T06:31:56+0200
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

## Proposed fix — contingent on the first acceptance box

Two candidate fixes, mutually exclusive, and the live measurement picks one:

- **If the item is below the fold** (the code-derived expectation): fix the scenario helpers —
  `scrollIntoView` the target before every nav click in
  `tests/scenarios/scripts/dev-browser-helpers/aim-helpers.sh`, so a computed centre is always an
  on-screen centre. No app change.
- **If the item is in view and the footer still wins**: the original claim — render the badge
  where it cannot cover a nav target — and record what in the layout reading above was wrong.

Split from `TRDD-JU6Y2V7X` because its verification is a LIVE `elementFromPoint` probe in the
dashboard — a browser job, unlike that card's scenario-authoring items. (The first draft of this
section prescribed the layout fix unconditionally; that was the parent card's claim carried
forward unread.)

## Verification

`document.elementFromPoint()` at the Cemetery item's centre resolves inside that item, with the
Update Available badge rendered — via dev-browser at 1280×800, never asserted from CSS.

## Acceptance

- [x] FIRST, settle the mechanism live: at the SCEN-001 viewport (1280×800), with the nav
      unscrolled, read `getBoundingClientRect()` of the Cemetery item and of the nav's
      `overflow-y-auto` container. If the item's rect lies outside the container's visible rect,
      the revised root cause holds and the fix belongs in the scenario helpers
      (`scrollIntoView` before the click), not in the app.
      **Settled 2026-08-28 — the mechanism is real, but NOT on Cemetery any more.** Cemetery is
      *inside* the visible rect (item 673-733, nav 129-763), so its own probe resolves correctly.
      The mechanism was instead reproduced live on `Plugin Updates`, and the fix does belong in
      the tooling, not the app. See `## Live measurement` below.
- ~~[ ] If instead the item IS in view and `elementFromPoint` still resolves to the footer, the
      original overlap claim holds after all — then fix the layout, and record what in the code
      above was misread.~~ **OBSOLETE — the antecedent is false and was measured false.** Cemetery
      IS in view, and `elementFromPoint` at its centre returns the Cemetery item, not the footer.
      The layout branch is therefore dead: the footer is `position: static`, `z-index: auto`, and
      occupies 763-800, i.e. it *starts* exactly where the nav's visible box ends. Nothing in the
      footer can paint over a nav item. Nothing in the code reading was misread.
- [x] Whichever branch: `elementFromPoint` at the Cemetery nav centre is inside the nav item
      (measured via dev-browser, not asserted from CSS). — measured: centre (128, 703) → the
      Cemetery item itself, `hitIsItem: true`.
- ~~[ ] The Update Available badge is still visible and clickable afterwards.~~ **NOT MEASURABLE
      as written, and superseded by a stronger check.** The badge renders only when an update is
      available; this host is current, so `badgePresent: false` and there is nothing to click. The
      substantive claim was settled structurally instead: `<VersionChecker />` renders inside
      `<footer>` (`app/settings/page.tsx:113`), and that footer was measured at 763-800 — below
      the nav in every case, badge or no badge. Ticking this box on a run where the badge never
      rendered would have asserted something the run could not see.

## Approval log

- 2026-08-27T21:37:13+0200 — MANDATE issued by ai-maestro-hub-session (min-approval-requirement:
  none). Split out of TRDD-JU6Y2V7X on implementation.
- 2026-08-28T06:31:56+0200 — column → complete by ai-maestro-hub-session. Settled live at
  1280×800: the revised root cause is CONFIRMED (reproduced on `Plugin Updates`) and the original
  overlap claim is REFUTED (footer is static, z-auto, and begins at the nav's bottom edge).
  Cemetery itself no longer reproduces the defect. NO code change: the prescribed `scrollIntoView`
  fix has no call site — the tooling navigates settings by URL and uses selector clicks, which
  scroll into view themselves. Two boxes struck through with reasons rather than ticked.

## Live measurement — 2026-08-28, dev-browser, 1280×800, logged in, nav unscrolled

| element | rect (y…bottom) | note |
|---|---|---|
| nav scroll container | 129…763 | `overflow-y: auto`, `scrollHeight` 1164 vs `clientHeight` 634 — genuinely clipped |
| Cemetery item | 673…733 | **inside** the visible box, by 30 px |
| footer (`<footer>`, holds `<VersionChecker/>`) | 763…800 | `position: static`, `z-index: auto` |

`elementFromPoint` at each item's own computed centre:

| item | centre | below fold | resolves to | correct |
|---|---|---|---|---|
| `Plugin Updates` | (128, 775) | yes | **`v0.37.2`** — the footer | ✗ |
| `Cemetery` | (128, 703) | no | `Cemetery` | ✓ |

**The revised root cause is confirmed and the original claim is refuted.** A clipped item's
computed centre can land in the footer's 763-800 band, and `elementFromPoint` returns whatever is
*painted at that screen coordinate* — the footer wins by owning the pixel, not by z-order. The
footer is static with no z-index and begins exactly at the nav's bottom edge, so the "banner
overlaps the nav" story was never geometrically possible.

**But Cemetery no longer reproduces it.** 8 of the 17 nav items are currently below the fold
(Plugin Updates, Diagnostics, Analytics, Janitor Report, Experiments, Onboarding, Help, About);
Cemetery is not among them. The 2026-07-29 report was almost certainly taken when the item set
put Cemetery under the fold — the same mechanism, a different item.

## Outcome — NO code change, and why that is the finding rather than a shrug

The card offered two fixes and the measurement picked the tooling branch. Then the tooling branch
turned out to have **no call site**:

- `grep -rn 'elementFromPoint' tests/scenarios/` → nothing in the tooling (only an old
  `.claude/chat_history/` export, which is a transcript, not code).
- `aim_navigate_settings` navigates by **URL** (`settings?tab=<tab>`), never by clicking a nav
  item, so it cannot be caught by this at all.
- The remaining helpers use `page.click(selector)`, and Playwright-style clicks scroll the target
  into view themselves.

So adding the prescribed `scrollIntoView` guard would be a guard with nothing to guard — a
speculative fix for a call site that does not exist. It is deliberately NOT added.

**What is left is a latent hazard, recorded so the next person meets it with an explanation
instead of a mystery:** Cemetery clears the fold by 30 px, so adding a single nav item above it
puts it back under, and any future coordinate-based or `elementFromPoint`-based probe will then
resolve to the footer and look exactly like a z-order bug. It is not one. Scroll the target into
view before computing its centre.
