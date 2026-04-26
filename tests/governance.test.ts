import { describe, it, expect, vi, beforeEach } from 'vitest'
import { statePath } from '@/lib/ecosystem-constants'

// ============================================================================
// Mocks
// ============================================================================

let fsStore: Record<string, string> = {}

vi.mock('fs', () => ({
  default: {
    existsSync: vi.fn((filePath: string) => filePath in fsStore),
    mkdirSync: vi.fn(),
    readFileSync: vi.fn((filePath: string) => {
      if (filePath in fsStore) return fsStore[filePath]
      throw new Error(`ENOENT: no such file or directory, open '${filePath}'`)
    }),
    writeFileSync: vi.fn((filePath: string, data: string) => {
      fsStore[filePath] = data
    }),
    copyFileSync: vi.fn((src: string, dest: string) => {
      if (src in fsStore) fsStore[dest] = fsStore[src]
      else throw new Error(`ENOENT: no such file or directory, copy '${src}'`)
    }),
    renameSync: vi.fn((oldPath: string, newPath: string) => {
      if (oldPath in fsStore) {
        fsStore[newPath] = fsStore[oldPath]
        delete fsStore[oldPath]
      } else {
        throw new Error(`ENOENT: no such file or directory, rename '${oldPath}'`)
      }
    }),
  },
}))

let uuidCounter = 0
vi.mock('uuid', () => ({
  v4: vi.fn(() => {
    uuidCounter++
    return `uuid-${uuidCounter}`
  }),
}))

// Mock the argon2 wrapper (the source uses hashPassword/verifyPasswordAuto/needsRehash from
// `@/lib/argon2`, NOT bcryptjs directly). The mock uses simple string comparison; constant-time
// comparison is irrelevant here (Phase 1 localhost; timing-attack resistance is not under test).
vi.mock('@/lib/argon2', () => ({
  hashPassword: vi.fn((plain: string) => Promise.resolve(`hashed:${plain}`)),
  verifyPassword: vi.fn((hash: string, plain: string) => Promise.resolve(hash === `hashed:${plain}`)),
  verifyPasswordAuto: vi.fn((hash: string, plain: string) => Promise.resolve(hash === `hashed:${plain}`)),
  isArgon2Hash: vi.fn((hash: string) => hash.startsWith('$argon2')),
  isBcryptHash: vi.fn((hash: string) => hash.startsWith('$2b$') || hash.startsWith('$2a$')),
  // Always return false so verifyPassword never triggers the rehash branch in the test path.
  needsRehash: vi.fn(() => Promise.resolve(false)),
}))

// `setPassword` calls into `@/lib/security-config` to optionally re-encrypt cached secrets.
// Tests don't seed an unlocked security config, so isUnlocked must return false and
// reEncryptWithNewPassword must be a no-op. Mocking avoids real disk I/O for the encrypted vault.
vi.mock('@/lib/security-config', () => ({
  isUnlocked: vi.fn(() => false),
  reEncryptWithNewPassword: vi.fn(),
  loadSecurityConfig: vi.fn(() => ({
    argon2: { memoryCost: 65536, timeCost: 3, parallelism: 4 },
  })),
}))

vi.mock('@/lib/file-lock', () => ({
  // `withLock` is what governance.ts actually calls. `acquireLock` is exported by the real
  // module too, so the mock declares it to avoid noisy "No 'acquireLock' export" warnings
  // emitted when other tests/modules accidentally probe the surface during a vitest run.
  withLock: vi.fn((_name: string, fn: () => unknown) => Promise.resolve(fn())),
  acquireLock: vi.fn(() => Promise.resolve(() => {})),
}))

vi.mock('@/lib/team-registry', () => ({
  loadTeams: vi.fn(() => [] as Array<Record<string, unknown>>),
  getTeam: vi.fn(() => null),
}))

// MF-027: Mock governance-sync to prevent real dependency chain (broadcastGovernanceSync)
// from firing when governance config is saved during tests. The mock must return a Promise
// because the caller uses fire-and-forget pattern: broadcastGovernanceSync(...).catch(...)
vi.mock('@/lib/governance-sync', () => ({
  broadcastGovernanceSync: vi.fn(() => Promise.resolve()),
}))

// Mock the signed-ledger so saveGovernance's `governanceLedger.append(...)` becomes a no-op.
// Without this the real ledger emits "AUDIT GAP" warnings at every save during tests.
// Use a real class (not vi.fn().mockImplementation) so `new SignedLedger(path)` works at
// module-init time: `lib/agent-registry.ts` (transitively imported via team-registry mock
// path resolution, no — actually direct via governance.ts -> team-registry import) constructs
// SignedLedger at module top-level, so the constructor must be a real callable class.
vi.mock('@/lib/signed-ledger', () => {
  class SignedLedger {
    constructor(_registryPath: string) {}
    append(_op: string, _file: string, _diff: unknown): Promise<void> {
      return Promise.resolve()
    }
  }
  return { SignedLedger }
})

