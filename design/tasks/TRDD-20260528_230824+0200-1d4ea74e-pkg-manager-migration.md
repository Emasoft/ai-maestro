---
trdd-id: 1d4ea74e-8a9b-41a4-a5d6-3bd8ee99e195
title: Migrate from Yarn Classic to pnpm or Yarn Berry for release-age cooldown
status: not-started
created: 2026-05-28T23:08:24+0200
updated: 2026-05-28T23:08:24+0200
---

# TRDD-1d4ea74e — Migrate from Yarn Classic to pnpm or Yarn Berry for release-age cooldown

**Filename:** `design/tasks/TRDD-20260528_230824+0200-1d4ea74e-pkg-manager-migration.md`
**Tracked in:** this repo (design/tasks/ is git-tracked)

## Origin

A janitor supply-chain finding proposed adding three `.npmrc` keys for hardening:
`minimum-release-age=7200`, `trust-policy=no-downgrade`, `block-exotic-subdeps=true`.

Investigation (2026-05-28) found the repo uses **Yarn Classic v1.22.22**, which
**silently ignores** all three keys — writing them would be inert security
theater. The genuine way to get a dependency **release-age cooldown** (the
"don't install a version published less than N seconds ago" defense against
fresh-malware supply-chain attacks) is to move to a package manager that
implements it natively. The user chose to scope that migration as its own
task rather than write an ineffective `.npmrc`.

## Problem statement

The single concrete capability we want and cannot get on Yarn v1:

- **Release-age cooldown.** Refuse to resolve/install any dependency version
  published within the last N seconds (proposed 7200s = 2h, but the real
  recommendation is closer to 24-72h). This blunts the most common npm
  supply-chain attack: a compromised maintainer publishes a malicious patch
  release and it gets pulled into CI within minutes, before anyone notices.

Secondary hardening we'd also gain (PM-dependent — verify at implementation):

- **Build-script allowlisting.** Block arbitrary `postinstall` scripts unless
  explicitly approved. (pnpm 10 does this by default via `onlyBuiltDependencies`.)
- **Stricter lockfile / integrity semantics** and a non-flat `node_modules`
  that prevents phantom-dependency access.

## Current state (verified 2026-05-28)

| Fact | Value | Source |
|------|-------|--------|
| Package manager | Yarn Classic **v1.22.22** | `yarn --version` |
| Lockfile | `yarn.lock` (5902 lines), no `pnpm-lock.yaml`, no Berry `.yarnrc.yml` | `ls` |
| `packageManager` field | **absent** in package.json | parsed |
| Workspaces / monorepo | **none** (single package) | parsed |
| Node engines | `>=22.0.0` | package.json |
| Node version pin file | **none** (`.nvmrc` / `.node-version` / `.tool-versions` all absent) | `ls` |
| Native deps (rebuild on PM switch) | **node-pty ^1.0.0**, **better-sqlite3 ^12.8.0**, **sharp ^0.34.4** | parsed |
| Existing supply-chain protection | committed `yarn.lock` with integrity hashes + CI `--frozen-lockfile` | ci.yml:30,57 |
| Files referencing `yarn ` (tracked, excl. lockfile) | **70** — 27 tests, 16 docs, 5 scripts, 4 design, 4 .claude, 3 components, 2 lib, + README/CONTRIBUTING/SECURITY/CHANGELOG/CLAUDE.md/install.sh/update-aimaestro.sh/.github | `git grep -lF 'yarn '` |
| PM2 launch | `ecosystem.config.js` → `script: ./scripts/start-with-ssh.sh` (bash interpreter, `exec_mode: fork`) — PM2 does not call yarn directly; the shell wrapper may | grep |
| package.json scripts of note | dev/start/headless run `tsx server.mjs`; build is `next build`; `NEXT_PRIVATE_SKIP_LOCKFILE_CHECK=1` set on dev/build/start | parsed |

## Candidate package managers

### Option A — pnpm (recommended primary candidate)

