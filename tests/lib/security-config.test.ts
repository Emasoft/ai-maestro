/**
 * Unit tests for lib/security-config.ts — SUDO-03 sessionAuth TTL clamp.
 *
 * A tampered encrypted config (or a crafted PATCH body) must not be able to
 * push sudoTokenTtlSeconds / sessionTtlDays out of their safe ranges. The
 * clamp runs on the DECRYPT path (defense-in-depth alongside the PATCH Zod
 * schema), so we round-trip a tampered config through save → unlock and assert
 * the loaded values are clamped.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'fs'

// security-config.ts computes CONFIG_PATH = join(getStateDir(), 'security-config.enc')
// at module-load time, so getStateDir MUST be mocked before the import below.
// vi.mock is hoisted above module init, so the tmp dir is created inside
// vi.hoisted (which runs before the hoisted mock factory).
const { TMP_DIR } = vi.hoisted(() => {
  const osMod = require('os') as typeof import('os')
  const pathMod = require('path') as typeof import('path')
  const fsMod = require('fs') as typeof import('fs')
  return { TMP_DIR: fsMod.mkdtempSync(pathMod.join(osMod.tmpdir(), 'aim-secconf-')) }
})
vi.mock('@/lib/ecosystem-constants', () => ({
  getStateDir: () => TMP_DIR,
}))

import {
  unlockSecurityConfig,
  saveSecurityConfig,
  loadSecurityConfig,
  lockSecurityConfig,
  resetSecurityConfigCache,
  getSecurityDefaults,
} from '@/lib/security-config'

const PASSWORD = 'test-governance-password'

afterAll(() => {
  try {
    fs.rmSync(TMP_DIR, { recursive: true, force: true })
  } catch {
    /* best effort */
  }
})

beforeAll(() => {
  // Establish an unlocked baseline so saveSecurityConfig can encrypt with PASSWORD.
  unlockSecurityConfig(PASSWORD)
})

describe('clampConfig — sessionAuth (SUDO-03)', () => {
  it('clamps sudoTokenTtlSeconds=99999 down to 600 on load', () => {
    const tampered = getSecurityDefaults()
    tampered.sessionAuth.sudoTokenTtlSeconds = 99999
    saveSecurityConfig(tampered, PASSWORD)

    // Force a real decrypt-from-disk: clear caches then unlock again.
    lockSecurityConfig()
    resetSecurityConfigCache()
    const ok = unlockSecurityConfig(PASSWORD)
    expect(ok).toBe(true)
    expect(loadSecurityConfig().sessionAuth.sudoTokenTtlSeconds).toBe(600)
  })

  it('clamps sudoTokenTtlSeconds=1 up to 10 on load', () => {
    const tampered = getSecurityDefaults()
    tampered.sessionAuth.sudoTokenTtlSeconds = 1
    saveSecurityConfig(tampered, PASSWORD)

    lockSecurityConfig()
    resetSecurityConfigCache()
    expect(unlockSecurityConfig(PASSWORD)).toBe(true)
    expect(loadSecurityConfig().sessionAuth.sudoTokenTtlSeconds).toBe(10)
  })

  it('clamps sessionTtlDays out-of-range values into [1, 90]', () => {
    const tooBig = getSecurityDefaults()
    tooBig.sessionAuth.sessionTtlDays = 9999
    saveSecurityConfig(tooBig, PASSWORD)
    lockSecurityConfig()
    resetSecurityConfigCache()
    unlockSecurityConfig(PASSWORD)
    expect(loadSecurityConfig().sessionAuth.sessionTtlDays).toBe(90)

    const tooSmall = getSecurityDefaults()
    tooSmall.sessionAuth.sessionTtlDays = 0
    saveSecurityConfig(tooSmall, PASSWORD)
    lockSecurityConfig()
    resetSecurityConfigCache()
    unlockSecurityConfig(PASSWORD)
    expect(loadSecurityConfig().sessionAuth.sessionTtlDays).toBe(1)
  })

  it('leaves an in-range sudoTokenTtlSeconds untouched', () => {
    const sane = getSecurityDefaults()
    sane.sessionAuth.sudoTokenTtlSeconds = 120
    saveSecurityConfig(sane, PASSWORD)
    lockSecurityConfig()
    resetSecurityConfigCache()
    unlockSecurityConfig(PASSWORD)
    expect(loadSecurityConfig().sessionAuth.sudoTokenTtlSeconds).toBe(120)
  })
})