// ============================================================================
// Import module under test (after mocks)
// ============================================================================

import {
  loadGovernance,
  setPassword,
  verifyPassword,
  setManager,
  getManagerId,
  removeManager,
  isManager,
  isChiefOfStaffAnywhere,
} from '@/lib/governance'
import { loadTeams } from '@/lib/team-registry'
import type { GovernanceConfig } from '@/types/governance'
import { DEFAULT_GOVERNANCE_CONFIG } from '@/types/governance'

// ============================================================================
// Test helpers
// ============================================================================

const GOVERNANCE_FILE = statePath('governance.json')

function seedGovernance(overrides: Partial<GovernanceConfig> = {}): void {
  const config: GovernanceConfig = { ...DEFAULT_GOVERNANCE_CONFIG, ...overrides }
  fsStore[GOVERNANCE_FILE] = JSON.stringify(config, null, 2)
}

// ============================================================================
// Setup
// ============================================================================

beforeEach(() => {
  fsStore = {}
  uuidCounter = 0
  vi.clearAllMocks()
})

// ============================================================================
// loadGovernance
// ============================================================================

describe('loadGovernance', () => {
  it('returns defaults when no governance file exists on disk', async () => {
    /** Verifies that a fresh system with no governance.json returns the default config */
    const config = loadGovernance()

    // userName is auto-generated on first load (not in DEFAULT_GOVERNANCE_CONFIG)
    expect(config).toMatchObject(DEFAULT_GOVERNANCE_CONFIG)
    expect(config.passwordHash).toBeNull()
    expect(config.managerId).toBeNull()
    expect(config.userName).toMatch(/^user\d{3}$/)
    // CC-003: Verify first-run initialization writes defaults to disk (saveGovernance is called for first-time init)
    const fsMock = (await import('fs')).default
    expect(fsMock.writeFileSync).toHaveBeenCalled()
  })

  it('reads and returns existing governance config from disk', () => {
    /** Verifies that an existing governance.json is read and parsed correctly */
    seedGovernance({
      passwordHash: 'hashed:secret123',
      passwordSetAt: '2025-06-01T12:00:00.000Z',
      managerId: 'agent-mgr-001',
    })

    const config = loadGovernance()

    expect(config.version).toBe(1)
    expect(config.passwordHash).toBe('hashed:secret123')
    expect(config.passwordSetAt).toBe('2025-06-01T12:00:00.000Z')
    expect(config.managerId).toBe('agent-mgr-001')
  })

  it('returns defaults and backs up when governance file contains invalid JSON', async () => {
    /** CC-015: Verifies that corrupted governance.json triggers fallback to defaults, backup of corrupt file, and self-healing write */
    // Seed with invalid JSON to simulate disk corruption
    fsStore[GOVERNANCE_FILE] = '{not-valid-json'

    const config = loadGovernance()

    // Must return DEFAULT_GOVERNANCE_CONFIG values
    expect(config.managerId).toBeNull()
    expect(config.passwordHash).toBeNull()
    expect(config.version).toBe(1)
    expect(config.passwordSetAt).toBeNull()

    // Verify corrupt file was backed up (copyFileSync called with governance file as source)
    const fsMock = (await import('fs')).default
    expect(fsMock.copyFileSync).toHaveBeenCalledWith(
      GOVERNANCE_FILE,
      expect.stringContaining('.corrupted.')
    )

    // Verify self-healing: defaults written back to disk after corruption
    expect(fsMock.writeFileSync).toHaveBeenCalled()
    const writtenData = JSON.parse(fsStore[GOVERNANCE_FILE])
    expect(writtenData.managerId).toBeNull()
    expect(writtenData.passwordHash).toBeNull()
    expect(writtenData.version).toBe(1)
  })
})

// ============================================================================
// setPassword
// ============================================================================

describe('setPassword', () => {
  it('hashes the plaintext password and persists it to governance config', async () => {
    /** Verifies that setPassword stores an argon2id hash and timestamp in governance.json */
    await setPassword('my-governance-pass')

    const config = loadGovernance()

    expect(config.passwordHash).toBe('hashed:my-governance-pass')
    expect(config.passwordSetAt).toBeDefined()
    expect(typeof config.passwordSetAt).toBe('string')
    // Verify the timestamp is a valid ISO date
    expect(new Date(config.passwordSetAt!).toISOString()).toBe(config.passwordSetAt)
    // CC-002: Verify the argon2id wrapper was called with the plaintext password.
    // `setPassword` no longer accepts a salt-rounds parameter — argon2id options are
    // sourced from `loadSecurityConfig().argon2` inside the wrapper itself.
    const argon2Module = await import('@/lib/argon2')
    expect(argon2Module.hashPassword).toHaveBeenCalledWith('my-governance-pass')
  })
})

