---
trdd-id: Y0XEEUXN
title: Give the marketplace-storage layer one owner for manifest read + settings registration
column: todo
created: 2026-07-07T21:56:19+0200
updated: 2026-08-29T18:49:47+0200
current-owner: ai-maestro-hub-session
assignee: ai-maestro-hub-session
created-by: code-review
priority: 2
severity: LOW
effort: M
labels: [code-review, review-batch-20260707, reuse, altitude, tech-debt]
task-type: refactor
min-approval-requirement: none
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports/code-review/20260707_175225+0200-finder-CLEAN.json"]
---

# TRDD-Y0XEEUXN — Give the marketplace-storage layer one owner for manifest read + settings registration

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-29

**Part 1 is DONE for the READ helper only. Two of this card's premises were wrong; read
them before doing the rest, because one of them makes the obvious next step a mistake.**

- **DONE:** `readRoleClientMarketplacePlugins` and `readCustomClientMarketplacePlugins`
  are now ONE `readClientMarketplacePlugins(marketplaceDir)`. **The bodies were confirmed
  identical the RIGHT way, on the second attempt.** The first `diff` compared two
  hand-picked line RANGES of different lengths (32 vs 35), and its own output showed the
  role extract had overrun the function end — so it was comparing a body against a body
  plus six lines of the next function, and could not have detected a difference in a
  region it never aligned. Since the role copy was then DELETED, that mattered. Re-done
  brace-delimited (`sed -n '/^async function X/,/^}/p'`) against the PRE-MERGE blob, where
  both copies still exist, headers and path lines dropped: the only difference is ONE
  COMMENT line. Zero executable difference; the deletion took nothing with it. All four call sites already bound
  `marketplaceDir` on the preceding line, so the parameter cost nothing. All six functions
  had no caller outside this file. (Evidenced for the ROLE trio by a repo-wide grep; the
  CUSTOM trio was never searched — a third asymmetric-needle slip this session. The claim
  still holds indirectly: none carried `export`, and `tsc` would fail an unresolved import.
  Stated at that strength rather than as a measurement.)
- **PREMISE WRONG #1 — the `ensure`/`update` halves are NOT near-identical, and merging
  them the way this card describes would change behaviour.** Beyond the name and path they
  differ on `claude`: the ROLE pair early-returns (`if (targetClient === 'claude') return`)
  because role-plugin-service owns Claude's manifest, while the CUSTOM pair falls through
  and performs a LOCKED settings.json read-modify-write to register the marketplace with
  the Claude CLI (TRDD-RYFP030K). A shared helper would need flags for skip-claude,
  register-claude, the manifest name and the log prefix — four parameters to save ~40
  lines, which is worse than the duplication. **Recommend: dedup the read (done) and leave
  `ensure`/`update` alone**, or reduce the scope of this card to part 2.
- **PREMISE WRONG #2 — "exercise the full plugin-conversion test path" describes a path
  that does not exist.** MEASURED: stubbing the merged reader to `return []`
  unconditionally left all 24 tests of the four conversion suites GREEN
  (`change-client-matrix`, `install-element-codex-adapter`, `createagent-g08-cross-client`,
  `marketplace-supported`). Precisely: no conversion test OBSERVES this function's return
  value — a test that called it and ignored the result would also stay green, so this is
  "uncovered", not provably "unreached". Either way "24/24 still pass" after the refactor
  was a VACUOUS confirmation. `tests/unit/client-marketplace-manifest-read.test.ts` now covers
  it directly — 6 tests including both manifest shapes (Claude `source` string vs Codex
  `source` object), the both-present precedence, the no-manifest case, and malformed
  entries. Two neuters attributed: stubbing the reader reds 5 of 6; breaking only the Codex
  object decode reds exactly the Codex test.
- The helper is `export`ed for that test and has no production caller outside the module;
  the comment above it says so.

**NEXT ACTION.** Decide part 2 (moving `extraKnownMarketplaces` registration into
`CreateMarketplace`/`DeleteMarketplace`/`UpdateMarketplace`) on its own — it touches 5
route handlers plus 3 pipelines and deserves its own change, per this card's own
"land as its own PR". Not started.

## Problem

Two related duplications in the marketplace-storage / marketplace-route layer:

