---
trdd-id: S7V7PMDZ
title: Smooth-scroll to the current search match even when its row is already rendered
column: proposal
created: 2026-07-07T12:44:38+0200
updated: 2026-07-07T12:44:38+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: LOW
effort: S
labels: [scenario-improvement, scen-027, batch-backlog-20260707]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_027_2026-05-23T00-42-41Z.md"]
---

# TRDD-S7V7PMDZ — Smooth-scroll to the current search match even when its row is already rendered

## Problem

This is the lighter sibling of TRDD-W0841DFE (P1-PROP-001, same batch):
even when the current search match's line IS already loaded/rendered in
the Sessions tab's chat transcript, clicking Next/Previous match does not
scroll the viewport to bring that row into view if it happens to be
off-screen (above or below the currently-visible scroll position). The
user has to manually scroll to see the newly-highlighted match.

## Root cause

Confirmed at HEAD (2026-07-07): the search-navigation handlers `nextMatch`
/ `prevMatch` in
`components/agent-profile/sessions/useJsonlSession.ts:1303-1317` only
update the `matchIndex` state; there is no `scrollIntoView` call anywhere
in `components/agent-profile/sessions/ChatTranscript.tsx` tied to
`currentMatchLine` changing. The highlight itself renders correctly once
the row is in the DOM (see `ChatTranscript.tsx:843-986` and
`MessageBubble.tsx:411-599`) — only the "bring it into the visible
viewport" step is missing, exactly as for the fully-off-loaded-range case
in TRDD-W0841DFE.

## Relationship to TRDD-W0841DFE

TRDD-W0841DFE (P1-PROP-001) handles the harder case where the target
match's line has not even been progressively loaded yet, and needs a
load/jump step before it can be scrolled to. This proposal (P2-PROP-003)
covers the simpler case where the row already exists in the DOM but is
merely scrolled out of the visible viewport.

**If W0841DFE is approved and implemented first**, its fix (which adds a
`scrollIntoView` call on the resolved current-match DOM node after
ensuring the line is loaded) will almost certainly satisfy this proposal
as a side effect, since "already loaded" is a strict subset of "loaded
after the jump logic runs". In that case this TRDD should be closed as
`superseded` by W0841DFE's implementation commit rather than implemented
separately. If W0841DFE is NOT approved (e.g. deferred because
progressive-load jumping is judged too risky for now), this narrower fix
can still land independently and captures most of the user-visible value
at much lower risk.

## Proposed fix

In the same search-navigation effect described in TRDD-W0841DFE (or, if
that proposal is not adopted, as a standalone minimal change): after
`currentMatchLine` changes and the corresponding row is confirmed present
in the DOM, call:
```ts
matchEl.scrollIntoView({ behavior: 'smooth', block: 'center' })
```
on the DOM node holding that line (see TRDD-W0841DFE's proposed
`data-line-index` attribute for how to locate it).

## Verification

Repeat SCEN-027 S014 with a transcript long enough that the current match
starts off-screen but within the already-loaded range; the page should
smooth-scroll to bring it into view without needing any additional data
load.

## Estimated risk

LOW — a single `scrollIntoView` call, no data-loading logic involved.

## Approval log
