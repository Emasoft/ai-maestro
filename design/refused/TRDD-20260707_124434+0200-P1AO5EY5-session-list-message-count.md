---
trdd-id: P1AO5EY5
title: Replace the literal "? msgs" placeholder with a real cached message count
column: refused
created: 2026-07-07T12:44:38+0200
updated: 2026-07-07T13:24:46+0200
current-owner: scenario-runner
approval-tier: 2
priority: 2
severity: LOW
effort: M
labels: [scenario-improvement, scen-027, batch-backlog-20260707]
task-type: feature
parent-trdd: null
npt: []
eht: []
relevant-rules: []
external-refs: ["reports_dev/scenarios-runner/scenario_proposed-improvements_027_2026-05-23T00-42-41Z.md"]
---

# TRDD-P1AO5EY5 — Replace the literal "? msgs" placeholder with a real cached message count

## Problem

The Sessions tab's session-list row shows `<uuid> · <size> KB · ? msgs ·
<age>` — a literal question mark instead of a real number. Verified in
SCEN-027 S008 (session row `82b989ad-... · 63.9 KB · ? msgs · 26d ago`) and
confirmed still present at HEAD (2026-07-07):
`components/agent-profile/sessions/SessionList.tsx:122` —
```
<span>{s.messageCount !== null ? `${s.messageCount} msgs` : '? msgs'}</span>
```
Note: a sibling component, `components/agent-profile/SessionsTab.tsx:159-160`,
handles the null case differently (it silently omits the ", N msgs" segment
instead of showing "?"). The two components have drifted — both should
converge on whichever fix is applied.

## Root cause

`services/sessions-browser-service.ts:99` currently hardcodes
`messageCount: null` for every session-list entry (see the comment at
line 68: "Each entry carries file size, mtime, and a lazy `messageCount =
null`"). The message count is never actually computed anywhere in the
Node service layer, and the Rust reader's on-disk index does not persist
one either — confirmed by grepping `rust-tools/aim-jsonl-reader/src/index.rs`
for `total_messages`/`message_count`, which returns no hits. So the "lazy"
comment describes an intended-but-never-implemented on-demand fill.

## Proposed fix

1. In `rust-tools/aim-jsonl-reader/src/index.rs`, when generating or
   updating a session's `.aimidx` sidecar, add a `total_messages` field to
   the index footer/metadata (incrementing once per JSONL line processed
   — the reader already walks every line to build the rest of the index,
   so this is a near-zero-cost addition).
2. In `services/sessions-browser-service.ts`, replace the hardcoded
   `messageCount: null` (line 99) with a read of the `.aimidx` sidecar's
   `total_messages` field when the sidecar exists and is not stale
   (mtime check against the `.jsonl` file, consistent with however
   staleness is already checked elsewhere in this service for other
   sidecar-derived fields). Fall back to `null` only when no sidecar
   exists yet or a stale one can't be trusted.
3. Update `components/agent-profile/sessions/SessionList.tsx:122` and
   `components/agent-profile/SessionsTab.tsx:159-160` to use the same
   fallback behavior — recommend keeping the SessionList.tsx `'? msgs'`
   text (explicit "unknown" signal beats silently omitting the segment,
   which just looks like inconsistent formatting), but confirm the two
   components render identically once `messageCount` is populated for the
   common case.

## Verification

Open the Sessions tab for an agent with multiple sessions, at least one of
which predates any `.aimidx` sidecar (to exercise the fallback path) and
at least one with a fresh sidecar. Confirm sessions with a valid sidecar
show a concrete `<n> msgs` count matching a manual `wc -l` on the `.jsonl`
(or the appropriate message-line filter if not every JSONL line is a
message), and sessions without one still show `? msgs` gracefully (no
crash, no `NaN`).

## Estimated risk

MEDIUM — touches the Rust index writer, the Node service wrapper, and two
React components; the `.aimidx` schema change needs to stay
backward-compatible with sidecars written before this field existed (a
missing `total_messages` field must be treated as "unknown", not `0`).

## Approval log

- 2026-07-07T13:24:46+0200 — REFUSED by USER-delegated batch screening (tier 2). Cosmetic placeholder polish; M effort not justified.
