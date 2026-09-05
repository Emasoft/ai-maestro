/**
 * TRDD-Y0XEEUXN residue — the `POST /api/settings/marketplaces` `delete-marketplace` action
 * answers 409 when the DELETE pipeline's failure cause was an unreadable `~/.claude/settings.json`
 * (typed `ChangeResult.errorKind === 'unreadable-target'`, forwarded from `GateFailure.errorKind` in
 * lib/gate-transaction.ts), and keeps today's designed partial-success response when the file is
 * simply ABSENT — a different fact ("nothing to remove") that must not be conflated with "the state
 * on disk is UNKNOWN" (see lib/extra-known-marketplaces.ts's module doc, DECISION REFINED (4)).
 *
 * Drives the REAL exported `POST` handler rather than an internal helper — `app/api/…/route.ts`
 * files reject any export besides the Next.js route surface (GET/POST/config/…) at the
 * `.next/types` type-check layer, so `handleDeleteMarketplace` cannot be exported for a direct
 * call. `enforceSystemOwner` / `requireSudoToken` are mocked to `null` (pass) so the test exercises
 * the DELETE pipeline itself, not this route's separate auth layer.
 *
 * Same fake-$HOME containment idiom as tests/integration/change-marketplace-rollback.test.ts:
 * `os.homedir` mocked (route.ts's and element-management-service.ts's `HOME` are both captured at
 * module load) plus `@/lib/ecosystem-constants`'s path FUNCTIONS overridden via the shared
 * `fakeEcosystemPaths` helper. `child_process.execFile` and `@/lib/plugin-enumeration` are mocked so
 * no real `claude` CLI is ever spawned (G02b's cascade enumerates zero plugins; G03's CLI calls are
 * intercepted).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'

const H = vi.hoisted(() => {
  const { mkdtempSync: mk } = require('fs') as typeof import('fs')
  const { join: j } = require('path') as typeof import('path')
  const root = (process.env.TMPDIR || '/tmp').replace(/\/$/, '')
  const FAKE_HOME = mk(j(root, 'aim-delete-mkt-unreadable-'))
  return { FAKE_HOME, FAKE_STATE: j(FAKE_HOME, '.aimaestro') }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => H.FAKE_HOME, default: { ...actual, homedir: () => H.FAKE_HOME } }
})

vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, H.FAKE_HOME, H.FAKE_STATE)
})

// Bypass this route's OWN auth layer (system-owner + sudo token) — out of scope for this test,
// which is about the DELETE pipeline's failure classification, not authentication.
vi.mock('@/lib/route-auth', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/route-auth')>()
  return { ...actual, enforceSystemOwner: () => null }
})
vi.mock('@/lib/sudo-guard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/sudo-guard')>()
  return { ...actual, requireSudoToken: () => null }
})

// G02b's cascade would otherwise try to list plugins under a marketplace dir that does not
// exist under the fake $HOME — returning [] naturally, but pinning it explicitly (rather than
// relying on ENOENT-as-empty) keeps this test about the settings-file failure, not enumeration.
vi.mock('@/lib/plugin-enumeration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plugin-enumeration')>()
  return { ...actual, listPluginsInMarketplace: async () => [] }
})

const cli = vi.hoisted(() => ({ calls: [] as string[][] }))
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFile: (file: string, args: string[], _opts: unknown, cb: (e: Error | null, r?: unknown) => void) => {
      cli.calls.push([file, ...args])
      // "not found" is G03's documented orphan-path no-op — treat every candidate as already
      // unregistered with the CLI, so the pipeline proceeds straight to G05 (the settings write
      // under test) without needing a real registration to exist.
      cb(new Error('not found'))
    },
  }
})

const MKT = 'unreadable-settings-mkt'
const SETTINGS = join(H.FAKE_HOME, '.claude', 'settings.json')

function seedCorruptSettings(): void {
  mkdirSync(join(H.FAKE_HOME, '.claude'), { recursive: true })
  writeFileSync(SETTINGS, '{ this is not valid json', 'utf-8')
}

async function postDeleteMarketplace(): Promise<Response> {
  const { POST } = await import('@/app/api/settings/marketplaces/route')
  const { NextRequest } = await import('next/server')
  const req = new NextRequest('http://localhost/api/settings/marketplaces', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'delete-marketplace', marketplaceName: MKT }),
  })
  return POST(req) as unknown as Response
}

beforeEach(() => {
  rmSync(H.FAKE_HOME, { recursive: true, force: true })
  mkdirSync(H.FAKE_HOME, { recursive: true })
  cli.calls = []
})

describe('POST delete-marketplace — 409 on an unreadable settings.json, partial success on absence', () => {
  it('MEASURED — returns 409 with errorType unreadable-settings when settings.json exists but does not parse', async () => {
    seedCorruptSettings()
    const before = readFileSync(SETTINGS, 'utf-8')

    const response = await postDeleteMarketplace()
    const body = await response.json()

    expect(response.status).toBe(409)
    expect(body.errorType).toBe('unreadable-settings')
    expect(String(body.error)).toContain('does not parse')
    // NON-VACUITY: this route's OUTER catch-all (line ~894) already maps a bare
    // `UnreadableTargetError` thrown from ANYWHERE in this handler to the identical
    // {status:409, errorType:'unreadable-settings'} shape — including the unconditional
    // enabledPlugins cleanup a few lines below the DeleteMarketplace loop, which touches the
    // SAME corrupt file and would itself throw once the loop reaches it. So status+errorType
    // alone pass even with the explicit `errorKind === 'unreadable-target'` check deleted
    // (MEASURED: neutered, both assertions above still passed). `failedGateId` is the one
    // field ONLY this route's explicit mapping populates — the generic catch-all's response
    // (route.ts:894) carries no such field — so asserting it is what actually pins the code
    // this test exists to cover.
    expect(body.failedGateId).toBe('G05')
    // Refusing to write means the corrupt bytes are exactly as found — never "repaired" by a
    // rebuild-as-{} pass, the incident lib/extra-known-marketplaces.ts's doc comment names.
    expect(readFileSync(SETTINGS, 'utf-8')).toBe(before)
  })

  it('POSITIVE CONTROL — an ABSENT settings.json keeps today\'s exact partial-success status (200)', async () => {
    // No seedCorruptSettings() call: ~/.claude/settings.json genuinely does not exist under the
    // fake $HOME. This is the "legitimately absent" branch the residue must NOT touch — DECISION
    // REFINED (4) draws exactly this line, and this test is what proves the 409 change left it alone.
    expect(existsSync(SETTINGS)).toBe(false)

    const response = await postDeleteMarketplace()
    const body = await response.json()

    expect(response.status).toBe(200)
    expect(body).toMatchObject({ success: true, action: 'delete-marketplace', marketplaceName: MKT })
  })
})
