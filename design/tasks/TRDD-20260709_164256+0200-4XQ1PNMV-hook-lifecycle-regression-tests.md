---
trdd-id: 4XQ1PNMV
title: Add a rendering test harness so WebSocket hook lifecycle races are catchable
column: planned
created: 2026-07-09T16:42:56+0200
updated: 2026-07-09T16:42:56+0200
current-owner: ai-maestro-session
assignee: null
priority: 2
severity: MEDIUM
effort: S
task-type: infra
release-via: none
parent-trdd: TRDD-6A2I6ZO0
npt: []
eht: []
blocked-by: []
relevant-rules: []
labels: [tests, hooks, websocket, dependencies]
test-requirements: [unit]
review-requirements: []
runtime-targets: [macos, linux]
impacts: [dependencies]
external-refs: []
---

# TRDD-4XQ1PNMV — a rendering test harness for WebSocket hook lifecycle races

TRDD-6A2I6ZO0 found a silent, load-bearing bug in `hooks/usePanelWebSocket.ts`: a
stale socket's `onclose` nulled `wsRef.current` unconditionally, wiping the
reference to the live socket created moments earlier by the re-run effect. Every
click inside the HTML panel was then dropped before it reached the WebSocket.

The panel had **6 passing unit tests**. None could see this, because the defect
lives in a React effect's closure and only appears when the effect is torn down
and re-run (i.e. when the active agent changes). It was found by driving a real
browser, and it was fixed and re-verified the same way.

That is a bad place to leave it. The fix is one `if (wsRef.current !== sock)`
guard; nothing in `yarn test` would notice if someone removed it.

## Why there is no test today

`vitest.config` runs `environment: 'node'`, and the repo has neither `jsdom` nor
`@testing-library/react`. A hook-lifecycle test needs both. Adding devDependencies
is a dependency change (`impacts: [dependencies]`) and had no business riding
along in a bugfix commit, so it was carried here instead of being slipped in.

## Scope

1. Add devDeps: `jsdom` (or `happy-dom`) and `@testing-library/react` (`renderHook`).
2. Allow a per-file `// @vitest-environment jsdom` docblock rather than flipping
   the global environment — the 135 existing node-environment test files must not
   pay for it.
3. A `FakeWebSocket` test double: constructor records instances; `open()`,
   `close()`, and `message()` drive the handlers synchronously.
4. Regression tests, one per defect shape actually observed:
   - **stale-close clobber**: mount with agent A, rerender with agent B, then fire
     A's `onclose` *after* B is connected → `sendFeedback` must still send on B.
   - **stale-error close**: A's `onerror` must not close B's socket.
   - **reconnect**: the live socket closing must null the ref, mark
     `connected:false`, and reconnect after the backoff.
   - **cleanup**: unmount must close the socket and not schedule a reconnect.
5. Apply the same tests to `hooks/useCompanionWebSocket.ts`, whose identical
   defect was fixed by inspection only and has never been exercised end-to-end.

## Verification

The tests must FAIL against the pre-fix bodies of both hooks (revert the guard
locally, watch them go red) and pass against the current ones. A regression test
that passes on the buggy code proves nothing — check this explicitly.

Gate: `npx tsc --noEmit` 0 · `npx vitest run` green · `npx next lint` clean on
touched files.

## Notes and lessons learned

The bug was invisible for a reason worth remembering: the failure was
**asymmetric**. `onopen` restored `connected` but never restored `wsRef`. So the
server reported a live client, the UI said "Panel channel connected", and control
messages kept flowing — while the only reader of `wsRef` silently no-op'd. Any
health signal that does not exercise the actual write path can report green while
the write path is dead.
