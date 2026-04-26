/**
 * Agent Local Config Service tests — focused smoke tests.
 *
 * PROP-P0-001 (SCEN-016 2026-04-21): scanCodexDirectory must populate
 * rolePlugin by quad-matching the source folder's .agent.toml. Without this,
 * GET /api/agents/:id/local-config returns rolePlugin:null for any Codex
 * agent, causing the UI to show "No role plugin" after a successful client
 * change even when ai-maestro-autonomous-agent IS correctly installed.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest'
import path from 'path'
import os from 'os'

// ============================================================================
// Mocks
// ============================================================================

const {
  mockFsExistsSync,
  mockFsReadFileSync,
  mockFsReaddirSync,
  mockFsStatSync,
  mockAgentRegistry,
} = vi.hoisted(() => ({
  mockFsExistsSync: vi.fn().mockReturnValue(false),
  mockFsReadFileSync: vi.fn().mockReturnValue(''),
  mockFsReaddirSync: vi.fn().mockReturnValue([]),
  mockFsStatSync: vi.fn().mockReturnValue({ isDirectory: () => true }),
  mockAgentRegistry: {
    getAgent: vi.fn(),
  },
}))

vi.mock('fs', () => ({
  existsSync: mockFsExistsSync,
  readFileSync: mockFsReadFileSync,
  readdirSync: mockFsReaddirSync,
  statSync: mockFsStatSync,
  default: {
    existsSync: mockFsExistsSync,
    readFileSync: mockFsReadFileSync,
    readdirSync: mockFsReaddirSync,
    statSync: mockFsStatSync,
  },
}))

vi.mock('@/lib/agent-registry', () => mockAgentRegistry)

// ============================================================================
// Fixture: a Codex agent workdir with the autonomous role plugin installed
// ============================================================================

const HOME = os.homedir()
const WORK_DIR = path.join(HOME, 'agents', 'scen016-r18-test')
const ROLE_PLUGIN_NAME = 'ai-maestro-autonomous-agent'
const CORE_PLUGIN_NAME = 'ai-maestro-plugin'

// Files that should appear to exist in the fixture
function buildFixtureFs(): {
  files: Record<string, string>
  dirs: Record<string, string[]>
} {
  const roleSource = path.join(HOME, 'agents', 'role-plugins', ROLE_PLUGIN_NAME)
  const roleToml = path.join(roleSource, `${ROLE_PLUGIN_NAME}.agent.toml`)
  const roleMainAgent = path.join(
    roleSource,
    'agents',
    `${ROLE_PLUGIN_NAME}-main-agent.md`,
  )
  const codexInstalledDir = path.join(WORK_DIR, '.codex', 'installed-plugins')
  const coreInstalledJson = path.join(codexInstalledDir, `${CORE_PLUGIN_NAME}.json`)
  const roleInstalledJson = path.join(codexInstalledDir, `${ROLE_PLUGIN_NAME}.json`)
  const codexPluginManifest = path.join(WORK_DIR, '.codex-plugin', 'plugin.json')

  const files: Record<string, string> = {
    [roleToml]: [
      '[agent]',
      `name = "${ROLE_PLUGIN_NAME}"`,
      'description = "Autonomous agent"',
      '',
      'compatible-titles = ["AUTONOMOUS"]',
      'compatible-clients = ["claude-code", "codex"]',
      '',
      '[dependencies]',
      'plugins = []',
      'skills = []',
      '',
    ].join('\n'),
    [roleMainAgent]:
      '---\n' +
      `name: ${ROLE_PLUGIN_NAME}-main-agent\n` +
      'model: opus\n' +
      '---\n' +
      '\n' +
      '# Autonomous Main Agent\n',
    [coreInstalledJson]: JSON.stringify({
      name: CORE_PLUGIN_NAME,
      clientType: 'codex',
      installedAt: '2026-04-21T00:00:00Z',
      paths: ['.codex-plugin/plugin.json'],
    }),
    [roleInstalledJson]: JSON.stringify({
      name: ROLE_PLUGIN_NAME,
      clientType: 'codex',
      installedAt: '2026-04-21T00:00:00Z',
      paths: [
        '.agents/skills/autonomous-core/SKILL.md',
      ],
    }),
    [codexPluginManifest]: JSON.stringify({
      name: CORE_PLUGIN_NAME,
      version: '2.5.2',
      description: 'AI Maestro core plugin',
    }),
  }

  const dirs: Record<string, string[]> = {
    [codexInstalledDir]: [
      `${CORE_PLUGIN_NAME}.json`,
      `${ROLE_PLUGIN_NAME}.json`,
    ],
  }

  return { files, dirs }
}

// ============================================================================
// Tests
// ============================================================================

describe('scanAgentLocalConfig (Codex scanner)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockFsExistsSync.mockReturnValue(false)
    mockFsReadFileSync.mockReturnValue('')
    mockFsReaddirSync.mockReturnValue([])
    mockFsStatSync.mockReturnValue({ isDirectory: () => true })
  })

  // --------------------------------------------------------------------------
  // PROP-P0-001: Codex scanner populates rolePlugin via quad-match
  // --------------------------------------------------------------------------
  it('populates rolePlugin when a quad-matching source folder exists', async () => {
    /**
     * Fixture: a Codex workdir with .codex/installed-plugins/ containing
     * ai-maestro-plugin.json + ai-maestro-autonomous-agent.json. The source
     * role-plugin folder at ~/agents/role-plugins/ai-maestro-autonomous-agent/
     * has all quad-match files (toml + main-agent.md with matching frontmatter).
     * Expectation: rolePlugin.name === "ai-maestro-autonomous-agent".
     */
    const { files, dirs } = buildFixtureFs()

    mockAgentRegistry.getAgent.mockReturnValue({
      id: 'agent-1',
      name: 'scen016-r18-test',
      workingDirectory: WORK_DIR,
      sessions: [],
    })

    mockFsExistsSync.mockImplementation((p: unknown) => {
      if (typeof p !== 'string') return false
      if (p in files) return true
      if (p in dirs) return true
      // .codex/installed-plugins/ must exist for the Codex branch to fire
      if (p === path.join(WORK_DIR, '.codex', 'installed-plugins')) return true
      // working dir itself
      if (p === WORK_DIR) return true
      // role-plugin source folder (for quadMatch's existsSync(cand.dir) check)
      if (p === path.join(HOME, 'agents', 'role-plugins', ROLE_PLUGIN_NAME)) return true
      // agents/ subdir under the role plugin
      if (p === path.join(HOME, 'agents', 'role-plugins', ROLE_PLUGIN_NAME, 'agents')) return true
      return false
    })

    mockFsStatSync.mockImplementation((p: unknown) => {
      if (typeof p === 'string' && (p === WORK_DIR || p in dirs)) {
        return { isDirectory: () => true }
      }
      return { isDirectory: () => false }
    })

    mockFsReadFileSync.mockImplementation((p: unknown) => {
      if (typeof p !== 'string') return ''
      return files[p] ?? ''
    })

    mockFsReaddirSync.mockImplementation((p: unknown) => {
      if (typeof p !== 'string') return []
      return dirs[p] ?? []
    })

    const { scanAgentLocalConfig } = await import(
      '@/services/agent-local-config-service'
    )
    const result = scanAgentLocalConfig('agent-1')

    expect(result.error).toBeUndefined()
    expect(result.data).toBeDefined()
    expect(result.data!.plugins.length).toBeGreaterThanOrEqual(1)
    // The rolePlugin MUST now be populated, not null.
    expect(result.data!.rolePlugin).not.toBeNull()
    expect(result.data!.rolePlugin?.name).toBe(ROLE_PLUGIN_NAME)
    // Quad-match output fields
    expect(result.data!.rolePlugin?.mainAgentName).toBe(
      `${ROLE_PLUGIN_NAME}-main-agent`,
    )
    expect(result.data!.rolePlugin?.compatibleTitles).toContain('AUTONOMOUS')
  })

  // --------------------------------------------------------------------------
  // Regression guard: when no source folder exists, rolePlugin stays null
  // --------------------------------------------------------------------------
  it('returns rolePlugin:null when no source folder satisfies the quad-match', async () => {
    /**
     * When none of the candidate source folders exist, scanCodexDirectory
     * must not crash and must return rolePlugin:null. This covers the case
     * where a plugin was installed but its source folder is missing (e.g.
     * user deleted ~/agents/role-plugins/<name>/).
     */
    const workDir = WORK_DIR
    const codexInstalledDir = path.join(workDir, '.codex', 'installed-plugins')
    const coreInstalledJson = path.join(codexInstalledDir, `${CORE_PLUGIN_NAME}.json`)

    const files: Record<string, string> = {
      [coreInstalledJson]: JSON.stringify({
        name: CORE_PLUGIN_NAME,
        clientType: 'codex',
        installedAt: '2026-04-21T00:00:00Z',
        paths: [],
      }),
    }

    mockAgentRegistry.getAgent.mockReturnValue({
      id: 'agent-2',
      name: 'scen016-r18-test',
      workingDirectory: workDir,
      sessions: [],
    })

    mockFsExistsSync.mockImplementation((p: unknown) => {
      if (typeof p !== 'string') return false
      if (p === workDir) return true
      if (p === codexInstalledDir) return true
      if (p in files) return true
      return false
    })
    mockFsStatSync.mockImplementation((p: unknown) => {
      if (typeof p === 'string' && (p === workDir || p === codexInstalledDir)) {
        return { isDirectory: () => true }
      }
      return { isDirectory: () => false }
    })
    mockFsReadFileSync.mockImplementation((p: unknown) =>
      typeof p === 'string' ? (files[p] ?? '') : '',
    )
    mockFsReaddirSync.mockImplementation((p: unknown) =>
      p === codexInstalledDir ? [`${CORE_PLUGIN_NAME}.json`] : [],
    )

    const { scanAgentLocalConfig } = await import(
      '@/services/agent-local-config-service'
    )
    const result = scanAgentLocalConfig('agent-2')

    expect(result.error).toBeUndefined()
    expect(result.data).toBeDefined()
    // Core plugin is visible but rolePlugin is null (core plugin is NOT a role plugin).
    expect(result.data!.plugins.some(p => p.name === CORE_PLUGIN_NAME)).toBe(true)
    expect(result.data!.rolePlugin).toBeNull()
  })

  // --------------------------------------------------------------------------
  // Agent not found → 404
  // --------------------------------------------------------------------------
  it('returns 404 when agent is not in the registry', async () => {
    /** Protects against silent misdirection when an agent id is bogus. */
    mockAgentRegistry.getAgent.mockReturnValue(null)

    const { scanAgentLocalConfig } = await import(
      '@/services/agent-local-config-service'
    )
    const result = scanAgentLocalConfig('non-existent')

    expect(result.status).toBe(404)
    expect(result.error).toBeTruthy()
  })
})
