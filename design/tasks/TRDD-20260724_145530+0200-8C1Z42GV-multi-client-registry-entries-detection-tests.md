---
trdd-id: 8C1Z42GV
title: Multi-client registry entries and detection tests
column: design
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-08-25T17:28:11+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-24T14:55:30+0200
parent-trdd: 5CIL7A07
derived: true
derived-kind: eht
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-05

**"PURE DATA" IS THE MISLEADING WORD. The table append is one line; the DATA DOES NOT EXIST, and
acquiring it is the whole task.** Measured 2026-08-05 before starting:

| checked | result |
|---|---|
| per-client event modules in `lib/` | **one** — `continuity-events-claude.ts` |
| events defined for Claude | **one** — `retry-wedge` |
| captured Codex / OpenCode / Kimi frames anywhere in the repo | **none** — every `Retrying in … attempt N/300` hit is Claude's OWN pattern, in its own tests and a triage report |
| clients installed on this host | `codex` ✓ `gemini` ✓ `opencode` ✓ · `kiro` ✗ `kimi` ✗ |

**Why a registry entry cannot be written without the frame, and why guessing is worse than
waiting.** The event's `response` is a **raw keystroke injected into a live agent's terminal**
(Claude's is one ESC). So a matcher built from documentation rather than a captured frame does not
merely fail to fire — when it fires on the WRONG client's healthy screen it types into a working
session. The card's own NEXT ACTION says this outright, and it is the reason it must not be
short-circuited: *"a signature guessed from documentation is exactly how one client's pattern
fires on another's healthy screen."*

**And a placeholder entry buys nothing.** `continuity-registry.ts:19` is explicit that an unknown
program, a throwing matcher, and an **empty event list** are all the same fail-open outcome — so
appending `{program: 'codex', events: []}` is indistinguishable from the current state. There is no
honest partial here.

**Moved `todo → backburner`.** Nothing local blocks it (so `blocked`, which needs a `blocked-by`
naming an open card, would be wrong), and it is not ready (so `todo` was a lie — it claimed a
one-line data append was waiting).

**WHAT WOULD UNBLOCK IT — two routes, and the first is free:**
1. **Capture opportunistically.** A real Codex/OpenCode wedge occurring in the wild, captured
   (`tmux capture-pane` on the wedged pane) and pasted into this card. Costs nothing, needs only
   that whoever sees one grabs the frame.
2. **Induce deliberately** — drive an installed client into its wedge/menu surfaces and capture
   there. That is a USER decision about their own machine and their own API quota, and it needs
   their word before I touch a third-party client.

Either way the frame must be REAL and pasted here BEFORE a matcher is written. Do not re-open this
card as "pure data" — that phrasing already cost one session a start.

## ⏵ SUPERSEDED STATE — 2026-07-24 (its unblock claim was about the ENGINE, not the data)

Goal: add per-client event signatures for at least Codex + one of Kimi/OpenCode, with a detection
unit test per client.

**UNBLOCKED 2026-07-24** — the registry landed (TRDD-X8801GT4, `a3a22376`).

NEXT ACTION: this is now PURE DATA — append a `ContinuityClientEntry` per client to
`CONTINUITY_REGISTRY` in `lib/continuity-registry.ts`; the engine needs no change (its tests
already prove that by driving it entirely with fake tables). Two things to get right: (1) capture
a REAL frame from each client before writing a matcher — a signature guessed from documentation
is exactly how one client's pattern fires on another's healthy screen; (2) `program` must match
what the agent registry actually stores for that client (normalisation handles path/case, not a
different name). Aligns with task #57.

## Spec

- Per-client event signatures for at least Codex + one of Kimi/OpenCode (their wedge/menu/idle
  surfaces); a detection unit test per client. Aligns with task #57 (multi-client runtime-env
  enforcer).

## Acceptance

- [ ] Per-client detection unit tests pass for Claude + ≥1 non-Claude client

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
