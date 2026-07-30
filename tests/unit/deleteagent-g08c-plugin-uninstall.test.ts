/**
 * `DeleteAgent` G08c — the gate that hands a deleted agent's local plugins to the `claude plugin`
 * CLI to uninstall. TRDD-OWO449MR (this shape) · TRDD-AQTGAY60 (the gate's origin as G09b) ·
 * TRDD-0GCIMQ9F (Shape A, which forced the move) · TRDD-FHBGF0WG (the record scoping).
 *
 * IT WAS G09b AND IT RAN AFTER THE FOLDER DELETE. There it hand-edited installed_plugins.json,
 * and that placement bought irreversibility for free: with the workdir gone every row for it was
 * provably false, so removing it could not be wrong and needed no compensation. Shape A gives
 * that up on purpose — the file belongs to the CLI, and `claude plugin uninstall --scope local
 * --cwd <dir>` needs <dir> to EXIST. So the gate moved BEFORE G09, inside the sequence.
 *
 * THE PROPERTY THIS FILE EXISTS TO PIN is therefore an ORDERING one, and it is stated as such:
 * the fake adapter records `existsSync(targetDir)` AT CALL TIME, and the test asserts it was
 * true. Nothing else can express "the uninstall happened while the folder was still there" —
 * an end-state assertion is satisfied identically by a gate that ran too late and silently did
 * nothing.
 *
 * WHAT THIS PINS THAT NOTHING ELSE DOES. The reader is unit-tested
 * (`tests/unit/installed-plugins-records.test.ts`) and the post-condition probe is unit-tested
 * (`tests/unit/agent-teardown.test.ts`), but no test drove `DeleteAgent` itself — so "hard delete
 * uninstalls, soft delete leaves alone" was true only BY CONSTRUCTION (the gate sits inside the
 * folder-deleted branch). That is a claim about the code as written, not a guard against the next
 * edit, which is exactly the gap the FHBGF0WG bug lived in — and the reorder is precisely the
 * kind of edit that drops a branch's guards silently.
 *
 * WHY A DEDICATED FILE. The five files that already drive `DeleteAgent` cannot reach this branch:
 * they contain themselves with layer 2 only, so `agentsRoot` (derived from the service's
 * module-load `const HOME = homedir()`) stays the developer's real `~/agents` while the fixture
 * workdir is under a temp home — `startsWith` is false and the branch is skipped. Adding
 * `vi.mock('os')` to one of them would arm the real `rm -rf` for every existing hard-delete case
 * in a ~1 400-line file at once. The harness lives in `tests/helpers/drive-delete-agent.ts`; the
 * safety argument (a broken mock fails INERT, never destructive) is documented there.
 *
 * 0-IMPACT: both mock layers, a temp home, and a closing test that PROVES the developer's real
 * `~/agents` and `~/.claude/plugins/installed_plugins.json` were untouched — because a suite that
 * silently wrote the real stores would otherwise look identical to one that did not.
 */
import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest'
import { existsSync, readdirSync, statSync, mkdtempSync, mkdirSync } from 'fs'
import { join } from 'path'

const H = vi.hoisted(() => {
  // `vi.hoisted` runs ABOVE every static import, so the `fs`/`path` imports at the top of this
  // file are not initialised yet — everything here is `require`d inline. The temp root comes from
  // `process.env` rather than `os.tmpdir()` because `os` is the module being mocked.
  const { mkdtempSync: mk } = require('fs') as typeof import('fs')
  const { join: j } = require('path') as typeof import('path')
  const root = (process.env.TMPDIR || '/tmp').replace(/\/$/, '')
  const FAKE_HOME = mk(j(root, 'aim-deleteagent-g09b-'))
  return {
    FAKE_HOME,
    FAKE_STATE: j(FAKE_HOME, '.aimaestro'),
    store: new Map<string, Record<string, unknown>>(),
  }
})

const HELPER = '@/tests/helpers/drive-delete-agent'

