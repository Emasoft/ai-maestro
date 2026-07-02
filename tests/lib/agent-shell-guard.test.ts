/**
 * Unit tests for the agent shell guard.
 *
 * These tests cover:
 *   - the script-string contract (versioning, AGENT_WORK_DIR fail-open,
 *     allowlist content),
 *   - the atomic installer's idempotency + write-on-missing semantics.
 *
 * They do NOT execute the bash script — the only practical way to do
 * that would be to spawn bash and exercise the cd-override against
 * real paths, which is out of scope for vitest. The script's
 * behaviour is exercised end-to-end by SCEN-* (manual) when an agent
 * is woken.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { promises as fs } from 'fs'
import path from 'path'
import os from 'os'

import {
  SHELL_GUARD_SCRIPT,
  SHELL_GUARD_VERSION,
} from '@/lib/agent-shell-guard'

import {
  ensureShellGuardInstalled,
  resetShellGuardInstallForTests,
  SHELL_GUARD_INSTALL_PATH,
} from '@/lib/agent-shell-guard-install'

describe('SHELL_GUARD_SCRIPT', () => {
  it('embeds the canonical version string', () => {
    expect(SHELL_GUARD_SCRIPT).toContain(`agent shell guard — version ${SHELL_GUARD_VERSION}`)
  })

  it('fails open when AGENT_WORK_DIR is unset', () => {
    expect(SHELL_GUARD_SCRIPT).toContain('if [ -z "${AGENT_WORK_DIR:-}" ]')
    expect(SHELL_GUARD_SCRIPT).toContain('return 0 2>/dev/null || exit 0')
  })

  it('allowlists $AGENT_WORK_DIR + /tmp + /private/tmp + /var/folders', () => {
    // The case-glob lines look like `"$__aim_workdir_resolved"|"$__aim_workdir_resolved"/*)`
    expect(SHELL_GUARD_SCRIPT).toContain('"$__aim_workdir_resolved"/*')
    expect(SHELL_GUARD_SCRIPT).toContain('/tmp/*')
    expect(SHELL_GUARD_SCRIPT).toContain('/private/tmp/*')
    expect(SHELL_GUARD_SCRIPT).toContain('/var/folders/*')
  })

  it('overrides cd AND pushd, leaves popd untouched', () => {
    expect(SHELL_GUARD_SCRIPT).toContain('\ncd() {')
    expect(SHELL_GUARD_SCRIPT).toContain('\npushd() {')
    expect(SHELL_GUARD_SCRIPT).not.toContain('\npopd() {')
  })

  it('uses subshell builtin cd for path resolution (no parent PWD mutation)', () => {
    expect(SHELL_GUARD_SCRIPT).toContain('builtin cd "$target" 2>/dev/null && builtin pwd -P')
  })

  it('exports __AIM_SHELL_GUARD_LOADED so wake path can sanity-check', () => {
    expect(SHELL_GUARD_SCRIPT).toContain('__AIM_SHELL_GUARD_LOADED=1')
    expect(SHELL_GUARD_SCRIPT).toContain('export __AIM_SHELL_GUARD_LOADED')
  })
})

describe('ensureShellGuardInstalled', () => {
  let tmpDir: string
  let mockHome: string
  const ORIGINAL_HOME = os.homedir()
  const expectedPath = SHELL_GUARD_INSTALL_PATH

  beforeEach(async () => {
    // Use a real temp dir as $HOME for the duration of each test so
    // ensureShellGuardInstalled writes there and we can inspect the
    // result without touching the dev machine's actual ~/.aimaestro.
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'aim-shell-guard-'))
    mockHome = tmpDir
    process.env.HOME = mockHome
    resetShellGuardInstallForTests()
  })

  afterEach(async () => {
    process.env.HOME = ORIGINAL_HOME
    await fs.rm(tmpDir, { recursive: true, force: true })
  })

  it('writes the script when the file is missing', async () => {
    // SHELL_GUARD_INSTALL_PATH is captured at module-import time, so
    // it points at the REAL home, not mockHome. We therefore can only
    // check the content of the path we got, which lives at the real
    // ~/.aimaestro/agent-shell-guard.sh. Backup the existing file (if
    // any), run install, verify, restore.
    let backup: string | null = null
    try {
      backup = await fs.readFile(expectedPath, 'utf8')
    } catch {
      // No existing file — that's fine.
    }
    try {
      await fs.unlink(expectedPath).catch(() => { /* may not exist */ })
      await ensureShellGuardInstalled()
      const written = await fs.readFile(expectedPath, 'utf8')
      expect(written).toBe(SHELL_GUARD_SCRIPT)
    } finally {
      if (backup !== null) {
        await fs.writeFile(expectedPath, backup, { encoding: 'utf8', mode: 0o600 })
      }
    }
  })

  it('is idempotent — second call does NOT rewrite if version matches', async () => {
    let backup: string | null = null
    try {
      backup = await fs.readFile(expectedPath, 'utf8')
    } catch {
      // No existing file — fine.
    }
    try {
      await ensureShellGuardInstalled()
      const stat1 = await fs.stat(expectedPath)
      const mtime1 = stat1.mtimeMs

      // Reset the in-memory `installed` flag so the function attempts
      // the work again, then verify the file was NOT touched.
      resetShellGuardInstallForTests()
      // sleep 5ms so any rewrite would produce a different mtime
      await new Promise(resolve => setTimeout(resolve, 5))
      await ensureShellGuardInstalled()
      const stat2 = await fs.stat(expectedPath)
      expect(stat2.mtimeMs).toBe(mtime1)
    } finally {
      if (backup !== null) {
        await fs.writeFile(expectedPath, backup, { encoding: 'utf8', mode: 0o600 })
      }
    }
  })
})
