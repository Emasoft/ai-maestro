---
trdd-id: RXENA70O
title: Rooting all agent credentials in the keychain concentrates a failure this host has already suffered fleet-wide
column: planned
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-09-05T10:21:31+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: manager
mandate: false
approved: true
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
labels: [security, encryption-at-rest, availability]
external-refs: [TRDD-NFHFN8AJ]
approval-judge:  manager 
approval-datetime: 2026-09-05T10:21:31+0200
---

## Problem

Making the keychain the root of all agent credentials concentrates a failure mode this host
has already suffered fleet-wide.

## Evidence — PROVEN on this machine, 2026-07-12

A long-lived tmux server was **born keychain-blind**: in its panes every `SecKeychain*` call
failed, including `security list-keychains` (`errSecParam`), while the same script in a
normal shell returned rc=0. `securityd` had started 9.5 h earlier and was still running, so
this was not a daemon recycle — the server was blind from birth. Every agent it forked
printed `Not logged in`. `/login` correctly did not help, because the credential was never
the problem.

Under the proposed design the same condition does not degrade one capability — it denies
every agent every credential at once, and the symptom will again look like a billing or
account fault rather than a keychain fault.

## Task

1. INVESTIGATE — what makes a process keychain-blind at birth here (spawn parent, session
   membership, pm2 restart from inside a Claude Code session was the observed correlate).
2. ASSESS — whether the server process specifically can be born blind, and under which
   start paths.
3. SAFEGUARD — a startup probe that FAILS LOUDLY and names the keychain, plus a documented
   degraded mode, so the next occurrence is diagnosed in minutes rather than hours.

## Acceptance

- [ ] The birth condition characterised, or recorded as not reproducible with what was tried.
- [ ] A startup keychain probe exists and fails loudly with a keychain-specific message.
- [ ] A degraded mode is documented: what the fleet does when the key is unavailable.
- [ ] The 2026-07-12 symptom is added to the diagnostic docs so it is recognised on sight.

## Approval log

- 2026-09-05T10:21:31+0200 — APPROVED by  manager  (min-approval-requirement: manager). APPROVED:  single-point keychain-blindness risk still unaddressed . USER /goal 2026-09-05 'complete all TRDD and pending tasks'; screened 2026-09-05 (reports/triage/20260905_101808+0200-proposal-screen.md), grounding verified in-tree.
