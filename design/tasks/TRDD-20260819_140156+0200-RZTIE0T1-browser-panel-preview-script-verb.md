---
trdd-id: RZTIE0T1
title: Browser-panel preview script verb for artifact-producing plugins
column: todo
priority-note: demoted to low by consumer measurement 2026-08-19 (see STATE)
created: 2026-08-19T14:01:56+0200
updated: 2026-08-19T14:54:11+0200
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

## ⏵ STATE — 2026-08-19 14:54 (authoritative; narrows the scope below)

The PREVIEW half of this card was ALREADY COVERED by `aimaestro-panel.sh`
(open/close/refresh/set/status/feedback) — webdesign found this on reading the generated
scripts spec, withdrew their `aimaestro-browser.sh` ask, and WIRED it consumer-side
(webdesign commit d9743cf: bin/amw-panel-preview.sh over the frozen CLI, exit-3 gating,
dev-browser fallback; rides their next release after v0.1.16). REMAINING SCOPE of this
card is ONLY the `screenshot` verb (capture what the panel currently renders to a file
path the agent can read, so slop/a11y verifiers check the exact surface the human saw).
Webdesign rates it LOW priority — dev-browser covers it locally. Spec-first when pulled.
Their auth-gap ask (an identity for the plugin-dev workdir) was answered separately: a
dev workdir gets NO registered identity (R32 / the 6SL6UY6N precedent) — live e2e
verification is the hub's, with owner auth, or via a registered test agent.

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

- [x] ~~preview verb~~ ALREADY COVERED by aimaestro-panel.sh (no work was needed here;
      webdesign wired the consumer side, d9743cf) — struck per the STATE narrowing
- [ ] `screenshot` verb: spec section drafted first; reviewed against webdesign's
      slop/a11y verifier workflows (LOW priority — dev-browser covers locally)
- [ ] screenshot round-trip works against the live dashboard; path readable by the
      calling agent; webdesign confirms and wires it

## Approval log

- 2026-08-19T14:01:56+0200 — MANDATE under the USER's 2026-08-19 orchestration directive.
  Queued at todo; spec-first at design.
