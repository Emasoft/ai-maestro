---
trdd-id: QXRWQ232
title: Bootstrap the Codex marketplace manifest file when absent
column: planned
created: 2026-07-07T12:41:00+0200
updated: 2026-07-07T15:00:52+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: LOW
effort: S
labels: [scenario-improvement, scen-026, batch-backlog-20260707]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_026_2026-05-04T12-26-52Z.md"]
---

# TRDD-QXRWQ232 — Bootstrap the Codex marketplace manifest file when absent

## Problem

SCEN-026 (S019, S022, S030, S033, and any future Codex regular-plugin
scenario) assumes a Codex-readable marketplace manifest file exists and
gets mutated by AI Maestro during plugin install/uninstall flows. On
the machine the scenario was run on, no such file existed at setup time
(`BACKUP_SKIP ... marketplace.json (not present)` in the setup output),
so any flow that expects to read-then-write it would either crash or
silently no-op depending on how the missing-file case is handled.

**Correction to the source report's proposed location:** the source
report (`reports_dev/scenarios-runner/scenario_proposed-improvements_026_2026-05-04T12-26-52Z.md`,
P2-PROP-001) describes the target as the user-global
`~/.agents/plugins/marketplace.json` and proposes bootstrapping it
inside `lib/client-plugin-adapters/codex-adapter.ts`. That premise is
outdated: per `lib/client-capabilities.ts:56-81` (the `marketplaces`
field of `ClientCapabilities`, documented inline), Codex's marketplace
manifest convention is **repo-scoped**,
`$REPO_ROOT/.agents/plugins/marketplace.json` (per the
`github.com/hon454/codex-marketplace` template referenced in that
comment) — not a single user-home file. The SAME file's comment already
documents a known, tracked gap:

> [Known gap 2026-04-22: `services/plugin-storage-service.ts` currently
> writes to `<root>/marketplace.json` for Codex — the manifest path
> migration to `.agents/plugins/marketplace.json` is tracked as a
> follow-up.]

Verified at HEAD (2026-07-07): `lib/client-plugin-adapters/codex-adapter.ts`
has no logic that reads, writes, or bootstraps any
`marketplace.json` path at all (`grep -n "marketplace.json"
lib/client-plugin-adapters/codex-adapter.ts` returns nothing). So the
actual gap is broader than the source report described: there is
neither a bootstrap-if-missing helper NOR a completed migration to the
`.agents/plugins/marketplace.json` path — `plugin-storage-service.ts`
still writes to `<root>/marketplace.json` per the tracked comment
above.

## Root cause

The Codex marketplace-manifest path convention changed (or was
clarified) after the initial Codex-adapter implementation, and the
migration from `<root>/marketplace.json` to
`.agents/plugins/marketplace.json` was deferred as a follow-up
(`lib/client-capabilities.ts:72-75`) rather than completed. No bootstrap
logic exists for either path today, so a machine that has never run
Codex (and therefore has no `.agents/plugins/` directory) will fail or
silently skip any AI Maestro flow that assumes the manifest exists.

## Proposed fix

1. First, complete (or explicitly re-scope) the migration already
   tracked in `lib/client-capabilities.ts:72-75`: locate every write
   site in `services/plugin-storage-service.ts` that currently targets
   `<root>/marketplace.json` for a Codex-targeted emission (grep for
   `marketplace.json` writes gated on `targetClient === 'codex'` or
   equivalent), and redirect them to
   `<repo-root>/.agents/plugins/marketplace.json` per the documented
   convention. Confirm with the actual Codex CLI / the
   `github.com/hon454/codex-marketplace` template which path Codex
   reads at runtime before finalizing — the comment describes the
   target but the migration itself was never done, so do not assume it
   is correct without a live check against a real Codex install.
2. Add a bootstrap helper (in `lib/client-plugin-adapters/codex-adapter.ts`
   or a shared helper it calls) that, before any read-modify-write of
   the manifest, ensures the containing directory exists (`mkdir -p
   .agents/plugins/`) and creates a minimal valid manifest
   (`{ "marketplaces": {} }` or whatever shape the Codex marketplace
   template requires — verify against the template referenced above)
   if the file is absent. Stamp the file with standard permissions
   (0644).
3. This bootstrap should be defensive and idempotent — calling it
   repeatedly must not corrupt an existing manifest; it should only
   act when the file (or its parent directory) does not exist.

## Verification

- Delete the target manifest path (whichever path step 1 confirms is
  correct — `.agents/plugins/marketplace.json` at repo root, per the
  tracked migration) and its parent directory if present, then trigger
  an AI Maestro flow that installs or registers a Codex plugin/
  marketplace. Confirm both the directory and a valid manifest file are
  recreated, and the new marketplace/plugin entry is present in it.
- Confirm `lib/client-capabilities.ts:72-75`'s "Known gap" comment is
  either removed (once the migration lands) or updated to reflect the
  new state.

## Estimated risk

LOW-MED. Small bootstrap helper, but the path-migration part (step 1)
touches an existing write path in `plugin-storage-service.ts` that
other Codex flows may already depend on at the old `<root>/marketplace.json`
location — verify no other code reads from the old path before
redirecting all writes, or split this into two sequential changes
(add bootstrap for whichever path is current today; migrate the path
as a separate, explicitly-tested change).

**Dependencies:** TRDD-4IYPNZWT (local-directory marketplace support)
addresses AI Maestro's OWN marketplace-add UI, which is a different
manifest/flow than Codex's own repo-scoped marketplace.json — no direct
code dependency, but both surface as gaps in the same Codex plugin
install/uninstall test path (SCEN-026 Phases 4-5).

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2). Implement together with YFCNYVYB.
- 2026-07-07T15:00:52+0200 — PARTIALLY IMPLEMENTED (wave W6): step 1 (path migration to the documented `$REPO_ROOT/.agents/plugins/marketplace.json` repo-scoped convention) SKIPPED — the TRDD itself requires confirming against a live Codex CLI / the `github.com/hon454/codex-marketplace` template before finalizing, which this wave has no live Codex install to verify against; the write sites for a full fix (`lib/client-capabilities.ts`'s "Known gap" comment, and any resulting wiring in `lib/client-plugin-adapters/codex-adapter.ts`) are also outside this wave's write-scope. Verified `codex-adapter.ts` handles per-AGENT plugin file installs (`<agentDir>/.codex-plugin/...`) and has no relationship to any marketplace.json — a bootstrap helper does not belong there under the current architecture. Step 2/3 (idempotent create-if-missing bootstrap for "whichever path is current today", per the TRDD's own split-into-two-changes fallback) is ALREADY satisfied for the CURRENT path by the pre-existing `ensureCustomClientMarketplace` (custom-plugins container) and by the new `ensureRoleClientMarketplace` added in this wave for TRDD-YFCNYVYB (role-plugins container) — both mkdir the marketplace dir and seed an empty manifest via `writeMarketplaceManifest` only when absent, and are safe to call repeatedly. No further code change made. Follow-up: a future wave with write access to `lib/client-capabilities.ts` + `lib/client-plugin-adapters/codex-adapter.ts` and a live Codex CLI should confirm the actual runtime-read path and, if it differs from today's, perform the migration as its own explicitly-tested change.