**Why it fits the goal best:** pnpm ships a native `minimumReleaseAge` cooldown
(introduced ~pnpm 10.16, Sept 2025), configured in `pnpm-workspace.yaml` or via
`.npmrc` (`minimum-release-age`, with `minimum-release-age-exclude` for trusted
internal packages). This is the exact feature the finding wanted.

Additional pnpm-10 wins:
- Build scripts are **blocked by default**; only packages in
  `onlyBuiltDependencies` may run `postinstall`. This is a strong supply-chain
  control — but it means **node-pty, better-sqlite3, and sharp must be
  explicitly allowlisted** or they won't compile their native bindings.
- Non-flat symlinked `node_modules` prevents phantom-dependency imports.

**Risks specific to pnpm:**
- Strict (isolated) `node_modules` layout breaks packages that assume hoisting.
  Next.js generally works, but some transitive deps may need
  `node-linker=hoisted` or a targeted `public-hoist-pattern`. Must be validated
  against this app's full dependency tree.
- The three native deps each need a verified native build under pnpm + the
  allowlist entry. Highest-risk item in the whole migration.

### Option B — Yarn Berry (v4)

**Why consider it:** smaller conceptual jump (still "yarn"), team muscle memory
mostly preserved (`yarn install`, `yarn build` still work).

**Why it's weaker for THIS goal:** as of the Jan-2026 knowledge cutoff, Yarn
Berry has **no confirmed native release-age cooldown** equivalent to pnpm's
`minimumReleaseAge`. It may require a third-party plugin or may not exist at
all — **this MUST be verified live at implementation time** before choosing
Berry. If Berry cannot do the cooldown natively, it does not satisfy the
problem statement and Option A wins by default.

**Other Berry friction:** PnP mode is incompatible with several tools unless
`nodeLinker: node-modules` is set; `tsx`/`vitest`/`playwright`/`next` + native
deps are smoother under the `node-modules` linker, which gives up some of
Berry's headline benefits.

### Option C — npm (fallback)

npm may have shipped a cooldown/age-gate feature after the knowledge cutoff
(verify). Lowest migration friction (no new binary, Corepack-managed), but
historically the weakest of the three on supply-chain controls. Only choose if
A and B are both blocked.

## Decision points (resolve at implementation, with live verification)

1. **Confirm the cooldown feature exists and its exact config key** for the
   chosen PM at the version we'll pin. Do NOT trust this TRDD's version numbers
   — they predate implementation. (D1)
2. **Pick the cooldown window.** 7200s (2h) from the finding is low; 86400s
   (24h) or 259200s (72h) is the more defensible default. Decide with the user. (D2)
3. **pnpm only:** enumerate the `onlyBuiltDependencies` allowlist. Start with
   `node-pty`, `better-sqlite3`, `sharp`; expand only as install surfaces more
   build-script-requiring packages. (D3)
4. **node_modules linker strategy** if pnpm: try strict first, fall back to
   `hoisted` only for packages that demonstrably break. (D4)
5. **Corepack pinning:** add a `packageManager` field + commit it so CI and
   every dev use the identical PM version. (D5)

## Acceptance criteria

- [ ] Chosen PM installed via Corepack with a pinned `packageManager` field.
- [ ] Release-age cooldown is **active and demonstrably enforced** (a test that
      tries to install a too-fresh version is rejected).
- [ ] `yarn.lock` removed; new lockfile committed; `node_modules` reproducible
      from a clean clone.
- [ ] All three native deps (node-pty, better-sqlite3, sharp) build and load at
      runtime (server boots, terminal PTY works, SQLite agent.db opens, avatar
      image processing works).
- [ ] `yarn build` / `yarn test` / `yarn lint` / `yarn tsc` equivalents pass
      under the new PM, locally and in CI.
- [ ] PM2 production launch (`scripts/start-with-ssh.sh`) works under the new PM.
- [ ] All 70 `yarn `-referencing files updated (or the PM aliased so existing
      docs stay accurate) — see Phase 4.
