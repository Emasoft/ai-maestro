---
trdd-id: MANP68KP
title: A keychain ACL prompt in a headless server hangs or denies and both are outages
column: planned
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-09-05T10:21:25+0200
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
priority: 2
severity: medium
labels: [security, encryption-at-rest, availability]
external-refs: [TRDD-NFHFN8AJ, TRDD-RXENA70O]
approval-judge:  manager 
approval-datetime: 2026-09-05T10:21:25+0200
---

## Problem

A keychain item guarded by an ACL prompts the user when an untrusted process asks for it. A
server running headless under pm2 has no one to answer the prompt, so the request either
hangs or is denied — and both are outages rather than security events.

This is adjacent to TRDD-RXENA70O (blindness) but distinct: there the API fails outright;
here it succeeds into a dialog nobody sees.

## Task

1. INVESTIGATE — measure what the keychain API returns for the server's access pattern in a
   headless context, with and without the ACL trusting the calling binary.
2. ASSESS — whether the dev-mode bypass token (TRDD-7IJ08EUV) exists precisely to paper over
   this, and whether that is an acceptable production posture.
3. SAFEGUARD — use a custody mechanism that does not prompt for the server's own access,
   and make any prompt condition a loud, bounded failure rather than a hang.

## Acceptance

- [ ] Headless behaviour measured, not assumed.
- [ ] A bounded timeout on key retrieval, with a named error on expiry.
- [ ] A statement of whether the dev-mode token is required in production, and why not.

## Approval log

- 2026-09-05T10:21:25+0200 — APPROVED by  manager  (min-approval-requirement: manager). APPROVED:  keychain ACL prompt-in-headless still unhandled . USER /goal 2026-09-05 'complete all TRDD and pending tasks'; screened 2026-09-05 (reports/triage/20260905_101808+0200-proposal-screen.md), grounding verified in-tree.
