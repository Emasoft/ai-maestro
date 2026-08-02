import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

/**
 * The first-run REQUIRED-recovery gate flag (TRDD-7U927FCM 2A).
 *
 * WHY THIS FILE EXISTS: the card's Verification asks for *"unit tests for the gate flag logic +
 * the `accountEmail`-vs-`to` relay send"*. The relay half was written (`mailer-user-relay.test.ts`,
 * 4 tests); the GATE FLAG half never was. Nothing in the tree named `isRecoverySetupComplete`,
 * `setRecoveryOptOut` or `recoverySetupComplete` — the only greppable hits were scenario
 * state-backup fixtures, i.e. DATA, which is the shape that makes a search look like coverage.
 *
 * WHAT THE FLAG DECIDES: `LoginGate` blocks app entry until it is true. Wrong in one direction and
 * a fresh MAESTRO sails past the gate with NO recovery configured and can lock themselves out of
 * their own host — the exact state this card exists to make impossible. Wrong in the other and the
 * owner is held at a gate, which is survivable only because of the opt-out. Both directions are
 * tested below, because a gate is a two-sided claim.
 *
 * 0-IMPACT: `lib/governance.ts` computes `GOVERNANCE_FILE` from `os.homedir()` at MODULE LOAD, and
 * `homedir()` reads `$HOME` on POSIX — so the stub must land BEFORE the import and the module
 * registry must be reset, or the test rewrites the developer's real ~/.aimaestro/governance.json.
 * Same setup as `password-invalidation.test.ts`, and for the same reason.
 */

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-recov-'))
  vi.stubEnv('HOME', dir)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  rmSync(dir, { recursive: true, force: true })
})

const SMTP = { host: 'smtp.example.com', port: 587, secure: false, usernameFormat: 'full' as const }

describe('isRecoverySetupComplete — the gate that blocks app entry until recovery is a CONSCIOUS choice', () => {
  it('a fresh host is INCOMPLETE — the gate must show, or a new MAESTRO has silent no-recovery', async () => {
    const g = await import('@/lib/governance')
    expect(g.isRecoverySetupComplete()).toBe(false)
  })

  it('a VERIFIED recovery email completes it', async () => {
    const g = await import('@/lib/governance')
    await g.setRecoveryEmail('owner@example.com', SMTP)
    await g.setRecoveryEmailVerified()
    expect(g.isRecoverySetupComplete()).toBe(true)
  })

  it('an UNVERIFIED recovery email does NOT complete it — the discriminating case', async () => {
    // THE case that separates this flag from a naive `!!config.recoveryEmail`. Configuring an
    // address proves nothing: `setRecoveryEmail` deliberately clears `recoveryEmailVerifiedAt` on
    // every (re)configure, because receipt is what proves the relay can actually reach the owner.
    // A gate satisfied by an unverified address would wave through the exact silently-unrecoverable
    // account it exists to catch — typo'd address, wrong app-password, unreachable SMTP.
    const g = await import('@/lib/governance')
    await g.setRecoveryEmail('typo@exmaple.com', SMTP)
    expect(g.getRecoveryEmail()?.verified).toBe(false) // non-vacuity: the address really is on file
    expect(g.isRecoverySetupComplete()).toBe(false)
  })

  it('re-configuring a VERIFIED email makes it INCOMPLETE again — verification does not carry over', async () => {
    const g = await import('@/lib/governance')
    await g.setRecoveryEmail('owner@example.com', SMTP)
    await g.setRecoveryEmailVerified()
    expect(g.isRecoverySetupComplete()).toBe(true)

    await g.setRecoveryEmail('newaddress@example.com', SMTP)
    expect(g.isRecoverySetupComplete()).toBe(false)
  })

  it('clearing a verified email re-opens the gate', async () => {
    const g = await import('@/lib/governance')
    await g.setRecoveryEmail('owner@example.com', SMTP)
    await g.setRecoveryEmailVerified()
    await g.clearRecoveryEmail()
    expect(g.isRecoverySetupComplete()).toBe(false)
  })
})

describe('setRecoveryOptOut — the escape hatch, which must never become a trap', () => {
  it('opting out completes the gate with NO email — the host with unreachable SMTP is not stranded', async () => {
    const g = await import('@/lib/governance')
    await g.setRecoveryOptOut(true)
    expect(g.isRecoverySetupComplete()).toBe(true)
    // …and it is genuinely email-free: nothing was configured behind the scenes.
    expect(g.getRecoveryEmail()).toBeNull()
  })

  it('the opt-out is REVERSIBLE — clearing it re-opens the gate', async () => {
    // A one-way waiver would mean an owner who opted out at first-run could never be re-prompted
    // after deciding they do want email recovery.
    const g = await import('@/lib/governance')
    await g.setRecoveryOptOut(true)
    await g.setRecoveryOptOut(false)
    expect(g.isRecoverySetupComplete()).toBe(false)
  })

  it('the two satisfiers are independent — clearing the email does not revoke the opt-out', async () => {
    const g = await import('@/lib/governance')
    await g.setRecoveryOptOut(true)
    await g.setRecoveryEmail('owner@example.com', SMTP)
    await g.setRecoveryEmailVerified()
    await g.clearRecoveryEmail()
    // Still complete: the owner's explicit console/passkey choice stands on its own.
    expect(g.isRecoverySetupComplete()).toBe(true)
  })
})

/**
 * NEUTER RECORD — 2026-08-02
 *
 * (a) `isRecoverySetupComplete` → drop the verification conjunct, i.e.
 *     `const emailVerified = !!config.recoveryEmail`. This is the realistic mistake — an address on
 *     file LOOKS like recovery. Reds exactly 2:
 *       × an UNVERIFIED recovery email does NOT complete it — the discriminating case
 *       × re-configuring a VERIFIED email makes it INCOMPLETE again
 *     Every other test stays green, including both "verified completes it" cases — which is why
 *     none of them could have caught it, and why the unverified case had to be written.
 *
 * (b) `isRecoverySetupComplete` → drop the `|| !!config.recoveryOptOut` disjunct. Reds exactly 2:
 *       × opting out completes the gate with NO email
 *       × the two satisfiers are independent
 *     The reversibility test stays green (it asserts FALSE, which the neuter also produces) — an
 *     assertion of absence cannot see a mutation that removes the thing.
 */
