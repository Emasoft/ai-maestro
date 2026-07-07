---
trdd-id: 4IYPNZWT
title: Allow Add Marketplace to accept a local directory path, not only GitHub URLs
column: planned
created: 2026-07-07T12:41:00+0200
updated: 2026-07-07T15:00:52+0200
current-owner: scenario-runner
approval-tier: 2
priority: 0
severity: HIGH
effort: M
labels: [scenario-improvement, scen-026, batch-backlog-20260707]
task-type: feature
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_026_2026-05-04T12-26-52Z.md"]
---

# TRDD-4IYPNZWT — Allow Add Marketplace to accept a local directory path, not only GitHub URLs

## Problem

`Settings → Plugins Explorer → Marketplaces` only supports registering a
marketplace from a GitHub URL. Verified at HEAD (2026-07-07):

- UI: `components/settings/MarketplaceManager.tsx:354` — the input
  placeholder is hardcoded `"Add marketplace from GitHub URL..."`. There is
  no toggle or second field for a local path.
- API: `app/api/settings/marketplaces/route.ts:1330-1373`, function
  `handleAddMarketplace(url?: string)`. Line 1336:
  `const match = url.match(/github\.com\/([^/]+\/[^/]+)/i)`. If the regex
  doesn't match, line 1337-1339 returns
  `{ error: 'Invalid GitHub URL' }` with status 400. There is no `path`
  parameter accepted anywhere in the function signature or body.

This blocks any scenario or workflow that needs to register a
fixture-backed or otherwise local-directory marketplace (e.g. SCEN-026
Phase 4, which needs to add a local Codex plugin fixture as a
marketplace).

## Root cause

The route was last touched for SCEN-019 BUG-001 (2026-04-30, see the
comment at route.ts:1341-1347) to fix the marketplace-naming convention
(`owner-repo` vs basename), but the `path`-source case was never wired
into the HTTP layer even though the underlying pipeline supports it:
`services/element-management-service.ts` exports
`CreateMarketplace(desired: { name: string; source: { repo: string } |
{ path: string } }, authContext)` — the `{ path: string }` union member
already exists in the type, and `handleAddMarketplace` at
route.ts:1354 always calls
`CreateMarketplace({ name: marketplaceName, source: { repo } }, ...)`,
never `{ source: { path } }`. The UI never had a "Local directory"
affordance to begin with.

## Proposed fix

1. **Backend** — `app/api/settings/marketplaces/route.ts`, function
   `handleAddMarketplace` (currently `async function
   handleAddMarketplace(url?: string)` at line 1330). Change its
   signature to accept an object `{ url?: string; path?: string }` (the
   caller at line 679-680, `if (action === 'add-marketplace') { return
   await handleAddMarketplace(url) }`, must be updated to pass both
   fields from `body`). Logic:
   - If neither `url` nor `path` is present, return 400
     `{ error: 'url or path is required' }`.
   - If `url` is present, keep the existing GitHub-URL branch verbatim
     (lines 1336-1372).
   - If `path` is present (and `url` is not), derive a marketplace name:
     prefer `.claude-plugin/marketplace.json`'s `name` field if the file
     exists under `path`, otherwise `path.basename(path)`. Validate the
     derived name against `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/` (matches the
     pipeline's own naming constraint) and return 400 with a clear
     message if it fails validation. Then call
     `CreateMarketplace({ name: marketplaceName, source: { path } },
     { isSystemOwner: true as const })`, handle the same `already
     exists` (409) / generic-failure (500) branches as the URL path, and
     on success stamp `extraKnownMarketplaces[marketplaceName] = {
     source: { source: 'local', path } }` into `SETTINGS_PATH` (mirror
     the existing `{ source: 'github', repo }` stamping at line 1368).
2. **UI** — `components/settings/MarketplaceManager.tsx` around the
   input at line 354. Add a small mode toggle (`GitHub URL` /
   `Local directory`, e.g. two radio inputs bound to a
   `addMode: 'url' | 'path'` state) above the existing input. Keep the
   input a plain free-form text field in BOTH modes (no native OS file
   picker) so headless UI-automation (dev-browser `page.fill(...)`) can
   drive it without a picker dependency. Wire the submit handler to send
   `{ action: 'add-marketplace', url: addInput }` or `{ action:
   'add-marketplace', path: addInput }` depending on `addMode`.
3. **Security** — restrict `path` to directories the process can read
   and that are not obviously system paths. Add a check (in the route
   handler or in `lib/route-auth.ts`) that rejects paths under `/etc`,
   `/usr`, `/private/etc`, `/private/var/db`, `/System`, and anything
   outside `$HOME` unless an explicit allow-list override is set. This
   mirrors the existing sudo/system-owner gating already applied to
   marketplace mutations (`isSystemOwner: true` is already required by
   `CreateMarketplace`).

## Verification

- `POST /api/settings/marketplaces` with body `{ "action":
  "add-marketplace", "path": "/abs/fixture/path" }` (a directory
  containing a valid `.claude-plugin/marketplace.json` or a
  filesystem-safe basename) returns `{ success: true, action:
  "add-marketplace", marketplaceName: "<derived>", path }` with HTTP
  200/201, and the new entry appears in
  `~/.claude/settings.json:extraKnownMarketplaces` keyed by
  `marketplaceName` with `source: { source: 'local', path }`.
- `POST /api/settings/marketplaces` with a `path` whose derived name
  fails `/^[a-zA-Z0-9][a-zA-Z0-9_-]*$/` returns HTTP 400 with an
  actionable error message (not a stack trace).
- UI: with the "Local directory" mode selected, typing an absolute path
  and submitting registers the marketplace without any error, and the
  new marketplace appears in the Marketplaces list.
- Re-running SCEN-026 Phase 4 (S019 onward) no longer fails at the
  "Add Marketplace" step due to the GitHub-URL-only restriction.

## Estimated risk

MED. Adds a new read-capable attack surface (arbitrary local-path
ingestion) that must be scoped by the security check above; already
partially mitigated because marketplace mutation already requires
`isSystemOwner` / sudo. The underlying pipeline (`CreateMarketplace`
with `{ path }` source) already exists and is exercised elsewhere, so
the HTTP+UI wiring is the only new surface, not new pipeline logic.

**Dependencies:** None. TRDD-55T8NUX2 (CLAUDE.md doc update) should land
alongside this once implemented, so the documentation matches the new
capability instead of describing the old restriction.

## Approval log

- 2026-07-07T13:24:46+0200 — APPROVED by USER-delegated batch screening (tier 2).
- 2026-07-07T15:00:52+0200 — IMPLEMENTED (wave W6): backend `handleAddMarketplace`/`handleAddMarketplaceFromPath` in `app/api/settings/marketplaces/route.ts` now accepts `{ path }` (name derived from `.claude-plugin/marketplace.json` or basename, home-dir-only + system-dir-blocklist check, routes through `CreateMarketplace({source:{path}})`, stamps `extraKnownMarketplaces` with `source:'local'`); UI `components/settings/MarketplaceManager.tsx` adds a GitHub-URL/Local-directory radio toggle (plain text input in both modes) feeding the same submit handler. `npx tsc --noEmit`: 0 errors.