// ============================================================================
// verifyPassword
// ============================================================================

describe('verifyPassword', () => {
  it('returns true for correct password and false for wrong password', async () => {
    /** Verifies password comparison against stored hash returns correct boolean */
    seedGovernance({ passwordHash: 'hashed:correctpass' })

    expect(await verifyPassword('correctpass')).toBe(true)
    expect(await verifyPassword('wrongpass')).toBe(false)
  })

  it('returns false when no password has been set', async () => {
    /** Verifies that verifyPassword returns false when passwordHash is null (no password configured) */
    seedGovernance({ passwordHash: null })

    expect(await verifyPassword('anypassword')).toBe(false)
  })
})

// ============================================================================
// setManager / getManagerId
// ============================================================================

describe('setManager / getManagerId', () => {
  it('sets the manager ID and retrieves it back', async () => {
    /** Verifies that setManager persists the manager UUID and getManagerId reads it */
    expect(getManagerId()).toBeNull()

    await setManager('agent-boss-42')

    expect(getManagerId()).toBe('agent-boss-42')
  })
})

// ============================================================================
// removeManager
// ============================================================================

describe('removeManager', () => {
  it('removes the previously set manager', async () => {
    /** Verifies that removeManager clears the managerId back to null */
    await setManager('agent-boss-42')
    expect(getManagerId()).toBe('agent-boss-42')

    await removeManager()

    expect(getManagerId()).toBeNull()
  })
})

// ============================================================================
// isManager
// ============================================================================

describe('isManager', () => {
  it('returns true only for the agent ID that matches the set manager', async () => {
    /** Verifies isManager is true for the exact manager UUID and false for others */
    await setManager('agent-boss-42')

    expect(isManager('agent-boss-42')).toBe(true)
    expect(isManager('agent-other-99')).toBe(false)
    expect(isManager('')).toBe(false)
  })

  it('returns false for empty string when no manager is set', () => {
    /** Verifies isManager returns false for empty string agentId when managerId is null (null !== '') */
    seedGovernance({ managerId: null })

    expect(isManager('')).toBe(false)
  })

  it('returns false when managerId is null and agentId is null', () => {
    /** CC-015: Guards against null === null being true — isManager must reject null agentId even when managerId is null */
    seedGovernance({ managerId: null })

    expect(isManager(null as any)).toBe(false)
  })
})

// ============================================================================
// isChiefOfStaffAnywhere
// ============================================================================

describe('isChiefOfStaffAnywhere', () => {
  it('returns true when the agent is chief-of-staff of a closed team', () => {
    /** Verifies that an agent designated as COS on a closed team is correctly identified */
    const mockedLoadTeams = vi.mocked(loadTeams)

    mockedLoadTeams.mockReturnValue([
      {
        id: 'team-open-1',
        name: 'Open Team',
        type: 'closed',
        agentIds: ['agent-cos-1'],
        chiefOfStaffId: 'agent-cos-1',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'team-closed-1',
        name: 'Closed Team',
        type: 'closed',
        agentIds: ['agent-cos-1', 'agent-member-2'],
        chiefOfStaffId: 'agent-cos-1',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ])

    expect(isChiefOfStaffAnywhere('agent-cos-1')).toBe(true)
    expect(isChiefOfStaffAnywhere('agent-member-2')).toBe(false)
    expect(isChiefOfStaffAnywhere('agent-nobody')).toBe(false)
  })

  it('returns true when agent is COS on any team (all teams are closed after governance simplification)', () => {
    /** After governance simplification all teams are closed, so COS on any team counts */
    const mockedLoadTeams = vi.mocked(loadTeams)

    mockedLoadTeams.mockReturnValue([
      {
        id: 'team-1',
        name: 'Team Alpha',
        type: 'closed',
        agentIds: ['agent-cos-open'],
        chiefOfStaffId: 'agent-cos-open',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
      {
        id: 'team-2',
        name: 'Team Beta',
        type: 'closed',
        agentIds: ['agent-cos-open'],
        chiefOfStaffId: 'agent-cos-open',
        createdAt: '2025-01-01T00:00:00.000Z',
        updatedAt: '2025-01-01T00:00:00.000Z',
      },
    ])

    expect(isChiefOfStaffAnywhere('agent-cos-open')).toBe(true)
  })
})
