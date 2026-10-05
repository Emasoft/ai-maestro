import { describe, it, expect, beforeEach } from 'vitest'
import { findDanglingTeamSlots, type TeamSlotFinding } from '@/lib/team-slot-liveness'
import { runFleetLivenessTick, resetTeamSlotState } from '@/lib/fleet-liveness-watchdog'
import type { FleetLivenessSnapshot } from '@/lib/fleet-liveness'


const lookup = (id: string): { deletedAt?: string } | null =>
  id === 'live' ? {} : id === 'gone' ? { deletedAt: '2026-01-01T00:00:00Z' } : null

describe('findDanglingTeamSlots', () => {
  it('reports a chair id absent from the registry as unknown', () => {
    const r = findDanglingTeamSlots([{ id: 't1', name: 'T1', chiefOfStaffId: 'ghost', orchestratorId: null }], lookup)
    expect(r).toEqual([{ teamId: 't1', teamName: 'T1', slot: 'chief-of-staff', danglingId: 'ghost', reason: 'unknown' }])
  })
  it('reports a dangling orchestrator', () => {
    const r = findDanglingTeamSlots([{ id: 't1', name: 'T1', chiefOfStaffId: 'live', orchestratorId: 'ghost' }], lookup)
    expect(r.map((f) => [f.slot, f.reason])).toEqual([['orchestrator', 'unknown']])
  })
  it('reports a soft-deleted holder as soft-deleted', () => {
    const r = findDanglingTeamSlots([{ id: 't1', name: 'T1', chiefOfStaffId: 'gone' }], lookup)
    expect(r[0].reason).toBe('soft-deleted')
  })
  it('does not treat null or missing slots as findings', () => {
    const r = findDanglingTeamSlots([{ id: 't1', name: 'T1', chiefOfStaffId: null, orchestratorId: undefined }, { id: 't2', name: 'T2' }], lookup)
    expect(r).toEqual([])
  })
  it('reports nothing for a healthy team', () => {
    expect(findDanglingTeamSlots([{ id: 't1', name: 'T1', chiefOfStaffId: 'live', orchestratorId: 'live' }], lookup)).toEqual([])
  })
  it('reports two findings when both slots dangle', () => {
    const r = findDanglingTeamSlots([{ id: 't1', name: 'T1', chiefOfStaffId: 'ghost', orchestratorId: 'gone' }], lookup)
    expect(r.map((f) => f.slot)).toEqual(['chief-of-staff', 'orchestrator'])
  })
  it('does not mutate the teams it reads', () => {
    const teams = [{ id: 't1', name: 'T1', chiefOfStaffId: 'ghost', orchestratorId: 'gone' }]
    const before = structuredClone(teams)
    findDanglingTeamSlots(teams, lookup)
    expect(teams).toEqual(before)
  })
})

