import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { NextRequest, NextResponse } from 'next/server'

/**
 * POST /api/governance/email/configure (TRDD-P7XKV3N9) — the "enter the password once"
 * surface. Load-bearing claims: a SUCCESSFUL verify PERSISTS the app-password (credential
 * store) + the recovery email (governance, UNVERIFIED) and sends a confirm code; an
 * AUTH_REQUIRED / FAILED verify stores NOTHING and returns guidance; the owner gate and body
 * validation are enforced. The gate, autodetect, verify, and code-send are stubbed (their own
 * suites cover them); the credential store + governance run REAL against a throwaway $HOME so
 * the persistence assertions are true, not mocked.
 */
const EMAIL = 'me@corp.example'
const APPPW = 'secret-app-pw'
const CONFIG = { host: 'smtp.corp.example', port: 587, secure: false, usernameFormat: 'full' as const }

function makeReq(body: unknown): NextRequest {
  return new NextRequest('http://localhost/api/governance/email/configure', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-aim-peer': '127.0.0.1' },
    body: JSON.stringify(body),
  })
}

function mockDeps(opts: { status: 'SUCCESS' | 'AUTH_REQUIRED' | 'FAILED'; gateDenied?: boolean }) {
  const autodetectSMTP = vi.fn(async () => ({ ...CONFIG, source: 'mx', label: 'corp.example', known: false }))
  const verifyCredentials = vi.fn(async () => ({
    status: opts.status,
    config: CONFIG,
    instructions: opts.status === 'AUTH_REQUIRED' ? 'enable SMTP and use an app password' : undefined,
  }))
  vi.doMock('@/lib/route-auth', () => ({
    enforceSystemOwner: vi.fn(() => (opts.gateDenied ? NextResponse.json({ error: 'Forbidden' }, { status: 403 }) : null)),
  }))
  vi.doMock('@/lib/smtp-autodetect', () => ({ autodetectSMTP, verifyCredentials }))
  vi.doMock('@/lib/setup-bootstrap', () => ({
    startSetupFlow: vi.fn(async () => ({ channel: 'email', hint: 'sent to your inbox', expiresAt: 9_999_999_999_999 })),
  }))
  return { autodetectSMTP, verifyCredentials }
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'aim-email-cfg-'))
  vi.stubEnv('HOME', dir)
  vi.stubEnv('AIM_SMTP_CRED_BACKEND', 'file')
  vi.resetModules()
})
afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  rmSync(dir, { recursive: true, force: true })
})

async function loadRoute() {
  return (await import('@/app/api/governance/email/configure/route')).POST
}

describe('POST /api/governance/email/configure', () => {
  it('SUCCESS persists the app-password + recovery email (unverified) and sends a confirm code', async () => {
    mockDeps({ status: 'SUCCESS' })
    const POST = await loadRoute()
    const res = await POST(makeReq({ email: EMAIL, appPassword: APPPW }))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.status).toBe('SUCCESS')
    expect(j.channel).toBe('email')

    const cred = await import('@/lib/smtp-credential')
    const gov = await import('@/lib/governance')
    expect(cred.getSmtpPassword(EMAIL)).toBe(APPPW)
    expect(gov.getRecoveryEmail()).toMatchObject({ email: EMAIL, verified: false })
  })

  it('AUTH_REQUIRED returns guidance and stores NOTHING', async () => {
    mockDeps({ status: 'AUTH_REQUIRED' })
    const POST = await loadRoute()
    const res = await POST(makeReq({ email: EMAIL, appPassword: APPPW }))
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.status).toBe('AUTH_REQUIRED')
    expect(j.instructions).toMatch(/app password/i)

    const cred = await import('@/lib/smtp-credential')
    const gov = await import('@/lib/governance')
    expect(cred.getSmtpPassword(EMAIL)).toBeNull()
    expect(gov.getRecoveryEmail()).toBeNull()
  })

  it('rejects with the gate response when the owner gate denies', async () => {
    mockDeps({ status: 'SUCCESS', gateDenied: true })
    const POST = await loadRoute()
    const res = await POST(makeReq({ email: EMAIL, appPassword: APPPW }))
    expect(res.status).toBe(403)
  })

  it('400 on a malformed email', async () => {
    mockDeps({ status: 'SUCCESS' })
    const POST = await loadRoute()
    const res = await POST(makeReq({ email: 'not-an-email', appPassword: APPPW }))
    expect(res.status).toBe(400)
  })

  it('a manual SMTP host override is used verbatim and SKIPS autodetection (TRDD-P7XKV3N9)', async () => {
    // The escape hatch for a provider whose server autodetection gets wrong/unreachable —
    // and the answer to "it said the address was wrong but never asked me for it".
    const { autodetectSMTP, verifyCredentials } = mockDeps({ status: 'SUCCESS' })
    const POST = await loadRoute()
    const res = await POST(makeReq({ email: EMAIL, appPassword: APPPW, host: 'mail.override.example', port: 465, secure: true }))
    expect(res.status).toBe(200)
    expect((await res.json()).status).toBe('SUCCESS')
    // Detection was bypassed; the owner's explicit server was verified instead.
    expect(autodetectSMTP).not.toHaveBeenCalled()
    expect(verifyCredentials).toHaveBeenCalledWith(
      expect.objectContaining({ host: 'mail.override.example', port: 465, secure: true }),
      EMAIL,
      APPPW,
      undefined,
    )
  })

  it('with NO host override, autodetection runs (the default path is unchanged)', async () => {
    const { autodetectSMTP } = mockDeps({ status: 'SUCCESS' })
    const POST = await loadRoute()
    const res = await POST(makeReq({ email: EMAIL, appPassword: APPPW }))
    expect(res.status).toBe(200)
    expect(autodetectSMTP).toHaveBeenCalledOnce()
  })
})