1. **Duplicate client-marketplace helpers** — `readRoleClientMarketplacePlugins`
   / `ensureRoleClientMarketplace` / `updateRoleClientMarketplaceManifest`
   (`services/plugin-storage-service.ts`, TRDD-YFCNYVYB) are ~85 lines that
   are near byte-for-byte copies of the pre-existing `readCustom*` /
   `ensureCustom*` / `updateCustom*` trio, differing only in the
   marketplace-name string (bare `LOCAL_MARKETPLACE_NAME` vs
   `${CUSTOM_MARKETPLACE_NAME}-${targetClient}`) and the path helper
   (`getRoleMarketplacePathForClient` vs `getCustomMarketplacePathForClient`).

2. **Scattered settings.json registration** —
   `app/api/settings/marketplaces/route.ts`'s `handleAddMarketplaceFromPath`,
   `handleInstall`, `handleUninstall`, `handleDeleteMarketplace`,
   `handleUpdateMarketplace` each independently patch
   `extraKnownMarketplaces` in settings.json after calling their pipeline
   function, because `CreateMarketplace`/`DeleteMarketplace`/`UpdateMarketplace`
   don't own their own settings.json registration end-to-end.

## Root cause

Both stem from the same gap: the marketplace-storage layer never centralized
(a) the per-client manifest read/seed/write logic, nor (b) the settings.json
`extraKnownMarketplaces` mutation. So a manifest-parsing edge-case fix (e.g. the
Claude-string-vs-Codex-object `source` field) must be applied to both the role
and custom trios, and a marketplace-source-shape change must be hunted across
5 raw-write call sites. The file's own comments already document this pattern
producing orphaned-key bugs (BUG-MKTNAME-001, SCEN-019 BUG-002/BUG-003).

## Proposed fix

1. Factor the manifest read/seed/write trio into ONE parameterized helper set
   taking `(container, marketplaceName)` — `readClientMarketplacePlugins`,
   `ensureClientMarketplace`, `updateClientMarketplaceManifest` — and have the
   role and custom call sites pass their respective name/path. Delete the
   duplicated trio.
2. Move `extraKnownMarketplaces` registration INTO the
   `CreateMarketplace`/`DeleteMarketplace`/`UpdateMarketplace` pipeline
   functions so each owns its settings.json write end-to-end; the route
   handlers stop patching settings.json below the pipeline call. One place then
   knows the `{ source: 'local'|'github', path|repo }` shape.

## Verification

- One manifest helper, one registration owner; a source-shape change is a
  single edit. `npx vitest run` green; existing marketplace-route tests +
  SCEN-019 still pass.

## Estimated risk

MED. `plugin-storage-service` conversion helpers and the settings.json
registration are used by every plugin install/convert flow; behavior must be
preserved exactly (the role trio keeps the bare `LOCAL_MARKETPLACE_NAME`, the
custom trio keeps the `-<client>` suffix — the shared helper must not
homogenize them). Land as its own PR with the full plugin-conversion test path
exercised.

## Acceptance

- [x] The two manifest READ helpers are one function; the duplicate is deleted and every call site repointed. Bodies confirmed byte-identical by `diff` before merging, so the merge is a rename plus a parameter the callers already had.
- [x] The merged reader has direct behavioural coverage — both manifest shapes, precedence, absence, malformed entries — with two attributed neuters proving it non-vacuous.
- [x] `yarn tsc --noEmit` exit 0; the five relevant suites 30/30 (24 pre-existing at their recorded baseline + 6 new).
- [ ] ~~Factor the `ensure`/`update` trios into one parameterized helper set.~~ **DECLINED as specified** — measured, they differ on `claude` handling, not just on a name string; see STATE. Reopen only with a design that keeps the two behaviours distinct.
- [ ] Part 2: `extraKnownMarketplaces` registration moved into the Create/Delete/UpdateMarketplace pipelines, route handlers stop patching settings.json below the pipeline call. **NOT STARTED** — own change.

## Approval log

- 2026-08-20T22:20:37+0200 — classified min-approval-requirement: none (was UNSET) and re-filed design/proposals/ → design/tasks/ as column: planned. Floor is none: deduplicating ~85 near-byte-identical marketplace-storage helpers and giving the settings.json registration one owner is an in-scope, reversible refactor of this project's own source, with zero D3 floor signals. A Tier-0 task does not belong in the proposals folder. Nothing was approved here; a Tier-0 card has no approver.
