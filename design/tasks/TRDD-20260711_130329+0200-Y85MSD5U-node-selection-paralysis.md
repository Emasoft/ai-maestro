---
trdd-id: Y85MSD5U
title: Node selection paralyzes build and test — pin the supported Node in one place
column: dev
created: 2026-07-11T13:03:29+0200
updated: 2026-07-11T13:03:29+0200
current-owner: ai-maestro-dev
assignee: ai-maestro-dev
priority: 0
severity: HIGH
effort: S
labels: [runtime, dx, readiness, migration-blocker]
task-type: bugfix
parent-trdd: null
npt: []
eht: []
blocked-by: []
supersedes: []
superseded-by: []
relevant-rules: []
min-approval-requirement: none
mandate: true
mandated-by: self
created-by: ai-maestro-dev
approved: true
approval-judge: maestro
approval-datetime: 2026-07-11T13:03:29+0200
release-via: none
delivery: direct-push
target-branch: governance-rules
must-pass-tests-before-merge: true
test-requirements: [unit, lint, typecheck]
audit-requirements: []
review-requirements: []
runtime-targets: [macos]
impacts: [install-script, ci-pipeline]
attempts: 0
test-failures: 0
last-test-result: pass
last-test-at: 2026-07-11T13:03:29+0200
implementation-commits: []
external-refs: ["https://github.com/Emasoft/ai-maestro-maintainer-agent/issues/27"]
---

# Node selection paralyzes build and test

## ⏵ STATE — READ THIS FIRST ON RESUME (authoritative) — 2026-07-11

**Current state.** Diagnosed, fix not yet applied.

- The machine's default `node` is **v26.5.0**. `package.json` declares
  `engines.node: ">=22.0.0 <26.0.0"`, and `.nvmrc` pins **22**.
- Yarn 1 enforces `engines` **at `yarn run` time**, before any script executes.
  So **`yarn build` and `yarn test` both abort immediately** with
  `The engine "node" is incompatible with this module`. A developer — or an
  ai-maestro agent — cannot build or test this repo at all.
- The `<26` cap is **CORRECT and must not be widened** (commit `12e6dd2d`):
  `node-pty`'s compiled binary is NODE_MODULE_VERSION 127 (Node 22 ABI) and
  Node 26 needs 147, and `better-sqlite3@12.8.0` hard-caps at Node 25. PTY /
  terminal streaming is the dashboard's core feature; running on Node 26 kills it.
- **Proof the code is healthy** — re-running the same gates with
  `PATH=/opt/homebrew/opt/node@22/bin:$PATH`: `tsc` 0 errors, vitest
  **158 files / 2478 passed / 2 skipped**, `next build` succeeded. So Node
  selection is the *only* blocker.
- `scripts/start-with-ssh.sh` **already** pins Node 22 (its Step 5), so the
  **server** start path is fine — the server is merely *stopped*. The gap is
  that **nothing else** pins Node: the build/test paths inherit ambient Node 26.
- Node 22 is already installed (`/opt/homebrew/opt/node@22/bin/node`), as are
  `nvm` and `mise`. **Nothing needs to be installed.**

**NEXT ACTION.** Apply the fix below (extract `scripts/pin-node.sh`; add
`scripts/with-node.sh`; make `start-with-ssh.sh` source it; make it fail-fast).

**Load-bearing gotchas.**
- The brew kegs `node@23/24/25/26` on this machine are **mislabeled** — several
  report v26.3.0. Any pin logic MUST check the binary's actual `node -v`, never
  trust the keg name. (`start-with-ssh.sh` already learned this the hard way.)
- Do **not** add `ignore-engines` to `.yarnrc`. That would silence the check and
  let someone run on Node 26, where node-pty dies at `require()` — trading a
  loud, correct failure for a crash-loop.

**SUPERSEDED — do NOT carry forward.**
- "Widen `engines` to allow Node 26" — rejected; the ABI constraint is real.

## Problem

Yarn's engine check fires before any script runs, so on this machine every
`yarn build` / `yarn test` is dead on arrival. Once plugin development moves
into ai-maestro, every MAINTAINER agent driving this repo hits the same wall.
This is the literal "issue that paralyzes development" the owner asked to be
eliminated before migration.

Secondary defect: `start-with-ssh.sh` Step 5 **silently falls back** to the
ambient Node when it finds no supported keg. On a machine whose default is 26
that starts the server on an unsupported Node, producing an `ERR_DLOPEN_FAILED`
crash-loop instead of one clear error. That violates fail-fast.

## Root cause

Node selection is implemented **once**, **inline**, in the server launcher only.
No other entry point (build, test, lint, CI, an agent's shell) has any Node
selection at all, and there is no single source of truth for "which Node".

## Proposed fix

1. **`scripts/pin-node.sh`** (new, source-able) — the ONE place that decides the
   Node. Reads the required major from `.nvmrc`, enumerates candidates (current
   PATH node, then the brew kegs), and **verifies each candidate's real
   `node -v`** against the `engines` range. Exports `PATH`. **Fails fast** with an
   actionable message if no supported Node exists — never falls back silently.
2. **`scripts/with-node.sh <cmd…>`** (new) — sources `pin-node.sh`, then
   `exec "$@"`. This is the deterministic entry point (`bash scripts/with-node.sh
   yarn build`) that works regardless of the caller's shell — which is what an
   agent needs, since an agent's tmux shell has no `nvm`/`mise` hook.
3. **`scripts/start-with-ssh.sh`** — replace the inline Step 5 loop with
   `source scripts/pin-node.sh` (single source of truth) and inherit its
   fail-fast behaviour.
4. **Docs** — `CLAUDE.md` dev-commands + `docs/REQUIREMENTS.md`: state the Node
   constraint, why (`node-pty` ABI), and the wrapper command.

Deliberately NOT done: no `.yarnrc` `ignore-engines`, no `engines` widening, no
`mise.toml` (`.nvmrc` already declares the pin and mise/nvm both read it).

## Verification

- `bash scripts/with-node.sh node -v` → v22.x.
- `bash scripts/with-node.sh yarn test` and `… yarn build` → green (baseline
  already measured: 2478 passed, build OK).
- `pm2 restart ai-maestro` → server reachable on `GET /api/sessions`.
- Negative: with the kegs hidden, `pin-node.sh` exits non-zero with a clear
  message instead of starting on Node 26.

## Approval log

- 2026-07-11T13:03:29+0200 — MANDATE issued by self (min-approval-requirement: none).
  Tier-0: in-scope bugfix on the project under development, reversible and local.
  No approval request was sent.

## Notes and lessons learned
