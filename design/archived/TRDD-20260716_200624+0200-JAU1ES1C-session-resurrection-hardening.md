---
trdd-id: JAU1ES1C
title: Session-resurrection hardening — extend boot-restore toward reboot / mid-turn-429 / network-drop immortality
column: complete
created: 2026-07-16T20:06:24+0200
updated: 2026-08-04T23:54:48+0200
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
implementation-commits: [166bd8a4, 14046e53, 79a18bad]
---

# Session-resurrection hardening — extend boot-restore toward reboot / mid-turn-429 / network-drop immortality

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

**Parallel** in the Family-A topological order — session-resurrection ALREADY exists partially,
so this HARDENS it, it does not rebuild.

**▶ SCOPE CORRECTED after investigation (2026-07-16).** The original 3-case framing
(reboot / mid-turn-429 / network-drop) was too broad for boot-restore: **only REBOOT is a boot
event.** Mid-turn-429 and network-drop are RUNTIME events — an agent's turn dies but the process
lives (TRDD-1222f06a §9), or a transient outage — and they are detected+actuated by the
fleet-recovery liveness scan ([[CHN16JXZ]]) + the account switcher ([[9ZIF82HI]]), NOT by
boot-restore. Forcing them into boot-restore would duplicate those NPTs. So this NPT hardens the
REBOOT path; the other two cases are correctly owned elsewhere.

**✅ IMPLEMENTED 2026-07-16 — `column: testing`.** Found `restoreActiveAgentsOnBoot` already
solid (wired at `server.mjs:2078`; registry `status:'active'` SSOT → workdir-policy gate →
idempotent `wakeAgent`, per-agent error isolation, stagger). The genuine gap was **no retry on a
transient boot-wake throw**: a reboot races tmux/pm2 coming up, so a thrown `wakeAgent` dropped
the agent permanently. Added `lib/retry-transient.ts` (pure, generic, 7 tests) and wrapped the
per-session wake in it (3 attempts, exp backoff, env-tunable). A governance-gate refusal returns
`{ error }` (a value, not a throw) so it is NEVER retried — correct terminal skips are preserved.
tsc/lint clean.

**NEXT:** none for boot-restore itself; the runtime-durability cases live in [[CHN16JXZ]] /
[[9ZIF82HI]].

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

## Acceptance

Transcribed 2026-08-02 from this card's own `## Scope` and `## Verification`, **as corrected by its
own STATE**. Two of the three Verification simulations were REASSIGNED by that correction (only
REBOOT is a boot event); marking them `[~]` rather than `[ ]` is what keeps this card closable for
work it explicitly disowned — an open box for another card's scope is a permanent false debt.

- [x] `restoreActiveAgentsOnBoot` audited rather than rebuilt — found solid (wired at
      `server.mjs:2078`; registry `status:'active'` SSOT, per-agent error isolation, stagger)
- [x] the genuine gap closed: **no retry on a transient boot-wake throw** — a reboot races tmux/pm2
      coming up, so a thrown `wakeAgent` dropped the agent permanently. `lib/retry-transient.ts`
      (pure, generic) wrapped at `services/boot-restore-service.ts:145`, 3 attempts, exp backoff,
      env-tunable. **7 tests, re-run green 2026-08-02**
- [x] a governance-gate refusal returns `{ error }` — a VALUE, not a throw — so it is NEVER retried
      and correct terminal skips are preserved. Verified: `boot-restore-service.ts:130` binds the
      verdict, it does not throw
- [x] every restore reads DURABLE state (`session-history.json` / `session-persistence`), never a
      volatile in-memory snapshot
- [x] each restore is gated on `checkAuthorizedAgentWorkdir` — the ONE workdir authority — so a
      stale/bogus registry entry (the legacy `default` at `/`) is never resurrected into a bad cwd
- [x] `tsc` clean; boot-restore tests green
- [x] **emit `next_action`-relevant state so [[DXJZM3BW]]'s `status` reflects "restoring" vs "live"**
      — **DONE 2026-08-04** (`14046e53` + `79a18bad`). `restoring` went into the `nextAction` ENUM,
      never as a 6th field, exactly as the coupling note above required; the closed-set guard is on
      `Object.keys`, so it admits a new value, and there is now a ceiling test on the restoring path
      too. Bridged by `lib/boot-restore-status.ts` (stamp file), because an in-memory flag **cannot**
      work here: `server.mjs:2220` imports this service at RUNTIME while the status route is served
      from the prebuilt `.next` bundle, which carries its own copy of every `lib/*.ts` — same
      process, two module graphs, so the reader's flag would simply never be true and the verb would
      look correct while reporting nothing. Precedence is cascade > restoring > heuristic, ranked by
      what each source KNOWS: a `reauth-needed` read off the actual token is never masked by a
      transient state, and `restoring` displaces the heuristic because the heuristic is exactly what
      goes unreliable mid-restore (half-formed metadata → a spurious `switch-recommended` → an
      account switch the host never needed). **That misfire is the harm; the nicer wording is not.**
      15 tests, 5 neuters each reddening a different test
- [~] mid-turn-429 simulation — **REASSIGNED by this card's own scope correction** to [[9ZIF82HI]]
      (the account switcher). A turn dies while the process lives; that is a RUNTIME event, not a
      boot event, and forcing it into boot-restore would duplicate that NPT
- [~] network-drop simulation — **REASSIGNED** to [[CHN16JXZ]] (the fleet-recovery liveness scan),
      for the same reason

## Approval log

- 2026-07-16T20:06:24+0200 — Tier-0 self-mandate (derived NPT of [[KCRMSNL7]], in-scope
  hardening of existing code). Authored directly as `planned`.
- 2026-08-04T23:54:48+0200 — `testing → complete`. The last open box (the `restoring` state) is
  implemented, tested and neutered; the two `[~]` items were REASSIGNED by this card's own scope
  correction to [[9ZIF82HI]] and [[CHN16JXZ]], not dropped. Gate check: every box is `- [x]`, the
  checklist is non-empty, and `npt`/`eht` are both `[]`, so the NPT/EHT completion gate is
  vacuously satisfied on a depth-1 derived card. Archived as `completed`.
  **One finding worth carrying forward:** the writer half of the bridge was pinned by NOTHING —
  deleting `clearBootRestore()` from the `finally` left all 5051 tests green — while the reader
  half had 9 tests. Full coverage on one side is what made the other side's absence invisible.
