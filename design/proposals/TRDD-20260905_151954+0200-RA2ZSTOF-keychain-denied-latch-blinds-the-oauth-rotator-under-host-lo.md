---
trdd-id: RA2ZSTOF
title: Keychain denied-latch blinds the OAuth rotator under host load — exempt attribute-only reads, harden the half-open probe, add a burn-rate horizon
column: proposal
created: 2026-09-05T15:19:54+0200
updated: 2026-09-05T15:22:28+0200
current-owner: governance-rules-session
created-by: governance-rules-session
task-type: security
min-approval-requirement: user
assignee: governance-rules-session
approved: false
labels: [family-a, continuity, oauth, keychain, security, token-touching, janitor-report]
external-refs: [TRDD-9ZIF82HI, TRDD-1GGQ4HWY, ai-maestro-janitor reports/oauth-rotator/20260905_151600+0200-rotation-failure-keychain-latch-under-load.md]
project-id: ai-maestro
---

# Keychain denied-latch blinds the OAuth rotator under host load — exempt attribute-only reads, harden the half-open probe, add a burn-rate horizon

## Problem

The owner reports the rotator "failed again to rotate" on 2026-09-05: the ipazia account hit its 5-hour cap at ~14:50 and a manual /login to fmuaddib was needed. The ai-maestro server (pid 24895) owned the oauth-rotator-tick chore since 09:45 and beat at ~60 s (55 beats/hour in pm2-out.log), so the chore RAN; the failure is inside safe-storage.ts's keychain DENIED-LATCH, measured by the janitor session from pm2-out.log + pm2-error.log (its report: ai-maestro-janitor repo, reports/oauth-rotator/20260905_151600+0200-rotation-failure-keychain-latch-under-load.md):

- 14:04 to 14:30: ipazia 60% to 82%, "within limits"; slope about 0.8 %/min; rotation threshold 97%.
- 14:30:36 "KEYCHAIN DENIED-LATCH SET: 3 consecutive security ops TIMED OUT past 5s" (slot reads; host loadavg 18 to 27 on 14 cores). Every beat after: "no live credential / STUCK".
- 14:45:47 a probe RECOVERED (SLOW op 2851 ms); 14:48:38/:44/:49 three reads timed out at 5001 to 5003 ms; re-latched 14:48:50.
- 14:59:13 the half-open probe itself TIMED OUT (5004 ms); re-latched for another 600 s.
- 15:09:14 a probe answered, latch cleared, "reconciled live account: state said ipazia but the real live credential is fmuaddib".

Rotation was blind from 14:30 to 15:09, the window in which ipazia crossed the cap. Second-hand data (a peer session's log read); verify against the two pm2 logs before designing.

## Root cause

Three independent weaknesses combine under host load: (1) the consecutive-timeout latch counts EVERY security op, including attribute-only reads (find-generic-password without -w) that can never be a keychain prompt hang, so pure slowness trips a guard meant for prompt hangs; (2) the half-open probe is a 5 s -w slot read under the same load that latched, so one loaded hour re-latches indefinitely (measured twice: 14:48 and 14:59); (3) tick.ts has no burn-rate horizon: at 0.8 %/min the 97% trigger leaves about 3 minutes, shorter than one latch cooldown and than each of the three "usage unreachable (status 0)" gaps that day; a ROTATE_HORIZON_MIN=15 projection (the janitor's burn_gate.py) would have projected the wall at ~14:28 (82%, 19 to 25 min out).

## Proposed fix

Design decision for the USER (token-touching, family-a; precedent TRDD-9ZIF82HI / TRDD-1GGQ4HWY at floor user), then a Tier-0 implementation card:

1. Exempt attribute-only keychain reads from the consecutive-timeout latch; count only -w reads and writes.
2. Half-open probe: use the 10 s CLI_TIMEOUT_MS, or probe with an attribute-only read, so a loaded host cannot re-latch on the probe itself.
3. Add a burn-rate horizon to tick.ts: rotate when the projected wall (current % + slope × horizon) is inside ROTATE_HORIZON_MIN (15 min), mirroring the janitor's burn_gate.py, in addition to the 97% trigger.

The janitor side is aligning its python safe_storage.run_security to TIMEOUT_LATCH_THRESHOLD=3 and exempting attribute-only ops there; keep the two implementations' semantics identical (one number, one exemption list) or the two rotators disagree under the same load.

## Verification

- Replay the 14:04 to 15:09 pm2 log window against the new latch rules: with (1) and (2) the latch must not set on attribute-only timeouts and the probe must recover on the 10 s budget; with (3) the projected-wall trigger must fire at or before 14:30 on the measured slope.
- A unit test per rule with an attributed neuter: removing the attribute-only exemption re-latches on the replayed reads; removing the horizon leaves the 97% trigger alone and the replay misses the wall.

## Estimated risk

MED: the rotator touches live OAuth credentials and the keychain; a wrong exemption could mask a real prompt hang (the reason the latch exists). Dependencies: safe-storage.ts, tick.ts, the janitor's python twin.

## Acceptance

- [ ] USER decision recorded on all three asks (accept / modify / refuse each), with the janitor's report cross-checked against pm2-out.log and pm2-error.log first-hand
- [ ] a Tier-0 implementation card minted for the accepted items, citing this card, with the latch threshold and exemption list stated as ONE shared contract with the janitor's python twin

## Approval log
- 2026-09-05T15:22:28+0200 — janitor session ack (data, second-hand): their card TRDD-3VIXO8FA carries this id; the python twin is being built to be mirrored line for line — threshold 3 consecutive timeouts, per-process counter, reset on any answered op (equal to TIMEOUT_LATCH_THRESHOLD); the exemption is an argv PREDICATE, not a site list: find-generic-password or list-keychains WITHOUT -w cannot prompt and never latch on a timeout; anything carrying -w, and every add-/delete-generic-password, can prompt and counts. A shared config FILE for the two constants is left to this proposal's decision (the janitor is not creating one). Their one INFERENCE is the cap crossing itself (last reading 82% at 14:30, /login at ~14:55, no 429 line captured); every other timeline item is quoted from pm2-out/pm2-error.
