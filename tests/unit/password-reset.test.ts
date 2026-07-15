import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { NextRequest } from 'next/server'

/**
 * The presence-only forgot-password reset (TRDD-P7XKV3N9 sibling).
 *
 * The load-bearing claims: (1) a REMOTE peer can NEVER reset — console presence is
 * the ONLY factor, so dropping it is a remote takeover; (2) the reset needs NO old
 * password — the code + console IS the authorization; (3) a wrong code changes
 * nothing. governance + security-config + peer-address + rate-limit run REAL against
 * a throwaway $HOME; only the code channel and the session minter are stubbed (their
 * own suites cover them) so this suite exercises the ROUTE's gates.
 */

const CONSOLE = '127.0.0.1'
const REMOTE = '100.64.0.1' // Tailscale CGNAT — reachable on the VPN but NOT the console
const GOOD_CODE = '123456'
const FAR_FUTURE = 9_999_999_999_999

function makeReq(peer: string, body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/governance/password/reset', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-aim-peer': peer },
    body: JSON.stringify(body),
  })
}

// Passkey stub state — set per test BEFORE loadRoute(). The webauthn mock's vi.fn closures read
// these each call, so a passkey test controls whether a credential is "registered" and whether
// the assertion "verifies", without touching real WebAuthn crypto (its own suite covers that).
let passkeyHasCreds = false
let passkeyVerify: () => Promise<unknown> = async () => ({ newCounter: 1 })

// Stub the code channel (startSetupFlow "delivers"; verifySetupCode accepts only GOOD_CODE),
// the session minter, AND the WebAuthn server module — before importing the route, after
// resetModules. The webauthn stub mirrors how the code channel is stubbed: the route's gates
// are exercised for real; only the external crypto/delivery is faked.
function stubChannelAndSession() {
  vi.doMock('@/lib/setup-bootstrap', () => ({
    // Channel-aware: the console method passes no email → 'file'; the email method passes
    // { email } → 'email'. Mirrors the real dispatchCode branching.
    startSetupFlow: vi.fn(async (opts?: { email?: string; purpose?: string }) => ({
      channel: opts?.email ? 'email' : 'file',
      hint: opts?.email ? 'sent to your recovery email' : 'read ~/.aimaestro/setup-code.txt',
      expiresAt: FAR_FUTURE,
    })),
    verifySetupCode: vi.fn((code: string) => (code === GOOD_CODE ? { ok: true } : { ok: false, reason: 'mismatch' })),
    isSetupCodePending: vi.fn(() => true),
  }))
  vi.doMock('@/lib/session-auth', () => ({
    createSession: vi.fn(async () => 'test-session-token'),
    buildSessionCookie: vi.fn((t: string) => `aim_session=${t}; HttpOnly; Path=/`),
  }))
  vi.doMock('@/lib/webauthn-server', () => ({
    hasRegisteredCredentials: vi.fn(() => passkeyHasCreds),
    // Real generateWebAuthnAuthenticationOptions stores a challenge and returns request options;
    // here we just return an options-shaped object so call-1 can hand it to the client.
    generateWebAuthnAuthenticationOptions: vi.fn(async () => ({
      challenge: 'stub-challenge',
      rpId: 'localhost',
      allowCredentials: [],
      timeout: 60_000,
      userVerification: 'preferred',
    })),
    // Resolves (assertion valid) or rejects (invalid) per the passkeyVerify the test installs.
    verifyWebAuthnAuthentication: vi.fn(async () => passkeyVerify()),
  }))
}

async function loadRoute() {
  stubChannelAndSession()
  return (await import('@/app/api/governance/password/reset/route')).POST
}

let dir: string

