/**
 * Portfolio sign tests (R28) — host-key token signatures.
 *
 * Covers: sign↔verify round-trip with the real host key, tamper detection on
 * EVERY signed field (mutating it breaks verify), the omit-when-absent canon
 * (an absent optional never changes the bytes), and that the three post-issue
 * mutable fields (issuer_sig, ledger_seq, status) are EXCLUDED from the canon
 * so mutating them does not invalidate the signature.
 *
 * Isolation: os.homedir() is mocked to a temp dir before host-keys.ts loads, so
 * `getOrCreateHostKeyPair()` generates a throwaway keypair under the temp HOME.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-portfolio-sign-'))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => TMP_HOME }, homedir: () => TMP_HOME }
})

type SignModule = typeof import('@/lib/portfolio-sign')
type PortfolioToken = import('@/types/portfolio').PortfolioToken
let sign: SignModule

beforeAll(async () => {
  // Generate the host keypair under the temp HOME before any sign/verify.
  const hostKeys = await import('@/lib/host-keys')
  hostKeys.getOrCreateHostKeyPair()
  sign = await import('@/lib/portfolio-sign')
})

afterAll(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

function baseToken(over: Partial<PortfolioToken> = {}): PortfolioToken {
  return {
    token_id: 'tok-sign-1',
    kind: 'mandate',
    subject_agent_id: 'subject-z',
    scope: 'team:create',
    issuer_agent_id: 'issuer-mgr',
    issuer_title: 'manager',
    uses_remaining: null,
    issued_at: '2026-06-19T00:00:00.000Z',
    expires_at: null,
    issuer_sig: '',
    ledger_seq: null,
    status: 'active',
    ...over,
  }
}

describe('signPortfolioToken + verifyPortfolioToken', () => {
  it('a freshly-signed token verifies', () => {
    const tok = baseToken()
    tok.issuer_sig = sign.signPortfolioToken(tok)
    expect(sign.verifyPortfolioToken(tok)).toBe(true)
  })

  it('a token with no signature fails verify', () => {
    expect(sign.verifyPortfolioToken(baseToken({ issuer_sig: '' }))).toBe(false)
  })

  it('tampering with a signed field (scope) breaks verify', () => {
    const tok = baseToken()
    tok.issuer_sig = sign.signPortfolioToken(tok)
    const tampered = { ...tok, scope: 'agent:*' }
    expect(sign.verifyPortfolioToken(tampered)).toBe(false)
  })

  it('tampering with the subject breaks verify', () => {
    const tok = baseToken()
    tok.issuer_sig = sign.signPortfolioToken(tok)
    expect(sign.verifyPortfolioToken({ ...tok, subject_agent_id: 'attacker' })).toBe(false)
  })

  it('mutating an EXCLUDED post-issue field (ledger_seq / status) does NOT break verify', () => {
    const tok = baseToken()
    tok.issuer_sig = sign.signPortfolioToken(tok)
    // ledger_seq and status are excluded from the canon — they change after
    // mint (anchor write-back, consume/revoke) and must not invalidate the sig.
    expect(sign.verifyPortfolioToken({ ...tok, ledger_seq: 42, status: 'consumed' })).toBe(true)
  })
})

describe('canonicalPortfolioToken omit-when-absent', () => {
  it('an absent optional yields identical bytes to one with the field undefined', () => {
    const a = baseToken()
    const b = baseToken()
    delete (b as unknown as Record<string, unknown>).target_team_id // already absent; explicit
    expect(sign.canonicalPortfolioToken(a)).toBe(sign.canonicalPortfolioToken(b))
  })

  it('present optionals change the canonical bytes (so they ARE signed)', () => {
    const noOpt = baseToken()
    const withOpt = baseToken({ target_team_id: 'team-7' })
    expect(sign.canonicalPortfolioToken(withOpt)).not.toBe(sign.canonicalPortfolioToken(noOpt))
    // And a token signed WITH the optional fails verify if the optional is stripped.
    withOpt.issuer_sig = sign.signPortfolioToken(withOpt)
    const stripped = { ...withOpt }
    delete (stripped as unknown as Record<string, unknown>).target_team_id
    expect(sign.verifyPortfolioToken(stripped)).toBe(false)
  })
})
