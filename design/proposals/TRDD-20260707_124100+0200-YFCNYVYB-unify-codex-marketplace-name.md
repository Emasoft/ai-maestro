---
trdd-id: YFCNYVYB
title: Unify the local Codex marketplace name across constant and on-disk manifest
column: proposal
created: 2026-07-07T12:41:00+0200
updated: 2026-07-07T12:41:00+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: MEDIUM
effort: S
labels: [scenario-improvement, scen-026, batch-backlog-20260707]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_026_2026-05-04T12-26-52Z.md"]
---

# TRDD-YFCNYVYB — Unify the local Codex marketplace name across constant and on-disk manifest

## Problem

Verified at HEAD (2026-07-07), three places disagree on the name of the
local Codex role-plugins marketplace:

1. `lib/ecosystem-constants.ts:106` —
   `export const LOCAL_MARKETPLACE_NAME = 'ai-maestro-local-roles-marketplace'`
   (bare name, no client infix).
2. On-disk manifest
   `~/agents/role-plugins/codex-roles-marketplace/marketplace.json`:
   ```json
   {
     "name": "ai-maestro-local-codex-roles-marketplace",
     "interface": { "displayName": "AI Maestro Local Roles (Codex)" },
     "plugins": []
   }
   ```
   (has a `-codex-` infix, and does NOT match `LOCAL_MARKETPLACE_NAME`).
3. SCEN-026 (S007, S008, S012, S023) references
   `ai-maestro-local-roles-marketplace` (no infix) as the marketplace
   name it expects to find.

So the shared TypeScript constant, the file actually on disk, and the
scenario's expectations are three different strings. Any code path or
scenario that trusts `LOCAL_MARKETPLACE_NAME` will look for a
marketplace that doesn't exist on disk for Codex.

## Root cause

The per-client marketplace manifests under
`~/agents/role-plugins/<client>-roles-marketplace/marketplace.json`
were generated with a `<client>`-infixed `name` field (at least for
Codex — `gemini-roles-marketplace/`, `kiro-roles-marketplace/`, and
`opencode-roles-marketplace/` marketplace.json files should be checked
for the same drift), while `lib/ecosystem-constants.ts` defines a
single bare `LOCAL_MARKETPLACE_NAME` intended to be shared across
clients (per its usage pattern elsewhere in the codebase as the
canonical plugin-key marketplace segment,
`<plugin>@ai-maestro-local-roles-marketplace`). Whatever code path
writes `marketplace.json`'s `name` field for a per-client role-plugins
container is not sourcing it from `LOCAL_MARKETPLACE_NAME` — it is
independently constructing a `<client>`-infixed string.

## Proposed fix

Two options, pick one deliberately (do not implement both):

**Option A — unify under the bare name.** Regenerate every per-client
`marketplace.json` under `~/agents/role-plugins/<client>-roles-marketplace/`
(codex, gemini, kiro, opencode — check all four, plus the Claude
`.claude-plugin/marketplace.json`) so `name` equals
`LOCAL_MARKETPLACE_NAME` from `lib/ecosystem-constants.ts`. The
`<client>-roles-marketplace` directory name remains the per-client
storage surface; the `name` field inside becomes the shared logical
identifier across clients. Find and fix whichever code path
constructs the manifest (likely in `services/plugin-storage-service.ts`
or `services/role-plugin-service.ts` — grep for
`-roles-marketplace` and `marketplace.json` writes) to read
`LOCAL_MARKETPLACE_NAME` instead of building a per-client string.

**Option B — keep the per-client infix, formalize it.** Add
`LOCAL_MARKETPLACE_NAME_<CLIENT>` constants (or a
`getLocalMarketplaceName(client)` helper) to
`lib/ecosystem-constants.ts` for each supported client, and update
every scenario (SCEN-026 S007/S008/S012/S023, and audit any other
scenario referencing `ai-maestro-local-roles-marketplace`) to use the
per-client name when the target client is not Claude.

Both options preserve the existing per-client storage layout under
`~/agents/role-plugins/<client>-roles-marketplace/` — only the `name`
field's value (and the constant surface) changes.

## Verification

- Option A: `grep '"name"' ~/agents/role-plugins/*/marketplace.json`
  returns `"ai-maestro-local-roles-marketplace"` (or the equivalent
  Claude `.claude-plugin/marketplace.json` name) for every per-client
  manifest.
- Option B: the scenario file(s) referencing the marketplace name are
  updated to use the correct per-client constant, and
  `lib/ecosystem-constants.ts` exposes a documented per-client lookup.
- Either way: a plugin-key string built from the marketplace name (as
  used in `settings.local.json`, ledger entries, or agent registry
  metadata) resolves correctly for Codex-hosted role-plugins.

## Estimated risk

MED. Marketplace-name strings appear in `settings.local.json`, ledger
entries, and potentially agent registry metadata — changing an
already-live manifest's `name` risks orphaning references that were
keyed by the old (either bare or infixed) name. A migration step may
be needed for any existing installs.

**Dependencies:** Coupled with TRDD-39ABGST4 (codex-emitted role-plugin
name suffix) — both touch the same storage tree and the resulting
plugin-key story (`<name>@<marketplace-name>`) should be decided
together so the two proposals don't produce an internally
inconsistent naming scheme.

## Approval log