describe('watchdog team-slot leg', () => {
  const SNAP = { scannedAt: 0, agents: [], recoveryTargets: [] } as unknown as FleetLivenessSnapshot
  const f1: TeamSlotFinding = { teamId: 't1', teamName: 'Secret Name', slot: 'chief-of-staff', danglingId: 'ghost', reason: 'unknown' }
  const f2: TeamSlotFinding = { ...f1, slot: 'orchestrator' }
  const tick = (find: () => TeamSlotFinding[], logs: string[], extra: Record<string, unknown> = {}) =>
    runFleetLivenessTick({
      scan: async () => SNAP,
      nudgeEnabled: false,
      runContinuity: async () => ({ scanned: 0, fired: [], skipped: [] }),
      findTeamSlots: find,
      log: (m) => logs.push(m),
      ...extra,
    })
  const slotLogs = (logs: string[]) => logs.filter((m) => m.includes('[FleetTeamSlots]'))
  beforeEach(() => resetTeamSlotState())

  it('logs a finding once, naming team id, slot and dangling id only, and says report only', async () => {
    const logs: string[] = []
    await tick(() => [f1], logs)
    expect(slotLogs(logs)).toHaveLength(1)
    expect(logs[0]).toContain('REPORT ONLY')
    expect(logs[0]).toContain('nothing was modified')
    expect(logs[0]).toContain('team t1 chief-of-staff=ghost')
    expect(logs[0]).not.toContain('Secret Name')
  })
  it('does not re-log an unchanged finding set on the next tick', async () => {
    const logs: string[] = []
    await tick(() => [f1], logs)
    await tick(() => [f1], logs)
    expect(slotLogs(logs)).toHaveLength(1)
  })
  it('logs again when the finding set changes', async () => {
    const logs: string[] = []
    await tick(() => [f1], logs)
    await tick(() => [f1, f2], logs)
    expect(slotLogs(logs)).toHaveLength(2)
  })
  it('logs one resolved line when the set empties, then nothing while it stays empty', async () => {
    const logs: string[] = []
    await tick(() => [f1], logs)
    await tick(() => [], logs)
    await tick(() => [], logs)
    const s = slotLogs(logs)
    expect(s).toHaveLength(2)
    expect(s[1]).toContain('resolved')
  })
  it('logs nothing for a clean fleet from the start', async () => {
    const logs: string[] = []
    await tick(() => [], logs)
    expect(slotLogs(logs)).toEqual([])
  })
  it('a throwing detector logs one error line and the other legs still complete', async () => {
    const logs: string[] = []
    const snap = await tick(
      () => {
        throw new Error('boom')
      },
      logs,
      {
        nudgeEnabled: true,
        runNudge: async () => ({ nudged: [{ agentId: 'a1', name: 'alice', unread: 2 }] }) as never,
        runContinuity: async () => ({ scanned: 1, fired: [{ agentId: 'a1', name: 'alice', eventId: 'e', response: 'r' }], skipped: [] }),
      },
    )
    expect(snap).not.toBeNull()
    expect(slotLogs(logs)).toHaveLength(1)
    expect(logs.find((m) => m.includes('[FleetTeamSlots]'))).toContain('failed (non-fatal): boom')
    expect(logs.some((m) => m.includes('[FleetInboxNudge] nudged'))).toBe(true)
    expect(logs.some((m) => m.includes('[FleetContinuity] alice'))).toBe(true)
  })
  it('logs a persistent identical failure once, and logs it again after a successful check re-arms it', async () => {
    const logs: string[] = []
    const boom = () => {
      throw new Error('boom')
    }
    await tick(boom, logs)
    await tick(boom, logs)
    expect(slotLogs(logs)).toHaveLength(1)
    await tick(() => [], logs)
    await tick(boom, logs)
    expect(slotLogs(logs).filter((m) => m.includes('failed (non-fatal): boom'))).toHaveLength(2)
  })
  it('logs a different failure message even while the previous failure persists', async () => {
    const logs: string[] = []
    await tick(() => { throw new Error('one') }, logs)
    await tick(() => { throw new Error('two') }, logs)
    expect(slotLogs(logs)).toHaveLength(2)
  })
  it('puts reason in the log line and treats unknown -> soft-deleted on the same slot as a change', async () => {
    const logs: string[] = []
    await tick(() => [f1], logs)
    await tick(() => [{ ...f1, reason: 'soft-deleted' }], logs)
    const s = slotLogs(logs)
    expect(s).toHaveLength(2)
    expect(s[0]).toContain('chief-of-staff=ghost (unknown)')
    expect(s[1]).toContain('chief-of-staff=ghost (soft-deleted)')
  })
  it('does not mutate the teams data across a tick', async () => {
    const teams = [{ id: 't1', name: 'T1', chiefOfStaffId: 'ghost', orchestratorId: 'gone' }]
    const before = structuredClone(teams)
    await tick(() => findDanglingTeamSlots(teams, () => null), [])
    expect(teams).toEqual(before)
  })
})
