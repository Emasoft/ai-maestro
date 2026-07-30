/**
 * Drive the REAL `DeleteAgent` pipeline against a temp home — TRDD-AQTGAY60.
 *
 * WHY THIS EXISTS
 * ---------------
 * Five test files already drive `DeleteAgent` end-to-end, and NONE of them can reach the
 * hard-delete-with-folder branch — so the three effects that live inside it (the `rm -rf`, the
 * Claude transcript-dir purge, and G09b's `installed_plugins.json` cleanup) have never been
 * executed by any test. The reason is structural, not an oversight:
 *
 *   - `services/element-management-service.ts` resolves `const HOME = homedir()` at MODULE LOAD,
 *     and derives both `agentsRoot` and `INSTALLED_FILE` from it.
 *   - Those files contain themselves with LAYER 2 ONLY (the `@/lib/ecosystem-constants` path
 *     helpers) and deliberately do not `vi.mock('os')`.
 *   - So `agentsRoot` is the developer's REAL `~/agents` while the fixture workdir is under a
 *     temp home: `resolvedDir.startsWith(agentsRoot)` is false and the whole branch is skipped.
 *
 * The containment that makes those tests SAFE is what makes the branch UNREACHABLE. Adding
 * `vi.mock('os')` to one of them is not the fix — it would flip `agentsRoot` to the fake home and
 * thereby ARM the real `rm -rf` for every existing hard-delete case in a ~1 400-line file at once.
 * This helper is the other half of the answer: a harness that wires BOTH layers from the start, so
 * the branch is armed only against a temp tree the test owns.
 *
 * WHY ARMING `rm -rf` IS SAFE BY CONSTRUCTION (state it, do not trust it)
 * ----------------------------------------------------------------------
 * If either mock layer fails to take, `agentsRoot` stays the developer's real `~/agents` while
 * `resolvedDir` is built from FAKE_HOME — `startsWith` is false, and the branch is SKIPPED. A
 * broken mock therefore makes the test FAIL INERT (the fixture folder survives, the assertion
 * reddens) and can never delete something real. The "folder is gone" assertion doubles as the
 * containment proof: it can only pass if the fake root took effect.
 *
 * WHY REAL `fs` (unlike the two existing scaffolds, which mock it wholesale)
 * -------------------------------------------------------------------------
 * The property under test is a FILE being rewritten. With `fs` mocked, G09b's removal, the folder
 * deletion, and G08b's on-disk registry verification are all unobservable — the test would assert
 * against its own stubs. So the collaborators (registry, tmux, teams, credentials, ledger) are
 * mocked and the FILESYSTEM is real, rooted in a temp dir.
 *
 * USAGE — the mock factories are per-file and hoisted, so a test still writes its own `vi.mock`
 * lines; this module supplies their BODIES (the same split `fake-ecosystem-home.ts` uses for
 * layer 2). The `await import()` must stay INSIDE each factory: `vi.mock` is hoisted above every
 * top-level import, so a static import of this module would not be initialised in time.
 *
 *   const H = vi.hoisted(() => { … mkdtempSync … return { FAKE_HOME, FAKE_STATE, store: new Map() } })
 *
 *   vi.mock('os', async (importOriginal) => { … homedir: () => H.FAKE_HOME … })   // layer 1
 *   vi.mock('@/lib/ecosystem-constants', … fakeEcosystemPaths(actual, …))          // layer 2
 *   vi.mock('@/lib/agent-registry', async () =>
 *     (await import('@/tests/helpers/drive-delete-agent')).registryMock(H.store, registryPath(H.FAKE_STATE)))
 *   vi.mock('@/lib/governance', async () =>
 *     (await import('@/tests/helpers/drive-delete-agent')).stubs.governance())
 *   … one line per collaborator …
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'fs'
import { dirname, join } from 'path'

/** The subset of an Agent record every `DeleteAgent` gate and teardown probe reads. */
export interface FakeAgent {
  id: string
  name: string
  program?: string
  workingDirectory?: string | null
  governanceTitle?: string | null
  deletedAt?: string | null
  status?: string
}

