---
trdd-id: P7RPOR5O
title: Server liveness+capability probe file — the auth-free coordination seam both janitor backends read
column: dev
created: 2026-07-17T14:47:58+0200
updated: 2026-07-17T14:47:58+0200
current-owner: ai-maestro
task-type: feature
scope: project
min-approval-requirement: none
mandate: true
mandated-by: ai-maestro
approved: true
approval-judge: ai-maestro
approval-datetime: 2026-07-17T14:47:58+0200
relevant-rules: [16, 23, 42]
labels: [family-a, continuity, coordination, liveness, capability-probe, npt]
external-refs: [Emasoft/ai-maestro-janitor#100]
parent-trdd: KCRMSNL7
derived: true
derived-kind: npt
npt: []
eht: []
blocked-by: []
release-via: none
---

# Server liveness+capability probe file — the auth-free coordination seam both janitor backends read

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-17

7th NPT of [[KCRMSNL7]], surfaced by the daemon-coordination refinement (janitor#100). The whole
Family-A/B daemon split needs ONE fact from two ends: `#J` (inside the harness) must know "the
server is up and owns capability X" before delegating; `#N` (outside) must know "a live server
owns the harness agents" to hold its exclusion (and "no live server" to adopt the fallback). The
HTTP health endpoint 401s unauthenticated and the frozen CLI needs `$AID_AUTH` — neither works for
the OUTSIDE daemon. The janitor asked me (janitor#100, comment 5003418487) to name the shape; I
proposed an **auth-free file the server maintains**, both consumers `stat` it. This NPT builds it.

**THE LOAD-BEARING RULE (janitor#100):** `capabilities` advertises ONLY what the server ACTUALLY
owns and is RUNNING right now — never what code merely exists. An un-absorbed / INERT chore class
is simply ABSENT, so the janitor keeps doing it until the server proves ownership. This makes the
whole absorption a per-class INCREMENTAL HANDOFF with no flag-day. Today the file ships advertising
`capabilities: []` (OAuth INERT via the R16 flag; nothing else built) → the janitor keeps 100%.

**Capability tokens (each appears only when its class is LIVE):**
- `family-a` — the OAuth rotator tick is ENABLED (the R16 flag `oauth-rotator-tick.enabled` present).
  Reuses [[1GGQ4HWY]]'s `oauthTickEnabled()` — one source of truth for the flag. Absent today.
- `singleton-chores` — marketplace/user-plugins/version-update absorption is running. NOT built →
  intentionally NOT computed (a token without its live chore would silence the janitor on a chore
  nobody runs — the exact failure janitor#100 forbids). Ships WITH `marketplace-op.lock`.
- `fleet-recovery` — server-internal session-liveness/fleet-stop for harness agents ([[CHN16JXZ]],
  design-gated on ai-maestro#60). NOT built → not computed.

**NEXT ACTION:** DONE for the seam itself once built + tested. The 2 unbuilt tokens are added by
their own NPTs (singleton-chores absorption; CHN16JXZ) — each adds its `caps.push(...)` guard here
when its chore goes live. Do NOT advertise a token before its chore runs.

## Problem / Goal

Provide the canonical "server is up / owns capability X" signal the janitor's two backends both
consume, WITHOUT auth (the outside `#N` daemon has no `$AID_AUTH`) and WITHOUT the HTTP-401 problem.
An auth-free file under `~/.aimaestro/` that the server maintains and both backends `stat`.

## Scope (the seam only — the tokens' chores are other NPTs)

- `lib/server-liveness.ts` — `SERVER_LIVENESS_FILE = statePath('server-liveness.json')`;
  `currentCapabilities()` (honest, live-only — today just the `family-a` guard on `oauthTickEnabled()`);
  `writeServerLiveness()` (atomic tmp+rename, never throws); `startServerLiveness()` (write-once on
  boot + a 30 s unref'd interval — a third of the 90 s staleness consumers use).
- `server.mjs` — dynamic-import + `startServerLiveness()` at boot, right after the OAuth-rotator tick
  start, mirroring that pattern (unconditional start; the honesty lives inside `currentCapabilities`).
- The file shape is `{ ts: <epoch_s>, pid: <server pid>, capabilities: string[] }`.

## Reuse (do not reinvent)

- `oauthTickEnabled()` (`lib/oauth-rotator/server-tick.ts`) — the single source for the R16 flag,
  reused for the `family-a` token so the flag name is never duplicated.
- `statePath()` re-resolved via `path.basename(SERVER_LIVENESS_FILE)` on every write — honors a
  test's HOME override (the exact idiom `server-tick.ts` uses for `oauthTickEnabled`).
- The `setInterval(...).unref()` + never-throw beat pattern from `server-tick.ts`.

## Verification

- Unit (`tests/unit/server-liveness.test.ts`, 0-IMPACT temp-HOME): the file is written with the 3
  fields; `capabilities` is `[]` when the R16 flag is absent and `['family-a']` when present;
  `writeServerLiveness` never throws on an unwritable dir; the write is atomic (no partial file).
- `bash scripts/with-node.sh npx tsc --noEmit` clean; `yarn build` clean.

## Approval log

- 2026-07-17T14:47:58+0200 — Tier-0 self-mandate (derived NPT of [[KCRMSNL7]], coordination
  substrate the janitor is blocked on; in-scope server dev, no token material). Authored as `dev`.
