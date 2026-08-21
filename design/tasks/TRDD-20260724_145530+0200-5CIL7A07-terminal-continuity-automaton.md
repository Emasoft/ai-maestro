---
trdd-id: 5CIL7A07
title: Programmatic per-client terminal-continuity automaton
column: blocked
pre-block-column: dispatch
blocked-by: [Y8VPE3NS, U6AS2YWB, 8C1Z42GV]
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-08-21T14:00:55+0200
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
npt: [6HEF0XLS, X8801GT4]
eht: [Y8VPE3NS, U6AS2YWB, 9DYUI97S, 8C1Z42GV]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-08-20

Goal: build a programmatic, always-on, per-client terminal-continuity automaton — ONE injector
reusing the fleet-recovery-actuator's cooldown, STOP gate, HID-presence, curated-key boundary.
Depends on Flock D being trustworthy (USER's order) for the ESC-before-rotation ordering, but E1/E2
detection can start in parallel. **NPT GATE SATISFIED (verified 2026-08-20) — both NPTs are terminal:
6HEF0XLS (xterm/headless reader) and X8801GT4 (registry+actuator extension) are `complete` in
`design/archived/`.** This card sat parked behind prerequisites that had already finished. ~~NEXT ACTION:
build the injector itself, then the EHT events. Not started.~~

**⚠ RE-MEASURED 2026-08-21 — "Not started" is FALSE. The injector and E1 are BUILT.** Struck, not
deleted; this is the TENTH stale premise found on this board today, and the one that parked a card
in `dispatch` for a build that already exists.

- **The ONE injector:** `lib/fleet-continuity.ts:173-193` — its own comment says *"the gates + the
  one side effect, split out so the injector is visible in isolation"* — injecting `ESC_KEYSTROKE`
  imported from `lib/continuity-registry`.
- **E1, the canonical first event:** `lib/continuity-events-claude.ts:56-62` defines
  `id: 'retry-wedge'`, matched by `RETRY_WEDGE_RE` / `parseRetryAttempt`, with
  `response: { kind: 'esc' }` — **ESC only**, exactly as the spec below requires, with
  `progressMarker` carrying the attempt number.
- **The per-client registry** is `lib/continuity-registry.ts`, and the frame reader (NPT 6HEF0XLS)
  is `lib/agent-frame-reader.ts`.

**E2 is the one genuinely open event, and it needs a RULING before it needs code.**
`CLAUDE_CONTINUITY_EVENTS` holds exactly ONE entry — there is no AskUserQuestion event. But
`lib/fleet-askuser-autoanswer.ts` shipped separately (`8e03e32f`, dark behind
`AIM_FLEET_ASKUSER_AUTOANSWER=1`, per `TRDD-MN0Q1IA2` item 5) and answers a dwelled menu with its
DEFAULT. That is a different mechanism from this card's E2 (*ESC-then-inject a directive*).
**Decide whether E2 is SUPERSEDED by the autoanswer leg before building it** — two mechanisms
racing for the same frame is a worse outcome than either alone.

**NEXT ACTION:** work `TRDD-Y8VPE3NS` (retry-wedge event, `column: todo`) — its code appears to be
the `retry-wedge` entry above, so start by checking whether that card is closeable rather than
buildable. This card itself is now `blocked` on its own flock, which is what the completion gate
requires: a parent whose EHTs are open is BLOCKED, never in a work column.
**EHT gate, for when the build lands:** Y8VPE3NS `todo`, U6AS2YWB `todo`, 9DYUI97S `superseded`
(terminal — does not gate), 8C1Z42GV `backburner` and GENUINELY BLOCKED: the captured client frames it
needs exist nowhere in the repo and acquiring them is its whole task. This card therefore cannot reach
`complete` until 8C1Z42GV is unblocked — sequence the two together.

## Spec

- ARCHITECTURE §8 (ai-maestro#90) is the canonical first event — the retry-wedge
  (`attempt N/300` spinning turn) → server detects the rendered frame and injects **ESC only**.
- The AskUserQuestion case is a *distinct* event (ESC-then-inject a directive).
- ONE injector (reuse the actuator's cooldown, STOP gate, HID-presence, curated-key boundary).
- Depends on Flock D being trustworthy (ESC-before-rotation ordering), but E1/E2 detection can
  start in parallel.

## Acceptance

- [x] NPT 6HEF0XLS (xterm/headless reader) terminal — `complete`, `design/archived/`, re-verified 2026-08-21
- [x] NPT X8801GT4 (registry + actuator extension) terminal — `complete`, `design/archived/`, re-verified 2026-08-21
- [ ] EHT Y8VPE3NS (retry-wedge event) terminal — **card is `todo` while its CODE appears to exist**
      (`lib/continuity-events-claude.ts:56-62`). Check closeable-vs-buildable first; the box tracks
      the CARD's column, so it stays open until that card is actually closed
- [ ] EHT U6AS2YWB (AskUserQuestion event) terminal — needs the SUPERSEDED-vs-build ruling above
      (`lib/fleet-askuser-autoanswer.ts` may already own this frame)
- [x] EHT 9DYUI97S (idle-with-inbox wake event) terminal — `superseded`, `design/archived/`;
      superseded IS terminal, so this box was satisfiable the day that card was archived
- [ ] EHT 8C1Z42GV (multi-client registry entries + detection tests) terminal — GENUINELY BLOCKED:
      the captured client frames it needs exist nowhere in the repo, and acquiring them is its
      whole task. This is the one that keeps this card out of `complete`

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
