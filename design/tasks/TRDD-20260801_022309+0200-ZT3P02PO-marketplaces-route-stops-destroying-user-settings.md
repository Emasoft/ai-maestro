---
trdd-id: ZT3P02PO
title: the marketplaces route stops destroying the user's global settings.json
column: dev
scope: project
project-id: ai-maestro
created: 2026-08-01T02:23:09+0200
updated: 2026-08-01T02:23:09+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: bugfix
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-01T02:23:09+0200
derived: true
derived-kind: eht
parent-trdd: G2K02VDY
relevant-rules: [R51]
npt: []
eht: []
blocked-by: []
implementation-commits: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME

`app/api/settings/marketplaces/route.ts` is the **only file in the tree** that writes the human
user's global `~/.claude/settings.json` with a direct `writeFile`. It does so at **five** sites,
each a read-modify-write fed by a file-local **lenient** reader — so a corrupt settings file is
read as `{}` and the write REPLACES it, destroying every key it held.

This is an **EHT of TRDD-G2K02VDY**: that card routed a `verified === 'mismatch'` into
`handleInstall`'s stale-cleanup block, and the destructive write **lives in that block**. The
parent may not reach `complete` while this is open.

## The defect, measured

| # | line | site |
|---|---|---|
| 1 | 1021 | `handleInstall` stale cleanup — **the one G2K02VDY made more reachable** |
| 2 | 1087 | `handleUninstall` belt-and-braces key sweep |
| 3 | 1183 | `handleDeleteMarketplace` enabledPlugins purge |
| 4 | 1455 | `handleAddMarketplaceFromPath` extraKnownMarketplaces stamp |
| 5 | 1507 | `handleAddMarketplace` extraKnownMarketplaces stamp |

Each is `readJsonSafe(SETTINGS_PATH) || {}` → mutate one key → `writeFile(SETTINGS_PATH, …)`.

**Reachability of site 1 is NOT gated on the settings read.** `cleaned` is set by an
`existsSync(cacheDir)` branch (`:1012`-`:1018`) that never touches the settings file — so
*corrupt settings + a stale cache dir* is sufficient, and the write lands `{enabledPlugins:{}}`
over the user's entire global config.

## Why the existing guard could not see it

`tests/governance/one-json-io-implementation.test.ts` forbids a fifth copy of the json-io family,
but its `DEFINES` regex keys on the NAMES `loadJsonSafe|saveJsonSafe|readJson`. This copy is called
**`readJsonSafe`** — one character different — so the sweep was blind to it **by construction**,
and the whole family looked consolidated (TRDD-CS25TA6W) while the worst-placed copy survived.

## Plan

1. Route every `SETTINGS_PATH` access through `lib/json-io.ts` — `loadJsonSafe` for reads,
   `saveJsonSafe` for writes. `saveJsonSafe` is atomic AND refuses to overwrite a target it could
   not read, which is exactly the missing guard.
2. **KEEP the local `readJsonSafe` for the manifest chains** (`:389`-`:392`, `:1356`-`:1357`, …).
   Its `null` return is LOAD-BEARING there: those are `a || b || c` fall-through chains, and
   `loadJsonSafe` returns a **truthy `{}`**, so swapping it in would silently stop the fall-through
   at the first candidate. Say so in a comment — it is the trap the next reader would walk into.
3. `saveJsonSafe` THROWS `UnreadableTargetError`. The POST catch-all (`:808`) currently answers
   every throw with a generic `Action failed` 500, so the user would never learn their settings
   file is corrupt. Special-case it there — ONE place covering all five sites — with the real
   cause and a **409** (the state is UNKNOWN, not a server fault).
4. Add the narrow ratchet the measurement justifies: the user's global settings.json has exactly
   **two** writers — `lib/json-io.ts` and `lib/claude-settings-enforcer.ts` (which has its own
   guarded atomic writer + a `.aim-bak`). No route may `writeFile` it directly.

## Verification

- A test per class: a **corrupt** settings.json ⇒ the file is byte-identical afterwards AND the
  route answers 409; a **missing** one ⇒ still creatable (the first-run path must not regress).
- **The neuter is `saveJsonSafe`'s guard**: make it not throw on `unreadable`, and the
  "file is byte-identical" test must red. A test asserting only the 409 would pass with the file
  already destroyed.
- Ratchet neuter: re-add a direct `writeFile(SETTINGS_PATH, …)` and the new governance test reds.
- `bash scripts/with-node.sh npx tsc --noEmit` = 0 lines; suite at or above 322 files / 4587
  passed / 2 skipped (re-measure, never quote).

## Estimated risk

**LOW.** The read swap is semantics-preserving (`readJsonSafe(p) || {}` ≡ `loadJsonSafe(p)`, plus a
strictly-better rejection of non-object JSON). The write swap changes behaviour in exactly one
direction: a case that previously destroyed data now refuses and says why.

## Acceptance

- [ ] all five `SETTINGS_PATH` writes go through `saveJsonSafe`; all `SETTINGS_PATH` reads through
      `loadJsonSafe`
- [ ] the manifest-chain `readJsonSafe` is KEPT with the null-is-load-bearing reason recorded
- [ ] `UnreadableTargetError` answers 409 with the real cause, not `Action failed`
- [ ] a governance ratchet pins the two-writer rule for the user's global settings.json
- [ ] tests + neuters recorded by name; tsc 0 lines; suite at or above the day's baseline

## Approval log

- 2026-08-01T02:23:09+0200 — SELF-MANDATE (min-approval-requirement: none). Tier 0: a bugfix inside
  this agent's own assignment scope, and an EHT of TRDD-G2K02VDY — that card made the destructive
  write more reachable, so closing the hole is part of landing it. Pre-approved: issuer authority
  >= required approver.
