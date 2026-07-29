/**
 * installed_plugins.json record surgery — TRDD-FHBGF0WG (NPT) + TRDD-AQTGAY60 (parent).
 *
 * THE PROPERTY UNDER TEST is multi-record, and that is the whole point: with ONE agent in the
 * fixture, key-scoped and record-scoped removal behave identically, which is exactly why the
 * bug survived. `plugins[key]` is an ARRAY of per-install records spanning BOTH `local` and
 * `user` scope, and `uninstallPluginLocally` used to `delete` the whole key — so uninstalling
 * for ONE agent destroyed every other agent's record and the user-scope row (R20.30).
 *
 * 0-IMPACT: `INSTALLED_FILE` is computed at MODULE LOAD from `homedir()`, so `os` is mocked
 * (layer 1) before the service is imported, plus the ecosystem path helpers (layer 2) which
 * resolve `homedir()` through a runtime require that layer 1 cannot reach. The final test
 * PROVES containment held rather than assuming it — a suite that silently wrote the real
 * ~/.claude store would otherwise look identical to one that did not.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync } from 'fs'
import { join } from 'path'

const H = vi.hoisted(() => {
  // `vi.hoisted` runs ABOVE every static import, so `join`/`mkdtempSync` imported at the top of
  // this file are not initialised yet ("Cannot access '__vi_import_1__' before initialization").
  // Everything this block needs is therefore `require`d inline. Resolving the temp root from
  // `process.env` rather than `os.tmpdir()` is deliberate for the same reason the helper
  // documents: `os` is the module being mocked, and a validator must not depend on it.
  const { mkdtempSync: mk } = require('fs') as typeof import('fs')
  const { join: j } = require('path') as typeof import('path')
  const root = (process.env.TMPDIR || '/tmp').replace(/\/$/, '')
  const FAKE_HOME = mk(j(root, 'aim-installed-plugins-'))
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

// The ledger is asserted, not exercised: appending would need a signing key and a real chain.
const ledger = vi.hoisted(() => ({ emitAgentOp: vi.fn() }))
vi.mock('@/lib/ledger-emit', () => ({ emitAgentOp: (...a: unknown[]) => ledger.emitAgentOp(...a) }))

import {
  removeLocalInstallRecords,
  restoreLocalInstallRecords,
} from '@/services/element-management-service'

const INSTALLED = join(H.FAKE_HOME, '.claude', 'plugins', 'installed_plugins.json')
const KEY = 'ai-maestro-plugin@ai-maestro-plugins'
const OTHER_KEY = 'ai-maestro-janitor@ai-maestro-plugins'
const DIR_A = join(H.FAKE_HOME, 'agents', 'agent-a')
const DIR_B = join(H.FAKE_HOME, 'agents', 'agent-b')

/** The shape that actually ships: one key, several records, mixed scope. */
function seed(plugins: Record<string, unknown>): void {
  mkdirSync(join(H.FAKE_HOME, '.claude', 'plugins'), { recursive: true })
  writeFileSync(INSTALLED, JSON.stringify({ version: 1, plugins }, null, 2), 'utf-8')
}

function read(): Record<string, unknown> {
  return (JSON.parse(readFileSync(INSTALLED, 'utf-8')) as { plugins: Record<string, unknown> }).plugins
}

const recA = { scope: 'local', projectPath: DIR_A, version: '2.8.0', installedAt: '2026-01-01T00:00:00Z' }
const recB = { scope: 'local', projectPath: DIR_B, version: '2.8.0', installedAt: '2026-02-02T00:00:00Z' }
const recUser = { scope: 'user', version: '2.8.0', installedAt: '2026-03-03T00:00:00Z' }

beforeEach(() => {
  ledger.emitAgentOp.mockReset()
  seed({ [KEY]: [recA, recB, recUser] })
})

describe('removeLocalInstallRecords — record-scoped, not key-scoped (TRDD-FHBGF0WG)', () => {
  it('removes ONLY the named workdir record and leaves the sibling agent and the user-scope row', async () => {
    // THE regression guard. Against HEAD (`delete pluginsMap[key]`) all three vanish.
    const removed = await removeLocalInstallRecords(DIR_B, KEY)

    const after = read()[KEY] as Array<Record<string, unknown>>
    expect(after).toHaveLength(2)
    expect(after.map(r => r.projectPath)).toEqual([DIR_A, undefined])
    expect(after.some(r => r.scope === 'user')).toBe(true)
    expect(removed[KEY]).toEqual([recB])
  })

  it('keeps the key when the last LOCAL record goes but a user-scope record remains', async () => {
    await removeLocalInstallRecords(DIR_A, KEY)
    await removeLocalInstallRecords(DIR_B, KEY)
    const after = read()
    expect(after[KEY]).toEqual([recUser])
  })

  it('drops the key entirely once nothing is left under it', async () => {
    seed({ [KEY]: [recA] })
    await removeLocalInstallRecords(DIR_A, KEY)
    expect(KEY in read()).toBe(false)
  })

  it('leaves a non-array value untouched rather than guessing at its shape', async () => {
    // Deleting on a shape we cannot narrow is precisely how the old code destroyed live state.
    seed({ [KEY]: { scope: 'local', projectPath: DIR_A } })
    const removed = await removeLocalInstallRecords(DIR_A, KEY)
    expect(read()[KEY]).toEqual({ scope: 'local', projectPath: DIR_A })
    expect(removed).toEqual({})
  })

  it('sweeps EVERY plugin key for a workdir when no key is named (the DeleteAgent path)', async () => {
    seed({ [KEY]: [recA, recB, recUser], [OTHER_KEY]: [{ scope: 'local', projectPath: DIR_B }] })
    const removed = await removeLocalInstallRecords(DIR_B)
    expect(Object.keys(removed).sort()).toEqual([OTHER_KEY, KEY].sort())
    expect(read()[KEY]).toEqual([recA, recUser])
    expect(OTHER_KEY in read()).toBe(false)
  })

  it('is a no-op — and writes no ledger entry — when the workdir owns no record', async () => {
    const removed = await removeLocalInstallRecords(join(H.FAKE_HOME, 'agents', 'never-existed'), KEY)
    expect(removed).toEqual({})
    expect(read()[KEY]).toEqual([recA, recB, recUser])
    expect(ledger.emitAgentOp).not.toHaveBeenCalled()
  })
})

