---
trdd-id: 6A2I6ZO0
title: dev-browser headless walkthrough of the HTML terminal side panel
column: planned
created: 2026-07-09T15:56:32+0200
updated: 2026-07-09T15:56:32+0200
current-owner: ai-maestro-session
assignee: null
priority: 3
severity: LOW
effort: S
task-type: feature
release-via: none
parent-trdd: TRDD-SCLSRS6E
npt: []
eht: []
relevant-rules: []
labels: [dev-browser, panel, browser-test, deferred]
test-requirements: [e2e, dev-browser-headless]
review-requirements: []
runtime-targets: [macos]
impacts: []
external-refs: []
---

# TRDD-6A2I6ZO0 — dev-browser headless walkthrough of the HTML side panel

The **browser-level** verification of the HTML terminal side panel shipped by
TRDD-229CJGYH (D4 of epic TRDD-SCLSRS6E). It was deferred from Phase D to Phase E to
Phase F; rather than roll it forward a fourth time inside an epic whose other work is
done, it becomes its own task here. That is the whole reason this TRDD exists — the
deferral is now visible on the board instead of buried in a STATE block.

## Why it was deferred rather than dropped

The panel's **server half is fully covered** and should not be re-tested here:

- 6 unit tests: content mapping, bad payload shapes, fan-out with dead-socket pruning,
  the zero-client case, FIFO drain, and the bounded queue.
- Live checks against a running server (Phase E): the `delivered`-count semantics and
  the strict-route sudo gate on `POST /api/agents/[id]/panel`.

What is **not** covered is anything that requires a real DOM: whether the HTML a
caller pushes actually renders, whether the panel opens/closes/refreshes visibly, and
whether a click inside the panel travels back out as feedback.

## What to verify (headless dev-browser)

Drive the dashboard through the `dev-browser` CLI (per `tests/scenarios/`
SCENARIOS_TESTS_RULES.md Rule 8 — sandboxed JS piped to the CLI, `--headless`):

1. **Render.** `aimaestro-panel.sh set <agent> --html-file <fixture>` → the pushed
   document appears in the panel's DOM (assert on the a11y tree, not a screenshot).
2. **Open / close / refresh.** Each verb changes the panel's visible state, and
   `refresh` re-renders the content already held without a new `set`.
3. **Feedback round-trip.** A click on an element inside the panel is delivered to the
   feedback queue; `aimaestro-panel.sh feedback <agent>` drains it (read + clear) and a
   second drain returns empty.
4. **URL mode.** `set --url <https-url>` previews a live site; `javascript:`, `file:`,
   and `data:` URLs are rejected (server-side, but assert the UI surfaces the refusal).
5. **Themes.** Capture light **and** dark theme screenshots (`~/.claude/rules/
   browser-ui-test-techniques.md` §19), saved under
   `$MAIN_ROOT/reports/screenshots/`.

## Gotchas that will bite (learned in Phase E)

- **`delivered: 0` means the content was dropped, not queued.** If no panel channel is
  connected, `set`/`open` succeed with a zero fan-out count. The walkthrough must open
  the panel and confirm a live channel via `aimaestro-panel.sh status` *before*
  asserting on rendered content, or every render assertion will fail against an empty
  DOM for the wrong reason.
- **`POST /api/agents/[id]/panel` is a strict route.** A USER caller (cookie) needs a
  fresh, one-shot, operation-bound sudo token per call — one token does not cover the
  whole walkthrough. An agent caller (Bearer AID + governance title) needs none.
- **The server needs Node 22.** `node-pty` throws `ERR_DLOPEN_FAILED` on this machine's
  default Node 26; the repo's own `check-node.mjs` guard enforces `>=22 <26`.
- Use a **disposable test agent** (a `scen-`/`my-test-` prefix). Never index into
  `/api/agents` and take `agents[0]` — that resolved to a real user agent during the
  Phase E smoke run.

## Tests

The walkthrough IS the test. It passes when steps 1-5 above assert green headlessly and
the run leaves zero orphan Chromium renderer processes (snapshot the renderer count
before and after; they must match).

## Approval log
