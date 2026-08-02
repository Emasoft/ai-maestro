import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { NextRequest } from 'next/server'

/**
 * `POST /api/governance/password/invalidate` — the ROUTE's gates (TRDD-P7XKV3N9).
 *
 * WHY THIS FILE EXISTS: the card's Verification names four route-level properties and nothing
 * drove the route. `password-invalidation.test.ts` covers the `invalidatePassword()` FUNCTION
 * (hash destroyed, survives restart) and `peer-address.test.ts` covers `isConsolePeer` — both are
 * the route's ingredients, neither is the route. Its sibling
 * `POST /api/governance/password/reset` has a full 16-case route suite; this one, which the card
 * calls *"the single most attractive target on the whole surface"* because **its input IS the
 * secret**, had none.
 *
 * The three properties that had to be pinned here rather than borrowed:
 *   1. a REMOTE peer is refused BEFORE the password is touched, so the endpoint is not an oracle;
 *   2. the code is NEVER in the response body — "the moment the code travels over HTTP, this is
 *      theater" (the route's own words);
 *   3. a wrong password consumes no state — the credential is still verifiable afterwards.
 *
 * Harness copied from `password-reset.test.ts`: governance + peer-address + rate-limit run REAL
 * against a throwaway `$HOME`; only the code CHANNEL is stubbed, because delivering an OS
 * notification is not what this suite is about. `$HOME` is stubbed before any import because
 * governance computes its file path at MODULE LOAD — otherwise this rewrites the developer's real
 * `~/.aimaestro/governance.json`.
 */

const CONSOLE = '127.0.0.1'
const CONSOLE_V6 = '::ffff:127.0.0.1' // what a dual-stack (`::`) bind actually reports for loopback
const REMOTE = '100.64.0.1' // Tailscale CGNAT — on the VPN, not at the machine
const GOOD_CODE = '123456'
const FAR_FUTURE = 9_999_999_999_999
const PASSWORD = 'correct-horse-battery-staple'

/** The code the stub "delivers". If this string ever appears in a response body, the gate is theater. */
const DELIVERED_CODE = GOOD_CODE

function makeReq(peer: string, body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/governance/password/invalidate', {
    method: 'POST',
    // `x-aim-peer` is the header server.mjs STAMPS from req.socket.remoteAddress after deleting
    // any inbound copy — setting it here is simulating the server, not forging it.
    headers: { 'content-type': 'application/json', 'x-aim-peer': peer },
    body: JSON.stringify(body),
  })
}

let startSetupFlowCalls = 0

function stubChannel() {
  startSetupFlowCalls = 0
  vi.doMock('@/lib/setup-bootstrap', () => ({
    startSetupFlow: vi.fn(async () => {
      startSetupFlowCalls++
      return { channel: 'file', hint: 'read ~/.aimaestro/setup-code.txt', expiresAt: FAR_FUTURE }
    }),
    verifySetupCode: vi.fn((code: string) => (code === GOOD_CODE ? { ok: true } : { ok: false, reason: 'mismatch' })),
    isSetupCodePending: vi.fn(() => true),
  }))
}

async function loadRoute() {
  stubChannel()
  return (await import('@/app/api/governance/password/invalidate/route')).POST
}

let dir: string

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-inval-'))
  vi.stubEnv('HOME', dir)
  vi.resetModules()
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

/** Seed a real password into the throwaway governance file. */
async function seedPassword() {
  const g = await import('@/lib/governance')
  await g.setPassword(PASSWORD)
  return g
}

describe('POST /api/governance/password/invalidate — console presence is checked FIRST', () => {
  it('refuses a REMOTE peer with 403 and emits NO code', async () => {
    const g = await seedPassword()
    const POST = await loadRoute()

    const res = await POST(makeReq(REMOTE, { password: PASSWORD }))

    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('console_required')
    // The half that matters as much as the 403: nothing was dispatched to the desktop.
    expect(startSetupFlowCalls).toBe(0)
    expect(g.loadGovernance().passwordHash).not.toBeNull() // and nothing was revoked
  })

  it('refuses a remote caller holding the CORRECT password — presence is not a formality', async () => {
    // The request above and this one are the same request; what differs is that this one would
    // succeed if presence were advisory. It is the second factor, so it is not.
    await seedPassword()
    const POST = await loadRoute()
    expect((await POST(makeReq(REMOTE, { password: PASSWORD, code: GOOD_CODE }))).status).toBe(403)
  })

  it('refuses a remote caller with a WRONG password with the SAME 403 — never an oracle', async () => {
    // The route checks presence BEFORE the credential deliberately: distinct "wrong password" vs
    // "not at the console" replies would tell a remote attacker whether a guess was right.
    await seedPassword()
    const POST = await loadRoute()

    const wrong = await POST(makeReq(REMOTE, { password: 'wrong' }))
    const right = await POST(makeReq(REMOTE, { password: PASSWORD }))

    expect(wrong.status).toBe(right.status)
    expect(await wrong.json()).toEqual(await right.json())
  })

  it('accepts the IPv4-mapped loopback a dual-stack bind reports', async () => {
    // The `::` bind presents loopback as `::ffff:127.0.0.1`. If this shape were rejected, the
    // owner would be locked out AT THEIR OWN KEYBOARD — the failure the gate must never produce.
    await seedPassword()
    const POST = await loadRoute()
    const res = await POST(makeReq(CONSOLE_V6, { password: PASSWORD }))
    expect(res.status).toBe(200)
    expect((await res.json()).codeRequired).toBe(true)
  })
})