// ── Layer 1: the service resolves `const HOME = homedir()` at MODULE LOAD, and both `agentsRoot`
// (G09's safety guard) and `INSTALLED_FILE` (G09b's target) come from it. `lib/agent-teardown.ts`
// calls `homedir()` in its probes for the same reason. ──────────────────────────────────────────
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => H.FAKE_HOME, default: { ...actual, homedir: () => H.FAKE_HOME } }
})

// ── Layer 2: `statePath()` resolves `homedir()` through a RUNTIME require that layer 1 cannot
// reach. G08b re-reads `statePath('agents','registry.json')` with the REAL `fs`. ────────────────
vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, H.FAKE_HOME, H.FAKE_STATE)
})

// ── The collaborators. `fs` is deliberately NOT mocked: the property under test is a FILE being
// rewritten, and a mocked `fs` would make G09b, the folder deletion, and G08b's on-disk
// verification all unobservable. ───────────────────────────────────────────────────────────────
vi.mock('@/lib/agent-registry', async () => {
  const h = await import(HELPER)
  return h.registryMock(H.store as never, h.registryPath(H.FAKE_STATE))
})
vi.mock('@/lib/governance', async () => (await import(HELPER)).stubs.governance())
vi.mock('@/lib/team-registry', async () => (await import(HELPER)).stubs.teamRegistry())
vi.mock('@/lib/group-registry', async () => (await import(HELPER)).stubs.groupRegistry())
vi.mock('@/lib/agent-runtime', async () => (await import(HELPER)).stubs.agentRuntime())
vi.mock('@/lib/session-persistence', async () => (await import(HELPER)).stubs.sessionPersistence())
vi.mock('@/lib/amp-auth', async () => (await import(HELPER)).stubs.ampAuth())
vi.mock('@/lib/aid-token', async () => (await import(HELPER)).stubs.aidToken())
vi.mock('@/lib/governance-request-registry', async () => (await import(HELPER)).stubs.governanceRequests())
vi.mock('@/lib/ledger-emit', async () => (await import(HELPER)).stubs.ledgerEmit())
vi.mock('@/lib/aid-ledger-authority', () => ({ recordAidRevocation: async () => undefined }))
vi.mock('@/services/agents-transfer-service', async () => (await import(HELPER)).stubs.agentsTransfer())

// THE FAKE ADAPTER. It stands in for `claude plugin uninstall|install` and does two jobs:
//   1. RECORDS the call — including `existsSync(targetDir)` at the moment of the call, which is
//      the ordering evidence this whole file exists for.
//   2. SIMULATES the CLI's effect on the store, so the end-to-end assertions (G10's residue probe
//      finds nothing) are testing our pipeline rather than a no-op. A double that models the
//      external command as a pure no-op cannot tell "it worked" from "it left no trace".
const cli = vi.hoisted(() => ({
  uninstalls: [] as { key: string; targetDir: string; scope?: string; dirExisted: boolean }[],
  installs: [] as { key: string; targetDir: string; marketplace?: string }[],
  failUninstallFor: null as string | null,
  failInstall: false,
}))
vi.mock('@/lib/client-plugin-adapters', () => ({
  getAdapter: async () => ({
    clientType: 'claude',
    supportsEnableDisable: true,
    async uninstall(plugin: { name: string; sourcePlugin?: string }, targetDir: string, opts?: { scope?: string }) {
      const { existsSync: ex, readFileSync: rf, writeFileSync: wf } = require('fs') as typeof import('fs')
      const key = plugin.sourcePlugin ? `${plugin.name}@${plugin.sourcePlugin}` : plugin.name
      cli.uninstalls.push({ key, targetDir, scope: opts?.scope, dirExisted: ex(targetDir) })
      if (cli.failUninstallFor === key) return { success: false, error: 'simulated CLI failure' }
      // What the real CLI does: drop THIS project's local row for THIS key, narrowly.
      const { join: j } = require('path') as typeof import('path')
      const store = j(H.FAKE_HOME, '.claude', 'plugins', 'installed_plugins.json')
      if (ex(store)) {
        const parsed = JSON.parse(rf(store, 'utf-8')) as { plugins: Record<string, unknown> }
        const rows = parsed.plugins[key]
        if (Array.isArray(rows)) {
          const keep = rows.filter((r) => {
            const rec = r as { scope?: string; projectPath?: string }
            return !(rec.scope === 'local' && rec.projectPath === targetDir)
          })
          if (keep.length === 0) delete parsed.plugins[key]
          else parsed.plugins[key] = keep
          wf(store, JSON.stringify(parsed, null, 2), 'utf-8')
        }
      }
      return { success: true }
    },
    async install(plugin: { name: string }, targetDir: string, opts?: { marketplace?: string }) {
      const key = opts?.marketplace ? `${plugin.name}@${opts.marketplace}` : plugin.name
      cli.installs.push({ key, targetDir, marketplace: opts?.marketplace })
      return cli.failInstall
        ? { success: false, installedPaths: [], error: 'simulated CLI failure' }
        : { success: true, installedPaths: [] }
    },
  }),
}))

