---
trdd-id: ZLBBD4E3
title: read-only session-activity verb usable on non-self panes for the fleet guardian
column: complete
created: 2026-08-20T08:27:07+0200
updated: 2026-08-20T09:02:49+0200
current-owner: ai-maestro-hub
task-type: feature
scope: project
project-id: ai-maestro
priority: 1
min-approval-requirement: none
mandate: true
mandated-by: self
approved: true
approval-judge: ai-maestro-hub
approval-datetime: 2026-08-20T08:27:07+0200
---

# Read-only session-activity verb for non-self panes

## Problem

Janitor ask (2026-08-20): the fleet guardian + injection gates need
`aimaestro-agent.sh session activity <tmux> --json` → {in_turn, last_user_input_epoch,
transcript_advancing}. Today fleet_scan infers from transcript mtimes and the injection
gates probe HID via ioreg, which goes blind under load — the 2026-08-19 type-over-the-user
incident (janitor TRDD-D2DD5GO8). R42 constrains `state --pane` to SELF-only, which is why
this must be its OWN read-only verb rather than a reuse: the R42 constraint guards a
different hazard (pane CONTENT capture), while this verb returns derived booleans/epochs
only, never pane text.

## Proposed fix (specs-first)

1. Spec the verb: read-only, non-strict, returns ONLY derived activity signals (no pane
   content, no transcript text) — that property is what keeps it R42-compatible; state it
   in the spec so a future edit cannot widen it silently.
2. Server side: derive in_turn/last_user_input_epoch/transcript_advancing from what the
   sessions service already tracks (hook state, chat state, transcript mtime) — measure
   what exists before adding a collector.
3. CLI verb thin over the route; regen specs.

## Acceptance

- [x] spec section first — generated from the session.sh header, no-content property stated normatively; specs:check green
- [x] server derivation measured first: hook chat state (chatStateFileFor), lib/user-presence (last_user_input_epoch — the exact signal the ioreg probe approximates), transcript slug mtime. ZERO new collectors. `transcript_advancing` deliberately became `transcript_last_write_epoch`: one sample of a moving quantity licenses nothing, so movement is the CALLER's two-sample derivation — spec'd that way
- [x] LIVE-verified post-deploy: busy pane (frank) in_turn=true hook=active, idle pane (testbot) in_turn=false hook=idle, all five fields populated on both; unknown session → 404. Unit-pinned besides (in_turn map, null-absence, unreadable-file)
- [x] janitor notified with the exact invocation post-verification (2026-08-20)

## Approval log

- 2026-08-20T08:27:07+0200 — MANDATE issued by the hub (min-approval-requirement: none). No request sent.

- 2026-08-20T09:02:49+0200 — COMPLETED by the hub: shipped, deployed (yarn build + pm2 restart), live-verified by effect; all boxes checked.
