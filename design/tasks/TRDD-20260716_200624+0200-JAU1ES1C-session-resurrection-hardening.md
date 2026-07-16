---
trdd-id: JAU1ES1C
title: Session-resurrection hardening — extend boot-restore toward reboot / mid-turn-429 / network-drop immortality
column: planned
created: 2026-07-16T20:06:24+0200
updated: 2026-07-16T20:06:24+0200
current-owner: ai-maestro
task-type: refactor
scope: project
min-approval-requirement: none
mandate: true
mandated-by: ai-maestro
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-16T20:06:24+0200
relevant-rules: [16, 23]
labels: [family-a, continuity, session-resurrection, boot-restore, hardening, npt]
external-refs: [Emasoft/ai-maestro-janitor#100]
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
npt: []
eht: []
blocked-by: []
release-via: none
---

# Session-resurrection hardening — extend boot-restore toward reboot / mid-turn-429 / network-drop immortality

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

**Parallel** in the Family-A topological order — session-resurrection ALREADY exists partially,
so this HARDENS it, it does not rebuild. Light (non-blocking) dep on [[DXJZM3BW]] for the
`ensure-resume` route; kept out of `blocked-by:` deliberately so it can proceed in parallel.
**NEXT ACTION:** extend `services/boot-restore-service.ts::restoreActiveAgentsOnBoot` to cover
the three durability cases below, sourcing from the existing `session-history.json`.

## Problem / Goal

The user's mandate says the server "even resurrects the whole sessions after a reboot." Today
that is PARTIAL: `services/boot-restore-service.ts::restoreActiveAgentsOnBoot` +
`lib/session-history.ts` + `lib/session-persistence.ts` restore active agents on boot. This NPT
HARDENS that path toward "immortality" across three failure cases:

1. **Reboot** — the machine restarts; the server restores the fleet from the durable
   `session-history.json` (the revivable-orphan dataset). Already partial — close the gaps.
2. **Mid-turn 429** — the turn dies but the process lives (TRDD-1222f06a §9); pair with the
   account switcher ([[9ZIF82HI]]) so the resumed turn uses a healthy credential.
3. **Network drop** — a transient outage; the session is re-attached without losing durable
   state.

## Scope (HARDEN the existing path — do NOT rebuild)

- Audit `restoreActiveAgentsOnBoot` for gaps against the three cases; extend it, don't replace it.
- Ensure every restore reads from durable `session-history.json` / `session-persistence` (never
  a volatile in-memory snapshot).
- Gate each restore on `checkAuthorizedAgentWorkdir` (`lib/agent-workdir-policy.ts`) — the one
  workdir authority — so a stale/bogus registry entry (e.g. a legacy `default` at `/`) is never
  resurrected into a bad cwd.
- Emit `next_action`-relevant state so [[DXJZM3BW]]'s `status` reflects "restoring" vs "live".

## Reuse (the substrate that already exists TODAY)

- `services/boot-restore-service.ts` (`restoreActiveAgentsOnBoot`), `lib/session-history.ts`,
  `lib/session-persistence.ts` — the partial resurrection this NPT extends.
- `lib/session-safe-state.ts` — the safe-state gate for re-attaching without clobbering a live
  turn.

## Verification

- Reboot simulation: a fleet recorded in `session-history.json` is restored to the correct
  workdirs (bogus entries rejected by the workdir policy, not resurrected).
- Mid-turn-429 simulation: the resumed turn authenticates with a healthy credential (integration
  with [[9ZIF82HI]]).
- Network-drop simulation: re-attach preserves durable state; no double-write of session state.
- `tsc` clean; boot-restore unit/integration tests green.

## Approval log

- 2026-07-16T20:06:24+0200 — Tier-0 self-mandate (derived NPT of [[KCRMSNL7]], in-scope
  hardening of existing code). Authored directly as `planned`.
