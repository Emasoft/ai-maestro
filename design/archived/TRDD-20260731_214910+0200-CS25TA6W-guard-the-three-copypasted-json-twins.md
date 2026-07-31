---
trdd-id: CS25TA6W
title: Three sibling modules carry an unguarded copy of the same JSON read-modify-write pair
column: completed
scope: project
project-id: ai-maestro
created: 2026-07-31T21:49:10+0200
updated: 2026-07-31T22:07:28+0200
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
implementation-commits: [6d818c12]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body)

**LANDED — `6d818c12`. `lib/json-io.ts` is the single owner; all four modules import it.**

**The card's premise was too kind.** It said "three twins carry the same pair without the guard".
Reading them found they are not four COPIES of one function, they are **four different CORRECTNESS
LEVELS** of it — and neither service imports `rename` at all, so their writes were **non-atomic**,
4 of the 6 twin writes, 3 of them on `~/.claude/settings.json`.

**That is the finding, and it is what decided consolidate over replicate: the two defects compose
into a LOOP.** A torn write PRODUCES the corrupt settings file; the lenient reader answers `{}` for
it; every read-modify-write then REPLACES the file with a minimal object built from that `{}`. One
half creates the damage the other completes. Replicating the guard three times would have left the
half that *creates* the corruption in place, in the two weakest modules, on the user's global config.

**Import direction (the check the card told me to run first): clean by construction.** `json-io`
imports only node builtins, so the only edges are lib→lib and services→lib and no cycle is possible.
`element-management-service` RE-EXPORTS `readJson`/`saveJsonSafe`/`UnreadableTargetError` because its
callers name them — a symbol reachable from two import paths is the drift starting over, so it is a
re-export and never a second definition.

**`save-json-safe-not-an-api.test.ts` was REPLACED, not re-pointed** (the card allowed either). Its
subject stopped being true the moment a shared module existed, so re-pointing it would have asserted
the opposite of what it was written to say. `one-json-io-implementation.test.ts` guards the bigger
thing — ONE definition, so what is forbidden is a **fifth** copy.

**NEXT ACTION.** Nothing. Every box is closed; this card is terminal-ready. Closing it also unblocks
its parent `TRDD-K71FV649`, whose own work finished at `a044f390` and which is held open only by the
completion gate on this flock.

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

- [x] **Option 1 (consolidate) DECIDED**, and by a stronger argument than the import check: the four
      copies were four correctness levels, two of them NON-ATOMIC on the user's global settings, so
      replicating the guard would have left the half that CREATES the corruption in place. The
      import-direction check is clean by construction (`json-io` imports only node builtins)
- [x] All 6 read-modify-writes in the three modules are guarded — they now call the one owner
- [x] `readJson`'s non-object rejection travelled with it (it IS the shared reader)
- [x] Neuters recorded by name: **N15** hand-write a fifth copy → the "no other definition" test reds
      NAMING the file · **N16** make the owner non-atomic → the atomicity test reds ALONE, while the
      behavioural clobber test stays fully green (a non-atomic write still refuses a corrupt target),
      which is what proves the structural and behavioural assertions are independent, not redundant
- [x] `save-json-safe-not-an-api.test.ts` REPLACED by `one-json-io-implementation.test.ts` — its
      subject stopped being true, so re-pointing it would have asserted the opposite of its intent
- [x] tsc 0 lines · suite **320 files / 4567 passed / 2 skipped** (was 320/4564/2: −4 from the
      replaced guard file, +7 from its successor)

### Not done, and named rather than left silent

One real-file test **per module** was written as one test on the SHARED owner instead. With a single
implementation there is nothing per-module left to differ, and three near-identical suites over one
function would assert the import statement, not behaviour. `one-json-io-implementation.test.ts`
covers what the per-module tests were for: that no module has its own copy (N15) and that the one
they share is atomic and guarded (N16).

## Approval log

- 2026-07-31T21:49:10+0200 — SELF-MANDATE (min-approval-requirement: none). Tier 0: a bugfix inside
  this agent's own assignment scope, derived (EHT) from TRDD-K71FV649 whose landing created the
  asymmetry this card closes. Pre-approved: issuer authority >= required approver.
- 2026-07-31T22:07:28+0200 — COMPLETED by ai-maestro. All 6 boxes closed; landed at `6d818c12`. The card's own premise
  was corrected in flight (four correctness levels, not three unguarded copies), which is what
  decided consolidate over replicate. Neuters N15/N16 recorded. tsc 0 lines, suite 320/4567/2.
