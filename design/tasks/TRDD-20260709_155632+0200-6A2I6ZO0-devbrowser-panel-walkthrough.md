---
trdd-id: 6A2I6ZO0
title: dev-browser headless walkthrough of the HTML terminal side panel
column: complete
created: 2026-07-09T15:56:32+0200
updated: 2026-07-09T16:45:00+0200
current-owner: ai-maestro-session
assignee: ai-maestro-session
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
last-test-result: pass
last-test-at: 2026-07-09T16:41:00+0200
implementation-commits: [61027240, 2fbd313e]
external-refs: []
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-09

**DONE.** All 5 verification steps ran headlessly and passed. Zero orphan Chromium
renderers (2 before, 2 after — both pre-existing).

The walkthrough did what a browser walkthrough is for: it found a **real, silent
bug the 6 unit tests could not see** — the feedback channel never worked. Fixed and
re-verified through the exact path that broke it. Two further defects were found and
verified along the way; one is fixed, three are recorded below (not fixed here).

**SUPERSEDED — do NOT carry forward:** the body's step-4 wording "assert the UI
surfaces the refusal". A rejected URL scheme is a 400 to the CALLING plugin; nothing
is ever sent to the dashboard, so the UI has nothing to surface. Corrected below.

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

## Outcome (2026-07-09) — 5/5 steps pass; one silent bug found, fixed, re-verified

Run: dev-browser headless (`--browser ai-maestro-panel-6a2i`), Node 22 dev server,
disposable agent `my-test-panel-6a2i` (`a51c305a…`, created + soft-deleted; its
folder `~/agents/my-test-panel-6a2i` was LEFT on disk — untracked, and RULE 0 forbids
deleting untracked files without permission).

| Step | Result | Evidence |
|---|---|---|
| 1 Render | PASS | `set` → `delivered:1`; `srcdoc` iframe, sandbox `allow-scripts allow-forms` (**no** `allow-same-origin`); marker/heading/button present; the pushed script ran. `set` also auto-switched the dashboard to the Panel tab (openSignal), unprompted. |
| 2 open/close/refresh | PASS | `refresh` remounts the iframe (a tag set on the old document is gone) and re-renders the held content with **no** new `set`. `close` leaves the html tab only because we were on it → Terminal active, iframe unmounted, content-dot shown. `open` returns to the tab with content intact, dot cleared. |
| 3 Feedback round-trip | **PASS only after a fix** — see below | click on `#fixture-btn` → one `panel:feedback` frame carrying `{tag,id,text,dataset:{veId,probe}}`; drain #1 returns it, drain #2 is empty. `data-ve-nofeedback` element produces nothing. |
| 4 URL mode | PASS | `set --url https://example.com` → `src` iframe, title "Agent panel (live URL)", sandbox **with** `allow-same-origin`, frame navigated. `javascript:` / `file:` / `data:` → 400 `url must be http(s)`; `html`+`url` together → 400. |
| 5 Themes | PASS | light `rgb(255,255,255)` vs dark `rgb(3,7,18)` (gray-950). `reports/screenshots/20260709_163618+0200-trdd-6a2i-panel-{light,dark}.png` (gitignored). |

Renderer count 2 → 2. Gates: `tsc --noEmit` 0 · vitest 135 files / 2126 pass / 0 fail ·
`next lint` clean on touched files · `node --check server.mjs` OK.

### BUG-001 (fixed) — the feedback channel never worked, and failed silently

`hooks/usePanelWebSocket.ts`: `ws.onclose` ran `wsRef.current = null` **unconditionally**.
Switching the active agent tears the effect down and re-runs it immediately, so the OLD
socket's close event lands *after* the new socket is already in `wsRef` — and wipes it.
`sendFeedback` is the only reader of `wsRef`, so from then on every click inside the
panel was dropped before it reached the WebSocket.

It was silent because the failure is asymmetric: `onopen` restores `connected` but never
restores the ref. So the server reported `connectedClients: 1`, the UI said "Panel channel
connected", control messages kept arriving — and feedback went nowhere. All four
observations are consistent only with this cause.

Two contributing shapes, both fixed: the handlers closed over the mutable `ws` variable
(reassigned on reconnect) rather than a per-connection `const sock`, and `onerror` closed
whatever socket was current rather than its own.

Fix: capture `sock` per connection; guard every handler on `wsRef.current === sock`.
Re-verified by driving the exact path that broke it (load → **switch agent** → push →
click): one `panel:feedback` frame sent, drained once, empty on the second drain.

