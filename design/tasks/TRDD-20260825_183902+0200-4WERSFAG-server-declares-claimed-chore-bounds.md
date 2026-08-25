---
trdd-id: 4WERSFAG
title: Server declares its claimed-chore staleness bounds in claim-bounds.json
column: todo
created: 2026-08-25T18:39:02+0200
updated: 2026-08-25T18:39:02+0200
current-owner: ai-maestro-e5
created-by: ai-maestro-e5
assignee: ai-maestro-e5
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
scope: project
project-id: ai-maestro
external-refs: [ai-maestro#126, docs/claimed-chores-contract.md, janitor ARCHITECTURE.md §9.2]
---

# Server declares its claimed-chore staleness bounds in claim-bounds.json

## Problem

The janitor's `claimed-chore-stale` detector alarms on `marketplace-refresh` in the last hour
of EVERY healthy cycle. Relayed 2026-08-25 by ai-maestro-web-scenario-tester (229m stale vs a
180m bound); measured the same minute by the hub: stamp age 233.7m, server cadence 4h
(`services/auto-update-service.ts` `ABSORBED_DUTY_INTERVAL_MS`, USER directive 2026-08-07
3h→4h), 14 of 15 sibling stamps seconds-to-minutes old — the lane is beating, the alarm is a
deterministic false positive in the `(180m, 240m]` window. The janitor's 180m bound is
`max(3×c, c+600)` over ITS OWN 3600s roster cadence — the NON-executor's.

## Root cause

The ratified fix exists and was never built. Rev-8 §9.2 (ai-maestro#126, mirrored at
`docs/claimed-chores-contract.md`, ratified 2026-08-18): the EXECUTOR declares its own bound in
`~/.claude/janitor-control/claim-bounds.json` (`{"<chore>": <bound_s>}`), and the janitor
watchdog reads it widen-only, fail-open. Measured 2026-08-25: the file does not exist, and
`grep -rn "claim-bounds" lib/ services/ server.mjs` returns zero code references — the server
repo carries only the mirror doc. The declaration lane is contract-ratified, doc-recorded, and
unbuilt.

## Fix

One writer, called at absorbed-scheduler start (and on any future cadence change, since the
value derives from the same constant):

- `lib/janitor-chore-stamp.ts`: `declareChoreBounds(map: Record<string, number>)` — writes
  `janitorControlDir()/claim-bounds.json` atomically (tmp+rename), value per chore
  `max(3*cadence_s, cadence_s + 600)`. Merge-preserve unknown keys (another executor may
  declare its own chores; this writer owns only the names it is handed).
- `services/auto-update-service.ts`: at scheduler start declare the chores this scheduler
  executes from `ABSORBED_DUTY_INTERVAL_MS` (today: `marketplace-refresh`,
  `github-config-audit` → 43200s each). Declaring a bound BELOW the janitor default (e.g.
  github-config-audit's 43200 < 64800) is harmless by contract — widen-only ignores it — so
  the writer declares unconditionally and never encodes the janitor's defaults.

## Acceptance

- [ ] `declareChoreBounds` exists, atomic write, merge-preserves foreign keys; unit test seeded
      both directions (fresh file created with the map; pre-existing foreign key survives a
      rewrite).
- [ ] Scheduler start declares `marketplace-refresh: 43200` (and github-config-audit), derived
      from `ABSORBED_DUTY_INTERVAL_MS` — not a second hardcoded copy of the cadence.
- [ ] After `yarn build` + pm2 restart, `~/.claude/janitor-control/claim-bounds.json` exists on
      disk with `marketplace-refresh >= 43200` (run: `cat ~/.claude/janitor-control/claim-bounds.json`).
- [ ] Verification command recorded for the janitor half (their observation, not this card's
      gate): the next `claimed-chore-stale` fire after a >180m stamp age should NOT name
      marketplace-refresh.

## Notes

- The lessons file records the sibling defect from 2026-08-20 (cadence 3h→4h shipped without
  finding the janitor's derived 180m bound); this card closes the class the ratified way
  instead of asking the janitor to hardcode our number.
