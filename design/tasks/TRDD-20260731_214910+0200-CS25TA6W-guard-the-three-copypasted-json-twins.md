---
trdd-id: CS25TA6W
title: Three sibling modules carry an unguarded copy of the same JSON read-modify-write pair
column: todo
scope: project
project-id: ai-maestro
created: 2026-07-31T21:49:10+0200
updated: 2026-07-31T21:49:10+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-31T21:49:10+0200
relevant-rules: [R51]
derived: true
derived-kind: eht
parent-trdd: K71FV649
npt: []
eht: []
blocked-by: []
implementation-commits: []
---

## Problem

`6c175813` put a guard inside `services/element-management-service.ts`'s `saveJsonSafe`: it refuses
to overwrite a target that exists and does not parse, because on a corrupt settings file the
lenient reader answers `{}` and the atomic write then REPLACES the file. That closed 21 of 21
read-modify-writes in that module.

**Three sibling modules carry their own copy-pasted `loadJsonSafe`/`saveJsonSafe` pair, and none of
them got the guard.** Measured 2026-07-31:

| module | reader/writer | writes | RMW | targets |
|---|---|---|---|---|
| `services/role-plugin-service.ts` | `:323` / `:333` | 3 | 3/3 | `~/.claude/settings.json` ×2, a per-agent `settingsPath` ×1 |
| `lib/client-plugin-adapters/claude-adapter.ts` | `:28` / `:42` | 2 | 2/2 | agent-local `settings.local.json` ×2 |
| `services/plugin-storage-service.ts` | `:825` / `:829` | 1 | 1/1 | `~/.claude/settings.json` |

So **6 more read-modify-writes, 3 of them on the human user's own global Claude Code config**, still
replace that file with a minimal object when it does not parse.

Two of the three readers are **worse than the one that was fixed**: they do not even check
`existsSync` first —

```ts
// services/plugin-storage-service.ts:826  (role-plugin-service.ts:323 is the same shape)
async function loadJsonSafe(filePath) { try { return JSON.parse(await readFile(filePath,'utf-8')) } catch { return {} } }
```

— so ENOENT and a parse failure are collapsed by construction, with no `reason` to recover.

**`claude-adapter.ts` is the urgent one:** it sits in `ChangePlugin`'s OWN call path (the adapter
branch), so the parent's guard is bypassed one layer down for every non-CLI install. Fixing the
service alone leaves the bug live on the path the service itself takes.

## Why this is an EHT and not a follow-up

The parent did not merely leave these unfixed — it CHANGED them, from "four identical copies of a
known-bad pattern" into "one guarded, three not". That asymmetry is a new hazard: the next reader of
`role-plugin-service.ts` sees a `loadJsonSafe` that looks like the reviewed one and is not. The
parent cannot honestly reach `complete` while its own change has made three modules quietly
divergent from the one it fixed.

## Proposed fix (decide before writing)

1. **Consolidate.** One shared `lib/` module exporting `readJson` / `loadJsonSafe` / `saveJsonSafe`
   with the guard; the four modules import it and delete their copies. Best end state — one
   implementation, one guard, and a future fifth copy has no excuse to exist.
2. **Replicate.** Copy the guard into each of the three. Cheapest, and it re-creates the exact
   condition that produced this card (four copies drifting).

Prefer 1 unless a measured import-cycle or bundling constraint forbids it — `element-management-service`
already imports from `lib/`, so check that direction first and record what you find.

**Whichever wins, `readJson`'s non-object rejection travels with it** (`[]`, `null`, `42` and
`"str"` all parse and are not usable settings objects — `lib/claude-settings-enforcer.ts:121-128`
refuses this shape and the parent's reader now does too).

## Verification

- A test per module seeding a REAL corrupt file, asserting the write is refused AND the bytes are
  byte-identical afterward. The bytes are the load-bearing assertion; a mocked `fs` cannot see them,
  which is exactly why the parent's test uses real files.
- The neuter for each: delete that module's guard, and name the test that reds.
- If option 1 wins, `tests/governance/save-json-safe-not-an-api.test.ts` must be re-pointed at the
  shared module (its whole subject is that the service's writer is not an API — once there IS a
  shared API, that test is asserting the wrong thing and must be rewritten, not deleted).
- `bash scripts/with-node.sh npx tsc --noEmit` = 0 lines; suite at or above the day's baseline
  (re-measure, never quote: it was 319 files / 4560 passed / 2 skipped at `6c175813`).

## Estimated risk

**MED.** Same blast radius as the parent — settings reads on install/uninstall paths — plus, for
option 1, a module-boundary move across `services/` and `lib/`. The parent's landing found zero
existing tests depending on lenient overwrite, which is evidence but not proof for these three.

## Acceptance

- [ ] Option 1 vs 2 DECIDED and recorded here, with the import-direction check that decided it
- [ ] All 6 read-modify-writes in the three modules are guarded
- [ ] `readJson`'s non-object rejection is present wherever the guard landed
- [ ] One real-file test per module, each with its neuter recorded by name
- [ ] `save-json-safe-not-an-api.test.ts` re-pointed or rewritten if the shared-module option wins
- [ ] tsc clean · suite at/above baseline

## Approval log

- 2026-07-31T21:49:10+0200 — SELF-MANDATE (min-approval-requirement: none). Tier 0: a bugfix inside
  this agent's own assignment scope, derived (EHT) from TRDD-K71FV649 whose landing created the
  asymmetry this card closes. Pre-approved: issuer authority >= required approver.
