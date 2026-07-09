/**
 * TRDD-X8R2HP9D — a SUCCESSFUL sudo mint must not be charged like a failed
 * password guess.
 *
 * `POST /api/auth/sudo-password` used `checkAndRecordAttempt('sudo-password', 5)`
 * on a CONSTANT key and never called `resetRateLimit` on success. Since
 * `checkAndRecordAttempt` records every ALLOWED attempt (lib/rate-limit.ts says
 * so explicitly: "callers MUST call resetRateLimit(key) on success"), a correct
 * password consumed the same allowance as a wrong one.
 *
 * Sudo tokens are one-shot and bound to a single (method, pathTemplate), so each
 * strict operation costs exactly one mint. The result was a hard ceiling of
 * FIVE STRICT OPERATIONS PER MINUTE for the entire machine, on a key that was
 * not per-user, per-session, or per-IP. Deleting six agents 429'd on the sixth,
 * and the sudo modal surfaced it as a generic "Try again later".
 *
 * The fix keeps brute-force resistance exactly where it belongs: failed guesses
 * still accumulate, correct passwords reset the caller's own bucket. An attacker
 * who supplies the correct governance password has already won; charging them
 * for it protects nothing and only punishes the real user.
 *
 * This suite uses the REAL lib/rate-limit — mocking it would test the mock.
 *
 * FALSIFIED: delete `resetRateLimit(rateKey)` from the route and "six successive
 * successful mints" plus "success resets the subject bucket" both fail, while the
 * brute-force tests keep passing. That is the exact asymmetry the fix is for.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { checkRateLimit, resetRateLimit } from '@/lib/rate-limit'

const { mockAuth, mockSudo, mockKill } = vi.hoisted(() => ({
  mockAuth: {
    authenticateFromRequest: vi.fn(),
    buildAuthContext: vi.fn(),
  },
  mockSudo: {
    issueSudoToken: vi.fn(),
    countBySubject: vi.fn(() => 0),
  },
  mockKill: {
    isLockedDown: vi.fn(() => false),
    recordAuthFailure: vi.fn(),
    recordAuthSuccess: vi.fn(),
  },
}))

vi.mock('@/lib/agent-auth', () => mockAuth)
vi.mock('@/lib/sudo-auth', () => mockSudo)
vi.mock('@/lib/kill-switch', () => mockKill)
vi.mock('@/lib/security-registry', () => ({ matchedEntryKey: () => null }))
// '@/lib/rate-limit' is deliberately NOT mocked — the buckets are the subject.

import { POST } from '@/app/api/auth/sudo-password/route'
import { NextRequest } from 'next/server'

const GLOBAL_KEY = 'sudo-password:global'
const USER_A = 'user-a'
const USER_B = 'user-b'
const keyFor = (subject: string) => `sudo-password:${subject}`

/** Authenticate as a system-owner user with the given id. */
function asUser(userId: string) {
  mockAuth.authenticateFromRequest.mockReturnValue({ userId, userTitle: 'maestro' })
  mockAuth.buildAuthContext.mockReturnValue({ isSystemOwner: true, userId })
}

function withCorrectPassword() {
  mockSudo.issueSudoToken.mockResolvedValue({ token: 'st_1', expiresAt: Date.now() + 60_000 })
}

function withWrongPassword() {
  mockSudo.issueSudoToken.mockRejectedValue(new Error('sudo_mode_bad_password'))
}

function mint(password = 'pw') {
  const req = new NextRequest(new URL('http://localhost:23000/api/auth/sudo-password'), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ password }),
  } as never)
  return POST(req)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockKill.isLockedDown.mockReturnValue(false)
  mockSudo.countBySubject.mockReturnValue(0)
  // The limiter's Map is module state shared across tests in this file.
  resetRateLimit(GLOBAL_KEY)
  resetRateLimit(keyFor(USER_A))
  resetRateLimit(keyFor(USER_B))
  resetRateLimit(keyFor('system-owner'))
})