export type FakeRegistryStore = Map<string, FakeAgent>

/** Where the mocked registry mirrors to — the SAME path `statePath('agents','registry.json')`
 *  resolves to once layer 2 is in place, because G08b re-reads it with the REAL `fs`. */
export function registryPath(fakeState: string): string {
  return join(fakeState, 'agents', 'registry.json')
}

export function installedPluginsPath(fakeHome: string): string {
  return join(fakeHome, '.claude', 'plugins', 'installed_plugins.json')
}

/**
 * `@/lib/agent-registry` — an in-memory store that ALSO mirrors to a real `registry.json`.
 *
 * The mirror is not convenience: G08b verifies the delete landed by `readFileSync`-ing
 * `statePath('agents','registry.json')`, and refuses the whole operation when that read
 * disagrees with the store. A mock that only mutated memory would fail every case at G08b —
 * before G09b, the gate under test, ever ran.
 */
export function registryMock(store: FakeRegistryStore, registryFile: string) {
  const flush = (): void => {
    mkdirSync(dirname(registryFile), { recursive: true })
    writeFileSync(registryFile, JSON.stringify([...store.values()], null, 2), 'utf-8')
  }
  return {
    // The teardown `registry` probe calls this with ONE argument and inspects `deletedAt`, so a
    // soft-deleted row must still come back — mirroring the existing driver tests' mock.
    getAgent: (id: string, _includeDeleted?: boolean) => store.get(id) ?? null,
    getAgentByName: (name: string) => [...store.values()].find(a => a.name === name) ?? null,
    getAgentBySession: () => null,
    loadAgents: () => [...store.values()],
    saveAgents: () => undefined,
    createAgent: async () => null,
    updateAgent: async (id: string, patch: Partial<FakeAgent>) => {
      const existing = store.get(id)
      if (!existing) return null
      const updated = { ...existing, ...patch }
      store.set(id, updated)
      flush()
      return updated
    },
    // Mirrors the real registry's two modes: hard removes the row, soft tombstones it (the
    // cemetery model). G08b asserts exactly this difference on disk.
    deleteAgent: async (id: string, hard: boolean) => {
      const existing = store.get(id)
      if (!existing) return false
      if (hard) store.delete(id)
      else store.set(id, { ...existing, deletedAt: new Date().toISOString(), status: 'deleted' })
      flush()
      return true
    },
  }
}

/**
 * Seed one agent into the store, its real `registry.json` row, and its workdir on disk.
 * Returns the absolute workdir, which is what the caller asserts against.
 */
export function seedAgent(
  store: FakeRegistryStore,
  fakeHome: string,
  fakeState: string,
  agent: Omit<FakeAgent, 'workingDirectory'> & { workingDirectory?: string },
): string {
  const workdir = agent.workingDirectory ?? join(fakeHome, 'agents', agent.name)
  mkdirSync(join(workdir, '.claude'), { recursive: true })
  writeFileSync(join(workdir, 'CLAUDE.md'), `# ${agent.name}\n`, 'utf-8')
  store.set(agent.id, { deletedAt: null, status: 'active', program: 'claude', ...agent, workingDirectory: workdir })
  const file = registryPath(fakeState)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify([...store.values()], null, 2), 'utf-8')
  return workdir
}

/** Write `installed_plugins.json` in the shape that actually ships: key → ARRAY of records. */
export function seedInstalledPlugins(fakeHome: string, plugins: Record<string, unknown[]>): void {
  const file = installedPluginsPath(fakeHome)
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, JSON.stringify({ version: 1, plugins }, null, 2), 'utf-8')
}

/** Read back the `plugins` map. Throws if the file is gone — an absent store and an emptied one
 *  are different outcomes, and a helper that returned `{}` for both would hide the difference. */
export function readInstalledPlugins(fakeHome: string): Record<string, unknown> {
  const file = installedPluginsPath(fakeHome)
  if (!existsSync(file)) throw new Error(`installed_plugins.json missing at ${file}`)
  return (JSON.parse(readFileSync(file, 'utf-8')) as { plugins?: Record<string, unknown> }).plugins ?? {}
}

