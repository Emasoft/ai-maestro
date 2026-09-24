import { describe, it, expect, vi } from 'vitest'
import { spawn } from 'child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * CONVERTED 2026-09-24 (TRDD-7IJ08EUV `## Approval log`, owner ruling this session): the
 * boot call to assertDevModeAbsentInProduction() was REMOVED from server.mjs per that ruling —
 * a dev-mode token normally requires passing the passkey check to mint, and agents need one to
 * drive this server's UI while development is under way (though a hand-written governance.json
 * can self-mint one outside that flow — the card's own Findings). This file now pins the
 * NEGATIVE outcome: server.mjs no longer refuses to boot on a dev-mode token's presence. The
 * pure check function itself is UNCHANGED in lib/dev-mode-token.ts (still pinned by
 * tests/unit/dev-mode-token.test.ts), kept for re-wiring here once development ends.
 *
 * server.mjs boot wiring — TRDD-7IJ08EUV, formerly closing the acceptance box "A production
 * build refuses to start if a dev-mode token is present" (now superseded per the ruling above).
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
 * NEGATIVE CASE (post-conversion) is still a REAL subprocess spawn of the real server.mjs
 * (via the `tsx` CLI already on PATH), with NODE_ENV=production and a fake dev token
 * enabled in a throwaway $HOME — but the guard is now GONE, so the old safety argument
 * ("the guard exits before any socket exists") no longer holds. Safety instead comes from
 * killing the child (SIGKILL) the instant it produces its first byte of output: nothing in
 * server.mjs prints anything before the guard's old location, so any output at all is
 * already past that point, and the kill lands long before app.prepare()/server.listen()
 * could run. A distinct, non-23000 PORT is set too, as a second line of defense. See the
 * test body's own SAFETY DESIGN comment for the measured reason a pre-bound "busy port"
 * alone was tried first and rejected (it did not actually block the bind on this platform).
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
  it(
    'does NOT refuse to boot in production when a dev-mode token is present — real subprocess of server.mjs, killed at first output before it can ever reach server.listen() (owner ruling 2026-09-24)',
    async () => {
      // SAFETY DESIGN — measured, not assumed (2026-09-24): an earlier draft of this test
      // handed server.mjs a PORT it had pre-bound itself, expecting server.listen() to fail
      // with EADDRINUSE. Manually probed: it did NOT fail — the child bound the SAME port
      // successfully anyway (observed "> Ready on http://127.0.0.1:<port>" plus real side
      // effects: key rotation, marketplace calls) and ran a genuinely live production server.
      // A pre-bound "busy port" is therefore NOT a safe guarantee on this platform/Node combo.
      //
      // Instead: nothing in server.mjs prints ANYTHING before the (removed) guard's old
      // location — it was the very first executable statement after two silent handler
      // registrations. So the FIRST byte of stdout/stderr the child ever produces is, by
      // construction, already past that point, and the child is SIGKILL'd the instant that
      // byte arrives — long before app.prepare()/server.listen() can run (those require
      // seconds of real work: Next.js prepare, host-key generation, ledger verification).
      // A distinct, far-from-23000 PORT is set too, purely as a second line of defense in
      // case the kill ever raced a real bind.
      const home = mkdtempSync(join(tmpdir(), 'aim-server-boot-guard-neg-'))
      try {
        seedGovernance(home, {
          enabled: true,
          tokenHash: FAKE_TOKEN_HASH,
          createdAt: new Date().toISOString(),
          lastUsedAt: null,
        })

        const env: NodeJS.ProcessEnv = {
          ...process.env,
          HOME: home,
          NODE_ENV: 'production',
          PORT: '58217', // arbitrary, far from the real server's 23000 — belt-and-braces
          HOSTNAME: '127.0.0.1',
        }
        delete env.MAESTRO_MODE // force full mode — the guard used to sit before this branch too

        const output = await new Promise<string>((resolve, reject) => {
          // detached: true makes `child` the leader of its OWN process group, so
          // `process.kill(-child.pid, ...)` below reaches every process in that group —
          // tsx AND the node process it internally spawns to actually run server.mjs
          // (confirmed necessary by a real leak: killing only `child` with SIGKILL left
          // that inner node process alive and reparented to pid 1, still listening, because
          // SIGKILL gives tsx no chance to forward the signal to its own child).
          const child = spawn('tsx', [SERVER_MJS], { cwd: REPO_ROOT, env, detached: true })
          let chunks = ''
          let killed = false
          const killGroup = () => {
            if (killed) return
            killed = true
            try {
              if (child.pid) process.kill(-child.pid, 'SIGKILL')
            } catch {
              // group already gone (e.g. process.kill(-pid) after the process already exited) — fine
            }
          }
          const onFirstData = (data: Buffer) => {
            chunks += data.toString('utf-8')
            killGroup()
          }
          child.stdout?.on('data', onFirstData)
          child.stderr?.on('data', onFirstData)
          const timer = setTimeout(() => {
            killGroup()
            reject(new Error('server.mjs produced no output within 10s — cannot prove forward progress'))
          }, 10_000)
          child.on('error', (err) => {
            clearTimeout(timer)
            killGroup()
            reject(err)
          })
          child.on('exit', () => {
            clearTimeout(timer)
            // The direct child (tsx) exiting doesn't guarantee its inner node process is
            // dead too — kill the whole group unconditionally before resolving.
            killGroup()
            resolve(chunks)
          })
        })

        // The POSITIVE marker: any output at all, since nothing precedes the removed
        // guard's location. The NEGATIVE assertions: the guard's own refusal text is absent.
        expect(output.length, 'server.mjs must have printed something before being killed').toBeGreaterThan(0)
        expect(output).not.toContain('[SECURITY]')
        expect(output).not.toContain('FATAL: a dev-mode login token is present')
      } finally {
        rmSync(home, { recursive: true, force: true })
      }
    },
    15_000
  )

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

  it('server.mjs no longer calls assertDevModeAbsentInProduction — TRDD-7IJ08EUV owner ruling 2026-09-24', () => {
    // A source-scan, not a code-execution test — mirrors the old static-ordering test's own
    // method (reads server.mjs's own text) so this stays non-vacuous even against a call
    // hidden in a comment (see the CORRECTION note above this describe block): a call site
    // MUST be the literal, uncommented text, and this asserts that text is gone.
    expect(SERVER_MJS_SOURCE).not.toContain('assertDevModeAbsentInProduction()')
  })
})