import {
  driveDeleteAgent,
  installedPluginsPath,
  localRecord,
  readInstalledPlugins,
  seedAgent,
  seedInstalledPlugins,
  userRecord,
  type FakeRegistryStore,
} from '@/tests/helpers/drive-delete-agent'

const store = H.store as unknown as FakeRegistryStore
const CORE = 'ai-maestro-plugin@ai-maestro-plugins'
const OTHER = 'some-other-plugin@ai-maestro-plugins'

beforeEach(() => {
  cli.uninstalls = []
  cli.installs = []
  cli.failUninstallFor = null
  cli.failInstall = false
})

describe('DeleteAgent G08c — the CLI is asked WHILE the workdir still exists', () => {
  it('uninstalls every local plugin for the doomed workdir, at local scope, before the folder goes', async () => {
    const doomed = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'g08c-hard-1', name: 'g08c-hard-1' })
    const sibling = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'g08c-keep-1', name: 'g08c-keep-1' })
    // Two keys for the doomed workdir, so this also covers the multi-plugin sweep through the real
    // pipeline rather than through the reader directly.
    seedInstalledPlugins(H.FAKE_HOME, {
      [CORE]: [localRecord(doomed), localRecord(sibling), userRecord()],
      [OTHER]: [localRecord(doomed)],
    })

    const result = await driveDeleteAgent({ agentId: 'g08c-hard-1', hard: true, deleteFolder: true })

    expect(result.success).toBe(true)

    // ── THE ORDERING PROPERTY, which is the entire reason this gate moved ──────────────────
    // `claude plugin uninstall --scope local --cwd <dir>` cannot work on a directory that is
    // gone. `dirExisted` is sampled INSIDE the fake adapter, at the moment of the call, because
    // no end-state assertion can distinguish "ran too early to matter" from "ran too late to
    // work" — both leave the same store behind when the CLI is a no-op.
    expect(cli.uninstalls.map(u => u.key).sort()).toEqual([CORE, OTHER].sort())
    for (const u of cli.uninstalls) {
      expect(u.dirExisted, `${u.key} was uninstalled AFTER the workdir was deleted`).toBe(true)
      expect(u.targetDir).toBe(doomed)
      expect(u.scope).toBe('local')
    }

    // The folder assertion is ALSO the containment proof: it can only pass if the fake home took
    // effect — with a broken mock layer the branch is skipped and this reddens (fail inert).
    expect(existsSync(doomed)).toBe(false)
    expect(existsSync(sibling)).toBe(true)

    // And the CLI's narrow removal is what ends up in the store: sibling and global row intact.
    const plugins = readInstalledPlugins(H.FAKE_HOME)
    expect(plugins[CORE]).toEqual([localRecord(sibling), userRecord()])
    expect(OTHER in plugins).toBe(false)

    expect(result.operations.some(o => /^G08c: Uninstalled 2 local plugin\(s\)/.test(o))).toBe(true)
    expect(result.operations.find(o => o.startsWith('G08c:'))).toContain(OTHER)
  })

  it('reports the empty case honestly instead of claiming an uninstall', async () => {
    // A workdir with no records must still produce a G08c line — silence and "nothing to do" are
    // the same output otherwise, which is how a skipped gate hides.
    const doomed = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'g08c-hard-2', name: 'g08c-hard-2' })
    seedInstalledPlugins(H.FAKE_HOME, { [CORE]: [userRecord()] })

    const result = await driveDeleteAgent({ agentId: 'g08c-hard-2', hard: true, deleteFolder: true })

    expect(result.success).toBe(true)
    expect(existsSync(doomed)).toBe(false)
    expect(cli.uninstalls).toEqual([])
    expect(result.operations.some(o => /^G08c: No local plugin records for/.test(o))).toBe(true)
    expect(readInstalledPlugins(H.FAKE_HOME)[CORE]).toEqual([userRecord()])
  })

  it('leaves the plugin-records store out of the G10 residue, which is what PROVES the gate ran', async () => {
    // The independent channel: G10 asks each store whether it still claims the agent. Before this
    // gate existed the probe reported residue on every hard delete — and nothing asked it to.
    const doomed = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'g08c-hard-3', name: 'g08c-hard-3' })
    seedInstalledPlugins(H.FAKE_HOME, { [CORE]: [localRecord(doomed)] })

    const result = await driveDeleteAgent({ agentId: 'g08c-hard-3', hard: true, deleteFolder: true })

    expect(result.success).toBe(true)
    expect((result.residue ?? []).map(r => r.store)).not.toContain('plugin-records')
    expect(result.incomplete).toBeFalsy()
  })

  it('FAILS the whole delete when the CLI refuses, and re-installs what it already took', async () => {
    // A partial uninstall is precisely the state R51 forbids. The runner's write-ahead means a
    // gate that throws mid-run is still compensated, so the plugin already removed comes back.
    const doomed = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'g08c-fail-1', name: 'g08c-fail-1' })
    seedInstalledPlugins(H.FAKE_HOME, { [CORE]: [localRecord(doomed)], [OTHER]: [localRecord(doomed)] })
    cli.failUninstallFor = OTHER

    const result = await driveDeleteAgent({ agentId: 'g08c-fail-1', hard: true, deleteFolder: true })

    expect(result.success).toBe(false)
    // The folder is the proof the delete really was abandoned, not merely reported as failed.
    expect(existsSync(doomed)).toBe(true)
    // CORE came out first, so the compensation must put CORE back — and only CORE.
    expect(cli.installs.map(i => i.key)).toEqual([CORE])
    expect(cli.installs[0].targetDir).toBe(doomed)
  })
})

