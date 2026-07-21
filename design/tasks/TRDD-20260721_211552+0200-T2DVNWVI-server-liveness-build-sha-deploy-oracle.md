---
trdd-id: T2DVNWVI
title: Stamp the running git sha into server-liveness.json as the server deploy oracle
column: planned
created: 2026-07-21T21:15:52+0200
updated: 2026-07-21T21:15:52+0200
current-owner: ai-maestro
task-type: feature
scope: project
project-id: ai-maestro
min-approval-requirement: none
mandate: true
mandated-by: user
approved: true
approval-judge: user
approval-datetime: 2026-07-21T21:15:52+0200
relevant-rules: []
labels: [deploy-oracle, server-liveness, coordination, core-plugin, P7RPOR5O]
external-refs: [Emasoft/ai-maestro#80, Emasoft/ai-maestro-plugin#31]
release-via: none
---

# Stamp the running git sha into server-liveness.json as the server deploy oracle

## Problem
The working-tree-is-production model has no server-side "is code X live?" oracle. The frozen
SCRIPT layer is checkable (sha256 installed-vs-pushed), but the SERVER's `~/.aimaestro/
server-liveness.json` (`{ts, pid, capabilities[]}`, from P7RPOR5O / `lib/server-liveness.ts`)
proves the server is LIVE and which chore-classes it owns — but NOT which commit it is running.
The core plugin (ai-maestro-plugin#80 S5) needs a one-read check for "is server verb X live?"
on every future skill flip; without it, the only server-side oracle is a behavior probe or a
GitHub thread, which does not scale.

## Proposed fix
Add a `sha` field to the liveness JSON written by `lib/server-liveness.ts` — the running
server's git HEAD (short + full). Resolve it ONCE at startup (not per-heartbeat): read
`git rev-parse HEAD` in the install dir, or an env stamp (`AIM_BUILD_SHA`) the build/pm2 config
sets, with a `"unknown"` fallback when git is unavailable (packaged install). Additive-only —
does not change the existing `{ts, pid, capabilities[]}` contract the janitor's two backends read.

New shape: `{"ts":…, "pid":…, "sha":"139ae56f", "sha_full":"…", "capabilities":[…]}`.

## Files
- `lib/server-liveness.ts` — resolve the sha once at module/`startServerLiveness()` init;
  include it in the atomic write. Keep the 30s heartbeat cheap (reuse the cached sha).

## Verification
- `bash scripts/with-node.sh npx tsc --noEmit` → 0 errors.
- Restart → `cat ~/.aimaestro/server-liveness.json` shows `sha` == `git rev-parse --short HEAD`.
- The core can then answer "is server code X live?" = read `server-liveness.json.sha`.

## Notes
- Implementation is DEFERRED to batch with the next natural server restart (avoid a redundant
  dashboard blip + agent boot-restore right after the 21:12 restart). The code change + commit
  can land now; it goes live on the next restart.
- Coordinate the new field with the janitor (it reads this file) — additive, so no break, but
  note it on janitor#100 when implemented so the two backends can optionally consume `sha`.

## Approval log
- 2026-07-21T21:15:52+0200 — MANDATE (Tier-0, self, in-scope infra). Promised to core on #80 S5.
