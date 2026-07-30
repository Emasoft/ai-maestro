/**
 * ChangeMarketplace `remove` — the R51 rollback (AIO-TXN-10, TRDD-DQ6XN2VP).
 *
 * WHAT THIS PINS, and why it is a separate file from
 * `delete-marketplace-pipeline.test.ts`.
 *
 * The remove branch touches four stores in sequence: it uninstalls the marketplace's plugins
 * from every target (G02b), deregisters the marketplace and drops its cache (G03), and strips
 * the `extraKnownMarketplaces` entry from `~/.claude/settings.json` (G05). Before the retrofit,
 * a failure at G03 or G05 returned a bare error over a host where the cascade had ALREADY
 * uninstalled every one of that marketplace's plugins everywhere — with the marketplace still
 * registered and nothing rolling any of it back.
 *
 * The existing regression file drives the same pipeline against the DEVELOPER'S REAL `$HOME`.
 * It gets away with it because its fixture name is absent from the real settings, so G05's
 * `ekm[name] !== undefined` is false and nothing is ever written. These tests must SEED that
 * entry to exercise the rollback, so they need a fake home — and arming a fake home inside the
 * existing file would silently arm it for its five other cases too. Hence a new file.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { join } from 'path'

const H = vi.hoisted(() => {
  // `vi.hoisted` runs ABOVE every static import, so `join`/`mkdtempSync` from the top of this
  // file are not initialised yet. Everything here is `require`d inline, and the temp root comes
  // from `process.env` rather than `os.tmpdir()` because `os` is the module being mocked.
  const { mkdtempSync: mk } = require('fs') as typeof import('fs')
  const { join: j } = require('path') as typeof import('path')
  const root = (process.env.TMPDIR || '/tmp').replace(/\/$/, '')
  const FAKE_HOME = mk(j(root, 'aim-marketplace-rollback-'))
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

/**
 * The CLI is the observable for two of the three compensations: G03's undo is a
 * `marketplace add`, and G02b's undo is a `plugin install` per reinstated target. Recording argv
 * is what turns "the rollback ran" into "the rollback did the specific thing it claims".
 */
const cli = vi.hoisted(() => ({ calls: [] as string[][], failOn: null as string | null }))
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFile: (file: string, args: string[], _opts: unknown, cb: (e: Error | null, r?: unknown) => void) => {
      cli.calls.push([file, ...args])
      // Deliberately NOT the string "not found": that one is the documented orphan path G03
      // treats as a no-op, so using it here would test the tolerance rather than the rollback.
      if (cli.failOn && args.join(' ').includes(cli.failOn)) { cb(new Error('CLI refused: registry is locked')); return }
      cb(null, { stdout: '', stderr: '' })
    },
  }
})

/**
 * G05's only mutation is `saveJsonSafe`, which is a `writeFile` + `rename`. Failing the rename
 * for one specific destination is the narrowest way to abort the LAST gate that can abort —
 * which is the whole point, because that is the abort whose unwinding was previously absent.
 */
const fsp = vi.hoisted(() => ({ failRenameTo: null as string | null }))
vi.mock('fs/promises', async (importOriginal) => {
  const actual = await importOriginal<typeof import('fs/promises')>()
  const rename = async (from: Parameters<typeof actual.rename>[0], to: Parameters<typeof actual.rename>[1]) => {
    if (fsp.failRenameTo && String(to).endsWith(fsp.failRenameTo)) {
      fsp.failRenameTo = null // one-shot: the rollback's own write must succeed
      throw new Error('EIO: settings write failed')
    }
    return actual.rename(from, to)
  }
  return { ...actual, rename, default: { ...actual, rename } }
})

/**
 * The cascade's two enumeration seams. Mocking them (rather than seeding a real install tree)
 * keeps the fixture about the ROLLBACK; `ChangePlugin` still runs for real underneath, so the
 * uninstall/reinstall pair is the production one.
 */
const enumeration = vi.hoisted(() => ({
  plugins: [] as Array<{ name: string }>,
  installs: [] as Array<{ scope: 'user' | 'local'; agentId?: string; agentDir?: string }>,
}))
vi.mock('@/lib/plugin-enumeration', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/plugin-enumeration')>()
  return {
    ...actual,
    listPluginsInMarketplace: async () => enumeration.plugins,
    listInstallsOf: async () => enumeration.installs,
  }
})

const MKT = 'doomed-marketplace'
const PLUGIN = 'doomed-plugin'
const SOURCE_REPO = 'someone/doomed-marketplace'
const SETTINGS = join(H.FAKE_HOME, '.claude', 'settings.json')
const OWNER = { isSystemOwner: true as const }

