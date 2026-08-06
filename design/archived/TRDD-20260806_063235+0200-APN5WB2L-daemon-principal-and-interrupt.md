---
trdd-id: APN5WB2L
title: Daemon principal and synchronous interrupt — authenticated janitor recovery injection
column: complete
scope: project
project-id: ai-maestro
created: 2026-08-06T06:32:35+0200
updated: 2026-08-06T07:00:02+0200
implementation-commits: [01747710, aec47b51, edf79ff7, 8df0b4cd, 454b95e1, 31ab0877]
current-owner: ai-maestro
created-by: ai-maestro
assignee: ai-maestro
task-type: feature
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-08-06T06:32:35+0200
severity: high
effort: large
npt: []
eht: []
blocked-by: []
release-via: none
labels: [daemon, auth, janitor, recovery, owner-ours]
external-refs: [Emasoft/ai-maestro#60, Emasoft/ai-maestro#68, Emasoft/ai-maestro#117, Emasoft/ai-maestro#110]
---
# Daemon principal and synchronous interrupt — authenticated janitor recovery injection

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-08-06

**The DESIGN is settled and published** — #60 comment 2026-08-05T14:34Z answered the janitor's
five questions from the code with file:line; read that comment before any edit. This card is the
IMPLEMENTATION of the commitment made there ("What I propose to own"), plus one ruling taken
under the USER's standing delegation:

**RULED: the interrupt is SYNCHRONOUS** — the response reports `{delivered, interrupted}` the way
`prepareShellForLaunch` reports `{ready, interrupted}` (lib/agent-runtime.ts:486-506). A
fire-and-forget caller ignores the report; the superset shape unblocks the one open question
without waiting on the janitor's answer.

**NEXT ACTION:** read, in this order, before writing anything:
`lib/amp-keys.ts` (the Ed25519 + registration primitives to REUSE — generateKeyPair,
verifySignature, saveRegistration/loadRegistration), `lib/amp-auth.ts` (the bearer-principal
model), `services/sessions-service.ts::sendCommand` (~1305-1360: Gate 0 authorization, the
literal:true hardcode at ~1351, the #117 injectedPrompts mark, the requireIdle default),
`server.mjs`'s headless router (the 251-entry table), `security-registry.json` (strict-route
classification). Then implement in the order below.

## The deliverables (from the published commitment)

1. **Daemon principal.** An enrolled Ed25519 pubkey with its own principal class, granted EXACTLY
   two verbs: `submit-recovery-prompt` and `interrupt`. REUSE lib/amp-keys primitives — a second
   signing scheme is a second thing to rotate, revoke and audit. Enrollment is OWNER-GATED
   (sudo-mode / strict route, or a server-local CLI): the daemon registers its pubkey once.
2. **Replay protection** (the one part the existing helpers do not cover): signed request
   `{target, action, payload, nonce, issued_at}`; reject issued_at skew > 60s and any replayed
   nonce (bounded nonce store).
3. **`interrupt` action** wired to the existing NON-LITERAL sendKeys path ('Escape';
   lib/agent-runtime.ts:127 + :351) — sendCommand hardcodes `literal: true` at ~1351, so the
   capability exists one layer below the HTTP surface and only needs EXPOSURE. The interrupt MUST
   mark `injectedPrompts` exactly as sendCommand does (#117 — otherwise ESC-then-recover
   reintroduces the presence-forgery through the new door).
4. **The daemon path passes `requireIdle: false`** — a frozen agent is by definition not idle;
   the default would 409 every recovery exactly when it matters (#110's trap, measured).
5. **BOTH server modes** — the Next route AND a headless router entry. Measured while designing:
   `POST /api/sessions/me/user-input` exists in Next and in NONE of the headless router's 251
   entries; do not repeat that bug.
6. **Target by agent UUID**, never tmux session name (rename-unstable; the server derives the
   pane).
7. Tests (principal auth: wrong key / stale issued_at / replayed nonce / verb outside the grant
   all REFUSED with pinned reasons; interrupt delivers non-literal Escape + marks #117; both
   modes) with observed neuters. Deploy (build + restart), then answer #60 with the shipped
   shape + the sync ruling.

## Security posture (why Tier 0 under the delegation is defensible)

Least-privilege by construction: the principal cannot enroll itself (owner-gated), holds two
verbs only, cannot touch any other route, and the signature + nonce + skew bind each request to
one action on one agent. The design was published on #60 cross-repo with no objection, and the
USER's standing delegation ("decide by yourself after careful analysis") covers the sync-shape
ruling. Anything that would WIDEN the grant later is a new decision, not this card.

## Acceptance

- [x] enrollment: owner-gated (strict in security-registry → sudo, AND re-checked in the
      service), atomic 0600 write. Verified LIVE: `POST /api/daemon/enroll` without a
      credential answers `auth_required`.
- [x] signed-request verification: wrong key / tampered field / stale / FUTURE-dated / replayed
      nonce / ungranted verb / malformed / not-enrolled — each with a DISTINCT pinned reason
      (13 tests). Ed25519 signing in the tests is REAL, not mocked.
- [x] `submit-recovery-prompt` delivers with requireIdle:false and the #117 mark
- [x] `interrupt` sends NON-LITERAL Escape, returns {delivered, interrupted} synchronously
      (measured, false when nothing broke), writes the #117 mark BEFORE observing
- [x] both server modes (Next + headless), delegating to ONE service; parity test also asserts
      neither surface CALLS the verification
- [x] neuter runs observed, all with disjoint red sets: replay gate→1, freshness→2 (stale +
      future), grant→2 (incl. the ORDER test), burn-nonce→1, literal-path→2, dropped #117
      mark→1, requireIdle:true→1, headless-pattern rename→1
- [x] deployed (build + pm2 restart, health 200) and probed LIVE — which found the one defect
      no test could: the auth middleware refused before any handler ran, so the channel was
      correct and UNREACHABLE (`31ab0877` whitelists inject only; enroll stays gated).
- [x] #60 answered with the shipped shape + the synchronous ruling (comment 5200569302)

## Approval log

- 2026-08-06T06:32:35+0200 — MANDATE under the USER's standing delegation (2026-08-06, "decide
  by yourself after careful analysis. base your decision on verified facts and tests"). Design
  pre-published on #60 (comment 2026-08-05T14:34Z) without objection; sync-shape ruled here.
- 2026-08-06T07:00:02+0200 — COMPLETED by ai-maestro (Tier 0, mandate). Six commits
  (01747710 aec47b51 edf79ff7 8df0b4cd 454b95e1 31ab0877), 32 tests, 8 observed neuters with
  disjoint red sets, deployed and probed live. The live probe earned its keep: it found that
  the middleware made the whole channel unreachable, which no test could see. #60 answered
  (comment 5200569302). All boxes checked; NPT/EHT empty → archive.
