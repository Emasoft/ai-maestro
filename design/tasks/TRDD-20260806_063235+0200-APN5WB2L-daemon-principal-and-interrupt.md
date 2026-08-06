---
trdd-id: APN5WB2L
title: Daemon principal and synchronous interrupt — authenticated janitor recovery injection
column: dev
scope: project
project-id: ai-maestro
created: 2026-08-06T06:32:35+0200
updated: 2026-08-06T06:32:35+0200
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

- [ ] enrollment: owner-gated, stores pubkey via the amp-keys registration store; a second
      enrollment attempt without the owner gate is refused
- [ ] signed-request verification: wrong key / stale issued_at (>60s) / replayed nonce / verb
      outside the two-verb grant each refused with a DISTINCT pinned reason
- [ ] `submit-recovery-prompt` delivers a text line with requireIdle:false and the #117 mark
- [ ] `interrupt` sends non-literal Escape, returns {delivered, interrupted} synchronously, and
      writes the #117 mark
- [ ] both server modes reachable (Next route + headless router entry) — pinned by a parity test
- [ ] neuter runs observed and recorded (auth-bypass neuter reds exactly the refusal tests; mark
      neuter reds exactly the #117 test)
- [ ] deployed (build + pm2 restart, health 200); #60 answered with the shipped shape and the
      synchronous ruling

## Approval log

- 2026-08-06T06:32:35+0200 — MANDATE under the USER's standing delegation (2026-08-06, "decide
  by yourself after careful analysis. base your decision on verified facts and tests"). Design
  pre-published on #60 (comment 2026-08-05T14:34Z) without objection; sync-shape ruled here.
