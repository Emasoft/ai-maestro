/**
 * R31 incomplete-team freeze — TRDD-0KMDJVON.
 *
 * The one load-bearing fact this suite pins: `freezeIncompleteTeam()` is a NEW
 * function, deliberately NOT a reuse/extension of `blockAllTeams()` — the
 * DEADLOCK TRAP the card documents. `blockAllTeams()` hibernates the
 * CHIEF-OF-STAFF along with everyone else (correct for R9.8's no-MANAGER
 * cascade); R31's freeze must NEVER touch the COS, because the COS is the
 * only agent that can repair an incomplete roster (R12.2/R31.1). Hibernating
 * it here would deadlock every incomplete team forever.
 *
 * 0-IMPACT: `@/lib/ecosystem-constants` is faked to a temp dir (per the
 * `store-revocation-compensation.test.ts` idiom) so `teams.json` never
 * touches the developer's real `~/.aimaestro/`. `child_process.execFile` is
 * mocked so no real tmux session is ever targeted.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { rmSync } from 'fs'
import type { Team } from '@/types/team'

const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-freeze-team-'))
  return { FAKE_HOME: path.join(root, 'home'), FAKE_STATE: path.join(root, 'state') }
})

vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

// Fixture agents keyed by id — governanceTitle drives isTeamComplete; deletedAt
// (a tombstone) must make an agent invisible to it, mirroring getAgent()'s
// real default (excludes soft-deleted unless includeDeleted is passed).
type FixtureAgent = { id: string; name: string; governanceTitle?: string | null; deletedAt?: string }
const registry = new Map<string, FixtureAgent>()

vi.mock('@/lib/agent-registry', () => ({
  getAgent: (id: string, includeDeleted = false) => {
    const agent = registry.get(id) ?? null
    if (agent && agent.deletedAt && !includeDeleted) return null
    return agent
  },
}))

// Killed-session ledger the mock execFile writes to, so a test can assert
// exactly which agent ids were targeted (and, just as importantly, which
// were NOT — the COS must never appear here).
let killedSessionNames: string[] = []
vi.mock('child_process', () => ({
  execFile: (
    _cmd: string,
    args: string[],
    _opts: unknown,
    callback: (err: Error | null, result?: { stdout: string; stderr: string }) => void
  ) => {
    // args = ['kill-session', '-t', sessionName]
    if (args[1] === '-t') killedSessionNames.push(args[2])
    callback(null, { stdout: '', stderr: '' })
  },
}))

const COS_ID = 'agent-cos'
const ARCH_ID = 'agent-arch'
const ORCH_ID = 'agent-orch'
const INT_ID = 'agent-int'
const MEMBER_ID = 'agent-member'

function seedAgents(overrides: Partial<Record<string, Partial<FixtureAgent>>> = {}) {
  registry.clear()
  const base: FixtureAgent[] = [
    { id: COS_ID, name: 'cos-agent', governanceTitle: 'chief-of-staff' },
    { id: ARCH_ID, name: 'arch-agent', governanceTitle: 'architect' },
    { id: ORCH_ID, name: 'orch-agent', governanceTitle: 'orchestrator' },
    { id: INT_ID, name: 'int-agent', governanceTitle: 'integrator' },
    { id: MEMBER_ID, name: 'member-agent', governanceTitle: 'member' },
  ]
  for (const a of base) {
    registry.set(a.id, { ...a, ...(overrides[a.id] ?? {}) })
  }
}

beforeEach(async () => {
  killedSessionNames = []
  // Reset the (faked) teams.json between tests so agent ids reused across
  // tests never trip the single-team-membership guard from a prior test's team.
  const { saveTeams } = await import('@/lib/team-registry')
  saveTeams([])
})

afterAll(() => {
  rmSync(FAKE_STATE, { recursive: true, force: true })
  rmSync(FAKE_HOME, { recursive: true, force: true })
})

describe('isTeamComplete + freezeIncompleteTeam (TRDD-0KMDJVON)', () => {
  it('a complete team (all 5 R12.1 titles live) reports complete and freeze is a no-op', async () => {
    const { isTeamComplete, freezeIncompleteTeam, createTeam, loadTeams } = await import('@/lib/team-registry')
    seedAgents()
    const created = await createTeam({
      name: 'R31 Complete Team',
      agentIds: [COS_ID, ARCH_ID, ORCH_ID, INT_ID, MEMBER_ID],
      chiefOfStaffId: COS_ID,
    })

    expect(await isTeamComplete(created)).toBe(true)

    const result = await freezeIncompleteTeam(created.id)
    expect(result).toEqual({ frozen: false, hibernated: [] })
    expect(killedSessionNames).toEqual([])

    const onDisk = loadTeams().find(t => t.id === created.id) as Team
    expect(onDisk.frozen).not.toBe(true)
  })

  it('an incomplete team (missing ARCHITECT) freezes and hibernates every non-COS agent, sparing the COS', async () => {
    const { isTeamComplete, freezeIncompleteTeam, createTeam, loadTeams } = await import('@/lib/team-registry')
    seedAgents()
    const created = await createTeam({
      name: 'R31 Incomplete Team',
      agentIds: [COS_ID, ORCH_ID, INT_ID, MEMBER_ID], // no ARCHITECT
      chiefOfStaffId: COS_ID,
    })

    expect(await isTeamComplete(created)).toBe(false)

    const result = await freezeIncompleteTeam(created.id)
    expect(result.frozen).toBe(true)
    // Every non-COS agent was hibernated; the COS's session was NEVER killed.
    expect(new Set(result.hibernated)).toEqual(new Set([ORCH_ID, INT_ID, MEMBER_ID]))
    expect(killedSessionNames.slice().sort()).toEqual(['int-agent', 'member-agent', 'orch-agent'])
    expect(killedSessionNames).not.toContain('cos-agent')

    const onDisk = loadTeams().find(t => t.id === created.id) as Team
    expect(onDisk.frozen).toBe(true)
  })

  it('a tombstoned agent (deletedAt set) does not count toward completeness', async () => {
    const { isTeamComplete, createTeam } = await import('@/lib/team-registry')
    seedAgents({ [ARCH_ID]: { deletedAt: new Date().toISOString() } })
    const created = await createTeam({
      name: 'R31 Tombstoned-Architect Team',
      agentIds: [COS_ID, ARCH_ID, ORCH_ID, INT_ID, MEMBER_ID],
      chiefOfStaffId: COS_ID,
    })

    // ARCHITECT is present in agentIds but soft-deleted — must NOT count as live.
    expect(await isTeamComplete(created)).toBe(false)
  })
})
