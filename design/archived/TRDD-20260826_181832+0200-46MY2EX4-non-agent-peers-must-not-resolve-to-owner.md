---
trdd-id: 46MY2EX4
status: archived
title: A local process that resolves to no agent must be refused and never conflated with the system owner
column: complete
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T18:18:32+0200
updated: 2026-10-04T18:34:42+0200
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
labels: [security, impersonation, agent-auth]
external-refs: [TRDD-EVO7T245, TRDD-9JUEJFY3]
approval-judge:  manager 
approval-datetime: 2026-09-05T10:21:09+0200
---

## Problem

Any local process can connect to the server's Unix socket, not only agents. The identity
resolution must therefore have a well-defined answer for "this pid does not walk up to any
pane" — and that answer must be a refusal.

## Why it needs its own card

It looks like a trivial corollary of fail-closed (TRDD-9JUEJFY3) and it is not: that card is
about a walk that BREAKS, this one is about a walk that COMPLETES and finds nothing. The two
have different code paths and a fix for one does not imply the other. A `null` agent that is
then treated as "system" or "owner" anywhere downstream is a privilege escalation from any
local process on the machine, agent or not.

## Task

1. INVESTIGATE — the socket's path, ownership and mode; who can reach it.
2. ASSESS — what the resolution returns for a non-agent peer, and what every downstream
   consumer does with that value. Specifically: is `undefined` agentId treated as
   system-owner anywhere (lib/agent-auth.ts documents exactly that meaning for a web
   session, which makes the collision plausible).
3. SAFEGUARD — a non-resolving peer is refused, and is never conflated with the web-session
   system-owner case.

## Acceptance

- [x] Socket path, owner, mode recorded, with a statement of who can connect. MEASURED
  2026-10-04: the server exposes NO Unix domain socket of its own — `server.mjs:1685` binds
  `server.listen(port, bindAddress)` (TCP, default `127.0.0.1:23000`, `lsof` verified: `node
  84452 ... TCP 127.0.0.1:23000 (LISTEN)`). The only AF_UNIX socket the app touches is the
  shared tmux one at `/private/tmp/tmux-501/default`, mode `srw-rw----`, owner
  `emanuelesabetta`/`wheel` — connectable by every process of the same uid, i.e. by every
  agent AND every non-agent process on the machine. A live `node` probe of a fresh AF_UNIX
  socket re-measured the TRDD-EVO7T245 finding under the pinned Node 22.23.3:
  `net.Socket` exposes NO peer credentials (`getPeerCredentials` ABSENT from the prototype,
  `remoteAddress: undefined` on a UDS conn). Pinned by
  `tests/security/non-agent-peer-refusal.test.ts` (socket-surface describe: TCP-bind
  regex, delete-and-stamp regex, and a no-peer-credential-API assertion over server.mjs +
  lib/peer-address.mjs). Conclusion: "the socket" is the loopback TCP listener; who can
  connect = every local process of any user able to route to 127.0.0.1, plus Tailscale peers
  when the dual-stack bind is on. Identity therefore CANNOT come from the transport; it can
  only come from a possessed credential.
- [x] The resolution's return for a non-agent peer is specified and refused. The one
  identity resolution reachable by a credential-less peer is
  `lib/agent-auth.ts::authenticateAgent` (via middleware.ts → requireAuth /
  enforceSystemOwner / requireSudoToken). For a walk that COMPLETES and finds nothing (no
  cookie, no bearer): returns `{ error: 'Authentication required. Log in at /api/auth/login
  or provide a Bearer token.', status: 401 }` and nothing else (asserted: the result's key
  set is exactly `[error, status]`). The pid-ancestry resolution for a non-agent peer —
  `lib/identity-walk.ts::walkToPane` — refuses with `reason: 'severed'` (pinned by
  tests/security/non-agent-peer-refusal.test.ts AND the sibling TRDD-9JUEJFY3 suite).
  Verified by neuter: restoring the forgeable `ok:true` fallback shape reddened exactly
  that test.
- [x] A grep-backed audit that no consumer treats an unresolved peer as owner. Audited every
  consumer of the resolution: `lib/route-auth.ts` (requireAuth/enforceAuth/enforceSystemOwner
  — all check `result.error` before `buildAuthContext`), `lib/sudo-guard.ts`
  (requireSudoToken — authenticates first, agent path vs owner path split on
  `!ctx.isSystemOwner` AFTER auth), `lib/authorization.ts::authorize` — error-first, pinned
  by test; `services/headless-router.ts` — structural + semantic gates, then per-handler
  `authenticateAgent`; `services/amp-service.ts` — `auth.agentId!` only after
  `auth.authenticated`; `app/api/v1/route/route.ts` → `routeMessage` — mesh-forwarded
  identity requires a verified Ed25519 role attestation (TRDD-3VFT513C), else 401. FINDING
  AND FIX: `buildAuthContext` itself computed `isSystemOwner = !agentId` from an ERRORED
  result under the model-off default — every current caller checked `error` first, so
  nothing was exploitable live, but the one primitive all consumers share conflated a
  refusal with the owner. Fixed in place (error-first guard added, citing this card);
  verified by neuter (guard removed → exactly the new buildAuthContext test reddens) and by
  the 96-test auth-neighbourhood run staying green. Console-gated routes audited
  file-by-file: settings/edit (inline isConsolePeer + enforceSystemOwner),
  oauth-rotator/reauth/start+complete (guardReauthRoute: console FIRST, then
  enforceMaestro, then sudo), statusline/ingest (console-only, accepts data, confers no
  capability, no secret), governance/password invalidate+reset (console + one-shot code /
  passkey). Middleware whitelist entries each argued in situ; statusline/ingest is the only
  write-shaped one and returns no capability. `GET`-only routes with no auth call were
  spot-checked as reads (debug/pty, governance, statusline roll-up, teams names/stats,
  config, capabilities); `POST /api/hosts/register-peer` + `exchange-peers` are the
  cross-host bootstrap pair (peer-registration protocol, out of this card's identity-
  resolution scope — noted, not silently dropped).
- [x] A test connecting from a non-agent process and asserting refusal.
  tests/security/non-agent-peer-refusal.test.ts — 12 tests, all passing. The non-agent
  peer is simulated at the two boundaries the transport can reach: (a) the resolver
  (`authenticateAgent(null, null, null)` → 401, exact key set, owner-shape unreachable
  without a possessed credential, X-Agent-Id-only spoof refused) driven through the REAL
  unmocked resolver with $HOME redirected; (b) the ancestry walk (`walkToPane` from a
  chain that dead-ends at init with no known pane → `ok:false, reason:'severed'`). Both
  verified by neuter runs recorded in docs_dev/trdd-46my2ex4-report.md. tsc --noEmit and
  eslint --quiet clean on both touched files.

## Approval log

- 2026-09-05T10:21:09+0200 — APPROVED by  manager  (min-approval-requirement: manager). APPROVED:  fail-closed-on-no-match for identity walk still unimplemented (no such code exists) . USER /goal 2026-09-05 'complete all TRDD and pending tasks'; screened 2026-09-05 (reports/triage/20260905_101808+0200-proposal-screen.md), grounding verified in-tree.
- 2026-10-04T18:34:42+0200 — COMPLETE by main-agent@ai-maestro. archived → complete.

## Implementation

2026-10-04 — implemented, commits 71672f697 + b5d536391, verified: git log shows both TRDD-46MY2EX4 commits; git cat-file -e HEAD confirms lib/agent-auth.ts + tests/security/non-agent-peer-refusal.test.ts. Closing to complete.
