---
trdd-id: RZTIE0T1
title: Browser-panel preview script verb for artifact-producing plugins
column: todo
created: 2026-08-19T14:01:56+0200
updated: 2026-08-19T14:01:56+0200
implementation-commits: []
current-owner: hub-session-brrjk57p-phase2
created-by: hub-session-brrjk57p-phase2
assignee: hub-session-brrjk57p-phase2
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
priority: 2
project-id: ai-maestro
labels: [scripts-spec-needs, decoupling-layer, webdesign, panel]
external-refs: [WEBDESIGN reply 2026-08-19 (BRRJK57P ledger)]
---

# Browser-panel preview script verb for artifact-producing plugins

## Problem (spec-first — requested by ai-maestro-webdesign-agent, 2026-08-19)

The webdesign role's approval loop requires the USER to SEE the artifact (HTML pages, web
apps) live in the dashboard's browser panel, refreshed per edit iteration, with an optional
screenshot path the agent reads back for its slop/a11y verifiers. Today only
`aimaestro-panel.sh status|set --html-file` exists (static HTML panel push, used by
visual-communicator) — no URL open/refresh/screenshot cycle.

## Proposed shape (to refine at design)

`aimaestro-browser.sh open|refresh|screenshot <url-or-file> [--panel <id>]`, auth envs like
the sibling CLIs, headless fallback documented. Decide at design whether this extends
aimaestro-panel.sh instead of a 15th CLI (prefer extending — fewer surfaces).

## Acceptance

- [ ] spec section drafted first; reviewed against webdesign's amw-preview /
      wireframe-builder / infographics Phase-B workflows
- [ ] open + refresh + screenshot round-trip works against the live dashboard; screenshot
      path readable by the calling agent
- [ ] webdesign session confirms and wires it (they asked to be pinged on spec regen)

## Approval log

- 2026-08-19T14:01:56+0200 — MANDATE under the USER's 2026-08-19 orchestration directive.
  Queued at todo; spec-first at design.
