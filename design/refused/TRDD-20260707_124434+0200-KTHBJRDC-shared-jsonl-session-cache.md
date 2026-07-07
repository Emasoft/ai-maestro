---
trdd-id: KTHBJRDC
title: Share a parsed-JSONL cache between the Chat tab and the Sessions tab
column: refused
created: 2026-07-07T12:44:38+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: LOW
effort: L
labels: [scenario-improvement, scen-027, batch-backlog-20260707]
task-type: refactor
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_027_2026-05-23T00-42-41Z.md"]
---

# TRDD-KTHBJRDC — Share a parsed-JSONL cache between the Chat tab and the Sessions tab

## Problem

Both the agent-view **Chat tab** and the **Sessions tab** (the JSONL
session browser) read the same underlying file —
`~/.claude/projects/<slug>/<session-uuid>.jsonl` — for the same agent, but
they parse it independently with no shared cache. In SCEN-027, opening the
Chat tab (S006, to confirm a JSONL existed before testing the Sessions
tab) forced a full re-parse of the transcript, even though the Sessions
tab's reader (once visited) is the canonical, more capable reader for the
same file. This is a missed opportunity: whichever tab is opened first
could warm a shared cache for the other.

## Root cause

The Chat tab and the Sessions tab (`components/agent-profile/sessions/*`,
notably `useJsonlSession.ts` and the underlying
`services/sessions-browser-service.ts` / `rust-tools/aim-jsonl-reader`
pipeline) evolved independently and do not currently share any in-memory
or cross-tab cache keyed by session UUID.

## Proposed fix

1. Introduce a `SessionsCache` React context (or a module-level cache
   keyed by session UUID + JSONL mtime, scoped per-agent to avoid the
   module-level-mutable-state pitfall called out in this project's
   browser-UI-test-techniques lessons — i.e. scope it via a Provider per
   agent view, not a bare top-level array) that both the Chat tab and the
   Sessions tab subscribe to.
2. When either tab opens a session and parses/streams it, the parsed
   result (or at least the already-fetched line ranges / message list)
   goes into the shared cache.
3. When the other tab opens the same session UUID, it reads from the
   cache first instead of re-issuing the read from the Rust reader /
   Node service layer.
4. Invalidate the cached entry when the underlying JSONL file's mtime
   changes (the agent produced new output since the cache was populated).

## Verification

1. Open the Chat tab for an agent with an existing session; note it loads
   the transcript (baseline timing/network activity).
2. Open the Sessions tab for the same agent/session — it should load
   near-instantly (cache hit), not re-read the file from scratch.
3. Switch back to the Chat tab — still instant (still cached).
4. Stop the agent's live session, externally append a new line to the
   JSONL file, then refresh — both tabs should pick up the new line
   (cache correctly invalidated by the mtime change), not serve stale
   cached content.

## Estimated risk

MEDIUM — introduces a new shared context/cache and invalidation logic
that both tabs must correctly participate in; a bug here could cause one
tab to show stale data after the other tab's more recent read. Needs
careful testing of the invalidation path (point 4 above) before shipping.

## Approval log

- 2026-07-07T13:24:46+0200 — REFUSED by USER-delegated batch screening (tier 2). Speculative L-effort perf refactor; no measured performance problem on record.
