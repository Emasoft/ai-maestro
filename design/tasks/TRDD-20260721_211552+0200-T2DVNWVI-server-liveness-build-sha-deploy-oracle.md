---
trdd-id: T2DVNWVI
title: Stamp the running git sha into server-liveness.json as the server deploy oracle
column: testing
created: 2026-07-21T21:15:52+0200
updated: 2026-07-21T22:36:08+0200
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
implementation-commits: [5a91b7fb]
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

## IMPLEMENTED + VERIFIED (2026-07-21)
- `lib/server-liveness.ts`: `ServerLiveness` gained `sha`/`sha_full`/`dirty`; a PURE
  `computeBuildSha(env, runGit)` (env `AIM_BUILD_SHA` wins → git → `'unknown'`, `dirty` from
  `git status --porcelain`) behind the cached `resolveBuildSha()`; a `buildSha?()` seam on
  `WriteServerLivenessDeps` mirrors the existing `now`/`pid`/`capabilities` seams.
- `tests/unit/server-liveness.test.ts`: +5 (sha-write via seam; computeBuildSha env-wins /
  git-clean / git-dirty / unknown). **13/13 pass; `tsc --noEmit` exit 0.**
- Added `dirty` beyond the original plan: under working-tree-is-production a sha alone under-
  describes a dirty build, so the oracle must report it.

## Notes
- **DEPLOYED + VERIFIED LIVE 2026-07-21T22:36** — batched with the H18PO5YJ P0 restart (`pm2 restart`
  at HEAD `b4887d20`). `~/.aimaestro/server-liveness.json` now carries
  `sha:"b4887d202aa0"` (== HEAD), `sha_full:"b4887d202aa0460b740a1611f176496dbf5f99b5"`, `dirty:false`.
  The oracle CONFIRMED its own deploy AND P0's (the running server is provably on the committed HEAD,
  clean). Impl commit `5a91b7fb`. NB verify-lag: the very first post-restart liveness write can briefly
  show the old `{ts,pid,capabilities}` shape before the new process's writer runs — re-read after ~15s.
- Additive-field coordination with the janitor (reads this file) tracked on janitor#100 — additive, no break.
- Coordinate the additive field with the janitor (it reads this file) on janitor#100 when it
  deploys — additive, no break.

## Approval log
- 2026-07-21T21:15:52+0200 — MANDATE (Tier-0, self, in-scope infra). Promised to core on #80 S5.
