---
trdd-id: 5CIL7A07
title: Programmatic per-client terminal-continuity automaton
column: design
scope: project
created: 2026-07-24T14:55:30+0200
updated: 2026-07-24T14:55:30+0200
current-owner: ai-maestro
created-by: ai-maestro
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

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-24

Goal: build a programmatic, always-on, per-client terminal-continuity automaton — ONE injector
reusing the fleet-recovery-actuator's cooldown, STOP gate, HID-presence, curated-key boundary.
Depends on Flock D being trustworthy (USER's order) for the ESC-before-rotation ordering, but E1/E2
detection can start in parallel. NEXT ACTION: execute NPT 6HEF0XLS (xterm/headless reader), then
X8801GT4 (registry+actuator extension), then the EHT events. Not started.

## Spec

- ARCHITECTURE §8 (ai-maestro#90) is the canonical first event — the retry-wedge
  (`attempt N/300` spinning turn) → server detects the rendered frame and injects **ESC only**.
- The AskUserQuestion case is a *distinct* event (ESC-then-inject a directive).
- ONE injector (reuse the actuator's cooldown, STOP gate, HID-presence, curated-key boundary).
- Depends on Flock D being trustworthy (ESC-before-rotation ordering), but E1/E2 detection can
  start in parallel.

## Acceptance

- [ ] NPT 6HEF0XLS (xterm/headless reader) terminal
- [ ] NPT X8801GT4 (registry + actuator extension) terminal
- [ ] EHT Y8VPE3NS (retry-wedge event) terminal
- [ ] EHT U6AS2YWB (AskUserQuestion event) terminal
- [ ] EHT 9DYUI97S (idle-with-inbox wake event) terminal
- [ ] EHT 8C1Z42GV (multi-client registry entries + detection tests) terminal

## Approval log

- 2026-07-24T14:55:30+0200 — MANDATE issued by USER (min-approval-requirement: none). Pre-approved; born approved to author+execute.