`hooks/useCompanionWebSocket.ts` carries the same defect and the same `send()` reader.
`hooks/useWebSocket.ts` (terminal) is already immune: it nulls `onclose` before `close()`.

**Regression test — landed in `TRDD-4XQ1PNMV`, not in the fix commit.** The defect is a
React lifecycle race; only a rendering test catches it, and the repo had neither `jsdom` nor
`@testing-library/react`. Rather than slip devDependencies into a bugfix commit, the harness
was carried as a follow-up and delivered immediately after:
`tests/unit/ws-hook-lifecycle.test.ts` (12 tests). Falsified as required — with the guards
removed, exactly the 4 defect tests fail and the 8 behaviour tests still pass.

**Correction:** the companion fix is no longer "by inspection". Its clobber test fails
against the pre-fix hook, so it is now verified the same way the panel fix is.

### BUG-002 (recorded, partially addressed) — every strict route of epic TRDD-SCLSRS6E was unreachable by agents

`lib/sudo-guard.ts` `requireAidTitle` fails CLOSED for a strict route present in neither
`SYSTEM_OWNER_ONLY_STRICT` nor `STRICT_AGENT_RULES`. All eight routes this epic shipped
were in neither. Verified: a MANAGER-titled agent gets `403 aid_title_forbidden` on
`panel`, `queue`, `prompt/answer`, and all five `/api/trdd/*` verbs — i.e. the janitor,
the sole intended consumer, could not call any of them. `janitor#76` states the opposite
and must be corrected.

Running the new coverage guardrail surfaced **six older strict routes** in the same state
(`PATCH /api/agents/[id]`, both `maestro-delegate` verbs, both `foreign-approvals` verbs,
`POST /api/system/aid-recover`).

Addressed here **without changing who may call anything** (403 before, 403 after): the 14
routes are declared in a new `AGENT_POLICY_PENDING` debt ledger, agents now get an honest
`agent_policy_undefined` instead of a misleading "not available to agents", and
`tests/unit/sudo-guard-strict-agent-coverage.test.ts` pins the ledger so a new strict route
cannot ship undeclared.

**Not** addressed: whether agents may drive these routes. The obvious mapping (panel →
`send-command`, `targetFromPathId`) would *deny an agent driving its own panel*, because
`authorize()` universally refuses self-targeting — yet an agent showing the human its own
visualization, or enqueuing `/compact` on itself, is the primary use case. That is a
governance decision, not a mapping detail → proposal `TRDD-D3RP7KQZ`.

### BUG-003 (recorded) — the sudo mint is a global 5/60s bucket that successful mints consume

`POST /api/auth/sudo-password` calls `checkAndRecordAttempt('sudo-password', 5)` — a
**global** key, 5 attempts per 60 s — and, unlike `/api/auth/login`, never calls
`resetRateLimit` on success. Since every strict call burns one one-shot, operation-bound
token, a USER can perform at most **5 strict operations per minute, machine-wide**. Hit
live during this walkthrough: `429 Too many sudo attempts`. Deleting six agents in a row
from the UI would fail on the sixth. Recorded, not fixed: rate-limiting a password
endpoint is deliberate, and separating "failed password attempts" from "successful mints"
is a security-policy change. → proposal `TRDD-X8R2HP9D`.

### Observation — the script layer has no USER auth path

`scripts/shell-helpers/common.sh::get_auth_args` emits only `Authorization: Bearer $AID_AUTH`.
There is no session-cookie support anywhere in the wrapper layer, so `aimaestro-panel.sh
status <agent>` from a human's terminal returns `401 auth_required` — while its own header
claims "the local owner needs none". Agents (which carry `AID_AUTH`) reach the non-strict
verbs fine and are 403'd on the strict ones by BUG-002. The walkthrough therefore drove
`POST /api/agents/[id]/panel` directly with cookie + per-call sudo token; the wrapper hits
the identical route. Folded into proposal `TRDD-D3RP7KQZ`.

### Spec corrections to the body above

- Step 4's "assert the UI surfaces the refusal" is not achievable and was not attempted:
  a bad scheme is rejected in `buildPanelMessage` and returned as 400 to the caller. The
  dashboard never learns of it. Asserted instead: the 400 + unchanged panel content.
- The "one sudo token doesn't cover a walkthrough" gotcha is right but understated — you
  also cannot mint more than 5 tokens per minute (BUG-003).

## Approval log
