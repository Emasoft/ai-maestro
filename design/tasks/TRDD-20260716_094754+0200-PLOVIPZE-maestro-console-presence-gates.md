---
trdd-id: PLOVIPZE
title: MAESTRO console-presence gates — registration + first login + password change are local-only (R48)
column: planned
created: 2026-07-16T09:47:54+0200
updated: 2026-08-16T16:48:46+0200
current-owner: opus-governance-rules-session
task-type: security
relevant-rules: [48, 16, 47, 36, 37]
parent-trdd: P7XKV3N9
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-16T09:47:54+0200
labels: [multi-host, transition-phase]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

**Born approved, NOT started.** Implementation TRDD for **R48** (committed `bf70bf47`, v4.4.0).
Extends TRDD-P7XKV3N9's console-presence work. Held under the transition-phase hold — do NOT
implement.

**Load-bearing NUANCE (do NOT over-gate).** R48.2: presence is verified *at least once* (at MAESTRO
registration / first login) AND on *every MAESTRO password change*. **Ordinary subsequent remote
MAESTRO logins by password stay allowed** — the login route is not console-gated on every login,
only the first. Over-gating every login would strand the remote owner (iPad over Tailscale) — the
exact failure the recovery escape hatch (7U927FCM) exists to avoid.

**NEXT ACTION when unheld:** gate the MAESTRO REGISTRATION route to reject any non-console peer,
reusing `isConsolePeer()` from `lib/peer-address.mjs` (server re-stamps `x-aim-peer` from the real
TCP peer — the ONLY sanctioned reader). Presence code via `lib/setup-bootstrap.ts` (OS notification
channel). Console gate on MAESTRO password change already exists for invalidate/reset (P7XKV3N9
§2b) — extend to the change path.

## Problem

R48 requires physical host presence to become MAESTRO and to change the MAESTRO password — the
MAESTRO is too powerful to be seized remotely. Today: first-run `setup-verify` IS console-gated (OS
code = presence) and invalidate/reset ARE console-gated (P7XKV3N9 §2b). NOT yet done: MAESTRO
registration must REJECT a remote browser outright (R48.1); MAESTRO first-login presence-verify
(R48.2/4); the password-change route must branch MAESTRO→console-only vs normal-user→remote
(R48.3, meets TRDD-HR8CES7H).

## Approach (design sketch)

1. **R48.1 — registration local-only.** The MAESTRO registration route refuses any caller that is
   not the console peer (`isConsolePeer(req)`), with clear guidance ("register the MAESTRO from the
   host machine"). No setting overrides this.
2. **R48.2/4 — presence at first login.** MAESTRO first login requires an OS presence code
   (`lib/setup-bootstrap.ts`), verified once. Subsequent remote logins by password continue to work
   (see the NUANCE above — do not gate every login).
3. **R48.2/3 — password change console-only for MAESTRO.** The password-change route branches on the
   caller's title: MAESTRO → require console presence (reuse the invalidate/reset console gate);
   normal user → remote allowed (the positive path lives in TRDD-HR8CES7H). Both TRDDs converge on
   this one route.
4. **Keep the recovery-optout route NON-console-gated** (7U927FCM correction) — it is owner-gated
   only, deliberately, so a remote owner on a no-SMTP host is never stranded. Do not "harden" it.

## Verification
- MAESTRO registration from a remote (genuinely remote, e.g. the host's own Tailscale IP, not
  loopback) → 403; from the host console → allowed.
- MAESTRO first login requires presence; a later remote login by password succeeds.
- MAESTRO password change from remote → refused; from console → allowed. Normal-user password change
  from remote → allowed (HR8CES7H).
- Spoofed `x-forwarded-for: 127.0.0.1` from a remote peer does NOT satisfy `isConsolePeer`
  (peer-address re-stamp — verify from a real remote peer, never loopback).
- §0 mirror-sync: GOVERNANCE R48, `docs/API-CHANGES.md`.

## Estimated risk
MED. Auth path — a bug could lock the owner out or, worse, let a remote seize MAESTRO. The console
check must fail-closed (no presence channel ⇒ refuse the gated op) and must be verified from a real
remote peer. Preserve ordinary remote login (the NUANCE).

## Rollout cohort — multi-host governance (R43-R48), transition phase
Siblings: TRDD-OEG0V589 (migration R44) · TRDD-W9FA6ACZ (ASSISTANT R39) · TRDD-QR9FSL3Q (groups
R45) · TRDD-HR8CES7H (usernames R47) · TRDD-40CUZA1Z (sidebar R46) · TRDD-OC9ELGSO (transport,
#40). §0 mirror-sync rides each TRDD's Verification.

## Acceptance
- [ ] MAESTRO registration route rejects a genuinely remote caller (real Tailscale IP, not
      loopback) with 403, reusing `isConsolePeer()` from `lib/peer-address.mjs`; allowed from
      the host console.
- [ ] A spoofed `x-forwarded-for: 127.0.0.1` header from a real remote peer does NOT satisfy
      `isConsolePeer` (server re-stamp verified, not the client-supplied header).
- [ ] MAESTRO first login requires OS presence verification (`lib/setup-bootstrap.ts`); a LATER
      remote MAESTRO login by password alone still succeeds (the NUANCE — not gated every login).
- [ ] MAESTRO password-change route branches on caller title: MAESTRO → console-only (403 remote);
      normal user → remote allowed (meets TRDD-HR8CES7H).
- [ ] The recovery-optout route remains NON-console-gated (owner-gated only) — unmodified by this
      work (per the 7U927FCM correction).
- [ ] §0 mirror-sync done: GOVERNANCE-RULES R48, `docs/API-CHANGES.md`.

## Approval log
- 2026-07-16T09:47:54+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Verbatim: *"author all those TRDDs, but wait to implement them."* Implementation HELD.

## Notes and lessons learned