beforeEach(() => {
  // Same guard as password-invalidation.test.ts: governance computes its file path
  // from $HOME at module load, so stub HOME and reset the registry BEFORE any import,
  // or the test rewrites the developer's real ~/.aimaestro/governance.json.
  dir = mkdtempSync(join(tmpdir(), 'aim-reset-'))
  vi.stubEnv('HOME', dir)
  vi.resetModules()
  // Reset passkey stub state to safe defaults so a prior test can't leak into the next.
  passkeyHasCreds = false
  passkeyVerify = async () => ({ newCounter: 1 })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

describe('POST /api/governance/password/reset — presence-only forgot-password reset', () => {
  it('refuses a REMOTE peer with 403 and dispatches no code — console is the only factor', async () => {
    const POST = await loadRoute()
    const sb = await import('@/lib/setup-bootstrap')
    const res = await POST(makeReq(REMOTE, {}))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('console_required')
    // A remote caller must never even trigger code delivery (no oracle, no notification spam).
    expect(sb.startSetupFlow).not.toHaveBeenCalled()
  })

  it('call-1 {} from the console delivers a code and returns codeRequired — never the code itself', async () => {
    const POST = await loadRoute()
    const res = await POST(makeReq(CONSOLE, {}))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.codeRequired).toBe(true)
    expect(j.channel).toBe('file')
    expect(j).not.toHaveProperty('code')
  })

  it('resets the password with NO old password — the console + code is the whole authorization', async () => {
    const POST = await loadRoute()
    const g = await import('@/lib/governance')
    // A password the user has FORGOTTEN is sitting on disk.
    await g.setPassword('the-forgotten-one')
    expect(await g.verifyPassword('the-forgotten-one')).toBe(true)

    // Note: the request carries the code and the new password — but NOT the old one.
    const res = await POST(makeReq(CONSOLE, { code: GOOD_CODE, newPassword: 'a-brand-new-password' }))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.reset).toBe(true)
    // Auto-login — the caller lands in the app with a fresh session.
    expect(res.headers.get('set-cookie')).toMatch(/aim_session=/)
    // The new password works; the forgotten one is dead — and we never supplied it.
    expect(await g.verifyPassword('a-brand-new-password')).toBe(true)
    expect(await g.verifyPassword('the-forgotten-one')).toBe(false)
    expect(g.isPasswordInvalidated()).toBe(false)
  })

  it('reports securityPolicyReset when the config exists but is locked (the true forgot case)', async () => {
    const POST = await loadRoute()
    const g = await import('@/lib/governance')
    const sc = await import('@/lib/security-config')
    // Reproduce the real forgot state: a password (and its encrypted security-config)
    // were set earlier, but nobody has logged in this process — so the config is LOCKED
    // (isUnlocked() === false) and its blob is keyed to the password we no longer have.
    await g.setPassword('the-forgotten-one')
    sc.lockSecurityConfig()
    expect(sc.isUnlocked()).toBe(false)

    const res = await POST(makeReq(CONSOLE, { code: GOOD_CODE, newPassword: 'a-brand-new-password' }))
    const j = await res.json()
    expect(j.reset).toBe(true)
    // The orphaned blob can't be re-encrypted, so policy reverts to defaults — reported honestly.
    expect(j.securityPolicyReset).toBe(true)
    // The new password still works afterwards.
    expect(await g.verifyPassword('a-brand-new-password')).toBe(true)
  })

  it('rejects a wrong code with 401 and leaves the password untouched', async () => {
    const POST = await loadRoute()
    const g = await import('@/lib/governance')
    await g.setPassword('keep-me')
    const res = await POST(makeReq(CONSOLE, { code: '000000', newPassword: 'should-not-apply' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('code_mismatch')
    expect(await g.verifyPassword('keep-me')).toBe(true)
    expect(await g.verifyPassword('should-not-apply')).toBe(false)
  })

  it('requires a new password once a code is supplied (the code alone resets nothing)', async () => {
    const POST = await loadRoute()
    const res = await POST(makeReq(CONSOLE, { code: GOOD_CODE }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('new_password_required')
  })

  const VERIFIED_SMTP = { host: 'smtp.gmail.com', port: 465, secure: true, usernameFormat: 'full' as const }

  it('email method (REMOTE) with a verified recovery email delivers a code via email — no console gate', async () => {
    const POST = await loadRoute()
    const g = await import('@/lib/governance')
    await g.setRecoveryEmail('me@gmail.com', VERIFIED_SMTP)
    await g.setRecoveryEmailVerified()
    const res = await POST(makeReq(REMOTE, { method: 'email' }))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.codeRequired).toBe(true)
    expect(j.channel).toBe('email')
  })

  it('email method refuses (403) when no verified recovery email is configured', async () => {
    const POST = await loadRoute()
    const res = await POST(makeReq(REMOTE, { method: 'email' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('email_not_configured')
  })

  it('email method resets the password with a valid code from a REMOTE peer', async () => {
    const POST = await loadRoute()
    const g = await import('@/lib/governance')
    await g.setPassword('the-forgotten-one')
    await g.setRecoveryEmail('me@gmail.com', VERIFIED_SMTP)
    await g.setRecoveryEmailVerified()
    const res = await POST(makeReq(REMOTE, { method: 'email', code: GOOD_CODE, newPassword: 'a-brand-new-password' }))
    expect(res.status).toBe(200)
    expect((await res.json()).reset).toBe(true)
    expect(await g.verifyPassword('a-brand-new-password')).toBe(true)
  })

  it('email method refuses (403) BEFORE minting a code when the email is configured but UNVERIFIED', async () => {
    const POST = await loadRoute()
    const sb = await import('@/lib/setup-bootstrap')
    const g = await import('@/lib/governance')
    await g.setRecoveryEmail('me@gmail.com', VERIFIED_SMTP) // stored but NOT verified
    const res = await POST(makeReq(REMOTE, { method: 'email' }))
    expect(res.status).toBe(403)
    expect(sb.startSetupFlow).not.toHaveBeenCalled()
  })

  // ── Passkey method (TRDD-P7XKV3N9): a WebAuthn assertion replaces the code. Two-call flow
  // mirroring console/email — call-1 issues a challenge, call-2 verifies the assertion then runs
  // the SAME setPassword + auto-login tail. Possession of the authenticator is remote-capable, so
  // (like email) there is no console gate. The crypto is stubbed; these exercise the ROUTE's gates. ──

  const STUB_ASSERTION = {
    id: 'cred-1',
    rawId: 'cred-1',
    response: { clientDataJSON: 'eyJ0IjoxfQ', authenticatorData: 'YXV0aA', signature: 'c2ln' },
    clientExtensionResults: {},
    type: 'public-key',
  }

  it('passkey method refuses (403) when no passkey is registered — nothing to prove possession against', async () => {
    passkeyHasCreds = false
    const POST = await loadRoute()
    const res = await POST(makeReq(REMOTE, { method: 'passkey' }))
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('no_passkeys_registered')
  })

  it('passkey call-1 {method:passkey} with a registered passkey returns assertionRequired + options — never a secret', async () => {
    passkeyHasCreds = true
    const POST = await loadRoute()
    const res = await POST(makeReq(REMOTE, { method: 'passkey' }))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.assertionRequired).toBe(true)
    expect(j.options).toBeTruthy()
    expect(j).not.toHaveProperty('reset')
  })

  it('passkey resets the password with a valid assertion and NO old password — possession is the whole authorization', async () => {
    passkeyHasCreds = true
    passkeyVerify = async () => ({ newCounter: 2 })
    const POST = await loadRoute()
    const g = await import('@/lib/governance')
    // A password the user has FORGOTTEN is sitting on disk; the request carries the assertion and
    // the new password — but NOT the old one.
    await g.setPassword('the-forgotten-one')
    const res = await POST(makeReq(REMOTE, { method: 'passkey', assertion: STUB_ASSERTION, newPassword: 'a-brand-new-password' }))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.reset).toBe(true)
    // Auto-login — same tail as console/email.
    expect(res.headers.get('set-cookie')).toMatch(/aim_session=/)
    expect(await g.verifyPassword('a-brand-new-password')).toBe(true)
    expect(await g.verifyPassword('the-forgotten-one')).toBe(false)
  })

  it('passkey rejects an invalid assertion with 401 and leaves the password untouched', async () => {
    passkeyHasCreds = true
    passkeyVerify = async () => {
      throw new Error('webauthn_verification_failed: authentication response verification failed')
    }
    const POST = await loadRoute()
    const g = await import('@/lib/governance')
    await g.setPassword('keep-me')
    const res = await POST(makeReq(REMOTE, { method: 'passkey', assertion: STUB_ASSERTION, newPassword: 'should-not-apply' }))
    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('webauthn_verification_failed')
    expect(await g.verifyPassword('keep-me')).toBe(true)
    expect(await g.verifyPassword('should-not-apply')).toBe(false)
  })

  it('passkey requires a new password once an assertion is supplied (the assertion alone resets nothing)', async () => {
    passkeyHasCreds = true
    const POST = await loadRoute()
    const res = await POST(makeReq(REMOTE, { method: 'passkey', assertion: STUB_ASSERTION }))
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('new_password_required')
  })
})
