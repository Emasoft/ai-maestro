import { describe, it, expect, vi } from 'vitest'
import { execFileSync } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * server.mjs boot wiring — TRDD-7IJ08EUV, closing the acceptance box "A production
 * build refuses to start if a dev-mode token is present."
 *
 * lib/dev-mode-token.ts exports the pure check, assertDevModeAbsentInProduction(),
 * and tests/unit/dev-mode-token.test.ts already pins its logic (throws when
 * NODE_ENV=production and a token is enabled OR merely issued-but-parked). What
 * THIS file pins is the WIRING that box actually requires: that server.mjs calls
 * that check, as the very first executable statement in the file — before
 * hostname/port are read, before `await import('next')`, before the headless
 * router is imported — so it fires identically for both server modes (`yarn
 * start` full mode and `yarn headless`, both `tsx server.mjs`) and can never
 * race a bound listener.
 *
 * NEGATIVE CASE is a REAL subprocess spawn of the real server.mjs (via the `tsx`
 * CLI already on PATH), with NODE_ENV=production and a fake dev token enabled in
 * a throwaway $HOME. This is safe under this task's "never start the real
 * server" constraint precisely BECAUSE the guard is the first executable
 * statement in the file: assertDevModeAbsentInProduction() throws,
 * server.mjs's own catch logs `[SECURITY] ...` and calls process.exit(1), and
 * the process is dead before it ever reads hostname/port, before it imports
 * `next`, before any socket exists. The static ordering test below (which reads
 * server.mjs's own source, not a comment about it) is what proves that ordering
 * holds structurally rather than by luck of this one run.
 *
 * POSITIVE CASE (no token present) is deliberately NOT a subprocess spawn: with
 * no token the guard passes silently and the real server.mjs would carry
 * straight on into hostname/port resolution and eventually `server.listen(...)`
 * — an actually-bound port, forbidden here. So the positive leg calls the
 * exported pure check in-process instead, which is the documented fallback
 * ("or calls the exported pure check") — combined with the same static
 * ordering check, this still proves the wiring: the ordering test shows the
 * call is unconditionally reached before any startup side effect, and the
 * pure-check test shows that call does not throw when no token is present.
 *
 * NEUTER RUN (recorded 2026-09-10, TRDD-7IJ08EUV, actually executed twice —
 * see the correction below): server.mjs's guard block was changed to
 *   try { await import('./lib/dev-mode-token.ts') } catch (err) { ... }
 * i.e. the call to `assertDevModeAbsentInProduction()` was DELETED outright
 * (not commented out — a comment containing the literal text would have made
 * the static-ordering test below pass vacuously, since it string-searches the
 * source; see the FIRST attempt below, which is exactly this mistake caught
 * and corrected). Measured result, re-running this file against that diff:
 *   - 'refuses to boot in production when a dev-mode token is present' (the
 *     subprocess test) FAILED on `expect(stderr).toContain('[SECURITY]')` —
 *     the neutered server.mjs no longer refused at the guard; it fell through
 *     into full-mode startup and crashed ~20s later on an UNRELATED error
 *     (next's "Could not find a production build in the '.next' directory" —
 *     this worktree has no build). Note `expect(error?.status).not.toBe(0)`
 *     STAYED GREEN under the neuter (a non-zero exit still happened, just for
 *     the wrong reason 20s later) — a weaker assertion checking only exit
 *     code would have missed this neuter entirely, which is exactly why the
 *     FATAL-message assertion is required. (The crash was inside
 *     `app.prepare()`, before `server.listen()` — no port was ever bound in
 *     this run; that is incidental to this worktree lacking a `.next` build,
 *     not something the test relies on for safety.)
 *   - 'the guard call precedes ...' (the static ordering test) FAILED on
 *     `expect(guardIdx).toBeGreaterThan(-1)` — the literal call-site
 *     substring `assertDevModeAbsentInProduction()` was genuinely absent from
 *     the source once the call itself (not just a comment mentioning it) was
 *     removed.
 *   - 'does not block boot ... — pure-check positive control' STAYED GREEN,
 *     exactly as expected: it calls the exported function directly, and this
 *     neuter only removed server.mjs's CALL to it, never the function itself.
 * Restored immediately after; `git diff server.mjs` was empty before the next
 * commit (verified).
 *
 * CORRECTION — the neuter was first attempted by COMMENTING OUT the call
 * (`// assertDevModeAbsentInProduction()`) rather than deleting it. Under
 * that shape only the subprocess test went red; the static-ordering test
 * stayed GREEN, because its `indexOf('assertDevModeAbsentInProduction()')`
 * matched the commented-out text just as readily as real code — a neuter
 * that leaves the exact needle sitting in a comment does not exercise
 * whether the check discriminates code from prose. Re-running with the call
 * line deleted outright (the version recorded above) is what actually pins
 * the static test; the comment-based attempt is recorded here only because a
 * false "it passed" was briefly written down and this correction is the
 * record of catching it before it shipped.
 */

const REPO_ROOT = join(__dirname, '..', '..')
const SERVER_MJS = join(REPO_ROOT, 'server.mjs')
const SERVER_MJS_SOURCE = readFileSync(SERVER_MJS, 'utf-8')

// An obviously-fake, never-real 64-hex-char "hash" — this is test fixture data,
// not a secret. getDevTokenStatus() only checks its length (HASH_HEX_LEN=64) and
// that it is a string; the plaintext token it would correspond to never exists.
const FAKE_TOKEN_HASH = 'f'.repeat(64)

/** Write a minimal-but-loadable governance.json directly under <homeDir>/.aimaestro. */
function seedGovernance(homeDir: string, devModeLogin: Record<string, unknown> | null): void {
  const stateDir = join(homeDir, '.aimaestro')
  mkdirSync(stateDir, { recursive: true })
  const config: Record<string, unknown> = { version: 1, userName: 'trdd-7ij08euv-fixture' }
  if (devModeLogin) config.devModeLogin = devModeLogin
  writeFileSync(join(stateDir, 'governance.json'), JSON.stringify(config, null, 2))
}

describe('server.mjs boot wiring — dev-mode token guard (TRDD-7IJ08EUV)', () => {
  it('refuses to boot in production when a dev-mode token is present — real subprocess spawn of server.mjs', () => {
    const home = mkdtempSync(join(tmpdir(), 'aim-server-boot-guard-neg-'))
    try {
      seedGovernance(home, {
        enabled: true,
        tokenHash: FAKE_TOKEN_HASH,
        createdAt: new Date().toISOString(),
        lastUsedAt: null,
      })

      let error: (Error & { status?: number | null; stderr?: Buffer | string }) | undefined
      try {
        execFileSync('tsx', [SERVER_MJS], {
          cwd: REPO_ROOT,
          env: { ...process.env, HOME: home, NODE_ENV: 'production' },
          timeout: 20_000,
          encoding: 'utf-8',
        })
      } catch (err) {
        error = err as typeof error
      }

      // Positive control INSIDE the same assertion: a test asserting only
      // "exit !== 0" would also pass if server.mjs crashed for an unrelated
      // reason (a missing dependency, a syntax error) — so match the exact
      // refusal message the pure check throws, not just non-zero exit.
      expect(error, 'server.mjs must exit non-zero — it did not exit at all (or ran to success)').toBeDefined()
      expect(error?.status).not.toBe(0)
      const stderr = String(error?.stderr ?? '')
      expect(stderr).toContain('[SECURITY]')
      expect(stderr).toContain('FATAL: a dev-mode login token is present')
    } finally {
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('does not block boot in production when no dev-mode token is present — pure-check positive control', async () => {
    const home = mkdtempSync(join(tmpdir(), 'aim-server-boot-guard-pos-'))
    try {
      seedGovernance(home, null)
      vi.stubEnv('HOME', home)
      vi.stubEnv('NODE_ENV', 'production')
      vi.resetModules()
      const { assertDevModeAbsentInProduction } = await import('@/lib/dev-mode-token')
      expect(() => assertDevModeAbsentInProduction()).not.toThrow()
    } finally {
      vi.unstubAllEnvs()
      rmSync(home, { recursive: true, force: true })
    }
  })

  it('the guard call precedes port/hostname reads and the next/headless-router imports — static ordering, the reason the subprocess spawn above is safe', () => {
    const guardIdx = SERVER_MJS_SOURCE.indexOf('assertDevModeAbsentInProduction()')
    const hostnameIdx = SERVER_MJS_SOURCE.indexOf("process.env.HOSTNAME")
    const portIdx = SERVER_MJS_SOURCE.indexOf("parseInt(process.env.PORT")
    const listenIdx = SERVER_MJS_SOURCE.indexOf('server.listen(')
    const nextImportIdx = SERVER_MJS_SOURCE.indexOf("await import('next')")
    const headlessImportIdx = SERVER_MJS_SOURCE.indexOf("./services/headless-router.ts")

    expect(guardIdx).toBeGreaterThan(-1)
    expect(hostnameIdx).toBeGreaterThan(-1)
    expect(portIdx).toBeGreaterThan(-1)
    expect(listenIdx).toBeGreaterThan(-1)
    expect(nextImportIdx).toBeGreaterThan(-1)
    expect(headlessImportIdx).toBeGreaterThan(-1)

    expect(guardIdx).toBeLessThan(hostnameIdx)
    expect(guardIdx).toBeLessThan(portIdx)
    expect(guardIdx).toBeLessThan(listenIdx)
    expect(guardIdx).toBeLessThan(nextImportIdx)
    expect(guardIdx).toBeLessThan(headlessImportIdx)
  })
})
