/**
 * `DeleteAgent` G09b — the gate that removes a deleted agent's local plugin records.
 * TRDD-AQTGAY60 (parent) · TRDD-FHBGF0WG (the record-scoped remover it calls).
 *
 * WHAT THIS PINS THAT NOTHING ELSE DOES. The remover is unit-tested
 * (`tests/unit/installed-plugins-records.test.ts`) and the post-condition probe is unit-tested
 * (`tests/unit/agent-teardown.test.ts`), but no test drove `DeleteAgent` itself — so "hard delete
 * removes, soft delete leaves alone" was true only BY CONSTRUCTION (the gate sits inside the
 * folder-deleted branch). That is a claim about the code as written, not a guard against the next
 * edit, which is exactly the gap the FHBGF0WG bug lived in.
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
import { describe, it, expect, vi, afterAll } from 'vitest'
import { existsSync, readdirSync, statSync, mkdtempSync } from 'fs'
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

describe('DeleteAgent G09b — hard delete drops this workdir records and nothing else', () => {
  it('removes every local record for the deleted workdir, keeping the sibling agent and the user-scope row', async () => {
    const doomed = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'g09b-hard-1', name: 'g09b-hard-1' })
    const sibling = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'g09b-keep-1', name: 'g09b-keep-1' })
    // Two keys for the doomed workdir, so the assertion also covers "drop the key once nothing is
    // left under it" reached through the real pipeline rather than through the remover directly.
    seedInstalledPlugins(H.FAKE_HOME, {
      [CORE]: [localRecord(doomed), localRecord(sibling), userRecord()],
      [OTHER]: [localRecord(doomed)],
    })

    const result = await driveDeleteAgent({ agentId: 'g09b-hard-1', hard: true, deleteFolder: true })

    expect(result.success).toBe(true)
    // The folder assertion is ALSO the containment proof: it can only pass if the fake home took
    // effect — with a broken mock layer the branch is skipped and this reddens (fail inert).
    expect(existsSync(doomed)).toBe(false)
    expect(existsSync(sibling)).toBe(true)

    const plugins = readInstalledPlugins(H.FAKE_HOME)
    expect(plugins[CORE]).toEqual([localRecord(sibling), userRecord()])
    // Its only record was the doomed workdir's, so the key itself goes — an empty array reads as
    // "installed nowhere" to some consumers and as "key present" to others.
    expect(OTHER in plugins).toBe(false)

    expect(result.operations.some(o => /^G09b: Removed 2 local plugin record\(s\)/.test(o))).toBe(true)
    expect(result.operations.find(o => o.startsWith('G09b:'))).toContain(OTHER)
  })

  it('reports the empty case honestly instead of claiming a removal', async () => {
    // A workdir with no records at all must still produce a G09b line — silence and "nothing to
    // do" are the same output otherwise, which is how a skipped gate hides.
    const doomed = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'g09b-hard-2', name: 'g09b-hard-2' })
    seedInstalledPlugins(H.FAKE_HOME, { [CORE]: [userRecord()] })

    const result = await driveDeleteAgent({ agentId: 'g09b-hard-2', hard: true, deleteFolder: true })

    expect(result.success).toBe(true)
    expect(existsSync(doomed)).toBe(false)
    expect(result.operations.some(o => /^G09b: No local plugin records for/.test(o))).toBe(true)
    expect(readInstalledPlugins(H.FAKE_HOME)[CORE]).toEqual([userRecord()])
  })

  it('leaves the plugin-records store out of the G10 residue, which is what PROVES the gate ran', async () => {
    // The independent channel: G10 asks each store whether it still claims the agent. Before G09b
    // existed this probe reported residue on every hard delete — and nothing asked it to.
    const doomed = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'g09b-hard-3', name: 'g09b-hard-3' })
    seedInstalledPlugins(H.FAKE_HOME, { [CORE]: [localRecord(doomed)] })

    const result = await driveDeleteAgent({ agentId: 'g09b-hard-3', hard: true, deleteFolder: true })

    expect(result.success).toBe(true)
    expect((result.residue ?? []).map(r => r.store)).not.toContain('plugin-records')
    expect(result.incomplete).toBeFalsy()
  })
})

describe('DeleteAgent G09b — a soft delete must NOT touch them', () => {
  it('keeps the workdir and its records, and never runs G09b', async () => {
    // A soft delete keeps the workdir, so its records stay TRUE — re-adoption over a tombstone
    // depends on them. This is the case the gate's PLACEMENT (inside the folder-deleted branch)
    // is what guarantees, so it is the case a mis-placed gate breaks first.
    const kept = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'g09b-soft-1', name: 'g09b-soft-1' })
    seedInstalledPlugins(H.FAKE_HOME, { [CORE]: [localRecord(kept), userRecord()] })

    const result = await driveDeleteAgent({ agentId: 'g09b-soft-1', hard: false, deleteFolder: true })

    expect(result.success).toBe(true)
    expect(existsSync(kept)).toBe(true)
    expect(readInstalledPlugins(H.FAKE_HOME)[CORE]).toEqual([localRecord(kept), userRecord()])
    expect(result.operations.some(o => o.startsWith('G09b:'))).toBe(false)
    expect(result.operations).toContain('G09: Soft-delete — folder preserved')
  })

  it('keeps them on a hard delete that did not ask for the folder', async () => {
    // `deleteFolder: false` means the workdir survives, so the records are still true. The gate
    // must key on the folder going away, never on "DeleteAgent was called".
    const kept = seedAgent(store, H.FAKE_HOME, H.FAKE_STATE, { id: 'g09b-hard-nofolder', name: 'g09b-hard-nofolder' })
    seedInstalledPlugins(H.FAKE_HOME, { [CORE]: [localRecord(kept)] })

    const result = await driveDeleteAgent({ agentId: 'g09b-hard-nofolder', hard: true, deleteFolder: false })

    expect(result.success).toBe(true)
    expect(existsSync(kept)).toBe(true)
    expect(readInstalledPlugins(H.FAKE_HOME)[CORE]).toEqual([localRecord(kept)])
    expect(result.operations.some(o => o.startsWith('G09b:'))).toBe(false)
    expect(result.operations).toContain('G09: Hard-delete but no folder deletion requested')
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
