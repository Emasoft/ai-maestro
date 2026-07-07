---
trdd-id: 9IIC9CKT
title: Promote the context-breakdown heuristic-estimate disclaimer to a visible badge
column: refused
created: 2026-07-07T12:44:38+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: LOW
effort: S
labels: [scenario-improvement, scen-027, batch-backlog-20260707]
task-type: feature
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_027_2026-05-23T00-42-41Z.md"]
---

# TRDD-9IIC9CKT — Promote the context-breakdown heuristic-estimate disclaimer to a visible badge

## Problem

The Sessions tab's Context Breakdown panel shows a disclaimer — `No
/context snapshot in this session — heuristic only` — below the token
totals when the session never ran Claude Code's `/context` command. It is
easy to miss at its current position/contrast, so a user could believe
the displayed token breakdown is exact when it is actually an estimate.

## Root cause

Confirmed at HEAD (2026-07-07):
`components/agent-profile/sessions/ContextBreakdownPanel.tsx:774` renders
the disclaimer text inline, low-contrast, below the model name/totals.
There IS already a small `~` badge next to individual approximate values
(line 787: `{approximate && <span className="text-gray-500" title="Heuristic
estimate (char/4), not Claude's exact BPE count">~</span>}`), so partial
prior-art for a badge-style treatment exists — it's just not applied at
the top-level "no /context snapshot at all" case, which is the more
consequential disclaimer (it means the WHOLE breakdown is estimated, not
just one bucket).

## Proposed fix

In `components/agent-profile/sessions/ContextBreakdownPanel.tsx`, near
line 774:

1. Promote the "no /context snapshot" notice from body text to a small,
   high-contrast badge positioned directly next to the total-tokens
   header (e.g. `87.8K ~` with the existing `~` styling from line 787,
   or a distinct `[estimate]` chip), using a yellow/amber caution color
   rather than the current gray.
2. Attach a hover `title` tooltip with the full explanation ("Heuristic —
   no /context snapshot in this session. Token counts below are estimated
   via char/4, not Claude's exact BPE count."), consistent with the
   existing tooltip pattern used for the per-value `~` badge at line 787.
3. Keep (or shorten) the existing body-text disclaimer as a secondary,
   less prominent confirmation for users who read further down the panel
   — do not remove the information, just add a harder-to-miss primary
   signal.

## Verification

Open the Sessions tab / Context Breakdown panel for an agent session that
has never run `/context`; the estimate disclaimer should be immediately
visible near the totals header (not just as small text further down),
with a caution color distinguishing it from confirmed exact values.
Compare against a session that HAS run `/context` to confirm the badge
does NOT appear in that case (false-positive check).

## Estimated risk

LOW — a presentational change to an existing component; no data-layer
change, since the underlying "recorded vs. heuristic" flag already exists
(reused from the per-value `approximate` prop pattern at line 787).

## Approval log

- 2026-07-07T13:24:46+0200 — REFUSED by USER-delegated batch screening (tier 2). Cosmetic prominence tweak.
