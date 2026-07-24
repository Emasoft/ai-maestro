---
trdd-id: Y8VPE3NS
title: Retry-wedge event the ai-maestro 90 contract
column: dev
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T21:22:02+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-24T14:55:30+0200
parent-trdd: 5CIL7A07
derived: true
derived-kind: eht
relevant-rules: [ai-maestro-90]
implementation-commits: [8e78c09b]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: implement the retry-wedge event — the canonical ai-maestro#90 contract — detecting
`attempt N/300` spinning turns and injecting a single raw ESC.

**DETECTION + DECISION BUILT 2026-07-24 (commit `8e78c09b`). NOT complete — see box 5.**

- `lib/continuity-events-claude.ts` — `RETRY_WEDGE_RE` (byte-identical to the janitor's
  `is_retry_wedge`, pinned as a literal by a test so an "improvement" fails loudly rather than
  silently desynchronising the two processes), `parseRetryAttempt`, and the `retry-wedge` event:
  `response: { kind: 'esc' }`, plus the `progressMarker`.
- **The FP gate is generic, not retry-specific.** `ContinuityEvent.progressMarker` + the engine's
  `classifyContinuityWithEpisodes`: an event fires only when its marker STRICTLY ADVANCES since
  the previous poll. A first sighting cannot fire; a tie cannot fire. E6's clients inherit it.
- The episode store is INJECTED (`ContinuityActuatorDeps.episodes`, the watchdog owns it) and is
  written back on EVERY poll — including polls a gate refused, or the next advance would be
  measured against a stale value and the wedge would be undetectable while the gate held.
- Accepted limitation, documented in code: `parseRetryAttempt` takes the FIRST match, so a doc
  quoting the pattern ABOVE a genuine retry masks it. Missing a wedge costs one stalled turn the
  ladder still catches; scanning for the highest number would let a static high value mask a live
  counter forever. Fail toward under-detection.

**WHAT REMAINS (box 5) — do not mistake this for done:**
1. **No live poll site exists.** Nothing calls `actuateContinuity` yet: there is no loop reading
   frames via `lib/agent-frame-reader.ts` and feeding observations in. The whole path is dark, so
   the event has never run against a real agent. This wiring is cross-child (E3/E4/E5 all need
   it) — as an EHT this TRDD may not spawn its own children (depth-1), so the wiring belongs to a
   SIBLING under E0 (5CIL7A07), or to E0 itself.
2. **The two empirical PTY unknowns** the Spec names, both needing a genuinely wedged agent to
   observe: (a) does the transcript append during a retry; (b) does ESC land on
   `on-stop-failure` or on a plain `Stop` — if plain `Stop`, call `ensure-resume` after the ESC.

NEXT ACTION: build the poll site (sibling TRDD under E0), then observe one real wedge.

## Spec

- Regex **byte-identical** to the janitor's `is_retry_wedge`
  `/retrying\s+in\b.*\battempt\s+(\d+)\s*\/\s*\d+/i` (capture attempt N).
- **FP gate = attempt must ADVANCE across polls** (persist per-agent episode: advance=wedged,
  tie=keep polling, vanish=clear); never gate on the usage %.
- Response = **one raw ESC (0x1B)**, a second only past cooldown; **NEVER a command, Enter, or
  Ctrl-C**; after ESC do nothing (abort → `on-stop-failure` → `rate-limited.flag` → resume).
- ESC is a **prerequisite for rotation** (a wedged turn holds the old credential).
- Verify the two empirical unknowns on our PTY (transcript-append during retry; ESC→
  `on-stop-failure` vs plain `Stop` → if `Stop`, call `ensure-resume` after ESC).

## Acceptance

- [x] Attempt-advancing frames → exactly one ESC per window — polling 11→15 injects exactly once;
      a second ESC only past the cooldown (`retry-wedge-event.test.ts`)
- [x] The **static-string case** (this plan / #90 text) → **NO ESC** — a document quoting a real
      wedge line survives 10 polls with zero injections (it never advances)
- [x] A progressing agent → NO ESC — ordinary working frames classify to `no_event`
- [x] Usage-% ignored — a high usage % on a healthy screen does not fire, and an advancing wedge
      fires regardless of the % shown; the percentage is never read in either direction
- [ ] **Live**: a poll site drives it against a real agent, and the two empirical PTY unknowns
      (transcript-append during retry; ESC → `on-stop-failure` vs plain `Stop`) are OBSERVED, not
      assumed — see the STATE block. Until this box is checked the event has never run for real.

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
- 2026-07-24T21:22:02+0200 — PROGRESS by ai-maestro (self-mandate). Detection + decision landed (`8e78c09b`); acceptance boxes 1-4 met by 16 tests. Box 5 (live poll site + the two empirical PTY observations) ADDED rather than silently omitted — the Spec required it and it cannot be met without a real wedged agent. Stays `dev`; the completion gate correctly holds it open.
