---
trdd-id: IZ6KU37Y
title: Mirror the janitor's model-scoped-window rotation policy in the server rotator/daemon
column: completed
created: 2026-08-15T16:35:41+0200
updated: 2026-08-15T23:58:00+0200
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: self
priority: 2
severity: medium
effort: medium
release-via: none
scope: project
project-id: ai-maestro
labels: [continuity, oauth-rotation, model-fallback, janitor-parity]
npt: []
eht: []
blocked-by: []
implementation-commits: [0497a2ba]
---

# Mirror the scoped-window rotation policy (janitor v3.3.2+) server-side

## Origin

Change notice from the janitor Claude (cross-session message, 2026-08-15, after the
Fable-exhaustion continuity failure; owner directive on their side). The janitor's rotator
(`scripts/oauth_rotator/rotator.py cmd_auto`) now treats a MODEL-SCOPED window wall on the
LIVE account as a rotation trigger. Both sides must implement ONE policy.

## The policy to mirror

1. Live account's scoped window (e.g. Fable) ≥ 90% while account 5h/7d are healthy →
   rotate, but ONLY onto an alternate that has headroom on that SAME model (their
   `scoped_rotation_veto` orders targets).
2. If NO alternate has that model's headroom → do NOT rotate: stay put and let the
   model-fallback path type `/model opus`. Tier 1b and degraded rotation are SKIPPED for
   scoped-only walls.

Gate constants (theirs, reuse the same semantics): `token_burn.model_fallback_verdict` —
scoped_high=90, account_headroom=90; env overrides `ROTATOR_SCOPED_SWITCH_AT` /
`ROTATOR_SCOPED_ACCOUNT_HEADROOM`.

## Where it lands here

The server's rotator/continuity daemon leg (the #J harness backend per ARCHITECTURE.md §8
— server side is ours). Relates to the model-scoped-window fallback feature already shipped
dark behind `AIM_FLEET_MODEL_FALLBACK=1` (see PROJECT memory page
`model-scoped-window-fallback` and TRDD-DPPYVLVH, which awaits the USER to arm it): rule 2
above is exactly the case that hands off to that fallback, so the two must agree on the 90%
thresholds and on skipping rotation for scoped-only walls.

## Status notes

- 2026-08-15 ~16:50: janitor v3.3.2 PUBLISHED (their ping: tag v3.3.2, PUBLISH_EXIT=0,
  install smoke clean) carrying the scoped-window rotation trigger f185e521 — the policy to
  mirror is now LIVE on their side; the daemon auto-rolls on its next fire. Their WKTD5JTC
  Phase 1 wedge recovery (v3.3.1) unchanged.
- Blocking context: the server's receiving fallback leg is DARK behind
  AIM_FLEET_MODEL_FALLBACK=1 pending the USER ruling on TRDD-DPPYVLVH (escalated urgent
  2026-08-15 with the handoff-onto-dark-receiver incident).

## Acceptance

- [x] Server-side rotation decision implements rules 1-2 with the same thresholds
      (env-overridable, same names or documented mapping) — commit **0497a2ba**. The SAME env
      names, not a mapping: `ROTATOR_SCOPED_SWITCH_AT` / `ROTATOR_SCOPED_ACCOUNT_HEADROOM`,
      both defaulting to 90, read in `lib/oauth-rotator/model-fallback.ts` (the leaf module —
      `tick → model-fallback` is the value edge, the reverse is type-only, so the constants
      cannot live in tick.ts without a runtime cycle). Three helpers mirror their
      `token_burn.py` with the same evidence rules and the same fail-open asymmetry:
      `modelsInUse` (percent>0 is evidence; an explicit `is_active:false` withdraws it, a
      MISSING field does not — which is why `ScopedLimit.isActive` became tri-state),
      `scopedVetoPct` (veto only for a model the LIVE account demonstrably runs; a veto
      DEPRIORITIZES into `scopedOnly`, never drops), `isScopedOnlyWall` (scoped ≥ 90 while
      every PROVEN account window ≤ 90; headroom must be proven, so an unreadable payload
      returns false).
- [x] Scoped-only wall with no same-model alternate → no rotation, fallback path chosen
      (test drives both branches) — and BOTH suppressions are pinned separately, because they
      are two different escapes: the `scopedOnly` push is gated by `!scopedWall`, and the
      DEGRADED tier is skipped by an explicit stop before it. 4 neuters, each reddening a
      different named test: N1 disable the scoped-only stop → *"only a DEGRADED alternate"*;
      N2 restore the unconditional push → *"only same-model-spent alternates"*; N3 restore the
      blanket `worstScopedPercent` veto → *"a candidate spent on a DIFFERENT model"*; N4
      `scopedWall = false` → the 92%-trigger and the no-rotation tests (2 red). Blob-verified
      back to HEAD after each. 30/30 green, tsc 0.
- [x] Parity note recorded in the `model-scoped-window-fallback` memory page + a reply to
      the janitor session confirming the mirror (their follow-up: TRDD-WKTD5JTC Phase 1)

## Outcome — one policy, two implementations

The USER's framing was continuity: *"the rotation system had a flaw … it missed the
handling/rotation in the case of rate limit reached for special models like Fable … mirror its
implementation in the ai-maestro version of the global daemon, so it will work even when the
ai-maestro server is replacing the janitor daemon."* Both halves of that now hold:

- **The trigger** — a scoped wall at 92% rotates, where before only `isNearLimit`'s 97%
  disjunct could. `planModelFallback`'s sweep threshold moved 97 → the same shared gate, so a
  92% wall cannot land in a dead zone refused by the rotation leg AND the `/model` leg.
- **The refusal** — a scoped-only wall with nowhere same-model-clear to go stays put and emits
  `all-maxed`, which is exactly what `stuckSuggestsModelFallback` keys on. The receiving lane
  is no longer dark: `AIM_FLEET_MODEL_FALLBACK=1` was armed the same evening (TRDD-DPPYVLVH,
  USER-approved first-hand; commit 56047fa5, verified on the live process with `ps -E`).

## Approval log

- 2026-08-15T16:35:41+0200 — MANDATE issued by ai-maestro (self, floor `none`): a Tier-0
  parity mirror inside this server's own rotator. Pre-approved; no request was sent.
- 2026-08-15T23:58:00+0200 — COMPLETED by ai-maestro. All three acceptance boxes checked, no
  NPT/EHT, work landed as `0497a2ba` (now recorded in `implementation-commits:`). The card had
  been sitting in `dev` since the code landed, which made the work column claim an active task
  that had in fact finished — closed rather than left asserting otherwise.
