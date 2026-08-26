---
trdd-id: 1V7UZ38I
title: The docker agent path is dormant and would expose an unauthenticated remote PTY plus a duplicate host session if anyone used it
column: todo
scope: project
project-id: ai-maestro
repo: Emasoft/ai-maestro
created: 2026-08-26T16:25:53+0200
updated: 2026-08-26T16:25:53+0200
current-owner: ai-maestro-hub-session
created-by: ai-maestro-hub-session
assignee: ai-maestro-hub-session
task-type: security
min-approval-requirement: manager
mandate: false
approved: false
derived: false
npt: []
eht: []
blocked-by: []
release-via: none
priority: 1
severity: high
labels: [security, containers, dead-feature, pty]
external-refs: [TRDD-EVO7T245, TRDD-DQVPODKW]
---

## Problem

Found while answering TRDD-EVO7T245's container question read-only. **The route is fine** —
`POST /api/agents/docker/create` runs `authorize(auth, 'create-agent')`, closed under
TRDD-DQVPODKW. Everything below it is not.

The docker path cannot run today (the image is absent), so nothing is exposed *right now*. The
defect is that **the first person to build the image gets all three of these at once**, from a
legitimate, authorized action, with no warning.

### 1. The container's `/term` is UNAUTHENTICATED, and the port binds 0.0.0.0

`agent-container/agent-server.js` serves a WebSocket at `/term` (`:64-66`) and spawns
`node-pty` against `tmux attach-session` (`:162`). There is **no credential check on the
handshake**. Measured rather than eyeballed: twelve auth-vocabulary hits in that file
(`auth|token|bearer|credential|cookie|secret`) and **all twelve are git credential config**
(`:72-96`). Positive control: `lib/ws-auth-gate.ts` returns 12 hits of the same needles and they
ARE the authentication.

`agents-docker-service.ts:193-197` publishes `-p ${port}:23000`, which Docker binds to **0.0.0.0**.

So anyone who can reach that port gets an interactive PTY on the agent's session. The host's own
`/term` deep-validates a credential before attaching a PTY (`server.mjs:1152`, `lib/ws-auth-gate.ts`)
— **the container's does not, and it is the one reachable from off-box.** This is strictly worse
than the local process-table exposure TRDD-EVO7T245 was filed for.

### 2. A "containerised" agent also gets a HOST tmux session — so it is a duplicate

`agents-docker-service.ts:232` passes `createSession: true` into `createAgent`. That reaches
`element-management-service.ts:10669-10672`, which imports `createSession` from
`sessions-service`, whose `:1014` calls `runtime.createSession(...)` — **the host tmux runtime.**

The container starts its own tmux (`-e TMUX_SESSION_NAME=${name}`) and the host starts one under
the same name. Two agent processes; the dashboard streams the host one (see 3). **Containerising
an agent today therefore buys ZERO isolation and costs a second process** — and the half you can
see is precisely the `send-keys` impersonation surface TRDD-EVO7T245 demonstrated.

### 3. The host never routes to the container, and says so

```
server.mjs:852   // NOTE: Container agent handling removed - not yet implemented
server.mjs:853   // Future: Add handleContainerAgent() when cloud deployment is supported
server.mjs:1276  // NOTE: Container/cloud agent routing is not yet implemented
server.mjs:1277  // Future: Check agent metadata for cloud deployment and proxy to container WebSocket
server.mjs:1278  // Currently all agents are local tmux sessions
```

`agents-docker-service.ts:246` writes `websocketUrl: ws://localhost:${port}/term` into the agent
record and **that field has zero readers** — the only other hits are a type declaration and a
different route's request body (`agents-core-service.ts:128, :1162`). The client builds its URL
from `window.location.host` (`hooks/useWebSocket.ts:63`), and `/term` routes on **hostId** only
(`server.mjs:1264`) before falling through to local tmux.

### 4. Minor, same feature area: `GET /api/docker/info` has no gate at all

`app/api/docker/info/route.ts:10` — no `enforceAuth`, no `authorize`. It runs `docker version` via
`execFileAsync` (`config-service.ts:528`) and returns the server version. Low severity (a version
fingerprint, plus an unauthenticated subprocess spawn bounded by a 5 s timeout), noted here because
it is the same surface and would be fixed in the same pass. **Out of TRDD-R268J32X's scope by
construction** — that ledger tracks MUTATING routes and this is a GET.

