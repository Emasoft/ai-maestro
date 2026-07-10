---
trdd-id: 229CJGYH
title: HTML side-panel subsystem for visualizer plugins with open close refresh and feedback callback
column: complete
created: 2026-07-09T10:27:08+0200
updated: 2026-07-10T04:20:51+0200
implementation-commits: [230ea125]
current-owner: ai-maestro-session
assignee: ai-maestro-session
priority: 2
severity: MEDIUM
effort: L
task-type: feature
release-via: none
parent-trdd: TRDD-SCLSRS6E
derived: true
derived-kind: npt
npt: []
eht: []
relevant-rules: []
labels: [side-panel, html, visual-communicator, websocket, api, g4]
test-requirements: [unit, integration, dev-browser-headless]
review-requirements: [human-review]
impacts: [public-api]
external-refs: ["campaign gate G4 in TRDD-903b7a20"]
---

# TRDD-229CJGYH — HTML side-panel subsystem (campaign gate G4)

> **Graph correction 2026-07-10 (corpus sweep).** This TRDD's `eht:` named
> TRDD-280DF70U, the shared script-wrapper platelet. But an `npt:`/`eht:` edge
> declares *parenthood*, and 280DF70U has exactly one parent — the epic
> TRDD-SCLSRS6E, which still claims it. Five siblings named the same platelet, so
> the one-parent law read it as five parents. What the edge really said is "the
> panel needs a wrapper script" — a dependency on a sibling, which belongs in
> `blocked-by:`. Moot now: 280DF70U is complete, and `blocked-by:` carries only
> OPEN blockers. This TRDD is itself an NPT of the epic; a derived TRDD carries no
> children of its own (depth is exactly 1).

Build a new dashboard side panel that visualizer plugins (visual-communicator /
webdesign) can push live HTML into, open/close/refresh remotely, and receive
click-driven feedback back from — so a plugin can drive the panel from a live
Claude Code agent instead of only deploying to Vercel or opening a standalone local
browser. This is greenfield work and closes campaign gate G4 (TRDD-903b7a20).

## What exists today

- Nothing — this is 0/5, fully greenfield.
- `app/page.tsx:93` — the existing tab set (terminal/chat/messages/worktree/
  search/export/profile) has no `html`/`panel` tab.
- The only comparable companion channel today is voice: `server.mjs:878-1019`
  (`companionWss`), which sends `{type: 'speech'}` messages over a per-agent
  WebSocket client registry.
- Today, visual-communicator deploys either to Vercel
  (`amvcp-share-page`) or opens a local browser and file-polls a `.ve-comments/`
  directory for feedback. There is no ai-maestro-native panel it can push into.
- Reusable templates to build on: the `app/page.tsx` tab-switcher (roughly lines
  799-880) for adding a new tab, and the `companionWss`
  per-agent client-registry pattern (`Map<agentId, Set<ws>>`, with `ws._xCleanup`
  for teardown) as the shape for the new panel-content WebSocket server.

## What to build

1. A new HTML side-panel component (`components/HtmlSidePanel.tsx`), wired as a new
   `html` tab in `app/page.tsx`, rendering pushed HTML inside a SANDBOXED iframe
   (`srcdoc` + a restrictive `sandbox` attribute). Per the no-nested-scrollbars
   rule, the iframe/panel content must let the page expand — no inner
   `overflow: auto`/`scroll` boxes.
2. A new panel-content WebSocket server in `server.mjs`, mirroring the
   `companionWss` per-agent client-registry pattern, keyed by `agentId`, carrying
   messages shaped `{type: 'panel:set-html'|'panel:open'|'panel:close'|'panel:refresh', html?, url?}`.
3. API routes to drive the panel from outside the browser session:
   `POST /api/agents/[id]/panel` — `{action: 'open'|'close'|'refresh'|'set', html?, url?}`.
4. A FEEDBACK callback channel: panel → server → the plugin that pushed the content.
   Implemented as a `panel:feedback` WebSocket message plus either a
   `GET /api/agents/[id]/panel/feedback` drain endpoint or delivery as an AMP
   message back to the originating plugin/agent.
5. dev-browser integration so the panel can also display a live rendered website
   (a dev-browser screenshot or a live URL) — the visualizer's "show me the app"
   use case, not only static pushed HTML.

## Files to touch

- NEW `components/HtmlSidePanel.tsx`.
- edit `app/page.tsx` — add the `html` tab.
- edit `server.mjs` — new panel-content WebSocket server (mirrors `companionWss`).
- NEW `app/api/agents/[id]/panel/route.ts`.
- NEW `app/api/agents/[id]/panel/feedback/route.ts`.
- NEW `hooks/usePanelWebSocket.ts`.

## Tests

- dev-browser headless: pushing HTML via `POST .../panel` `{action: 'set', html}`
  results in the panel actually rendering that HTML (verified via the DOM, not just
  a 200 response).
- Open/close/refresh actions each produce the correct panel state transition,
  verified via a dev-browser headless walkthrough.
- Feedback round-trip: a click inside the panel's pushed HTML results in a
  `panel:feedback` event being delivered back out (to the WS drain or as an AMP
  message) with the click's payload intact.
- Light and dark theme screenshots both render correctly (no unstyled/broken panel
  in either theme).
- No nested scrollbar regression: wide/tall pushed content expands the page rather
  than introducing an inner scrollbar (per the no-nested-scrollbars rule).

## Approval log
