---
trdd-id: 3339cc45-c6ed-4704-9ccf-e8a473b5e471
title: De-fragilize the /context snapshot parser against future Claude Code line removals
status: completed
created: 2026-06-14T11:42:34+0200
updated: 2026-06-25T06:15:50+0200
---

# TRDD-3339cc45 — Make the /context snapshot parser resilient to dropped lines

**Source:** pre-merge correctness review of TRDD-1657a5f4. Report: `reports/chat-history-review/correctness-20260614_110801+0200.md`.

## Problem
`computeLocalContextBreakdown` in `services/sessions-browser/local-context-breakdown.ts` parses the Claude Code `/context` snapshot. TRDD-1657a5f4 just fixed a P0 where the parser hard-required an "Autocompact buffer" line that Claude Code REMOVED, silently dropping the ENTIRE recorded snapshot for every modern session. But the null-guard (≈ lines 1016-1027) STILL hard-requires `skills !== null` and `freeSpace !== null`. If a future Claude Code version drops the "Skills" or "Free space" line the way it dropped "Autocompact buffer", the whole recorded snapshot silently drops again — identical regression class, re-armed.

## Proposed change
Make per-bucket fields default to 0 (or omit them from the hard null-guard) rather than treat any single missing line as fatal to the whole snapshot. Keep a snapshot as long as the load-bearing total is parseable; treat individual missing buckets as 0 (with a note), not as a drop.

## Derived tasks / risks
- Decide the minimum field set that MUST be present for a snapshot to be meaningful (likely the printed total + ≥1 bucket); everything else defaults to 0.
- Add a parser test feeding a `/context` block with the "Skills" line removed and asserting the snapshot is still produced — a regression lock for the NEXT line Claude drops.
- Confirm the recorded-vs-heuristic Δ in `ContextBreakdownPanel` degrades gracefully when a bucket is 0-defaulted (don't render a misleading Δ against a 0-defaulted bucket).

## Acceptance
- A `/context` block missing any single non-total line still yields a recorded snapshot.
- New parser test locks the resilience; `yarn test` + `tsc --noEmit` green.

## Implementation (2026-06-25)
Landed in two atomic commits:
- **`e7130809`** — parser fix in `local-context-breakdown.ts`: the null-guard now
  hard-requires ONLY the load-bearing header (`total` + `modelContextLimit`); every
  per-bucket line (systemPrompt/customAgents/memory/skills/messages/freeSpace) 0-defaults
  when absent and is recorded in a new `missingFields: string[]` on `ParsedContextSnapshot`
  + `RecordedContextSnapshot`. A snapshot missing the header total is still dropped. +4
  no-mock tests (real temp-JSONL fixtures) in `tests/unit/local-context-breakdown-parser.test.ts`:
  Skills-line-removed still yields a snapshot (skills=0, missingFields=['skills']); surviving
  buckets unaffected; all-present → missingFields=[]; total-removed still drops. 10/10 green.
- **`26481ae4`** — Δ-degradation (the "don't render a misleading Δ" derived task): wired
  `missingFields` through `RecordedContextSnapshotWire` (`types/sessions-browser.ts`) + the
  route's `RecordedSnapshotSchema` (zod would otherwise strip it) so the panel's BarRow +
  drill-down null out `recordedValue` for a 0-defaulted bucket → no Δ badge, no "captured
  /context" tooltip. A bucket genuinely captured as 0 is NOT in missingFields, so its real Δ
  still shows; the total Δ is untouched (load-bearing). tsc 0; route-isolation 24/24.
