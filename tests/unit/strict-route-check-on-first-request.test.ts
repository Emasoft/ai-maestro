import { describe, it, expect, afterEach, vi } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'fs'
import { tmpdir } from 'os'
import path from 'path'
import { NextRequest } from 'next/server'

/**
 * Owner ruling (TRDD-HUSKG52P): "on first request". A strict-route table that disagrees with
 * security-registry.json must not stop the module (and so the server) from loading; it must
 * refuse guarded requests instead, every time, until fixed.
 */

const REAL = path.join(process.cwd(), 'security-registry.json')
let dir: string | undefined

function brokenRegistry(): string {
  const reg = JSON.parse(readFileSync(REAL, 'utf8')) as { entries: Record<string, string> }
  reg.entries['POST_/api/not-declared-anywhere'] = 'strict'
  dir = mkdtempSync(path.join(tmpdir(), 'aim-strict-'))
  writeFileSync(path.join(dir, 'security-registry.json'), JSON.stringify(reg))
  return dir
}

const req = () => new NextRequest('http://localhost/api/anything', { method: 'GET' })

afterEach(() => {
  vi.restoreAllMocks()
  vi.resetModules()
  if (dir) rmSync(dir, { recursive: true, force: true })
  dir = undefined
})

describe('strict-route cross-check runs on the first guarded request', () => {
  it('a disagreeing registry does not throw at import, and throws on every guarded request', async () => {
    vi.spyOn(process, 'cwd').mockReturnValue(brokenRegistry())
    vi.resetModules()
    const guard = await import('@/lib/sudo-guard') // must not throw
    const call = () => guard.requireSudoToken(req(), 'GET', '/api/anything')
    expect(call).toThrow(/strict but declared nowhere: POST \/api\/not-declared-anywhere/)
    expect(call).toThrow(/declared nowhere/) // a failed check is not remembered as passed
  })

  it('the real registry passes, and a non-strict route still returns null', async () => {
    vi.resetModules()
    const guard = await import('@/lib/sudo-guard')
    expect(() => guard.ensureStrictRoutesChecked()).not.toThrow()
    expect(guard.requireSudoToken(req(), 'GET', '/api/anything')).toBeNull()
  })
})
