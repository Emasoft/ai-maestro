---
trdd-id: Y8VPE3NS
title: Retry-wedge event the ai-maestro 90 contract
column: todo
blocked-by: []
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-08-21T15:01:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
priority: 2
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
implementation-commits: [8e78c09b, 73c9b27c]
---

## ⏹ TRIAGE 2026-08-02T15:2x+0200 — `dev` → `todo`, nobody is working this ([[5YRLA53W]])

Re-columned, not closed. The last acceptance box is genuinely OPEN — the two empirical PTY unknowns
must be **OBSERVED**, and observation is work nobody has done. It had sat in `dev` for 8 days
claiming active work; with one worker that was untrue. Nothing about the work changed, only the
claim.

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

**POLL SITE LANDED 2026-07-25 (`73c9b27c`) — `lib/fleet-continuity.ts`, watchdog leg 3.**
SUPERSEDED above: "no live poll site exists / the whole path is dark" is no longer true, and the
plan to feed it from `lib/agent-frame-reader.ts` was ABANDONED on contact with the requirement —
that reader renders a PTY stream, and a PTY exists only while a browser is attached to the agent's
terminal. The agents this automaton exists for are precisely the unattended ones, so it would have
read empty forever while appearing to work. The poll uses `tmux capture-pane -p` (visible pane
only; scrollback would let an hour-old banner re-trigger forever), which needs no browser.

**WHAT REMAINS (box 5b):**
1. **The two empirical PTY unknowns** the Spec names, both needing a genuinely wedged agent to
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
- [x] **A poll site drives it** — `lib/fleet-continuity.ts`, wired as the third leg of the
      fleet-liveness watchdog (`73c9b27c`), 13 tests. It reads the pane with `tmux capture-pane`,
      NOT the `@xterm/headless` reader built in E1: a PTY only exists while a browser is attached,
      and the agents this exists for are the unattended ones — the reader would have returned empty
      forever while looking healthy.
- [ ] **The two empirical PTY unknowns are OBSERVED, not assumed** — transcript-append during
      retry, and whether ESC yields `on-stop-failure` vs a plain `Stop` (if `Stop`, call
      `ensure-resume` after ESC). This needs a REAL wedged agent, which cannot be manufactured on
      demand; it is armed and waiting for the next natural occurrence. Split from the box above
      rather than ticked with it: the automaton now runs, but its response has still never been
      watched landing on a real wedge.
      **⚠ 2026-08-21 — this box is not WAITING, it is UNOBSERVABLE. `TRDD-7UWQ92WK` filed.**
      Measured from the server logs: **556 of 556** `[FleetContinuity]` observations since
      2026-08-06 are `not actuated (empty-frame)` — every one, both agents, two weeks — while a
      bare `tmux capture-pane -p` on those same live Claude sessions returns 954 / 1005 chars the
      same minute. The classifier has never received a frame, so no natural wedge could have fired
      it however long we waited. **An open box that reads as PATIENCE can be hiding BROKEN, and the
      card cannot tell you which** — one grep of the runtime logs could, and did.
      **CORRECTED the same hour (see 7UWQ92WK's `## RE-MEASURED`):** that run is **HISTORICAL** —
      it stops at the 2026-08-20 18:53 log line, the server restarted at 21:24, and the production
      capture call returns 640/753 chars when probed in-process today. So this box may in fact now
      be merely waiting, as originally written. **What cannot be determined from the logs is which**,
      because a healthy continuity pass logs NOTHING at all — silence and a dead leg are the same
      observation. Do not tick this box on silence; it needs `7UWQ92WK`'s heartbeat line first.
      **✅ UNBLOCKED 2026-08-21T15:01 — the heartbeat line exists, twice** (`14:26:10` and
      `14:58:44`, both `pass ok: scanned 2, fired 0, skipped 0`). `7UWQ92WK` is `complete`, so this
      box is now genuinely **WAITING**, as originally written — the leg runs, sees both rendering
      agents, and classifies them healthy; a real wedge would now print `fired 1`. Still not
      tickable: it needs a natural occurrence, not more code. But the ambiguity that made it
      *possibly broken* is gone, and silence from here on means "no wedge happened", not "nothing
      ran".

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
- 2026-07-24T21:22:02+0200 — PROGRESS by ai-maestro (self-mandate). Detection + decision landed (`8e78c09b`); acceptance boxes 1-4 met by 16 tests. Box 5 (live poll site + the two empirical PTY observations) ADDED rather than silently omitted — the Spec required it and it cannot be met without a real wedged agent. Stays `dev`; the completion gate correctly holds it open.
- 2026-08-21T15:01:00+0200 — UNBLOCKED by ai-maestro-hub. `blocked-by: [7UWQ92WK]` cleared —
  that card reached `complete`, and `trddgrep validate` flagged the stale edge
  (`GRAPH-DANGLING-BLOCKER`) the moment it did. Restored to **`todo`**, NOT to the recorded
  `pre-block-column: dev`: git says this card was at `column: todo` in the commit before the block
  (`01ab0ff5^`), so that field had captured a column 8 days stale — it recorded where the card was
  before the 2026-08-02 triage, not where it was when blocked. Restoring `dev` would have re-asserted
  active work on a card whose one open box nobody can advance. **A `pre-block-column` written from
  memory instead of from the card's current column silently promotes a card on unblock.**
- 2026-07-25T22:18:19+0200 — PROGRESS (self-mandate). The POLL SITE landed (73c9b27c): lib/fleet-continuity.ts, watchdog leg 3, 13 tests. Box 5 SPLIT — the caller half is met; the two empirical PTY observations need a real wedged agent and stay open. Detection+classification had been complete and 0% reachable since 8e78c09b.