describe('DeleteAgent G08c — the guards that moved WITH the gate', () => {
  it('never uninstalls on a soft delete — the folder survives, so the records stay true', async () => {
    // A soft delete keeps the workdir, so its records stay TRUE — re-adoption over a tombstone
    // depends on them. This was guaranteed by the old gate's PLACEMENT inside the folder-deleted
    // branch; lifting the gate into the sequence had to carry the condition explicitly, and this
    // is the case that breaks first if it did not.
    const kept = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'g08c-soft-1', name: 'g08c-soft-1' })
    seedInstalledPlugins(H.FAKE_HOME, { [CORE]: [localRecord(kept), userRecord()] })

    const result = await driveDeleteAgent({ agentId: 'g08c-soft-1', hard: false, deleteFolder: true })

    expect(result.success).toBe(true)
    expect(existsSync(kept)).toBe(true)
    expect(cli.uninstalls).toEqual([])
    expect(readInstalledPlugins(H.FAKE_HOME)[CORE]).toEqual([localRecord(kept), userRecord()])
    expect(result.operations).toContain('G08c: Folder preserved — local plugin records stay true, nothing to uninstall')
    expect(result.operations).toContain('G09: Soft-delete — folder preserved')
  })

  it('never uninstalls on a hard delete that did not ask for the folder', async () => {
    // `deleteFolder: false` means the workdir survives, so the records are still true. The gate
    // must key on the folder going away, never on "DeleteAgent was called".
    const kept = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'g08c-hard-nofolder', name: 'g08c-hard-nofolder' })
    seedInstalledPlugins(H.FAKE_HOME, { [CORE]: [localRecord(kept)] })

    const result = await driveDeleteAgent({ agentId: 'g08c-hard-nofolder', hard: true, deleteFolder: false })

    expect(result.success).toBe(true)
    expect(existsSync(kept)).toBe(true)
    expect(cli.uninstalls).toEqual([])
    expect(readInstalledPlugins(H.FAKE_HOME)[CORE]).toEqual([localRecord(kept)])
    expect(result.operations).toContain('G09: Hard-delete but no folder deletion requested')
  })

  it('never uninstalls from an ADOPTED workdir outside ~/agents, whose folder G09 refuses to delete', async () => {
    // THE HAZARD THE REORDER NEARLY SHIPPED. The old gate was nested inside G09's
    // startsWith(agentsRoot) check as well as the hard+deleteFolder one. A MAINTAINER adopted at
    // ~/Code/<project> asks for deleteFolder, G09 correctly REFUSES to delete a folder outside
    // ~/agents — and a gate that kept only the first guard would strip that live project's
    // plugins anyway. Its records are TRUE, because its folder is still there.
    const outside = join(H.FAKE_HOME, 'Code', 'adopted-project')
    mkdirSync(outside, { recursive: true })
    seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, {
      id: 'g08c-adopted', name: 'g08c-adopted', workingDirectory: outside,
    })
    seedInstalledPlugins(H.FAKE_HOME, { [CORE]: [localRecord(outside)] })

    const result = await driveDeleteAgent({ agentId: 'g08c-adopted', hard: true, deleteFolder: true })

    expect(result.success).toBe(true)
    expect(existsSync(outside), 'G09 must refuse to delete a folder outside ~/agents').toBe(true)
    expect(cli.uninstalls).toEqual([])
    expect(readInstalledPlugins(H.FAKE_HOME)[CORE]).toEqual([localRecord(outside)])
    expect(result.operations.some(o => /^G08c: Folder outside ~\/agents\//.test(o))).toBe(true)
  })
})