function seedSettings(entry: unknown): void {
  mkdirSync(join(H.FAKE_HOME, '.claude'), { recursive: true })
  writeFileSync(SETTINGS, JSON.stringify({ extraKnownMarketplaces: { [MKT]: entry } }, null, 2), 'utf-8')
}

function readEkm(): Record<string, unknown> {
  if (!existsSync(SETTINGS)) return {}
  return (JSON.parse(readFileSync(SETTINGS, 'utf-8')) as { extraKnownMarketplaces?: Record<string, unknown> })
    .extraKnownMarketplaces ?? {}
}

const argvOf = (needle: string) => cli.calls.filter(c => c.join(' ').includes(needle))

describe('ChangeMarketplace::remove — every abort unwinds every store (R51)', () => {
  beforeEach(() => {
    cli.calls = []
    cli.failOn = null
    fsp.failRenameTo = null
    // One plugin, installed at user scope. That is the smallest fixture in which the cascade
    // records anything at all — and every assertion below about G02b's undo is only non-vacuous
    // because this records something.
    enumeration.plugins = [{ name: PLUGIN }]
    enumeration.installs = [{ scope: 'user' }]
    seedSettings({ source: { source: 'github', repo: SOURCE_REPO } })
  })

  it('reinstalls every plugin the cascade uninstalled when the CLI refuses to deregister', async () => {
    // The abort that used to be silent: the cascade has already stripped the plugin from every
    // target, and then the marketplace itself cannot be removed. Old behaviour returned
    // "CLI refused" over a host missing all of that marketplace's plugins.
    cli.failOn = 'marketplace remove'
    const { DeleteMarketplace } = await import('@/services/element-management-service')

    const result = await DeleteMarketplace({ name: MKT }, OWNER)

    expect(result.success).toBe(false)
    expect(result.error).toContain('NO CHANGES WERE MADE')
    expect(result.error).toContain('G03')
    expect(result.error).not.toContain('INVALID STATE')

    // NON-VACUITY: the reinstall proves the cascade actually uninstalled something to reinstate.
    // Without this the whole test would pass over an empty `uninstalled` list.
    expect(argvOf(`plugin install ${PLUGIN}`)).toHaveLength(1)
    // G03 recorded nothing (the CLI refused before deregistering), so its own undo is a no-op —
    // and the runner must not invent a re-add for a removal that never happened.
    expect(argvOf('marketplace add')).toHaveLength(0)
  })

  it('re-adds the marketplace it deregistered when the settings write fails afterwards', async () => {
    // G05 is the LAST gate that can abort, so this is the path that proves the sequence extends
    // to it rather than stopping at the CLI call.
    fsp.failRenameTo = join('.claude', 'settings.json')
    const { DeleteMarketplace } = await import('@/services/element-management-service')

    const result = await DeleteMarketplace({ name: MKT }, OWNER)

    expect(result.success).toBe(false)
    expect(result.error).toContain('NO CHANGES WERE MADE')
    expect(result.error).toContain('G05')

    // G03's undo: the ONE call that restores both the registration and the plugin cache.
    expect(argvOf(`marketplace add ${SOURCE_REPO}`)).toHaveLength(1)
    // G02b's undo, reached only because the unwind continued past G03.
    expect(argvOf(`plugin install ${PLUGIN}`)).toHaveLength(1)
    // The settings write is the thing that failed, so the entry must still be on disk untouched.
    expect(readEkm()[MKT]).toEqual({ source: { source: 'github', repo: SOURCE_REPO } })
  })

  it('says INVALID STATE, naming G03, when the entry records no source to re-add from', async () => {
    // R51.5: a compensation that cannot do its job must say so rather than claim "no changes".
    // The marketplace really is deregistered and its cache really is gone at this point.
    seedSettings({})
    fsp.failRenameTo = join('.claude', 'settings.json')
    const { DeleteMarketplace } = await import('@/services/element-management-service')

    const result = await DeleteMarketplace({ name: MKT }, OWNER)

    expect(result.success).toBe(false)
    expect(result.error).toContain('INVALID STATE')
    expect(result.error).toContain('G03')
    expect(result.error).toContain('no source recorded')
    expect(argvOf('marketplace add')).toHaveLength(0)
  })

  it('0-IMPACT: every path this suite writes is inside the fake home', () => {
    // The suite seeds and asserts a real settings.json. If the fake home ever fails to take,
    // these tests would be editing the developer's own Claude configuration.
    expect(SETTINGS.startsWith(H.FAKE_HOME)).toBe(true)
    const tmp = String(process.env.TMPDIR || '/tmp')
    expect(H.FAKE_HOME.startsWith('/tmp') || H.FAKE_HOME.startsWith('/private') || H.FAKE_HOME.startsWith(tmp)).toBe(true)
  })
})
