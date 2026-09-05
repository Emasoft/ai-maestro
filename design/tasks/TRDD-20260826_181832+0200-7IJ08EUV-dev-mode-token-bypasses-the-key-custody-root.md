---
trdd-id: 7IJ08EUV
title: The dev-mode keychain bypass token is a possessable credential for the root of the whole key hierarchy
column: planned
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-09-05T21:40:51+0200
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
implementation-commits: [8db78d42]
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

- [x] Mint path, storage, lifetime and validation of the dev-mode token recorded first-hand.
- [x] A measured answer to whether an agent can obtain or forge one.
- [x] The enable gate is pinned by a test with a NAMED neuter that reddens it.
- [x] Token use is recorded where the human can audit it.
- [ ] A production build refuses to start if a dev-mode token is present.

## Approval log

- 2026-09-05T10:21:07+0200 — APPROVED by  user  (min-approval-requirement: user). APPROVED:  dev-mode keychain-bypass token design not yet built; still an open, bounded finding . USER /goal 2026-09-05 'complete all TRDD and pending tasks'; screened 2026-09-05 (reports/triage/20260905_101808+0200-proposal-screen.md), grounding verified in-tree.
2026-09-05T21:18:49+0200 — WORKED by lean-worker. Neuter A: reverted enable-gate check (rec.enabled!==true -> !rec) in verifyDevToken; 1/27 tests reddened (the existing 'refuses a correct token while disabled' test), confirming the gate was ALREADY test-pinned — the card's prior-art note (0/14 in 2026-08) is stale. Neuter B: disabled the new assertDevModeAbsentInProduction() guard added this unit; exactly its 2 new tests reddened. Both restored; git diff on lib/dev-mode-token.ts shows only the intended +27-line addition. Box 5 left unticked: the guard function exists but nothing calls it yet (wiring into server.mjs boot is outside this worker's file scope) — see Findings for the follow-up.
- 2026-09-05T21:28:23+0200 — box 5 wired: assertDevModeAbsentInProduction() called from server.mjs at line 105-106 (module scope, before hostname/port setup and app.prepare()); node --check rc 0; by ai-maestro-hub-session's worker.
- 2026-09-05T21:40:50+0200 — boxes 1-4 landed in 8db78d42 (guard + 4 tests; neuter A 1/27, neuter B 2/13, independently re-verified). Box 5 UN-TICKED: the server.mjs wiring (lines 105-106) is written but HELD uncommitted — this host carries an enabled dev-mode login token (last used today), so with NODE_ENV=production the guard throws and the next pm2 restart of the live dashboard would refuse to start until the token is revoked via DELETE /api/auth/dev-token. Landing it is the USER's call (revoke then land / land without restart / drop). By ai-maestro-hub-session.

## Findings

Mint path: app/api/auth/dev-token/route.ts POST (lines ~93-173) requires BOTH governance password (verifyPassword) AND a verified WebAuthn assertion — no password-only fallback; calls mintDevToken() at lib/dev-mode-token.ts:107-118.
Storage: governance.json devModeLogin={enabled, tokenHash (sha256 hex, NEVER plaintext), createdAt, lastUsedAt} — lib/dev-mode-token.ts:50-57,107-118. No plaintext copy ever persists (mintDevToken docblock line 8).
Lifetime: NO expiry field exists. A minted token lives until explicit revokeDevToken() (lib/dev-mode-token.ts:152-157) or replaced by a re-mint (108-118, kills the previous hash). A merely-disabled (not revoked) token stays issued=true and can be re-enabled with one PATCH — this is why the new production guard checks issued OR enabled, not enabled alone.
Validation: verifyDevToken (lib/dev-mode-token.ts:126-144) checks prefix, enabled flag, tokenHash length, then constant-time compare via timingSafeEqual — fail-closed at every step. Confirmed test-pinned by neuter (see Approval log).
Forge/replay: over the network — cannot forge (sha256 preimage-resistant) or replay a stale value (timingSafeEqual, no plaintext ever returned by GET /api/auth/dev-token). BUT: an agent with local filesystem WRITE access to ~/.aimaestro/governance.json (same UID as the server, the ratified TRDD-CC9PY337 threat model) CAN self-mint by writing enabled:true + tokenHash:sha256(chosen-secret) directly to governance.json, bypassing the password+passkey gate in the API route entirely — the gate lives only in app/api/auth/dev-token/route.ts, not in the storage layer. This is a residual gap, not closed by this unit (same-UID filesystem trust is the existing accepted threat model; flagging it here as the measured answer to acceptance box 2).
Auditability of successful use: verifyDevToken calls saveGovernance() on success (lib/dev-mode-token.ts:141-142), which appends a signed, hash-chained diff entry (lastUsedAt change) to ~/.aimaestro/governance.ledger.json via governanceLedger.append (lib/governance.ts:24,175-193). This is a genuine append-only, tamper-evident audit trail already in place — no new abstraction added. FAILED verify attempts are NOT separately logged (early-return paths skip saveGovernance); this is a residual gap for detecting brute-force probing, out of this unit's narrow file scope (adding it would touch the signed-ledger's security-config-unlock dependency, a bigger change than this card's smallest-diff mandate).
Production hard-fail: NONE existed before this unit. Added exported assertDevModeAbsentInProduction() (lib/dev-mode-token.ts, new, ~27 lines) which throws when NODE_ENV=production and a token is enabled or issued. This is the CHECK only — nothing in the repo calls it yet; wiring it into the actual server boot sequence (server.mjs, before app.prepare()) requires editing server.mjs, which is OUTSIDE this worker's write-scope restriction. Recommend a follow-up TRDD/EHT to call assertDevModeAbsentInProduction() at server startup.