describe('0-IMPACT containment — proven, not assumed', () => {
  it('never touched the developer real ~/agents or ~/.claude/plugins/installed_plugins.json', () => {
    const tmp = String(process.env.TMPDIR || '/tmp')
    expect(H.FAKE_HOME.startsWith('/tmp') || H.FAKE_HOME.startsWith('/private') || H.FAKE_HOME.startsWith(tmp)).toBe(true)
    // Positive control: the fixture store we DID write exists, so the real-store checks below are
    // not vacuous — "nothing was written anywhere" would satisfy them on its own.
    expect(existsSync(installedPluginsPath(H.FAKE_HOME))).toBe(true)
    expect(REAL_STORE_BEFORE).toEqual(realStoreFingerprint())
    // This suite ARMS `rm -rf`, so the folder half needs its own witness, not just the file half.
    expect(REAL_AGENTS_BEFORE).toEqual(realAgentsFingerprint())
  })
})

/** size+mtime of the REAL install store, captured at module load before any test ran. */
function realStoreFingerprint(): string {
  const p = join(process.env.HOME || '', '.claude', 'plugins', 'installed_plugins.json')
  if (!existsSync(p)) return 'absent'
  const s = statSync(p)
  return `${s.size}:${s.mtimeMs}`
}
/** The developer's real `~/agents` entry list — the thing an escaped `rm -rf` would shorten. */
function realAgentsFingerprint(): string {
  const p = join(process.env.HOME || '', 'agents')
  if (!existsSync(p)) return 'absent'
  return readdirSync(p).sort().join('|')
}
const REAL_STORE_BEFORE = realStoreFingerprint()
const REAL_AGENTS_BEFORE = realAgentsFingerprint()

afterAll(() => {
  // Leave the temp dir in place — /tmp is swept by the OS, and removing it here would delete the
  // evidence if a test failed mid-run.
  void mkdtempSync
})
