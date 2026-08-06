/**
 * The DAEMON PRINCIPAL — signed-request verification (TRDD-APN5WB2L; ai-maestro#60).
 *
 * WHY THIS FILE IS THE LOAD-BEARING ONE. The principal exists so the janitor daemon can recover a
 * frozen agent WITHOUT the system-owner credential. Every property that makes that safe is a
 * REFUSAL, and refusals are the class this repo has repeatedly found to be vacuously "passing":
 * a test asserting only `ok === false` passes against a gate that was deleted, because some other
 * gate refused first for a different reason. So every case below pins the DISTINCT reason, and the
 * neuter record proves each gate is individually load-bearing.
 *
 * Ed25519 signing here is REAL (node's crypto, the same primitives lib/amp-keys verifies with) —
 * a mocked signature would test the mock. Only the enrollment STORE is redirected, so the suite
 * never reads or writes the developer's real ~/.aimaestro.
 *
 * NEUTER RUNS (2026-08-06 — all four OBSERVED via scripts/dev/neuter, restore blob-verified;
 * DISJOINT red sets, which is what proves each gate is individually pinned rather than one
 * catch-all refusal covering for the rest):
 *   · A `if (seenNonces.has(r.nonce))` → `if (false)` (replay gate removed)
 *     → 1 red: 'a replayed nonce is refused as replayed_nonce'.
 *   · B `Math.abs(nowS - r.issued_at) > MAX_SKEW_S` → `false` (freshness gate removed)
 *     → 2 red: 'a stale request is refused' AND 'a FUTURE-dated request is refused'. Both were
 *       needed: only the future-dated case can catch a one-sided fix.
 *   · C `!(DAEMON_VERBS as readonly string[]).includes(r.action)` → `false` (grant removed)
 *     → 2 red: the grant test AND the gate-ORDER test — the second is what proves the grant runs
 *       before the signature check, which no single-reason assertion can see.
 *   · D `rememberNonce(r.nonce, nowS)` hoisted ABOVE the signature check (the burn-a-nonce bug)
 *     → 1 red: 'a bad signature does not burn the nonce'. Nothing else moves, because every
 *       other case either never reaches the nonce store or does not reuse its nonce.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest'
import * as crypto from 'crypto'
import * as fs from 'fs'
import * as path from 'path'

// Redirect the state dir BEFORE importing the module under test: lib/ecosystem-constants resolves
// it per call, but a suite that let the real path through would write a daemon enrollment into the
// developer's live ~/.aimaestro — the exact class of leak the fixture rules exist to prevent.
// `vi.hoisted` is REQUIRED, not stylistic: vi.mock factories are hoisted above every top-level
// const, so a plain `const TMP_STATE` is in its temporal dead zone when the factory runs — and
// amp-keys resolves the state dir at MODULE LOAD, so the factory runs during import, not later.
const { TMP_STATE } = vi.hoisted(() => {
  const nodeFs = require('fs') as typeof import('fs')
  const nodeOs = require('os') as typeof import('os')
  const nodePath = require('path') as typeof import('path')
  return { TMP_STATE: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'daemon-principal-')) }
})
vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  return {
    ...actual,
    getStateDir: () => TMP_STATE,
    statePath: (...segments: string[]) => path.join(TMP_STATE, ...segments),
  }
})

import {
  verifyDaemonRequest,
  saveDaemonEnrollment,
  canonicalRequest,
  _resetNonceStoreForTests,
  MAX_SKEW_S,
  DAEMON_VERBS,
  type SignedDaemonRequest,
} from '@/lib/daemon-principal'

afterAll(() => {
  fs.rmSync(TMP_STATE, { recursive: true, force: true })
})

/** A real Ed25519 keypair, in the hex-public / PEM-private shape lib/amp-keys uses. */
function makeKeys() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519')
  const spki = publicKey.export({ format: 'der', type: 'spki' }) as Buffer
  // amp-keys' verifySignature reconstructs SPKI from the raw 32 bytes, so store it the same way:
  // the DER header is 12 bytes, the key is the remaining 32.
  const publicKeyHex = spki.subarray(12).toString('hex')
  return { privateKey, publicKeyHex }
}

const KEYS = makeKeys()
const OTHER = makeKeys()

let nonceCounter = 0
function signed(
  overrides: Partial<SignedDaemonRequest> = {},
  key: crypto.KeyObject = KEYS.privateKey,
): SignedDaemonRequest {
  const base = {
    target: 'agent-uuid-1',
    action: 'submit-recovery-prompt' as const,
    payload: '/janitor-arm',
    nonce: `nonce-${++nonceCounter}`,
    issued_at: Math.floor(Date.now() / 1000),
    ...overrides,
  }
  const signature = crypto.sign(null, Buffer.from(canonicalRequest(base)), key).toString('base64')
  return { ...base, signature, ...(overrides.signature ? { signature: overrides.signature } : {}) }
}