describe('a correct password must not consume the brute-force allowance', () => {
  it('six consecutive SUCCESSFUL mints all succeed — the sixth used to 429', async () => {
    asUser(USER_A)
    withCorrectPassword()
    for (let i = 1; i <= 6; i++) {
      const res = await mint()
      expect(res.status, `mint #${i} should succeed`).toBe(200)
    }
    expect(mockSudo.issueSudoToken).toHaveBeenCalledTimes(6)
  })

  it('twenty successful mints in one window still succeed — a real cleanup batch', async () => {
    asUser(USER_A)
    withCorrectPassword()
    for (let i = 0; i < 20; i++) {
      expect((await mint()).status).toBe(200)
    }
  })

  it('success resets ONLY the subject bucket; the global bucket keeps counting', async () => {
    asUser(USER_A)
    withCorrectPassword()
    for (let i = 0; i < 5; i++) await mint()

    // Subject bucket was reset by the last success → a fresh 5 are available.
    expect(checkRateLimit(keyFor(USER_A), 5).allowed).toBe(true)

    // Global bucket recorded all five and was NOT reset. Probing it with max=5
    // reveals the count: 5 recorded ⇒ a 6th would be refused at that ceiling.
    // (The route's real global ceiling is 200; this only reads the counter.)
    expect(checkRateLimit(GLOBAL_KEY, 5).allowed).toBe(false)
  })
})

describe('failed guesses still throttle — brute-force resistance is unchanged', () => {
  it('five wrong passwords, then the sixth attempt is 429', async () => {
    asUser(USER_A)
    withWrongPassword()
    for (let i = 1; i <= 5; i++) {
      const res = await mint('wrong')
      expect(res.status, `wrong-password attempt #${i} should be 403`).toBe(403)
    }
    const sixth = await mint('wrong')
    expect(sixth.status).toBe(429)
    // The sixth never reached the verifier.
    expect(mockSudo.issueSudoToken).toHaveBeenCalledTimes(5)
  })

  it('a wrong password does NOT reset the bucket', async () => {
    asUser(USER_A)
    withWrongPassword()
    await mint('wrong')
    // One attempt recorded; probing at max=1 must refuse.
    expect(checkRateLimit(keyFor(USER_A), 1).allowed).toBe(false)
  })

  it('a correct password after four failures clears the way again', async () => {
    asUser(USER_A)
    withWrongPassword()
    for (let i = 0; i < 4; i++) await mint('wrong')

    withCorrectPassword()
    expect((await mint()).status).toBe(200)

    // Reset happened: five more attempts are available to the real user.
    expect(checkRateLimit(keyFor(USER_A), 5).allowed).toBe(true)
  })
})

describe('the bucket is per-subject — one caller cannot lock out another', () => {
  it('user A exhausting its allowance does not 429 user B', async () => {
    asUser(USER_A)
    withWrongPassword()
    for (let i = 0; i < 5; i++) await mint('wrong')
    expect((await mint('wrong')).status).toBe(429)

    // B is a different subject: it still reaches the password verifier and gets
    // an honest 403, not a borrowed 429.
    asUser(USER_B)
    withWrongPassword()
    expect((await mint('wrong')).status).toBe(403)
  })

  it('the two subjects have independent buckets', async () => {
    asUser(USER_A)
    withWrongPassword()
    await mint('wrong')
    expect(checkRateLimit(keyFor(USER_A), 1).allowed).toBe(false)
    expect(checkRateLimit(keyFor(USER_B), 1).allowed).toBe(true)
  })
})

describe('the global bucket is a real pre-auth flood guard', () => {
  it('an over-limit global bucket 429s before authentication is attempted', async () => {
    // Saturate the global bucket at the route's own ceiling.
    const { checkAndRecordAttempt } = await import('@/lib/rate-limit')
    for (let i = 0; i < 200; i++) checkAndRecordAttempt(GLOBAL_KEY, 200)

    asUser(USER_A)
    withCorrectPassword()
    const res = await mint()
    expect(res.status).toBe(429)
    // Never authenticated, never verified — the guard is genuinely pre-auth.
    expect(mockAuth.authenticateFromRequest).not.toHaveBeenCalled()
    expect(mockSudo.issueSudoToken).not.toHaveBeenCalled()
  })

  it('lockdown still wins over both buckets', async () => {
    mockKill.isLockedDown.mockReturnValue(true)
    const res = await mint()
    expect(res.status).toBe(503)
    expect(mockAuth.authenticateFromRequest).not.toHaveBeenCalled()
  })
})
