---
trdd-id: Y0XEEUXN
title: Give the marketplace-storage layer one owner for manifest read + settings registration
column: planned
created: 2026-07-07T21:56:19+0200
updated: 2026-08-20T22:20:37+0200
current-owner: code-review
assignee: null
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

## Approval log

- 2026-08-20T22:20:37+0200 — classified min-approval-requirement: none (was UNSET) and re-filed design/proposals/ → design/tasks/ as column: planned. Floor is none: deduplicating ~85 near-byte-identical marketplace-storage helpers and giving the settings.json registration one owner is an in-scope, reversible refactor of this project's own source, with zero D3 floor signals. A Tier-0 task does not belong in the proposals folder. Nothing was approved here; a Tier-0 card has no approver.
