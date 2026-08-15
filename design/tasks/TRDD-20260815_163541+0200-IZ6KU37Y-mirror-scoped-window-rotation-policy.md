---
trdd-id: IZ6KU37Y
title: Mirror the janitor's model-scoped-window rotation policy in the server rotator/daemon
column: todo
created: 2026-08-15T16:35:41+0200
updated: 2026-08-15T16:35:41+0200
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

## Acceptance

- [ ] Server-side rotation decision implements rules 1-2 with the same thresholds
      (env-overridable, same names or documented mapping)
- [ ] Scoped-only wall with no same-model alternate → no rotation, fallback path chosen
      (test drives both branches)
- [ ] Parity note recorded in the `model-scoped-window-fallback` memory page + a reply to
      the janitor session confirming the mirror (their follow-up: TRDD-WKTD5JTC Phase 1)