describe('the code never travels over HTTP — "the moment the code travels over HTTP, this is theater"', () => {
  it('call-1 from the console dispatches a code and returns codeRequired — never the code', async () => {
    await seedPassword()
    const POST = await loadRoute()

    const res = await POST(makeReq(CONSOLE, { password: PASSWORD }))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body).toMatchObject({ codeRequired: true, channel: 'file' })
    expect(startSetupFlowCalls).toBe(1)
    // Asserted on the SERIALIZED body, not on named keys: a future edit that passes the flow
    // object through wholesale would add the code under a key no `expect(body.code)` predicts.
    expect(JSON.stringify(body)).not.toContain(DELIVERED_CODE)
  })

  it('the code is absent from the FAILURE bodies too', async () => {
    await seedPassword()
    const POST = await loadRoute()
    await POST(makeReq(CONSOLE, { password: PASSWORD })) // dispatch one, so a code exists to leak
    const bad = await POST(makeReq(CONSOLE, { password: PASSWORD, code: '999999' }))

    expect(bad.status).toBe(401)
    expect(JSON.stringify(await bad.json())).not.toContain(DELIVERED_CODE)
  })
})

describe('possession + presence — and a wrong password consumes nothing', () => {
  it('the full flow revokes: correct password + correct code ⇒ invalidated', async () => {
    const g = await seedPassword()
    const POST = await loadRoute()

    await POST(makeReq(CONSOLE, { password: PASSWORD }))
    const res = await POST(makeReq(CONSOLE, { password: PASSWORD, code: GOOD_CODE }))

    expect(res.status).toBe(200)
    expect((await res.json()).invalidated).toBe(true)
    expect(g.loadGovernance().passwordHash).toBeNull()
    expect(g.isPasswordInvalidated()).toBe(true)
    expect(await g.verifyPassword(PASSWORD)).toBe(false) // the whole point
  })

  it('a WRONG password changes nothing and consumes no state', async () => {
    const g = await seedPassword()
    const POST = await loadRoute()

    const res = await POST(makeReq(CONSOLE, { password: 'not-the-password' }))

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('invalid_password')
    expect(startSetupFlowCalls).toBe(0) // no code burned on a bad guess
    expect(g.isPasswordInvalidated()).toBe(false)
    expect(await g.verifyPassword(PASSWORD)).toBe(true) // still verifiable — nothing consumed
  })

  it('a WRONG code leaves the password intact', async () => {
    const g = await seedPassword()
    const POST = await loadRoute()

    await POST(makeReq(CONSOLE, { password: PASSWORD }))
    const res = await POST(makeReq(CONSOLE, { password: PASSWORD, code: '999999' }))

    expect(res.status).toBe(401)
    expect((await res.json()).error).toMatch(/^code_/)
    expect(await g.verifyPassword(PASSWORD)).toBe(true)
  })

  it('409s when no password is set — there is nothing to invalidate', async () => {
    const POST = await loadRoute()
    const res = await POST(makeReq(CONSOLE, { password: 'anything' }))
    expect(res.status).toBe(409)
    expect((await res.json()).error).toBe('no_password_set')
  })
})

describe('the throttle — this route takes the SECRET ITSELF as input', () => {
  it('429s after 5 failed guesses from one peer', async () => {
    // Unthrottled, an unauthenticated caller AT the console gets unlimited free attempts against
    // the master credential, and the endpoint built to protect it becomes the thing exposing it.
    await seedPassword()
    const POST = await loadRoute()

    const codes: number[] = []
    for (let i = 0; i < 6; i++) codes.push((await POST(makeReq(CONSOLE, { password: `guess-${i}` }))).status)

    expect(codes.slice(0, 5)).toEqual([401, 401, 401, 401, 401])
    expect(codes[5]).toBe(429)
  })
})

/**
 * NEUTER RECORD — 2026-08-02
 *
 * (a) Delete the `if (!isConsolePeer(peer))` block. Reds 3:
 *       × refuses a REMOTE peer with 403 and emits NO code
 *       × refuses a remote caller holding the CORRECT password
 *       × refuses a remote caller with a WRONG password with the SAME 403
 *     Every console-path test stays green — which is the point: a suite that only drives the
 *     console cannot see the gate at all, and the console path is the one a developer runs.
 *
 * (b) Return the flow object wholesale on call-1 — `NextResponse.json({ codeRequired: true, ...flow })`
 *     with the stub widened to include `code`. Reds 1:
 *       × call-1 … returns codeRequired — never the code
 *     ONLY because the assertion is on the SERIALIZED body. An `expect(body.code).toBeUndefined()`
 *     would pass on any key name but `code`, and a spread is exactly how an unpredicted key
 *     arrives.
 *
 * (c) Move the presence check BELOW the password check. Reds 1:
 *       × refuses a remote caller with a WRONG password with the SAME 403
 *     The other two remote tests stay green — they still get a 403, just from further down. That
 *     single test is what pins the ORDER, and the order is what makes the endpoint not an oracle.
 */