## What is NOT the problem

- **The create route's authorization.** Closed under TRDD-DQVPODKW; `authorize(auth,
  'create-agent')` is correct and its comment records why `authenticateFromRequest` rather than
  `requireAuth` (a gate that denies everyone passes every denial test — only the MANAGER positive
  control caught it).
- **The container image's hygiene.** The Dockerfile runs as a non-root `claude` user, and
  `agents-docker-service.ts:185-191` deliberately passes `GITHUB_TOKEN` via a temporary
  `mode: 0o600` env-file so it stays out of `docker inspect` and `/proc/[pid]/environ`. That is the
  right instinct and predates this card.
- **node-pty in a container.** It works; `agent-server.js` is a complete implementation that speaks
  this dashboard's exact message set (`input`/`resize`/`ping`/`set-logging`).

## Proposed fix — a RULING is needed first, because the cheap fix and the right fix differ

The honest question is **whether this feature is wanted at all**, and TRDD-EVO7T245 may answer it:
containers are the only candidate that makes cross-agent `send-keys` impossible by construction.

1. **If containers are NOT the direction:** the safe, lazy move is to make the dormant path refuse
   rather than half-work — have `createDockerAgent` return a 501 naming this card, and delete the
   unreachable `websocketUrl` write. A feature that cannot stream its terminal and duplicates the
   agent is not a feature; leaving it callable is the risk.
2. **If containers ARE the direction (TRDD-EVO7T245):** all four defects are prerequisites, not
   follow-ups —
   - bind `127.0.0.1:${port}:23000`, **and** require a credential on the container's `/term`
     (loopback alone is not enough once the routing proxies through the host);
   - drop `createSession: true` for a container agent, so no host tmux session is minted;
   - implement `handleContainerAgent()` in `/term`, reading `deployment.cloud.websocketUrl`;
   - build and version `ai-maestro-agent:latest`.
3. Gate `GET /api/docker/info` either way — one line, no design question.

**Anything that only builds the image is NOT a fix** — it is the change that converts three dormant
defects into three live ones.

## Verification

- A test that `createDockerAgent` does not request a host session, asserting `runtime.createSession`
  was NOT called — with a neuter (restore `createSession: true`, test reddens).
- A test that the published port is loopback-bound, asserting the `-p` argv element, with a neuter.
- If the container socket gains auth: a connection with no credential is REFUSED **and no PTY was
  spawned** — a 401 after `pty.spawn` is still a shell. POSITIVE CONTROL: a valid credential still
  attaches, or the test passes with a gate that refuses everyone (the exact trap
  `docker/create/route.ts:24-29` records catching).
- `GET /api/docker/info` unauthenticated → refused; authenticated → still returns the version.
- Re-run `tests/unit/agent-route-authorization-coverage.test.ts` and confirm the ledger does NOT
  move (these are service-side and a GET), rather than assuming it.

## Acceptance

- [ ] **RULING: is the docker agent path wanted?** Fix 1 (make it refuse) and fix 2 (finish it)
      are mutually exclusive and this card cannot proceed without the answer. Coupled to
      TRDD-EVO7T245's container decision
- [ ] Duplicate host session removed, or the path made to refuse
- [ ] Container `/term` authenticated + loopback-bound, or the path made to refuse
- [ ] `GET /api/docker/info` gated (unconditional — independent of the ruling)
- [ ] Neuters recorded for every guard added
- [ ] Positive control proving the added auth does not deny everyone
- [ ] Ledger confirmed unmoved

## Approval log

- 2026-08-26T16:25:53+0200 — FILED, `min-approval-requirement: manager`. Found while answering
  TRDD-EVO7T245's container step 5 from the code rather than by creating a container. Every claim
  read first-hand; the "no auth on the container socket" claim is a counted needle with a positive
  control on a file that DOES authenticate, because a zero from one grep is not a negative result.
  **Filed rather than left in EVO7T245's prose**: these are defects in shipped code whether or not
  the container direction is chosen, and a finding that lives only in another card's narrative is
  not on the board.
