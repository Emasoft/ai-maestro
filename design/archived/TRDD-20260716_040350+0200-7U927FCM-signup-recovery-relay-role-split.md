---
trdd-id: 7U927FCM
title: Signup recovery-relay role-split — MAESTRO required relay + normal-user 2FA email
column: completed
created: 2026-07-16T04:03:50+0200
updated: 2026-08-22T17:49:13+0200
current-owner: opus-governance-rules-session
task-type: feature
parent-trdd: P7XKV3N9
implementation-commits: [84d5b072, 434c636e, 10f910f4, ff648fa0]
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

**▶ 2B CORE SHIPPED (2026-07-16), commit `10f910f4`.** The relay send-primitive is live and
tested. What shipped:
- `UserRecord.email?` (`types/user.ts`) — a 2FA DESTINATION address, never a credential —
  with `setUserEmail(id, email)` (`lib/user-registry.ts`, locked, trims, null clears).
- `sendUserCodeEmail(userEmail, code, purpose)` (`lib/mailer.ts`) — sends with `to` = the
  user and SMTP `from`/account = the MAESTRO's VERIFIED recovery email. Gated on
  `getRecoveryEmail().verified` (proof the relay sends); no verified relay ⇒ `{skipped:true}`,
  caller falls back. Reuses Phase-1's `accountEmail`-vs-`to` split — no new SMTP logic.
- 4 unit tests (`tests/unit/mailer-user-relay.test.ts`): no-relay / unverified /
  missing-app-password all skip; verified relays from=MAESTRO,to=user. Full suite 188 files
  green, `yarn build` exit 0.

**CORRECTION — the §2B step-1 admission pointer was WRONG.**
`app/api/v1/governance/requests/[id]/approve` is **cross-host governance** (peer-host
manager/team state sync via `approveCrossHostRequest`), NOT foreign-USER admission. Foreign
USERS are `UserRecord`s (`types/user.ts` / `lib/user-registry.ts`); their creation/approval is
R40 territory in `services/element-management-service.ts` (grep `R40` there). Verified by
reading the route: it takes a peer request id + the global governance password and derives an
agent vote — it has no user-email surface at all. Do NOT wire 2B into that route.

**REMAINING 2B — DESIGN/FUTURE (deliberately not built; the TRDD scoped it "small hook + design"):**
1. **Capture the email at admission** — the foreign-user creation path (R40, in
   `element-management-service.ts`) should call `setUserEmail(userId, email)` once a
   normal-user admission UI collects an address. That UI does not exist yet (normal-user
   signup is nascent), so there is no non-speculative hook site today.
2. **The user-facing 2FA trigger** — a per-user password/sudo-reset flow (R37.4 gives each
   user their own sudo password) that calls `sendUserCodeEmail(user.email, code, 'password
   reset')`. No such per-user reset route exists yet.
Both are gated by features that aren't built; `sendUserCodeEmail` + `UserRecord.email` are the
primitives they will call. Building the callers now would be speculative UI (out of scope).

**NEXT ACTION:** none required for this TRDD's shipped scope — 2A + 2B core are in `testing`.
The remaining items above are future work that belongs to the normal-user-signup feature when
it is built. ~~Human step to fully exercise 2A live: owner resets password (Settings → Revoke)
to re-enter first-run and type the MAESTRO relay creds (R16 — human-only).~~
**⏹ That human step is now OWNED by [[U991KMFL]] (descoped 2026-08-22) — do not perform or
re-file it from here.** It sat in this card's acceptance AND in `P7XKV3N9`'s simultaneously, each
deferring to the other, so the act had no owner and both cards were held open by it.

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

## Acceptance

Transcribed 2026-08-02 from this card's own `## Verification` list, re-run live. The two REMAINING
2B items are `[~]`, not `[ ]`: the card's STATE **deliberately** scoped them out ("both are gated by
features that aren't built; building the callers now would be speculative UI"), so an open box for
them would be a permanent false debt against a feature this card never owned.

- [x] **2A backend** — `recoveryOptOut` on the config (`types/governance.ts:109`),
      `setRecoveryOptOut` (`lib/governance.ts:295`) and `isRecoverySetupComplete` (`:310`);
      `GET /api/auth/session` exposes `recoverySetupComplete` (`app/api/auth/session/route.ts:43`)
- [x] **the opt-out route is owner-gated ONLY and NOT console-gated** — the card's own CORRECTION,
      verified applied and not merely written: `app/api/governance/recovery-optout/route.ts` calls
      `enforceSystemOwner` and nothing else, with the reasoning in the file. Console-gating it would
      strand a REMOTE owner (iPad over Tailscale) on a host with unreachable SMTP — unable to
      configure email AND unable to waive it. An escape hatch behind the thing it escapes is a trap
- [x] **2A UI** — `LoginGate` carries the `'recovery'` state (`:81`, entered at `:103` on
      `recoverySetupComplete === false`) and renders `RecoveryGate` (`:20`, `:163-164`), which is a
      component INSIDE LoginGate.tsx, not a separate file
- [x] **2B core** — `UserRecord.email?` as a DESTINATION address never a credential
      (`types/user.ts:49`), `setUserEmail`, and `sendUserCodeEmail` (`lib/mailer.ts:158`) sending
      `to` = the user with the SMTP account = the MAESTRO's verified relay
- [x] unit tests for **the `accountEmail`-vs-`to` relay send** — `tests/unit/mailer-user-relay.test.ts`,
      4 tests (no-relay / unverified / missing-app-password all skip; verified relays correctly)
