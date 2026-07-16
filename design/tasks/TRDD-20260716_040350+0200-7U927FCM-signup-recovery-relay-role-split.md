---
trdd-id: 7U927FCM
title: Signup recovery-relay role-split — MAESTRO required relay + normal-user 2FA email
column: planned
created: 2026-07-16T04:03:50+0200
updated: 2026-07-16T04:24:11+0200
current-owner: opus-governance-rules-session
task-type: feature
parent-trdd: P7XKV3N9
relevant-rules: [16, 36, 38, 40]
min-approval-requirement: user
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-16T04:03:50+0200
derived: true
derived-kind: eht
---

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative; supersedes the body) — 2026-07-16

**Born approved.** The USER mandated this on 2026-07-16: *"registering new users
(signup) must ask ... the userid and password of the user mail provider"* + *"only the
MAESTRO USER needs to enter the mail provider configuration data; normal USERS ... just
need to enter their email address"* + *"write the TRDD and implement all"*. It is the EHT
of TRDD-P7XKV3N9 Phase 1 (the userid backfill, SHIPPED — commits `5c2b1636`, `69a1da78`,
`455340b4`): Phase 1 let the EXISTING MAESTRO backfill the relay; this makes it part of
NEW-account registration.

**▶ 2A SHIPPED (2026-07-16).** The post-bootstrap required-recovery gate is live. Commits:
`84d5b072` (backend: `recoveryOptOut` flag + `setRecoveryOptOut`/`isRecoverySetupComplete` +
session route exposes `recoverySetupComplete` + owner-gated `POST /api/governance/recovery-optout`)
and `434c636e` (UI: LoginGate `'recovery'` state + `RecoveryGate` embedding `RecoveryEmailSection`
with `onRecoveryComplete`). `setup-verify`'s atomic OS-code transaction was left untouched, as
planned. tsc clean, full suite 187 files green, `yarn build` exit 0, server live.

**CORRECTION to §2A step 5 (body line 87, now SUPERSEDED):** the opt-out route is **owner-gated
ONLY — deliberately NOT console-gated.** Console-gating it would re-create the exact lockout the
escape hatch exists to prevent: a REMOTE owner (iPad over Tailscale) on a host with unreachable
SMTP could then neither configure email NOR opt out, and would be stranded mid-first-run. Waiving
one's own recovery method is squarely within owner authority (the caller already holds an
authenticated owner session), so a session check is the correct and sufficient gate. Not strict
either — a sudo re-prompt one screen after setting the password is friction with no security gain.

**Testable NOW without a password reset:** the existing MAESTRO account predates recovery, so
`isRecoverySetupComplete()` is already false → the gate shows on the owner's next login. A full
first-run test still needs the password-reset step (below).

**NEXT ACTION:** implement **2B** — capture a foreign user's email at R40 admission
(`app/api/v1/governance/requests/[id]/approve`) and send their 2FA via the MAESTRO relay
(`sendCodeEmail(to = userEmail, accountEmail = MAESTRO email)`), gated on the relay existing.

**Load-bearing facts:**
- Reuse Phase 1 wholesale: `/api/governance/email/{autodetect,configure,verify}` +
  `route.ts` GET/DELETE, `resolveAuthUser` (`lib/smtp-autodetect.ts`), `RecoveryEmailSection`
  logic, `setRecoveryEmail({...username})`. NO new SMTP logic.
- The mailer already separates `to` from the SMTP account
  (`sendCodeEmail(to, code, purpose, accountEmail = to)`, `lib/mailer.ts:125`), so 2B needs
  only to pass the MAESTRO's address as `accountEmail` and the normal user's as `to`.
- First-run is console-gated (OS notification code = presence), so the owner is NEVER
  locked out even with no reachable SMTP — console/passkey is the standing fallback.
- **HUMAN-only (R16):** the MAESTRO relay creds (email+userid+app-password) are entered by
  the owner, never by an agent/model. Testing 2A requires the owner to reset the password
  (Settings → Revoke) to re-enter first-run.

