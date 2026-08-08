---
trdd-id: SLSSUIQ8
title: Feed the rotator's usage decisions from the agentlenspro CLI (accounts, usage, costs)
column: planned
created: 2026-08-08T07:59:55+0200
updated: 2026-08-08T10:23:33+0200
current-owner: ai-maestro-hub-session
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
project-id: ai-maestro
implementation-commits: [b0a842c8, 66b4ec6e]
labels: [oauth-rotator, agentlenspro, usage]
relevant-rules: []
---

# Feed the rotator's usage decisions from the agentlenspro CLI

USER directive (session task #27): "Server daemon uses agentlenspro CLI for accounts/usage/costs."
The whole design below was VERIFIED first-hand on 2026-08-08 (~07:50–08:00); every file:line was
read this session and every CLI behavior measured live. Implementation deferred one work unit
deliberately: the wiring touches `lib/oauth-rotator/tick.ts` — the subsystem whose own comments
document the account-burning failure mode — and that edit deserves a fresh context, not the tail
of a twice-compacted session.

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-08 ~10:45

- **IMPLEMENTED**: commits `b0a842c8` (feature — all 4 files per the design, plus
  `types/statusline.ts` gaining the `'agentlens'` source-union member) + `66b4ec6e` (neuter
  record), both PUSHED on `governance-rules`. tsc 0; directly-affected suites 66/66 green
  (agentlens-usage, tick-status with its toEqual pins, tick, fallback-leg); neuters n1 (cohort
  guard) + n2 (s→ms) recorded with clean per-fixture attribution. n3 resolved as named unpinned
  residue (the wiring try/catch is defense-in-depth over never-throwing callees — measured, named
  in the test file's trailer, kept).
- **NEXT ACTION**: confirm the FULL suite run (started ~10:45, backgrounded) is green, then tick
  the acceptance box. NOT YET DEPLOYED: `lib/*.ts` is bundled — the change goes live on the next
  `yarn build` + restart cycle, deliberately not forced mid-fleet.
- Costs remain out of scope per the body's follow-up note.

## Verified facts (measured 2026-08-08, this host)

- `agentlenspro` is on PATH at `/opt/homebrew/bin/agentlenspro` (npm global; repo
  `Emasoft/AgentlensPro`). NOT a package.json dependency — treat as optional host tooling,
  fail-soft when absent.
- `agentlenspro statusline-history windows --json` works. Row shape (measured):
  `{ session_id: string, ts: epochMs, pct_5h: number, pct_7d: number, resets_5h: epochSec }`.
  Top level: `{ view, stream, sinceMs, sortedBy, newestSampleTs, samplesInWindow, count, rows }`.
  This is "the only un-quantized 5h/7d reading" per the CLI's own help, and reads DISK — answers
  with the agentlens server down.
- **THE ATTRIBUTION HAZARD (the reason this is not a trivial reader): rows carry NO account
  identity, and a live measurement showed rows from TWO accounts side by side** — session
  `f8420a06` read 23%/4% with `5h resets 00:00` while eleven sibling rows read ~52-60%/49-51%
  with `resets 10:00`. A timestamp-only attribution would hand the rotator another account's
  numbers — precisely the misattribution `lib/statusline-admissible.ts` exists to prevent
  (its header documents the loop that "burns every remaining account in minutes").
- **The attribution KEY is the reset instant**: `resets_5h` differs per account and the tick
  already holds the live account's value — `usageRequest`'s payload carries `resets_at` on both
  buckets (`lib/oauth-rotator/network.ts:608` reads it; `earliestResetMs(liveData)` at
  `tick.ts:~1115` consumes it).
- The daemon's existing statusline source: `statuslineNear` (`tick.ts:370-395`, TRDD-GY0LJV6S)
  → `listStatuslineSnapshots()` (`lib/statusline-store.ts:116`) → admission via
  `freshestAdmissibleUsage` / `admitSnapshot` (`lib/statusline-admissible.ts`). Observations are
  identity-stamped (`liveFp`) at INGEST; admission also rejects pre-switch rows
  (`last_switch_at` is epoch SECONDS — the documented ms/s unit trap).
- **Costs**: the windows view carries none. `watch --metric cost-5h|cost-7d|cost-per-min` exists
  but is a continuous watcher (no one-shot mode found). Costs are therefore OUT OF SCOPE for this
  card's implementation; see "Costs follow-up" below.

## Design (4 files, implement in this order)

1. **NEW `lib/oauth-rotator/agentlens-usage.ts`** — the reader + the pure mapper.
   - `readAgentlensWindowRows(deps?)`: `execFile('agentlenspro', ['statusline-history','windows','--json'], {timeout: 10_000})`,
     parse rows; fail-soft `[]` on ENOENT / non-zero / parse error / timeout (an absent CLI is a
     normal host state, never a fault). Injectable exec for tests.
   - `agentlensObservations(rows, opts)` — PURE. `opts = { liveFp, lastSwitchAtS, liveResets5hSec }`.
     A row maps to a `UsageObservation` (`{ liveFp, capturedAt: row.ts, rateLimits: { fiveHour:
     {usedPercentage: pct_5h}, sevenDay: {usedPercentage: pct_7d} } }`) ONLY when ALL hold:
     (a) `opts.liveResets5hSec` is a finite number — **no known live cohort ⇒ EMPTY output**
     (never guess); (b) `row.resets_5h === opts.liveResets5hSec` (the cohort match — the identity
     surrogate); (c) `row.ts >= lastSwitchAtS * 1000` (SECONDS→ms conversion, same trap as
     `admitSnapshot`). Rows failing any check are dropped, never defaulted.
   - The admission machinery then re-filters downstream — the mapper's stamps make agentlens rows
     first-class citizens of the EXISTING guard, not a bypass of it.
2. **`lib/oauth-rotator/tick-status.ts` + `tick.ts` (`WindowSnapshot`)** — persist the cohort.
   Add optional `fiveHourResetsAtSec: number | null` to `WindowSnapshot` (declared in tick.ts);
   write it where the windows stamp is built from `liveData` (bucket `resets_at`, normalized the
   D8OYFG35 way); validate in `windowsFor()` (drop non-finite, keep the snapshot — additive,
   never voiding). Additive-optional so `planModelFallback` and every existing fixture stay valid.
3. **`tick.ts` `statuslineNear`** — concat sources: `[...storeSnapshots, ...agentlensObservations]`
   with the agentlens read behind its own try (fail-soft), cohort from `readTickWindows()?.fiveHourResetsAtSec ?? null`,
   `liveFp`/`last_switch_at` from the same `state` already in scope. Injectable via the existing
   `TickDeps.readSnapshots` seam SHAPE (add `readAgentlensRows?` alongside it).
4. **Tests** (`tests/unit/agentlens-usage.test.ts` + additions to the statuslineNear suite):
   - mapper ladder: cohort match admitted (assert the FULL observation shape); cohort MISMATCH
     dropped (use the measured two-cohort fixture: 00:00 vs 10:00); no-cohort ⇒ empty (the
     fail-soft that prevents guessing); pre-switch `ts` dropped (fixture straddling the switch
     instant BOTH directions — the admitSnapshot lesson); ms/s: a `lastSwitchAtS` in seconds
     against `ts` in ms (the 1000× trap, in the direction that would admit everything).
   - reader: ENOENT ⇒ `[]`; non-zero exit ⇒ `[]`; garbage stdout ⇒ `[]`; a real-shaped JSON parses.
   - integration: `statuslineNear` with store empty + agentlens rows admissible reaches a `near`
     verdict; agentlens read THROWING leaves the pre-card behavior exactly (fail-soft
     — never rotate, never block).
   - NEUTERS (commit first): (n1) cohort check removed → the mismatch test reds (this is THE
     account-burning guard); (n2) drop the s→ms conversion → the unit-trap test reds; (n3) reader
     fail-soft removed (throw propagates) → the integration fail-soft test reds.

## Costs follow-up (out of this card's scope, tracked here so it is not lost)

`watch --metric cost-5h/cost-7d/cost-per-min` are continuous watchers. Either (a) upstream
one-shot mode (`--once`) — file on `Emasoft/AgentlensPro` per the cross-project rule (issue
first), or (b) a bounded `watch` spawn with immediate kill after first sample — measure before
choosing. Do NOT block this card on costs; usage attribution is the value.

## Acceptance

- [x] `agentlens-usage.ts` lands with the mapper ladder + reader fail-soft tests green (b0a842c8)
- [x] `WindowSnapshot.fiveHourResetsAtSec` persisted by the tick and re-read by `statuslineNear`
- [x] Neuters recorded in the test file, commit-first (66b4ec6e; n3 re-scoped to named
      unpinned residue — the wiring catch guards never-throwing callees, per the
      defense-in-depth discipline)
- [ ] Full suite green (`tsc --noEmit` 0 confirmed; suite run in flight at card-update time)
- [ ] Session task #27 closed against this card's `implementation-commits:`

## Approval log