describe('the signed ledger records BOTH directions (USER directive 2026-07-29)', () => {
  it('records the removal with the FULL removed records as the value, so it can be reverted', async () => {
    await removeLocalInstallRecords(DIR_B, KEY)

    expect(ledger.emitAgentOp).toHaveBeenCalledTimes(1)
    const [op, diff] = ledger.emitAgentOp.mock.calls[0] as [string, Array<Record<string, unknown>>]
    expect(op).toBe('remove_plugin_records')
    expect(diff[0].op).toBe('remove')
    // A count would make the entry unrevertible — the records themselves ARE the restore payload.
    expect(diff[0].value).toEqual([recB])
  })

  it('records the REVERT too — a ledger that logs only destruction cannot prove restoration', async () => {
    const removed = await removeLocalInstallRecords(DIR_B, KEY)
    ledger.emitAgentOp.mockReset()

    await restoreLocalInstallRecords(removed)

    const [op, diff] = ledger.emitAgentOp.mock.calls[0] as [string, Array<Record<string, unknown>>]
    expect(op).toBe('restore_plugin_records')
    expect(diff[0].op).toBe('add')
    expect(diff[0].value).toEqual([recB])
  })

  it('escapes the JSON Pointer so a marketplace containing a slash cannot split the path', async () => {
    const slashKey = 'plug@owner/repo'
    seed({ [slashKey]: [recB] })
    await removeLocalInstallRecords(DIR_B, slashKey)
    const [, diff] = ledger.emitAgentOp.mock.calls[0] as [string, Array<Record<string, unknown>>]
    expect(diff[0].path).toContain('plug@owner~1repo')
  })
})

describe('restoreLocalInstallRecords — the compensation half (R51)', () => {
  it('puts back exactly what was taken, including when removal dropped the key', async () => {
    seed({ [KEY]: [recA] })
    const removed = await removeLocalInstallRecords(DIR_A, KEY)
    expect(KEY in read()).toBe(false)

    await restoreLocalInstallRecords(removed)
    expect(read()[KEY]).toEqual([recA])
  })

  it('is idempotent — a retried compensation must not duplicate the record', async () => {
    const removed = await removeLocalInstallRecords(DIR_B, KEY)
    await restoreLocalInstallRecords(removed)
    await restoreLocalInstallRecords(removed)
    const after = read()[KEY] as Array<Record<string, unknown>>
    expect(after.filter(r => r.projectPath === DIR_B)).toHaveLength(1)
  })
})

describe('0-IMPACT containment — proven, not assumed', () => {
  it('never touched the developer real ~/.claude/plugins/installed_plugins.json', () => {
    // The fixture path must be inside the OS temp dir, and the real store must be untouched.
    expect(INSTALLED.startsWith(H.FAKE_HOME)).toBe(true)
    expect(H.FAKE_HOME.startsWith('/tmp') || H.FAKE_HOME.startsWith('/private') || H.FAKE_HOME.startsWith(String(process.env.TMPDIR))).toBe(true)
    // Positive control: the fixture we DID write exists, so a passing assertion below is not
    // vacuous ("nothing was written anywhere" would satisfy the real-store check on its own).
    expect(existsSync(INSTALLED)).toBe(true)
    expect(REAL_STORE_BEFORE).toEqual(realStoreFingerprint())
  })
})

/** size+mtime of the REAL store, captured at module load before any test ran. */
function realStoreFingerprint(): string {
  const p = join(process.env.HOME || '', '.claude', 'plugins', 'installed_plugins.json')
  if (!existsSync(p)) return 'absent'
  const s = statSync(p)
  return `${s.size}:${s.mtimeMs}`
}
const REAL_STORE_BEFORE = realStoreFingerprint()

afterAll(() => {
  // Leave the temp dir in place — /tmp is swept by the OS, and removing it here would delete
  // evidence if a test failed mid-run.
  void mkdtempSync
})