- [ ] CI workflows updated (`pnpm/action-setup` or Corepack enable, `cache:`
      key, install + script invocations).

## Phased implementation plan (each phase ≤5 files where practical; verify before next)

- **Phase 0 — Live feature verification (no code).** Resolve D1/D2. Confirm the
  cooldown key + version for the chosen PM against current upstream docs. If the
  chosen PM can't do it, re-pick. Output: a short decision note appended here.
- **Phase 1 — Local migration spike on a branch.** Enable Corepack, add
  `packageManager`, generate the new lockfile, get a clean install with native
  deps building. Boot the server, exercise PTY + SQLite + sharp. This is the
  go/no-go gate — if native deps can't be made to build, stop and reassess.
- **Phase 2 — Cooldown + build-script policy.** Add the cooldown config and (pnpm)
  the `onlyBuiltDependencies` allowlist. Add a regression test that proves the
  cooldown rejects a too-fresh version.
- **Phase 3 — CI.** Update `ci.yml` and `test-installers.yml`: install step,
  cache key, script invocations. Keep `persist-credentials: false` (already
  added 2026-05-28). Confirm green on a PR.
- **Phase 4 — Docs/scripts sweep.** Update the 70 `yarn `-referencing files
  (README, CONTRIBUTING, CLAUDE.md, install/update scripts, PM2 wrapper, test
  docs, scenario rules). Decide whether to keep a `yarn`→new-PM shim for muscle
  memory or rewrite commands outright.
- **Phase 5 — Cleanup.** Remove yarn-specific artifacts; verify a from-scratch
  clone + install + build + test on a clean machine/container.

## Risks & mitigations

| Risk | Severity | Mitigation |
|------|----------|------------|
| Native deps (node-pty/better-sqlite3/sharp) fail to build under new PM | **HIGH** | Phase 1 is an explicit go/no-go gate before any irreversible change; keep yarn.lock recoverable until Phase 5 |
| pnpm strict node_modules breaks Next.js or a transitive dep | MED | Start strict, fall back to `hoisted` per-package; full app smoke test in Phase 1 |
| Cooldown feature absent/renamed in chosen PM at real version | MED | Phase 0 verifies before any migration work; re-pick PM if needed |
| Cooldown window too aggressive → blocks legit urgent security patches | LOW-MED | Use `*-exclude` allowlist for trusted/internal packages; pick a sane window (D2) |
| 70-file doc/script drift leaves contributors with broken `yarn` commands | LOW | Phase 4 sweep + optional shim; CONTRIBUTING updated first |
| PM2 `start-with-ssh.sh` hardcodes `yarn` | LOW | Audited in Phase 1; trivial edit |

## Security considerations

- The cooldown is the **primary security deliverable** — without a demonstrable
  rejection of too-fresh versions, the migration has not achieved its purpose.
- pnpm's default build-script blocking is a real net gain but is **double-edged**
  here: the three native deps legitimately need build scripts, so the
  allowlist must be curated, not disabled wholesale (`dangerouslyAllowAllBuilds`
  or `enable-pre-post-scripts=true` would throw away the benefit).
- Keep `yarn.lock` in git history (do not force-rewrite) until Phase 5 so the
  exact pre-migration dependency set remains auditable and reproducible.

## Test scenarios

1. Clean clone → install → `next build` succeeds.
2. Server boots; open a terminal → node-pty PTY streams (proves native build).
3. Agent DB opens (better-sqlite3 native binding loads).
4. Avatar/image processing path works (sharp native binding loads).
5. Cooldown regression: attempt to add a version published < window seconds ago
   → install is rejected with a clear cooldown error.
6. CI green on a PR (both workflows).
7. PM2 production start via `scripts/start-with-ssh.sh` boots the app.

## Out of scope

- Converting the project to a monorepo / workspaces (it is single-package today).
- Changing the Node version policy (`>=22.0.0` stays).
- The inert `.npmrc` keys from the original finding — explicitly rejected for
  Yarn v1; the chosen PM's own config replaces them.
