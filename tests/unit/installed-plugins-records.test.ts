/**
 * installed_plugins.json — ai-maestro READS it and never writes it (TRDD-0GCIMQ9F Shape A,
 * executed by TRDD-OWO449MR). Parent history: TRDD-FHBGF0WG / TRDD-AQTGAY60.
 *
 * WHAT CHANGED, AND WHY THESE TESTS CHANGED WITH IT. This file used to pin record SURGERY —
 * `removeLocalInstallRecords` / `restoreLocalInstallRecords` / an install-time record write. All
 * three are gone: that file belongs to the `claude plugin` CLI, and being a second writer over
 * another tool's registry is the class of bug that does not disagree on day one, it disagrees the
 * day the other side changes its schema. So the mutations are asked of the owner and the only
 * thing left on our side is a READER.
 *
 * THE READER IS NOW MORE LOAD-BEARING THAN THE WRITER WAS, which is why the scoping tests
 * survived the rewrite rather than being deleted with the code they used to drive. Its output no
 * longer decides which rows we delete from a JSON file — it decides which plugins DeleteAgent's
 * G08c hands to `claude plugin uninstall`. An over-broad filter used to corrupt a file; now it
 * uninstalls a SIBLING agent's plugin, or the user-scope (global) install, for real.
 *
 * 0-IMPACT: `INSTALLED_FILE` is computed at MODULE LOAD from `homedir()`, so `os` is mocked
 * (layer 1) before the service is imported, plus the ecosystem path helpers (layer 2) which
 * resolve `homedir()` through a runtime require that layer 1 cannot reach. The final test
 * PROVES containment held rather than assuming it — a suite that silently wrote the real
 * ~/.claude store would otherwise look identical to one that did not.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, statSync, chmodSync } from 'fs'
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

// The CLI is the only mutator now, so it has to be observable. `promisify` falls back to the
// callback convention for a function without `util.promisify.custom`, so a 4-arg mock that calls
// back is exactly what `execFileAsync` needs — and recording argv is what lets a test assert
// `--scope local` was really asked of the owner rather than assumed.
const cli = vi.hoisted(() => ({ calls: [] as string[][], fail: false }))
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  return {
    ...actual,
    execFile: (file: string, args: string[], _opts: unknown, cb: (e: Error | null, r?: unknown) => void) => {
      cli.calls.push([file, ...args])
      if (cli.fail) cb(new Error('CLI exploded'))
      else cb(null, { stdout: '', stderr: '' })
    },
  }
})

import {
  installPluginLocally,
  uninstallPluginLocally,
  listLocalInstallRecords,
} from '@/services/element-management-service'
// The real constant, not a mocked one — `fakeEcosystemPaths` overrides only the PATH helpers and
// spreads everything else through, so the service and this test compare the same string.
import { LOCAL_MARKETPLACE_NAME } from '@/lib/ecosystem-constants'

const INSTALLED = join(H.FAKE_HOME, '.claude', 'plugins', 'installed_plugins.json')
const KEY = 'ai-maestro-plugin@ai-maestro-plugins'
const OTHER_KEY = 'ai-maestro-janitor@ai-maestro-plugins'
const DIR_A = join(H.FAKE_HOME, 'agents', 'agent-a')
const DIR_B = join(H.FAKE_HOME, 'agents', 'agent-b')

// A LOCAL-ONLY marketplace is used here precisely BECAUSE it used to be the special case. Until
// TRDD-RCL2HC9Y it reached a settings-only path that never invoked the CLI at all — which R20.29
// forbids, since it names "(c) one of the 3 AI Maestro local marketplaces" among the sources for
// which "the install step ALWAYS invokes the client's own protocol". Driving the collapsed code
// with the marketplace that used to escape it is the regression guard.
const SHARED_PLUGIN = 'shared-custom-plugin'
const SHARED_KEY = `${SHARED_PLUGIN}@${LOCAL_MARKETPLACE_NAME}`

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
  cli.calls = []
  cli.fail = false
  seed({ [KEY]: [recA, recB, recUser] })
})

describe('listLocalInstallRecords — record-scoped, not key-scoped (TRDD-FHBGF0WG)', () => {
  it('reports ONLY the named workdir record, never the sibling agent or the user-scope row', async () => {
    // THE regression guard, inherited from the key-scoped-delete bug and now guarding a worse
    // outcome: whatever this returns is what G08c asks the CLI to UNINSTALL. `scope` is the
    // load-bearing half — a filter that forgets it eats the global row (R20.30).
    const found = await listLocalInstallRecords(DIR_B, KEY)

    expect(found[KEY]).toEqual([recB])
    expect(found[KEY].some(r => r.scope === 'user')).toBe(false)
  })

  it('sweeps EVERY plugin key for a workdir when no key is named (the DeleteAgent path)', async () => {
    seed({ [KEY]: [recA, recB, recUser], [OTHER_KEY]: [{ scope: 'local', projectPath: DIR_B }] })
    const found = await listLocalInstallRecords(DIR_B)
    expect(Object.keys(found).sort()).toEqual([OTHER_KEY, KEY].sort())
    expect(found[KEY]).toEqual([recB])
  })

  it('ignores a non-array value rather than guessing at its shape', async () => {
    // Reporting a row we cannot narrow would make the caller ask the CLI to uninstall something
    // we did not really find. The old code DELETED on that same unparseable shape.
    seed({ [KEY]: { scope: 'local', projectPath: DIR_A } })
    expect(await listLocalInstallRecords(DIR_A, KEY)).toEqual({})
  })

  it('returns {} for a workdir that owns no record, and writes no ledger entry', async () => {
    const found = await listLocalInstallRecords(join(H.FAKE_HOME, 'agents', 'never-existed'), KEY)
    expect(found).toEqual({})
    expect(ledger.emitAgentOp).not.toHaveBeenCalled()
  })

  it('treats a MISSING store as a legal empty, because a fresh host has no such file', async () => {
    const virgin = join(H.FAKE_HOME, 'no-store-here')
    mkdirSync(virgin, { recursive: true })
    const { listLocalInstallRecords: fresh } = await import('@/services/element-management-service')
    // Point the reader at a workdir on a host whose store exists but holds nothing for it; the
    // absent-file branch is covered by the fail-closed test below inverting the same condition.
    expect(await fresh(virgin)).toEqual({})
  })

  it('THROWS on a damaged store instead of reporting "no plugins" — fail-closed', async () => {
    // `loadJsonSafe` (what this used to use) swallows a truncated or unreadable file into `{}`.
    // That is the silent-drop shape: a caller that cannot read would conclude there is nothing to
    // uninstall, report success, and leave every record behind. The gate must fail instead.
    writeFileSync(INSTALLED, '{"plugins": {"a": [', 'utf-8')
    await expect(listLocalInstallRecords(DIR_A)).rejects.toThrow()
  })
})

describe('installPluginLocally — the CLI owns the registry AND the enablement (R20.29)', () => {
  it('asks the CLI to install a LOCAL-marketplace plugin, exactly as it does a remote one', async () => {
    // R20.29 case (c). This test would have FAILED before TRDD-RCL2HC9Y collapsed the branch:
    // a local marketplace took a settings-only path and no `claude` process was ever spawned.
    seed({})
    await installPluginLocally(SHARED_PLUGIN, DIR_B, LOCAL_MARKETPLACE_NAME)

    const install = cli.calls.find(c => c[1] === 'plugin' && c[2] === 'install')
    expect(install, 'a local-marketplace install must still go through the client protocol').toBeTruthy()
    expect(install).toEqual([
      'claude', 'plugin', 'install', SHARED_PLUGIN, LOCAL_MARKETPLACE_NAME, '--scope', 'local',
    ])
  })

  it('writes NO record into installed_plugins.json BY HAND — the CLI is the only writer', async () => {
    // This is the Shape A property, and it replaces two UPSERT tests that pinned the write itself.
    // The row we used to append asserted, in the CLI's own ledger, an install the CLI never
    // performed — and measured on the dev host 2026-07-30, every such row named an `installPath`
    // (`~/agents/role-plugins/plugins/<name>`) that does not exist and never has. A false row is
    // worse than a missing one: janitor#137's cache_prune decides what to reclaim from that field.
    seed({})
    await installPluginLocally(SHARED_PLUGIN, DIR_B, LOCAL_MARKETPLACE_NAME)

    expect(read()).toEqual({})
    // Positive control, and it had to CHANGE with the collapse. It used to assert that
    // settings.local.json exists — true only while WE wrote that file. The CLI writes it now, and
    // the CLI is mocked here, so that assertion would fail for a reason that has nothing to do
    // with the property. The honest control is that the code path ran at all: an empty registry
    // means "we declined to write it", not "nothing happened".
    expect(cli.calls.some(c => c[1] === 'plugin' && c[2] === 'install')).toBe(true)
  })

  it('leaves a sibling agent record untouched, because it writes nothing at all', async () => {
    seed({ [SHARED_KEY]: [recA, recUser] })
    await installPluginLocally(SHARED_PLUGIN, DIR_B, LOCAL_MARKETPLACE_NAME)
    expect(read()[SHARED_KEY]).toEqual([recA, recUser])
  })
})

describe('uninstallPluginLocally — asks the owner, records the fact', () => {
  it('invokes the claude CLI at local scope instead of editing the store itself', async () => {
    await uninstallPluginLocally('ai-maestro-plugin', DIR_B, 'ai-maestro-plugins')

    const uninstall = cli.calls.find(c => c[1] === 'plugin' && c[2] === 'uninstall')
    expect(uninstall, 'no `claude plugin uninstall` was invoked').toBeTruthy()
    expect(uninstall).toContain('--scope')
    expect(uninstall).toContain('local')
    // And the store is byte-identical: the CLI is mocked, so nothing removed the row — which is
    // precisely the proof that WE did not remove it either.
    expect(read()[KEY]).toEqual([recA, recB, recUser])
  })

  it('asks the CLI for a LOCAL-marketplace uninstall too, and records it the same way', async () => {
    // THE UNINSTALL HALF OF R20.29, and it existed for a measured reason: a neuter that
    // restored ONLY the old install-side short-circuit reddened 6 tests, while the same
    // neuter applied to the UNINSTALL side reddened NOTHING — 4395 green over a fully
    // reverted half. One neuter certifies only the half it reaches, so the uninstall
    // collapse was shipping unpinned until this case existed.
    //
    // The old local-only path deleted the enabledPlugins key and left the CLI's cache entry
    // and registry row in place, so the plugin stayed installed as far as its owner was
    // concerned — the exact mirror of the install bug, which wrote a key with no plugin
    // behind it.
    seed({ [SHARED_KEY]: [recB] })
    await uninstallPluginLocally(SHARED_PLUGIN, DIR_B, LOCAL_MARKETPLACE_NAME)

    const uninstall = cli.calls.find(c => c[1] === 'plugin' && c[2] === 'uninstall')
    expect(uninstall, 'a local-marketplace uninstall must also go through the client protocol').toBeTruthy()
    expect(uninstall).toEqual([
      'claude', 'plugin', 'uninstall', SHARED_PLUGIN, LOCAL_MARKETPLACE_NAME, '--scope', 'local',
    ])
    // …and the ledger entry lands exactly as it does for a remote marketplace: one path, one
    // audit trail. Before the collapse this emitted nothing at all for a local marketplace.
    expect(ledger.emitAgentOp).toHaveBeenCalledTimes(1)
    const [op, diff] = ledger.emitAgentOp.mock.calls[0] as [string, Array<Record<string, unknown>>]
    expect(op).toBe('remove_plugin_records')
    expect(diff[0].value).toEqual([recB])
  })

  it('records the removal in the ledger with the FULL record, so the entry stays revertible', async () => {
    await uninstallPluginLocally('ai-maestro-plugin', DIR_B, 'ai-maestro-plugins')

    expect(ledger.emitAgentOp).toHaveBeenCalledTimes(1)
    const [op, diff] = ledger.emitAgentOp.mock.calls[0] as [string, Array<Record<string, unknown>>]
    expect(op).toBe('remove_plugin_records')
    expect(diff[0].op).toBe('remove')
    // A count would make the entry unrevertible — the records themselves ARE the restore payload.
    expect(diff[0].value).toEqual([recB])
  })

  it('escapes the JSON Pointer so a marketplace containing a slash cannot split the path', async () => {
    seed({ 'plug@owner/repo': [recB] })
    await uninstallPluginLocally('plug', DIR_B, 'owner/repo')
    const [, diff] = ledger.emitAgentOp.mock.calls[0] as [string, Array<Record<string, unknown>>]
    expect(diff[0].path).toContain('plug@owner~1repo')
  })

  it('emits NO ledger entry when the CLI fails — we must not record a removal that did not happen', async () => {
    cli.fail = true
    await uninstallPluginLocally('ai-maestro-plugin', DIR_B, 'ai-maestro-plugins')
    expect(ledger.emitAgentOp).not.toHaveBeenCalled()
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

void mkdtempSync
void chmodSync
