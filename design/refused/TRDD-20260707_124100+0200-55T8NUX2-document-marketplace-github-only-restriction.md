---
trdd-id: 55T8NUX2
title: Document that Add Marketplace currently accepts GitHub URLs only
column: refused
created: 2026-07-07T12:41:00+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 1
severity: LOW
effort: S
labels: [scenario-improvement, scen-026, batch-backlog-20260707]
task-type: docs
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_026_2026-05-04T12-26-52Z.md"]
---

# TRDD-55T8NUX2 — Document that Add Marketplace currently accepts GitHub URLs only

## Problem

Verified at HEAD (2026-07-07): `CLAUDE.md:1162` (in this repo's
"Normal Plugins (General-Purpose Tools)" section) says:

> **Add marketplace:** Settings → Plugins Explorer → Marketplaces tab →
> add marketplace URL

This does NOT state that only GitHub URLs are accepted — it says "add
marketplace URL" with no qualifier. The actual behavior (verified at
`app/api/settings/marketplaces/route.ts:1330-1339`, function
`handleAddMarketplace`) rejects anything that doesn't match
`/github\.com\/([^/]+\/[^/]+)/i` with a 400 `Invalid GitHub URL` error.
A scenario author (or any developer) reading CLAUDE.md as written would
reasonably assume any URL form — including a local `file://` path — is
acceptable, which is exactly the trap SCEN-026 fell into at its Phase 4
setup.

## Root cause

CLAUDE.md's plugin-architecture documentation was written when the
marketplace-add flow was GitHub-only by design and never called out the
restriction explicitly, because at the time there was no local-path use
case to contrast it against. The restriction only became a documentation
gap once a scenario (SCEN-026) needed local-fixture-backed marketplace
registration and the docs gave no warning that it wasn't supported.

## Proposed fix

Update `CLAUDE.md` in the "Normal Plugins (General-Purpose Tools)"
section, immediately after the existing "Add marketplace:" bullet
(around line 1162), with a clarifying note:

```markdown
**Add marketplace:** Settings → Plugins Explorer → Marketplaces tab →
add marketplace URL

> Currently, `+ Add Marketplace` accepts only
> `https://github.com/<owner>/<repo>` URLs
> (`app/api/settings/marketplaces/route.ts:handleAddMarketplace`).
> Local-directory marketplaces are supported by the underlying
> `CreateMarketplace` pipeline (`services/element-management-service.ts`)
> but not yet exposed through this UI/HTTP route — see
> TRDD-4IYPNZWT for the planned local-directory enhancement.
```

If TRDD-4IYPNZWT (local-directory marketplace support) has already
landed by the time this TRDD is implemented, update the note instead to
describe BOTH accepted forms (GitHub URL and local directory path) and
remove the "not yet exposed" caveat.

## Verification

Read `CLAUDE.md` after the edit and confirm the GitHub-URL-only
restriction (or, if TRDD-4IYPNZWT has landed, the dual GitHub-URL /
local-path support) is stated in the "Add marketplace" bullet, with a
concrete reference to the enforcing code path.

## Estimated risk

NONE. Documentation-only change; does not touch any code path.

**Dependencies:** Should land alongside TRDD-4IYPNZWT (local-directory
marketplace support) once that is implemented, so the documentation
describes the CURRENT capability rather than describing a restriction
that no longer exists. If TRDD-4IYPNZWT is not yet approved/implemented
when this TRDD is picked up, land the "GitHub URLs only, local-path
tracked as TRDD-4IYPNZWT" wording as an interim fix.

## Approval log

- 2026-07-07T13:24:46+0200 — REFUSED by USER-delegated batch screening (tier 2). Superseded by approved TRDD-4IYPNZWT — the restriction is being removed, not documented.
