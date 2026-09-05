---
trdd-id: 7IJ08EUV
title: The dev-mode keychain bypass token is a possessable credential for the root of the whole key hierarchy
column: planned
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-09-05T10:21:07+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: user
mandate: false
approved: true
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 0
severity: high
labels: [security, impersonation, encryption-at-rest, dev-mode]
external-refs: [TRDD-NFHFN8AJ, TRDD-EVO7T245]
approval-judge:  user 
approval-datetime: 2026-09-05T10:21:07+0200
---

## Problem

The owner's encryption design is accompanied by a **dev-mode token** granting a temporary
bypass of the keychain prompt, so unattended tests can run with no human present.

A bypass token is a possessable credential for the root of the whole key hierarchy. Under
the impersonation threat model that makes it the single highest-value object on the host:
holding it is equivalent to holding every agent's key.

## Why it needs its own card rather than a line in the encryption card

The encryption design is judged on whether the store is unreadable. The bypass is judged on
different questions entirely — who may mint it, how long it lives, whether it is bound to a
host or a process, whether its use is recorded, and what stops it existing in production.
None of those are answered by encrypting the store.

Prior art on this repo, from `~/.claude/rules/lessons-verification.md`: `lib/dev-mode-token.ts`
shipped with its enable-flag gate pinned by ZERO tests — neutering the flag reddened 0 of 14 —
so the refusal to honour a token while disabled was decorative at the time it was written.
That is exactly the failure mode to avoid here.

## Task

1. INVESTIGATE — read the current `lib/dev-mode-token.ts` and its call sites; establish
   who can mint, where the enable flag lives, and whether the flag is now test-pinned.
2. ASSESS — can an agent read, forge, or replay a dev-mode token; does it survive a restart;
   is its use auditable; can it be present on a production host.
3. SAFEGUARD — bind it to (host, process, expiry), make minting require the human authority,
   log every use to an append-only ledger, and make its presence in a non-dev build a hard
   startup failure rather than a warning.

## Acceptance

- [ ] Mint path, storage, lifetime and validation of the dev-mode token recorded first-hand.
- [ ] A measured answer to whether an agent can obtain or forge one.
- [ ] The enable gate is pinned by a test with a NAMED neuter that reddens it.
- [ ] Token use is recorded where the human can audit it.
- [ ] A production build refuses to start if a dev-mode token is present.

## Approval log

- 2026-09-05T10:21:07+0200 — APPROVED by  user  (min-approval-requirement: user). APPROVED:  dev-mode keychain-bypass token design not yet built; still an open, bounded finding . USER /goal 2026-09-05 'complete all TRDD and pending tasks'; screened 2026-09-05 (reports/triage/20260905_101808+0200-proposal-screen.md), grounding verified in-tree.
