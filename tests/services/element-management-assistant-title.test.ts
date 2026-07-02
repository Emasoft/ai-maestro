/**
 * R39 Phase-A — the ASSISTANT governance title in the element-management pipeline.
 *
 * Verifies the repo-side R39.1/R39.2/R39.4/R39.6 wiring that lets an agent BE an
 * ASSISTANT and that protects an ASSISTANT from independent deletion:
 *
 *   - ChangeTitle(agent,'assistant') is ACCEPTED at Gate 1 (VALID_TITLES) and,
 *     being STANDALONE (R39.4 — no team affiliation), needs no team.
 *   - ChangeTitle to 'assistant' from a non-MANAGER caller is DENIED (R26/R39.4 —
 *     title is a locked field, changeable only by MANAGER/COS, never self).
 *   - The title→plugin resolver maps 'assistant' →
 *     'ai-maestro-assistant-role-agent' (R39.2 role-plugin), distinct from the
 *     MANAGER plugin 'ai-maestro-assistant-manager-agent'.
 *   - DeleteAgent on an ASSISTANT WITHOUT cascadeFromUser is REFUSED (R39.6
 *     independent-delete block); WITH cascadeFromUser (the Phase-B user-delete
 *     cascade seam) it soft-deletes.
 *   - ecosystem-constants registry assertions (name-collision guard + maps).
 *
 * Harness: the registryStore Map bridges the agent-registry mocks (createAgent /
 * getAgent / updateAgent / deleteAgent) and is mirrored into the on-disk
 * registry.json read so the real ChangeTitle/DeleteAgent gates that verify the
 * write landed on disk pass. Modeled on
 * tests/integration/createagent-g06-g07-ordering.test.ts.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

// ── Hoisted mock refs + the in-memory registry store ─────────────────────────
const {
  mockGetAgentByName,
  mockLoadAgents,
  mockCreateAgent,
  mockDeleteAgent,
  mockUpdateAgent,
  mockGetAgent,
  registryStore,
} = vi.hoisted(() => {
  const store = new Map<string, { id: string; name: string; program?: string; workingDirectory?: string; governanceTitle?: string | null; deletedAt?: string | null; status?: string }>()
  return {
    registryStore: store,
    mockGetAgentByName: vi.fn(() => null),
    mockLoadAgents: vi.fn(() => Array.from(store.values())),
    mockCreateAgent: vi.fn(),
    // Soft/hard delete: mirror the real registry — soft-delete sets deletedAt +
    // status:'deleted' but KEEPS the entry (cemetery model); hard removes it.
    mockDeleteAgent: vi.fn(async (id: string, hard: boolean) => {
      const existing = store.get(id)
      if (!existing) return false
      if (hard) { store.delete(id) }
      else { store.set(id, { ...existing, deletedAt: new Date().toISOString(), status: 'deleted' }) }
      return true
    }),
    mockUpdateAgent: vi.fn(async (id: string, patch: Record<string, unknown>) => {
      const existing = store.get(id)
      if (!existing) return null
      const updated = { ...existing, ...patch }
      store.set(id, updated)
      return updated
    }),
    mockGetAgent: vi.fn((id: string, _includeDeleted?: boolean) => store.get(id) ?? null),
  }
})

vi.mock('@/lib/agent-registry', () => ({
  getAgentByName: mockGetAgentByName,
  getAgentBySession: vi.fn(() => null),
  loadAgents: mockLoadAgents,
  createAgent: mockCreateAgent,
  deleteAgent: mockDeleteAgent,
  updateAgent: mockUpdateAgent,
  getAgent: mockGetAgent,
  saveAgents: vi.fn(),
}))

vi.mock('@/lib/security-config', () => ({
  loadSecurityConfig: vi.fn(() => ({ agentCreation: { maxAgentsPerHost: 100, minIntervalSeconds: 0 } })),
}))

vi.mock('@/lib/ibct-scope-check', () => ({
  checkIbctScope: vi.fn(() => null),
}))

vi.mock('@/lib/client-capabilities', () => ({
  getClientCapabilities: vi.fn(() => ({ plugins: true, rolePlugins: true, skills: true, agents: true, hooks: true })),
  detectClientType: vi.fn(() => 'claude'),
}))

// Governance: a no-manager/no-COS world so the pipeline proceeds past
// governance checks without touching governance.json. isManager(false) means
// the assistant target is never auto-treated as MANAGER in DeleteAgent G02.
vi.mock('@/lib/governance', () => ({
  isManager: vi.fn(() => false),
  getManagerId: vi.fn(() => null),
  isChiefOfStaffAnywhere: vi.fn(() => false),
  setManager: vi.fn(async () => undefined),
  removeManager: vi.fn(async () => undefined),
  loadGovernance: vi.fn(() => ({ managerId: null, chiefsOfStaff: {} })),
  saveGovernance: vi.fn(),
}))

vi.mock('@/lib/team-registry', () => ({
  loadTeams: vi.fn(() => []),
  saveTeams: vi.fn(),
  getTeam: vi.fn(() => undefined),
  getTeamsForAgent: vi.fn(() => []),
  isAgentInAnyTeam: vi.fn(() => false),
  blockAllTeams: vi.fn(),
  unblockAllTeams: vi.fn(),
  updateTeam: vi.fn(async () => undefined),
  deleteTeam: vi.fn(async () => undefined),
  addTeam: vi.fn(async () => undefined),
}))

vi.mock('@/lib/governance-sync', () => ({
  broadcastGovernanceSync: vi.fn(),
}))

vi.mock('@/lib/governance-request-registry', () => ({
  loadGovernanceRequests: vi.fn(() => ({ requests: [] })),
  rejectGovernanceRequest: vi.fn(),
  approveGovernanceRequest: vi.fn(),
  createGovernanceRequest: vi.fn(),
}))

vi.mock('@/services/governance-service', () => ({
  transferManager: vi.fn(),
  assignCOS: vi.fn(),
  removeCOS: vi.fn(),
}))

vi.mock('@/services/role-plugin-service', () => ({
  createPersona: vi.fn(async () => ({ success: true })),
  listRolePlugins: vi.fn(async () => []),
  getPluginsForTitle: vi.fn(() => []),
  installPluginLocally: vi.fn(async () => ({ success: true })),
  uninstallPluginLocally: vi.fn(async () => ({ success: true })),
}))

vi.mock('@/services/plugin-storage-service', () => ({
  findNativePluginForClient: vi.fn(async () => null),
  emitForClient: vi.fn(async () => null),
  convertAndStorePlugin: vi.fn(),
  getUniversalIR: vi.fn(async () => null),
}))

// Ledger + token + credential side-effects fired by ChangeTitle/DeleteAgent.
// All are fire-and-forget in the source (wrapped in try/catch), but stub them
// so the test path is deterministic and emits nothing real.
vi.mock('@/lib/ledger-emit', () => ({
  emitAgentOp: vi.fn(),
}))
vi.mock('@/lib/aid-token', () => ({
  revokeTokensForAgent: vi.fn(async () => 0),
}))
vi.mock('@/lib/portfolio-store', () => ({
  revokeTokensFromIssuer: vi.fn(async () => 0),
}))
vi.mock('@/lib/portfolio-ledger', () => ({
  emitPortfolioOp: vi.fn(),
}))
vi.mock('@/lib/amp-auth', () => ({
  revokeAllKeysForAgent: vi.fn(async () => 0),
}))
vi.mock('@/lib/group-registry', () => ({
  loadGroups: vi.fn(() => []),
  saveGroups: vi.fn(),
}))
// DeleteAgent G03 cemetery archive — return no data so it logs a WARN and skips
// the disk write (the archive is non-fatal; the soft-delete still proceeds).
vi.mock('@/services/agents-transfer-service', () => ({
  exportAgentZip: vi.fn(async () => ({ data: null, error: 'stubbed-in-test' })),
}))

vi.mock('@/lib/agent-runtime', () => ({
  getRuntime: vi.fn(() => ({ killSession: vi.fn(async () => undefined) })),
}))

vi.mock('child_process', () => ({
  execFileSync: vi.fn(() => '/usr/bin/claude'),
  execFile: vi.fn((_cmd: string, _args: string[], _opts: unknown, cb?: (err: Error | null, stdout: string, stderr: string) => void) => {
    if (typeof cb === 'function') cb(null, '', '')
  }),
}))

vi.mock('fs/promises', () => ({
  mkdir: vi.fn(async () => undefined),
  stat: vi.fn(async () => { const e = new Error('ENOENT') as Error & { code?: string }; e.code = 'ENOENT'; throw e }),
  readFile: vi.fn(async () => ''),
  writeFile: vi.fn(async () => undefined),
  rm: vi.fn(async () => undefined),
}))

// The on-disk registry.json view: mirror registryStore so the ChangeTitle G14 /
// DeleteAgent G08b verification gates (which readFileSync registry.json) see
// exactly what updateAgent/deleteAgent just wrote.
vi.mock('fs', () => ({
  existsSync: vi.fn(() => false),
  mkdirSync: vi.fn(),
  writeFileSync: vi.fn(),
  readFileSync: vi.fn((p: string) => {
    if (typeof p === 'string' && p.endsWith('registry.json')) {
      return JSON.stringify(Array.from(registryStore.values()))
    }
    return ''
  }),
  promises: {
    readFile: vi.fn(async () => ''),
    writeFile: vi.fn(async () => undefined),
  },
}))

// ── helpers ──────────────────────────────────────────────────────────────────
const managerCtx = { isSystemOwner: true as const }
const memberCtx = { isSystemOwner: false as const, agentId: 'caller-member-id', governanceTitle: 'member' as const }

function seedAgent(id: string, title: string | null = 'autonomous') {
  registryStore.set(id, {
    id,
    name: id,
    program: 'claude',
    workingDirectory: `/home/test/${id}`,
    governanceTitle: title,
    deletedAt: null,
    status: 'active',
  })
}

describe('element-management — ecosystem-constants ASSISTANT registry (R39.2)', () => {
  it('TITLE_PLUGIN_MAP[ASSISTANT] is the assistant role-plugin, distinct from the MANAGER plugin', async () => {
    const {
      TITLE_PLUGIN_MAP,
      ROLE_PLUGIN_ASSISTANT,
      ROLE_PLUGIN_MANAGER,
      PLUGIN_COMPATIBLE_TITLES,
      ROLE_PLUGIN_MAIN_AGENTS,
    } = await import('@/lib/ecosystem-constants')

    expect(ROLE_PLUGIN_ASSISTANT).toBe('ai-maestro-assistant-role-agent')
    // Name-collision guard: the assistant role-plugin must NOT be the MANAGER
    // plugin (they differ only by "manager" ↔ "role-agent").
    expect(ROLE_PLUGIN_ASSISTANT).not.toBe(ROLE_PLUGIN_MANAGER)
    expect(TITLE_PLUGIN_MAP['ASSISTANT']).toBe(ROLE_PLUGIN_ASSISTANT)
    expect(PLUGIN_COMPATIBLE_TITLES[ROLE_PLUGIN_ASSISTANT]).toEqual(['ASSISTANT'])
    expect(ROLE_PLUGIN_MAIN_AGENTS[ROLE_PLUGIN_ASSISTANT]).toBe('ai-maestro-assistant-role-agent-main-agent')
  })
})

describe('element-management — title→plugin resolver for ASSISTANT (R39.2)', () => {
  it('getRequiredPluginForTitle("assistant") → ai-maestro-assistant-role-agent', async () => {
    const { getRequiredPluginForTitle } = await import('@/services/element-management-service')
    expect(getRequiredPluginForTitle('assistant')).toBe('ai-maestro-assistant-role-agent')
  })

  it('getCompatiblePluginsForTitle("assistant") resolves the assistant role-plugin by name', async () => {
    const { getCompatiblePluginsForTitle } = await import('@/services/element-management-service')
    const plugins = await getCompatiblePluginsForTitle('assistant')
    expect(plugins.length).toBeGreaterThan(0)
    expect(plugins.map(p => p.name)).toContain('ai-maestro-assistant-role-agent')
  })
})

describe('element-management — ChangeTitle to ASSISTANT (R39.1/R39.4)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registryStore.clear()
  })
  afterEach(() => { vi.clearAllMocks() })

  it('Gate 1 accepts "assistant" as a valid title (R39.1 — 9th title); standalone so no team', async () => {
    seedAgent('assistant-agent-1', 'autonomous')
    const { ChangeTitle } = await import('@/services/element-management-service')
    const result = await ChangeTitle('assistant-agent-1', 'assistant', {
      authContext: managerCtx,
      skipPluginSync: true,
      skipRestart: true,
    })

    // The title must NOT be rejected at Gate 1 with "Invalid title" — a
    // successful change leaves error undefined, never the rejection string.
    expect(result.error ?? '').not.toMatch(/Invalid title/i)
    // Registry persisted the assistant title (Gate 14 verified on disk).
    expect(result.success).toBe(true)
    expect(registryStore.get('assistant-agent-1')?.governanceTitle).toBe('assistant')
    // STANDALONE (R39.4): the ops log must show the standalone no-team check,
    // not a team-membership rejection.
    const standaloneOp = result.operations.find(o => /standalone/i.test(o))
    expect(standaloneOp).toBeDefined()
  })

  it('rejects "assistant" title-change from a non-MANAGER caller (R26/R39.4 locked field)', async () => {
    seedAgent('assistant-agent-2', 'autonomous')
    const { ChangeTitle } = await import('@/services/element-management-service')
    const result = await ChangeTitle('assistant-agent-2', 'assistant', {
      authContext: memberCtx,
      skipPluginSync: true,
      skipRestart: true,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/MANAGER|CHIEF-OF-STAFF/i)
    // Title must NOT have changed.
    expect(registryStore.get('assistant-agent-2')?.governanceTitle).toBe('autonomous')
  })
})

describe('element-management — ChangeTitle G17 R9.13 recovery (titled-but-role-less)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registryStore.clear()
  })
  afterEach(() => { vi.clearAllMocks() })

  it('G17: 0 active role-plugins after a non-skip install → set roleMissing (not a false "consistent")', async () => {
    // skipPluginSync is OMITTED so Gate 16 (install) + Gate 17 (consistency)
    // actually run. The mocked fs leaves settings.local.json absent
    // (existsSync→false ⇒ loadJsonSafe→{}), so after the G16 install the agent
    // has ZERO active role-plugins despite a resolved targetPluginName — exactly
    // the "install silently WARNed and failed" R9.13 hole this fix closes. G17
    // must NOT report "Plugin state consistent (0 role-plugin(s))"; it must
    // enforce R9.13 by setting roleMissing=true (mirroring ChangePlugin's PG04).
    seedAgent('g17-roleless-1', 'autonomous')
    const { ChangeTitle } = await import('@/services/element-management-service')
    const result = await ChangeTitle('g17-roleless-1', 'assistant', {
      authContext: managerCtx,
      skipRestart: true,
    })

    // The title change itself still succeeds — the gap was the SILENT role-loss,
    // not a failed title write.
    expect(result.success).toBe(true)
    // R9.13 enforcement: G17 set roleMissing=true on the registry.
    expect(mockUpdateAgent).toHaveBeenCalledWith('g17-roleless-1', { roleMissing: true })
    // The ops log shows the R9.13 enforcement, NOT a false "consistent (0…)".
    expect(result.operations.some(o => /G17:.*R9\.13/.test(o))).toBe(true)
    expect(result.operations.some(o => /G17: Plugin state consistent \(0 role-plugin/.test(o))).toBe(false)
  })

  it('G17: settings.local.json PRESENT but 0 role-plugins → the single post-block re-scan recovers (the existsSync=true exit)', async () => {
    // The original G17 fix wired recovery into only 2 of 4 zero-active exits; the
    // >1 and MISMATCH reinstall-fail exits (uninstall-then-reinstall with a
    // swallowed .catch) had none. The fix replaced the per-branch calls with ONE
    // UNCONDITIONAL post-block re-scan, so every exit falls through to the same
    // recovery. The prior test drives existsSync=FALSE (no-settings); this drives
    // existsSync=TRUE (a settings.local.json that ends with 0 role-plugins) — the
    // with-settings entry the prior test never exercised — and asserts the post-block
    // re-scan still enforces R9.13 (roleMissing=true). The recovery here comes ONLY
    // from the post-block (the per-branch call was removed), so this guards the
    // refactor. Gap + test gap found by adversarial verification of TRDD-51ed3b0b.
    const fs = await import('fs')
    const fsp = await import('fs/promises')
    // existsSync→true ONLY for settings.local.json (other paths stay false, so the
    // registry-json readFileSync view and the rest of the pipeline are unaffected);
    // readFile returns a settings file with zero role-plugins.
    vi.mocked(fs.existsSync).mockImplementation((p: unknown) => typeof p === 'string' && p.includes('settings.local.json'))
    vi.mocked(fsp.readFile).mockImplementation(async (p: unknown) => (typeof p === 'string' && p.includes('settings.local.json')) ? '{"enabledPlugins":{}}' : '')
    try {
      seedAgent('g17-roleless-2', 'autonomous')
      const { ChangeTitle } = await import('@/services/element-management-service')
      const result = await ChangeTitle('g17-roleless-2', 'assistant', {
        authContext: managerCtx,
        skipRestart: true,
      })
      expect(result.success).toBe(true)
      // The single post-block R9.13 re-scan recovered on the with-settings exit.
      expect(mockUpdateAgent).toHaveBeenCalledWith('g17-roleless-2', { roleMissing: true })
      expect(result.operations.some(o => /G17:.*R9\.13/.test(o))).toBe(true)
    } finally {
      // clearAllMocks() clears calls but NOT implementations — restore the module
      // defaults so the existsSync/readFile leak cannot affect the DeleteAgent suite.
      vi.mocked(fs.existsSync).mockReturnValue(false)
      vi.mocked(fsp.readFile).mockResolvedValue('')
    }
  })
})

describe('element-management — DeleteAgent ASSISTANT independent-delete block (R39.6)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    registryStore.clear()
  })
  afterEach(() => { vi.clearAllMocks() })

  it('refuses to delete an ASSISTANT independently (no cascadeFromUser) — R39.6', async () => {
    seedAgent('assistant-del-1', 'assistant')
    const { DeleteAgent } = await import('@/services/element-management-service')
    const result = await DeleteAgent('assistant-del-1', { authContext: managerCtx })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/cannot be deleted independently \(R39\.6\)/i)
    // G01b must run BEFORE any cemetery archive / registry delete.
    expect(result.operations.some(o => /G01b: DENIED/.test(o))).toBe(true)
    // The agent is NOT soft-deleted — still present with no deletedAt.
    const after = registryStore.get('assistant-del-1')
    expect(after).toBeDefined()
    expect(after?.deletedAt ?? null).toBeNull()
    // deleteAgent (the registry mutation) was never reached.
    expect(mockDeleteAgent).not.toHaveBeenCalled()
  })

  it('allows ASSISTANT delete when cascadeFromUser=true (the Phase-B user-delete seam) — R39.6', async () => {
    seedAgent('assistant-del-2', 'assistant')
    const { DeleteAgent } = await import('@/services/element-management-service')
    const result = await DeleteAgent('assistant-del-2', { authContext: managerCtx, cascadeFromUser: true })

    expect(result.success).toBe(true)
    // Soft-deleted via the cascade — registry entry kept with deletedAt set.
    const after = registryStore.get('assistant-del-2')
    expect(after).toBeDefined()
    expect(after?.deletedAt).toBeTruthy()
    expect(after?.status).toBe('deleted')
    // The cascade path logged the authorization, not the block.
    expect(result.operations.some(o => /G01b: ASSISTANT delete authorized via user cascade/.test(o))).toBe(true)
  })

  it('a NON-assistant agent still deletes normally (G01b is a no-op for it)', async () => {
    seedAgent('member-del-1', 'autonomous')
    const { DeleteAgent } = await import('@/services/element-management-service')
    const result = await DeleteAgent('member-del-1', { authContext: managerCtx })

    expect(result.success).toBe(true)
    expect(result.operations.some(o => /G01b: Not an ASSISTANT/.test(o))).toBe(true)
    expect(registryStore.get('member-del-1')?.deletedAt).toBeTruthy()
  })

  it('a non-MANAGER caller is denied at G00 before the R39.6 block even runs', async () => {
    seedAgent('assistant-del-3', 'assistant')
    const { DeleteAgent } = await import('@/services/element-management-service')
    const result = await DeleteAgent('assistant-del-3', { authContext: memberCtx })

    expect(result.success).toBe(false)
    // G00 authz denial — Only MANAGER can delete agents.
    expect(result.error).toMatch(/Only MANAGER/i)
    expect(mockDeleteAgent).not.toHaveBeenCalled()
  })
})
