---
trdd-id: HR8CES7H
title: VPN-unique user names + remote normal-user registration and password change (R47)
column: planned
created: 2026-07-16T09:47:54+0200
updated: 2026-08-16T16:49:08+0200
current-owner: opus-governance-rules-session
task-type: feature
relevant-rules: [47, 43, 38, 40, 48]
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-16T09:47:54+0200
labels: [multi-host, transition-phase]
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-16

**Born approved, NOT started.** Implementation TRDD for **R47** (committed `bf70bf47`, v4.4.0).
Held under the transition-phase hold — do NOT implement.

**NEXT ACTION when unheld:** design VPN-wide username uniqueness — the hard part is a cross-host
consistency mechanism (a claim/confirm handshake or deterministic tiebreak for concurrent
registration of the same name on two hosts). Local check lives in `lib/user-registry.ts`; the
cross-host check needs a user directory synced across peers (extend `lib/agent-directory.ts` to
users, or add a peer user-directory).

**Load-bearing split (do NOT blur it):** a NORMAL user may register + change password REMOTELY
(R47.2). The MAESTRO may NOT (R48 → TRDD-PLOVIPZE). The password-change route must branch on title:
MAESTRO → console-only; normal user → remote allowed.

## Problem

R47.1 requires user names unique across the ENTIRE Tailscale VPN, not per-host. Today registration
(`lib/user-registry.ts`) is host-local, so two hosts could each hold a `bob`. R47.2 requires a
normal user to be able to register remotely and change their own password remotely — while R48
forbids exactly that for the MAESTRO.

## Approach (design sketch)

1. **VPN-wide uniqueness (R47.1).** On registration, check the name against every peer host's user
   directory (over the cross-host peer rail). Reject if taken anywhere. Handle the concurrent-claim
   race (two hosts, same name, same instant) with a claim→confirm handshake or a host-id tiebreak;
   a name is not final until confirmed across peers.
2. **Remote normal-user registration (R47.2).** The normal-user registration route works over a
   Tailscale browser (desktop/mobile). The new user is bound by all R38/R40 restrictions
   (foreign-user; MAESTRO approval for agent/team creation — R40). This is NOT the MAESTRO path.
3. **Remote normal-user password change (R47.2).** A normal user changes their own password
   remotely. The shared password-change route branches on the caller's title: normal → remote OK;
   MAESTRO → refuse remote, require console (defer the MAESTRO branch to TRDD-PLOVIPZE, but the
   branch point is authored here so the two TRDDs meet at one route).

## Verification
- A name already taken on a peer host is rejected at registration on any host.
- Concurrent same-name registration on two hosts resolves to exactly one winner.
- A normal user registers remotely and changes their own password remotely.
- The MAESTRO cannot change password remotely (asserted here as the negative; positive console path
  is TRDD-PLOVIPZE).
- §0 mirror-sync: GOVERNANCE R47.

## Estimated risk
MED-HIGH. VPN-wide unique-name is a distributed-consistency problem — the genuinely hard part of the
cohort. Depends on a cross-host user directory + the R48 MAESTRO/normal password-change split.

## Rollout cohort — multi-host governance (R43-R48), transition phase
Siblings: TRDD-OEG0V589 (migration R44) · TRDD-W9FA6ACZ (ASSISTANT R39) · TRDD-QR9FSL3Q (groups
R45) · TRDD-40CUZA1Z (sidebar R46) · TRDD-PLOVIPZE (console gates R48) · TRDD-OC9ELGSO (transport,
#40). §0 mirror-sync rides each TRDD's Verification.

## Acceptance

- [ ] A user name already taken on a peer host is rejected at registration on any host (VPN-wide uniqueness check against every peer's user directory).
- [ ] Concurrent same-name registration on two hosts resolves to exactly one winner via a claim/confirm handshake or deterministic tiebreak.
- [ ] A normal user can register remotely over a Tailscale browser and change their own password remotely.
- [ ] The shared password-change route branches on caller title, and a MAESTRO caller's remote password-change is refused (positive console path deferred to TRDD-PLOVIPZE).
- [ ] The transition-phase hold is explicitly lifted before implementation starts.

## Approval log
- 2026-07-16T09:47:54+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Verbatim: *"author all those TRDDs, but wait to implement them."* Implementation HELD.

## Notes and lessons learned