/** One local install record for `projectPath`. */
export function localRecord(projectPath: string, version = '2.8.0') {
  return { scope: 'local', projectPath, version, installedAt: '2026-01-01T00:00:00Z' }
}

/** The user-scope row — the single most damaging record in the file (it is what makes a plugin
 *  global, R20.30), so every removal test must prove it survived. */
export function userRecord(version = '2.8.0') {
  return { scope: 'user', version, installedAt: '2026-03-03T00:00:00Z' }
}

/**
 * The inert collaborators. Every one is reached through a dynamic `await import()` inside a gate
 * or a teardown probe, so the surface each stub must cover is BOTH: the gate's call and the
 * probe's read of the same store (e.g. `revokeAllKeysForAgent` for G06, `getKeysForAgent` for the
 * `amp-keys` probe). Omitting the probe half turns G10 into "verification unavailable", which
 * reads as a WARN rather than a failure — the exact shape that hides a missing gate.
 */
export const stubs = {
  /** `isManager: false` keeps G02 from calling ChangeTitle, which would drag in its own world. */
  governance: () => ({
    isManager: () => false,
    getManagerId: () => null,
    isChiefOfStaffAnywhere: () => false,
    setManager: async () => undefined,
    removeManager: async () => undefined,
    loadGovernance: () => ({ managerId: null, chiefsOfStaff: {} }),
    saveGovernance: () => undefined,
  }),
  teamRegistry: () => ({
    loadTeams: () => [],
    saveTeams: () => undefined,
    getTeam: () => undefined,
    getTeamsForAgent: () => [],
    isAgentInAnyTeam: () => false,
    updateTeam: async () => undefined,
    deleteTeam: async () => undefined,
    addTeam: async () => undefined,
    blockAllTeams: () => undefined,
    unblockAllTeams: () => undefined,
  }),
  groupRegistry: () => ({ loadGroups: () => [], saveGroups: () => undefined }),
  agentRuntime: () => ({
    getRuntime: () => ({
      killSession: async () => undefined,
      sessionExists: async () => false,
    }),
  }),
  sessionPersistence: () => ({
    unpersistSession: async () => 'removed',
    loadPersistedSessions: () => [],
  }),
  ampAuth: () => ({ revokeAllKeysForAgent: async () => 0, getKeysForAgent: () => [] }),
  aidToken: () => ({ revokeTokensForAgent: async () => 0, countTokensForAgent: () => 0 }),
  governanceRequests: () => ({
    loadGovernanceRequests: () => ({ requests: [] }),
    rejectGovernanceRequest: async () => undefined,
    approveGovernanceRequest: async () => undefined,
    createGovernanceRequest: async () => undefined,
  }),
  /** The signed ledger is asserted elsewhere, never exercised: appending needs a signing key and
   *  a real chain, and `tryEmitLedgerOp` is the single choke point every emit goes through. */
  ledgerEmit: () => ({ emitAgentOp: async () => undefined }),
  /** G01c REFUSES a soft delete whose cemetery archive failed — "soft" means recoverable and the
   *  zip IS the recovery. So the archive must SUCCEED here or the soft case fails for the wrong
   *  reason. The bytes are irrelevant; only `data` being present is load-bearing. */
  agentsTransfer: () => ({
    exportAgentZip: async () => ({
      data: { filename: 'stub-agent-export.zip', buffer: Buffer.from('stub-zip-payload') },
    }),
  }),
}

/**
 * Call the real pipeline as the system owner (`isSystemOwner` short-circuits G00 — the same seam
 * every internal caller uses). Imported dynamically so the mocks above are all in place first.
 */
export async function driveDeleteAgent(opts: {
  agentId: string
  hard: boolean
  deleteFolder?: boolean
}) {
  const { DeleteAgent } = await import('@/services/element-management-service')
  return DeleteAgent(opts.agentId, {
    authContext: { isSystemOwner: true },
    hard: opts.hard,
    deleteFolder: opts.deleteFolder,
  })
}
