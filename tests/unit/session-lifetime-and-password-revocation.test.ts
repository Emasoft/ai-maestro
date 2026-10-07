/**
 * TRDD-32PK69ND: changing or invalidating the governance password ends every browser session.
 * TRDD-PN9LCNNG: sessions use the configured sessionAuth.sessionTtlDays, read at mint time.
 * Real lib/governance + lib/session-auth + lib/security-config; HOME is jailed under /tmp.
 */
import { describe, it, expect, vi } from 'vitest'

vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs')
  const os = require('os') as typeof import('os')
  const path = require('path') as typeof import('path')
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-sess-'))
  process.env.HOME = dir
  process.env.USERPROFILE = dir
})

import os from 'os'
import { setPassword, invalidatePassword } from '@/lib/governance'
import { createSession, validateSession, buildSessionCookie } from '@/lib/session-auth'
import { loadSecurityConfig, saveSecurityConfig, unlockSecurityConfig } from '@/lib/security-config'

describe('governance password revokes sessions (TRDD-32PK69ND)', () => {
  it('HOME jail is active', () => {
    expect(os.homedir()).toContain('aim-sess-')
  })

  it('an old session cookie is refused after setPassword', async () => {
    const token = await createSession()
    expect(validateSession(token)).toBe(true)
    await setPassword('new-password-1')
    expect(validateSession(token)).toBe(false)
  })

  it('an old session cookie is refused after invalidatePassword', async () => {
    await setPassword('new-password-0')
    const token = await createSession()
    expect(validateSession(token)).toBe(true)
    await invalidatePassword()
    expect(validateSession(token)).toBe(false)
  })

  it('a session minted after the change is valid', async () => {
    await setPassword('new-password-2')
    expect(validateSession(await createSession())).toBe(true)
  })
})

describe('session lifetime follows sessionAuth.sessionTtlDays (TRDD-PN9LCNNG)', () => {
  it('a shorter configured lifetime yields a shorter Max-Age and expires_at', async () => {
    await setPassword('lifetime-pass-1')
    expect(unlockSecurityConfig('lifetime-pass-1')).toBe(true)
    const cfg = loadSecurityConfig()
    const maxAge = () => Number(/Max-Age=(\d+)/.exec(buildSessionCookie('t'))![1])
    expect(maxAge()).toBe(cfg.sessionAuth.sessionTtlDays * 86400)

    cfg.sessionAuth.sessionTtlDays = 1
    saveSecurityConfig(cfg)
    expect(maxAge()).toBe(86400)

    // expires_at: minted under a 1-day lifetime, dead after 2 days (the 7-day default would survive).
    const now = Date.now()
    const token = await createSession()
    vi.useFakeTimers({ now: now + 2 * 86400_000, toFake: ['Date'] })
    try {
      expect(validateSession(token)).toBe(false)
    } finally {
      vi.useRealTimers()
    }
  })
})