- [x] unit tests for **the gate flag logic** — **this half was promised and ABSENT.** Nothing in the
      tree named `isRecoverySetupComplete` / `setRecoveryOptOut` / `recoverySetupComplete`; the only
      greppable hits were scenario state-backup fixtures, i.e. DATA. Written today (`ff648fa0`):
      8 tests + 2 neuters, each reddening exactly 2. The load-bearing case is the UNVERIFIED email —
      see below
- [x] `tsc --noEmit` clean; full vitest suite green; `yarn build` exit 0 — all re-run 2026-08-02
- [~] **live 2A** — owner resets password (Settings → Revoke) to re-enter first-run, types the
      MAESTRO relay creds, verifies, and app entry unlocks; or takes the opt-out. **HUMAN-ONLY by
      R16** — the relay credentials are entered by the owner and never by an agent or a model. Not
      an engineering item and not one an agent may do on the owner's behalf.
      **DESCOPED 2026-08-22 to [[U991KMFL]], which now OWNS this act.** It was sitting in two cards'
      acceptance at once — here, and as `P7XKV3N9`'s recovery-email SMTP box — each effectively
      deferring to the other, so neither could close and nobody owned the act. One card now does.
      **The constraint was re-checked, not assumed**, because the sibling case went the other way:
      `K2WJH7RF`'s e2e was parked as "human-only" on a premise measurement later showed to be FALSE.
      Here there are two independent bars and either is sufficient — the flow BEGINS with a password
      reset (an agent must never rotate a credential, which the owner's decide-grant does not touch),
      and it needs the owner's real relay credentials, which R16 names as never an agent's to enter.
- [~] **live 2B** — admit a foreign user with an email, trigger their 2FA. **Unreachable, not
      unfinished:** it needs a normal-user admission UI and a per-user password/sudo-reset route,
      and neither exists yet. Deferred with its two design items below
- [~] capture the email at admission (R40, `element-management-service.ts`) — deliberately not
      built; there is no non-speculative hook site until a normal-user admission UI exists
- [~] the user-facing 2FA trigger calling `sendUserCodeEmail` — deliberately not built; no per-user
      reset route exists. `sendUserCodeEmail` + `UserRecord.email` ARE the primitives it will call,
      which is what this card shipped

## ⏱ VERIFIED 2026-08-02 — the promised gate-flag test was absent, and the case it needed is not obvious

`isRecoverySetupComplete()` decides whether `LoginGate` lets anyone into the app. Wrong in one
direction and a fresh MAESTRO sails past the gate with **no recovery configured** and can lock
themselves out of their own host — the precise state this card exists to make impossible. Wrong in
the other and the owner is held at a gate, survivable only because of the opt-out. A gate is a
two-sided claim, so both directions are now pinned.

**The case that had to be written is the UNVERIFIED email.** Configuring an address proves nothing —
`setRecoveryEmail` deliberately clears `recoveryEmailVerifiedAt` on every (re)configure, because
RECEIPT is what proves the relay can actually reach the owner. A flag satisfied by a mere address
would wave through the silently-unrecoverable account: a typo'd address, a wrong app-password, an
unreachable SMTP host. Both "a verified email completes it" tests pass under that mistake, which is
exactly why neither could have caught it — measured: the neuter that drops the verification
conjunct reds the unverified case and the re-configure case, and nothing else.

## Approval log
- 2026-08-05T01:08:00+0200 — `testing → human_review`. Column only; no work, no boxes, no scope changed.
  `testing` asserts someone is actively working this card, and nobody is — its one box is marked *"HUMAN-ONLY by R16 — the relay credentials are entered by the owner and never by an agent or a model. Not an engineering item"*.
  `blocked` would be the wrong move: it requires a non-empty `blocked-by:` naming an open
  CARD, and what this waits on is a person, not a card. `human_review` is the column that
  says "done to the point where a human must act", which is true. Re-columned during the
  triage of the 13 stale WORK-column cards, after reading this card's open box individually.

- 2026-07-16T04:03:50+0200 — MANDATE issued by USER (min-approval-requirement: user).
  Pre-approved: issuer authority >= required approver. Verbatim directives in the STATE block.
  No approval request was sent.
- 2026-08-22T15:49:13.214Z — column → complete. human review under the owner's grant
- 2026-08-22T15:49:13.336Z — COMPLETED by user. reviewed; live 2A descoped to U991KMFL.

## Notes and lessons learned

- 2026-08-22T17:49 — **HUMAN REVIEW PERFORMED, verdict COMPLETE**, by `ai-maestro-session` under
  the owner's explicit 2026-08-22 grant. The engineering is done and tested — 8 unit tests plus
  2 neuters over the gate-flag logic (`ff648fa0`), each neuter reddening exactly 2, with the
  UNVERIFIED-email case load-bearing; `tsc`, vitest and `yarn build` all re-run green 2026-08-02.
  The single remaining `- [ ]` was **live 2A**, a physical act barred to an agent twice over (it
  begins with a password reset, and needs the owner's real relay credentials — R16). It is
  descoped to **`TRDD-U991KMFL`**, created to own it, because the same act was sitting in this
  card's acceptance AND in `P7XKV3N9`'s, each deferring to the other so neither could close.
  Provenance caveat: closed via `promote` + `archive`, which anchor no token — `verify` will report
  UNVERIFIED by design (`TRDD-06G43RK2`).
