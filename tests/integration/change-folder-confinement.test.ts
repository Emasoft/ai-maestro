/**
 * Security regression test for TRDD-35af6b13 — ChangeFolder must confine an
 * agent's workingDirectory to ~/agents/. The PATCH route
 * (app/api/agents/[id]/route.ts) already documents this as the intended
 * "ChangeFolder Gate 3" invariant; the confinement was MISSING (G03 only
 * fetched the agent) and is restored as gate G01b. Without it, an authorized
 * actor could relocate an agent into ~/.claude / ~/ai-maestro / the home tree
 * and let the agent (whose shell-guard permits writes under its
 * workingDirectory) escape the per-agent write boundary.
 *
 * Imports the REAL ChangeFolder (no element-management-service mock) so the
 * gate itself is exercised. G01b runs after the auth gate (G00) and the
 * traversal check (G01) but BEFORE the existence probe (G02), so these cases
 * need neither a real ~/agents/ dir nor a populated registry — they
 * short-circuit at the boundary or the existence check. The dependency mocks
 * exist only so the module loads cleanly (mirrors
 * change-title-authcontext-required.test.ts).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { homedir } from 'node:os'
import { join } from 'node:path'

const {
  mockAgentRegistry,
  mockGovernance,
  mockTeamRegistry,
  mockFileLock,
  mockElementScan,
} = vi.hoisted(() => ({
  mockAgentRegistry: {
    getAgent: vi.fn(() => ({
      id: 'agent-1',
      name: 'test-agent',
      governanceTitle: null,
      program: 'claude',
      workingDirectory: join(homedir(), 'agents', 'test-agent'),
      config: {},
    })),
    loadAgents: vi.fn(() => []),
    updateAgent: vi.fn(),
    getAgentBySession: vi.fn(() => null),
  },
  mockGovernance: {
    loadGovernance: vi.fn(() => ({ managerId: null })),
    saveGovernance: vi.fn(),
    isManager: vi.fn(() => false),
    getManagerId: vi.fn(() => null),
  },
  mockTeamRegistry: {
    loadTeams: vi.fn(() => []),
    saveTeams: vi.fn(),
    blockAllTeams: vi.fn(),
    unblockAllTeams: vi.fn(),
    isAgentInAnyTeam: vi.fn(() => false),
    getTeam: vi.fn(() => null),
    updateTeam: vi.fn(),
  },
  mockFileLock: {
    acquireLock: vi.fn(() => Promise.resolve(() => {})),
    withLock: vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn())),
  },
  mockElementScan: {
    scanAgentLocalConfig: vi.fn(() =>
      Promise.resolve({ plugins: [], skills: [], agents: [], commands: [], rules: [], hooks: [], mcp: [], lsp: [], outputStyles: [], rolePlugin: null }),
    ),
  },
}))

vi.mock('@/lib/agent-registry', () => mockAgentRegistry)
vi.mock('@/lib/governance', () => mockGovernance)
vi.mock('@/lib/team-registry', () => mockTeamRegistry)
vi.mock('@/lib/file-lock', () => mockFileLock)
vi.mock('@/services/agent-local-config-service', () => mockElementScan)
vi.mock('@/services/role-plugin-service', () => ({
  installPluginLocally: vi.fn(),
  uninstallPluginLocally: vi.fn(),
  installPluginForAgent: vi.fn(),
  uninstallPluginForAgent: vi.fn(),
}))

import { ChangeFolder } from '@/services/element-management-service'

// gate0Auth short-circuits to "authorized" on isSystemOwner, so this is the
// minimal authContext that lets a test reach the confinement gate (G01b).
const owner = { isSystemOwner: true } as unknown as Parameters<typeof ChangeFolder>[2]

beforeEach(() => {
  vi.clearAllMocks()
})

describe('ChangeFolder — ~/agents/ confinement (TRDD-35af6b13, workdir-write escape)', () => {
  it('rejects a folder OUTSIDE ~/agents/ (the ~/.claude escape target) and writes nothing', async () => {
    const result = await ChangeFolder('agent-1', join(homedir(), '.claude'), owner)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/under ~\/agents/i)
    expect(mockAgentRegistry.updateAgent).not.toHaveBeenCalled()
  })

  it('rejects /tmp and other non-agents absolute dirs', async () => {
    const result = await ChangeFolder('agent-1', '/tmp', owner)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/under ~\/agents/i)
    expect(mockAgentRegistry.updateAgent).not.toHaveBeenCalled()
  })

  it('allows a path UNDER ~/agents/ past the boundary (then fails the existence check — proving the boundary did NOT reject it)', async () => {
    const underAgents = join(homedir(), 'agents', '__confine_probe_nonexistent__')
    const result = await ChangeFolder('agent-1', underAgents, owner)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/does not exist/i)
    expect(result.error).not.toMatch(/under ~\/agents/i)
  })

  it('still rejects path traversal (G01 unchanged)', async () => {
    const result = await ChangeFolder('agent-1', '~/agents/../evil', owner)
    expect(result.success).toBe(false)
    expect(result.error).toMatch(/traversal/i)
  })
})