beforeEach(() => {
  _resetNonceStoreForTests()
  saveDaemonEnrollment({ publicKeyHex: KEYS.publicKeyHex, enrolledAt: new Date().toISOString(), label: 'test daemon' })
})

describe('verifyDaemonRequest — the happy path', () => {
  it('accepts a correctly signed, fresh, first-use request and reports the verb and target', () => {
    const r = verifyDaemonRequest(signed())
    expect(r.ok).toBe(true)
    expect(r.verb).toBe('submit-recovery-prompt')
    expect(r.target).toBe('agent-uuid-1')
  })

  it('accepts the OTHER granted verb too — both, or the grant is really one verb', () => {
    const r = verifyDaemonRequest(signed({ action: 'interrupt', payload: '' }))
    expect(r.ok).toBe(true)
    expect(r.verb).toBe('interrupt')
  })
})

describe('verifyDaemonRequest — every refusal, by its OWN reason', () => {
  it('a request signed by a DIFFERENT key is refused as bad_signature', () => {
    const r = verifyDaemonRequest(signed({}, OTHER.privateKey))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('bad_signature')
  })

  it('a TAMPERED field is refused — the signature covers the action, not just the payload', () => {
    // THE attack the canonical form exists to stop: capture a submit-prompt request, edit one
    // unsigned-looking field into `interrupt`, replay. If `action` were outside the signed bytes
    // this would verify.
    const req = signed()
    const tampered = { ...req, action: 'interrupt' as const }
    const r = verifyDaemonRequest(tampered)
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('bad_signature')
  })

  it('a stale request is refused as stale_request', () => {
    const r = verifyDaemonRequest(signed({ issued_at: Math.floor(Date.now() / 1000) - (MAX_SKEW_S + 5) }))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('stale_request')
  })

  it('a FUTURE-dated request is refused too — skew is two-sided', () => {
    // A one-sided check lets a request claim a future issue time and stay valid past its own
    // window by exactly the amount it lies about.
    const r = verifyDaemonRequest(signed({ issued_at: Math.floor(Date.now() / 1000) + (MAX_SKEW_S + 5) }))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('stale_request')
  })

  it('a replayed nonce is refused as replayed_nonce (the same request twice)', () => {
    const req = signed()
    expect(verifyDaemonRequest(req).ok).toBe(true)
    const second = verifyDaemonRequest(req)
    expect(second.ok).toBe(false)
    expect(second.reason).toBe('replayed_nonce')
  })

  it('a verb outside the two-verb grant is refused as unknown_verb, even with a VALID signature', () => {
    // Signed with the real key: this proves the grant is enforced by the verb check and not
    // incidentally by the signature failing.
    const r = verifyDaemonRequest(signed({ action: 'delete-agent' as never }))
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('unknown_verb')
    expect(r.message).toContain('submit-recovery-prompt')
  })

  it('a malformed request is refused as malformed_request', () => {
    expect(verifyDaemonRequest({ target: 'x' }).reason).toBe('malformed_request')
    expect(verifyDaemonRequest(null).reason).toBe('malformed_request')
    expect(verifyDaemonRequest(signed({ issued_at: 'soon' as never })).reason).toBe('malformed_request')
  })

  it('with NO enrollment, everything is refused as not_enrolled — fail closed', () => {
    fs.rmSync(path.join(TMP_STATE, 'daemon-principal.json'), { force: true })
    const r = verifyDaemonRequest(signed())
    expect(r.ok).toBe(false)
    expect(r.reason).toBe('not_enrolled')
  })
})

describe('verifyDaemonRequest — the ORDER of the gates is itself a property', () => {
  it('a bad signature does not burn the nonce — the same nonce still works when signed correctly', () => {
    // Recording the nonce before the signature check would let anyone invalidate a legitimate
    // request by sending its nonce with a broken signature first.
    const good = signed()
    const forged = { ...good, signature: crypto.sign(null, Buffer.from(canonicalRequest(good)), OTHER.privateKey).toString('base64') }

    expect(verifyDaemonRequest(forged).reason).toBe('bad_signature')
    // Same nonce, correct signature: must still be accepted.
    expect(verifyDaemonRequest(good).ok).toBe(true)
  })

  it('an ungranted verb is refused BEFORE the expensive signature check can matter', () => {
    // Signed with the WRONG key AND an ungranted verb: the reported reason tells which gate ran
    // first. This pins the ordering, which a single-reason assertion cannot see.
    const r = verifyDaemonRequest(signed({ action: 'rm-rf' as never }, OTHER.privateKey))
    expect(r.reason).toBe('unknown_verb')
  })
})

describe('the grant itself', () => {
  it('is exactly two verbs — widening it is a governance decision, not a refactor', () => {
    expect([...DAEMON_VERBS].sort()).toEqual(['interrupt', 'submit-recovery-prompt'])
  })
})