**SUPERSEDED — do NOT carry forward:** the earlier idea of editing `setup-verify` to add the
relay INTO its atomic transaction. Rejected: the OS code is one-shot and the SMTP verify is a
slow network step that can fail — bundling them makes a fragile transaction and risks
consuming the code on an SMTP hiccup. The post-bootstrap gate keeps the delicate part intact.

## Problem

`TRDD-P7XKV3N9` built multi-channel password recovery (console / email / passkey) and, in
Phase 1, an explicit mail **userid** so the MAESTRO's email RELAY authenticates correctly.
But recovery data is collected only as an opt-in Settings backfill. New accounts start with
NO recovery configured, so a fresh MAESTRO can lock themselves out, and a normal user has no
2FA destination. The USER's directive: registration must COLLECT recovery data, role-split —
the MAESTRO enters the full provider relay; a normal user enters only their email address.

## Role model (the load-bearing decision)

- **MAESTRO (admin):** enters the mail-PROVIDER config — SMTP host (autodetected) + **userid**
  + app-password. This is the host's single **relay** that sends every no-reply 2FA email.
- **Normal / foreign user (R38/R40):** enters ONLY their **email address** (the 2FA
  destination). Their codes are sent THROUGH the MAESTRO relay. They supply no SMTP creds.

## 2A — MAESTRO first-run requires the recovery relay (implement now)

Design: a **post-bootstrap REQUIRED-recovery gate**, not a change to the atomic setup-verify.

1. `setup-verify` stays as-is (password + userName + OS code → session). After it succeeds
   the account is bootstrapped and logged in.
2. A governance flag records whether the required-recovery step is satisfied:
   `recoverySetupComplete` = (a verified `recoveryEmail` exists) OR (an explicit
   `recoveryOptOut` was acknowledged — "I'll rely on console/passkey recovery"). Store in
   `governance.json` (`types/governance.ts` + `lib/governance.ts` setter/getter).
3. `GET /api/auth/session` (and/or `/api/governance`) exposes `recoverySetupComplete` so the
   client can gate.
4. `LoginGate` (or a wrapper): when authenticated AND `!recoverySetupComplete`, render a
   REQUIRED recovery step — reuse `RecoveryEmailSection`'s email+userid+app-password+verify
   flow (the `/api/governance/email/*` routes already exist) — that BLOCKS app entry until a
   relay is verified OR the owner clicks an explicit "use console/passkey recovery instead"
   opt-out (which sets `recoveryOptOut`). Never a dead-end.
5. The opt-out route is console-gated + owner-gated (same trust model as the reset/invalidate
   family), so a remote device can't silently waive recovery.

## 2B — normal/foreign-user 2FA email (small hook + design)

1. At foreign-user admission (`app/api/v1/governance/requests/[id]/approve` — R40), capture
   the user's **email address** (address only). Persist on the user record.
2. Sending: `sendCodeEmail(to = userEmail, accountEmail = <MAESTRO email>)` — the mailer
   resolves the relay from the MAESTRO's stored config; only the `accountEmail` wiring is new.
3. **Gate on the relay existing:** if the MAESTRO has no configured relay, a normal user's
   email-recovery cannot send — block that method with a clear message and fall back to the
   other factors. A full normal-user signup UI is future work (out of scope here).

## Verification

- `tsc --noEmit` clean; full `vitest` suite green (add unit tests for the gate flag logic +
  the `accountEmail`-vs-`to` relay send).
- `yarn build` green (ESLint rules-of-hooks / no-unused-vars).
- Live 2A: owner resets password → next login re-enters first-run → after bootstrap the
  REQUIRED recovery step appears → enter email+userid+app-password → verify → app entry
  unlocked; OR click "console/passkey instead" → entry unlocked, `recoveryOptOut` set.
- Live 2B: admit a foreign user with an email → trigger their 2FA → code arrives via the
  MAESTRO relay; with no relay configured the method is blocked with guidance.

## Estimated risk
MED. 2A touches the auth/gate path (LoginGate + session route) — a bug there could block
app entry, so the opt-out escape is mandatory and must be tested. 2B is additive and gated.
Depends on Phase 1 (shipped).

## Approval log
- 2026-07-16T04:03:50+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: issuer authority >= required approver. Verbatim directives in the STATE block.
  No approval request was sent.

## Notes and lessons learned
