---
trdd-id: W0841DFE
title: Scroll the JSONL session transcript to the current search match
column: complete
created: 2026-07-07T12:44:38+0200
updated: 2026-07-07T14:58:53+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: MEDIUM
effort: M
labels: [scenario-improvement, scen-027, batch-backlog-20260707]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_027_2026-05-23T00-42-41Z.md"]
implementation-commits: [ec4e307d]
---

# TRDD-W0841DFE — Scroll the JSONL session transcript to the current search match

## Problem

In the Sessions tab's chat transcript (the JSONL session browser shipped by
the `jsonl-session-browser` feature, verified end-to-end by SCEN-027 on
commit `94f00b5b`), clicking "Next match" / "Previous match" in the search
bar advances the match counter (e.g. `2 / 4`, `4 / 4`) but the transcript
does not scroll to bring the new current match into view when that match's
message is not currently loaded/rendered. The user sees the counter change
with no visible change in the transcript and has to manually scroll to find
what it's pointing at.

Verified empirically in SCEN-027 run `20260523T002735Z`, step S014: at
positions `2 / 4` and `4 / 4` the DOM had zero `<mark>`/highlighted element
for the current match even though the indicator clearly counted them.

## Root cause

Confirmed at HEAD (2026-07-07) by reading the actual implementation:

- `components/agent-profile/sessions/useJsonlSession.ts:1303-1317` —
  `nextMatch()` / `prevMatch()` only update `matchIndex` state via
  `setMatchIndex`. Neither function requests a scroll, nor checks whether
  the target match's line is currently loaded.
- `components/agent-profile/sessions/ChatTranscript.tsx` is **not** a
  windowed/virtualized list (no `react-window` / `react-virtual` import).
  It uses **scroll-triggered progressive loading**: `onScroll` (line 645,
  wired at line 825) calls a `loadMore` path that appends more lines as the
  user scrolls near the edge (see the comment at
  `useJsonlSession.ts:1056`, "next loadMore continues, and bump totalLines
  for the virtualizer"). So the correction to the earlier report's
  hypothesis: there is no `virtualizer.scrollToIndex()` API to call — the
  real problem is that a match whose line hasn't been progressively loaded
  yet is simply **not in the DOM at all**, and even a loaded-but-off-screen
  match has no `scrollIntoView()` call anywhere in `ChatTranscript.tsx`.
- The "is this the current match" flag IS correctly plumbed end-to-end
  once a line IS rendered: `ChatTranscript.tsx:843`
  (`const isCurrent = currentMatchLine !== null && currentMatchLine === line.lineIndex`)
  passes `currentMatch={isCurrent}` (line 986) into
  `MessageBubble.tsx:449` which renders the highlight via
  `renderBubbleText(...)` (line 411/598-599). So the highlight rendering
  itself works; only the "get the row on screen" step is missing.

## Related proposal

TRDD-S7V7PMDZ (same batch, P2 priority) covers the narrower case where the
target match's row is already loaded/rendered but merely scrolled out of
the visible viewport. If this proposal (W0841DFE) is implemented, its
`scrollIntoView` step will very likely satisfy S7V7PMDZ too — in that
case S7V7PMDZ should be closed as `superseded` rather than implemented
separately.

## Proposed fix

1. In `components/agent-profile/sessions/useJsonlSession.ts`, extend
   `nextMatch` / `prevMatch` (lines 1303-1317) so that after computing the
   new `matchIndex`, they check whether `matches[newIndex].lineIndex` is
   within the currently-loaded line range. If not, trigger the same
   "load more" / "jump to line" path already used for `loadMore` (see the
   comment near line 1056) repeatedly (or via a direct jump-to-line API if
   one exists in the Rust reader's index/search protocol —
   `rust-tools/aim-jsonl-reader/src/search.rs` and `src/index.rs`) until
   that line is loaded.
2. Once the target line is guaranteed to be in the loaded/rendered set,
   scroll it into view. Because `ChatTranscript.tsx` renders real DOM nodes
   for every loaded line (no windowing), a plain
   `element.scrollIntoView({ behavior: 'smooth', block: 'center' })` on the
   DOM node holding `currentMatchLine` is sufficient — no need for a
   virtualizer-specific API. Attach a stable `data-line-index={line.lineIndex}`
   attribute (or reuse an existing one if present) so the scroll effect can
   `document.querySelector` or use a `ref` map keyed by line index.
3. Add a small `data-current-match="true"` attribute on the current match's
   `<mark>` (rendered via `MessageBubble.tsx` `renderBubbleText`) so browser
   test assertions can locate it deterministically instead of scanning for
   highlight classes.

## Verification

Re-run SCEN-027 step S014 (or a new focused scenario) with a session that
has search matches spread across many messages, including at least one
match whose line is beyond the initially-loaded window. After each
Next/Previous match click:
- the transcript visibly scrolls to bring the row into the viewport,
- `document.querySelector('[data-current-match="true"]')` is non-null and
  is within the visible viewport bounds (`getBoundingClientRect()` inside
  the scroll container's client rect).

## Estimated risk

LOW — additive change to the search-navigation handler and a scroll
effect; no change to existing highlight rendering or the progressive-load
mechanism itself. Main risk is over-triggering `loadMore` calls if the
jump-to-line logic isn't guarded against already-loaded ranges — guard
with a check against the currently loaded line-index bounds before
requesting more data.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2). Implement together with S7V7PMDZ (same surface).
- 2026-07-07T14:17:52+0200 — IMPLEMENTED (wave W3): re-reading the current code found the scroll-to-match wiring (offsets-based `ChatTranscript.scrollToLine` + `lineIndexToArrayPos`, `SessionsTab.tsx`) ALREADY EXISTED (landed under TRDD-1657a5f4), and `lineIndexToArrayPos` already handles the "already loaded but off-screen" case correctly via geometry, not DOM presence — so S7V7PMDZ's narrower case was already satisfied. The genuinely missing piece was progressive loading: a match beyond the currently-loaded page resolved to a CLAMPED (wrong) position. Added a jump-load effect in `useJsonlSession.ts` (generation-token-guarded loop over `appendRange` keyed on `nextFromRef`/`endReachedRef`) that keeps loading pages until the target raw line is covered or EOF; refactored `SessionsTab.tsx`'s scroll effect to depend on the RESOLVED array position (a memo) instead of only `matchIndex`/`matches`, so it re-fires once the jump-load lands the target line. Also added `data-current-match` to the `<mark>` in `MessageBubble.tsx` for deterministic test targeting.
- 2026-07-07T14:58:53+0200 — COMPLETED (implementation-commits recorded); archived per the TRDD lifecycle.
