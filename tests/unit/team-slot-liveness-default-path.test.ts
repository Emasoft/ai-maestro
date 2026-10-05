/**
 * The PRODUCTION default path of the team-slot leg (TRDD-XTDMQO68): runFleetLivenessTick WITHOUT an
 * injected findTeamSlots, so it reads the real team-registry and agent-registry modules over files
 * this test writes. HOME is redirected before any module loads (both registries fix their paths at
 * module load from os.homedir()); containment is proven, not assumed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

const { fakeHome, realTeamsDir } = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs')
  const os = require('os') as typeof import('os')
  const path = require('path') as typeof import('path')
  const realTeamsDir = path.join(os.homedir(), '.aimaestro', 'teams')
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'team-slot-default-path-'))
  process.env.HOME = fakeHome
  return { fakeHome, realTeamsDir }
})

/** names + sizes only, never contents */
const listing = (dir: string): string =>
  fs.existsSync(dir)
    ? fs
        .readdirSync(dir)
        .sort()
        .map((n) => `${n}:${fs.statSync(path.join(dir, n)).size}`)
        .join('|')
    : '(absent)'

const realBefore = listing(realTeamsDir)

let runFleetLivenessTick: typeof import('@/lib/fleet-liveness-watchdog').runFleetLivenessTick
let resetTeamSlotState: typeof import('@/lib/fleet-liveness-watchdog').resetTeamSlotState
let stateDir: string
let teamsFile: string
let registryFile: string
let writeCount = 0

beforeAll(async () => {
  ;({ runFleetLivenessTick, resetTeamSlotState } = await import('@/lib/fleet-liveness-watchdog'))
  stateDir = (await import('@/lib/ecosystem-constants')).getStateDir()
  teamsFile = path.join(stateDir, 'teams', 'teams.json')
  registryFile = path.join(stateDir, 'agents', 'registry.json')
})

afterAll(() => {
  fs.rmSync(fakeHome, { recursive: true, force: true })
})

// loadAgents caches by file mtime: give every registry write a distinct mtime.
const writeRegistry = (agents: unknown[]) => {
  fs.mkdirSync(path.dirname(registryFile), { recursive: true })
  fs.writeFileSync(registryFile, JSON.stringify(agents))
  const t = new Date(Date.now() + ++writeCount * 5000)
  fs.utimesSync(registryFile, t, t)
}
const writeTeams = (teams: unknown[]) => {
  fs.mkdirSync(path.dirname(teamsFile), { recursive: true })
  fs.writeFileSync(teamsFile, JSON.stringify({ version: 1, teams }))
}
const team = (over: Record<string, unknown>) => ({ id: 't1', name: 'Secret Name', type: 'closed', agentIds: [], ...over })

const tick = async (): Promise<string[]> => {
  const logs: string[] = []
  await runFleetLivenessTick({
    scan: async () => ({ scannedAt: 0, agents: [], recoveryTargets: [] }) as never,
    nudgeEnabled: false,
    runContinuity: async () => ({ scanned: 0, fired: [], skipped: [] }),
    log: (m) => logs.push(m),
  })
  return logs.filter((m) => m.includes('[FleetTeamSlots]'))
}

beforeEach(() => {
  resetTeamSlotState()
  fs.rmSync(path.join(stateDir, 'teams'), { recursive: true, force: true })
  writeRegistry([{ id: 'live-agent', name: 'live-agent' }, { id: 'gone-agent', name: 'gone-agent', deletedAt: '2026-01-01T00:00:00Z' }])
})

describe('team-slot leg, default (uninjected) path over a temp HOME', () => {
  it('contains every path it resolved under the temp dir and leaves the real teams dir untouched', async () => {
    expect(stateDir.startsWith(fakeHome)).toBe(true)
    expect(teamsFile.startsWith(fakeHome)).toBe(true)
    expect(registryFile.startsWith(fakeHome)).toBe(true)
    expect(realTeamsDir.startsWith(fakeHome)).toBe(false)
    writeTeams([team({ chiefOfStaffId: 'ghost' })])
    await tick()
    expect(listing(realTeamsDir)).toBe(realBefore)
  })
  it('(a) logs a chair id absent from the registry as unknown', async () => {
    writeTeams([team({ chiefOfStaffId: 'ghost' })])
    const s = await tick()
    expect(s).toHaveLength(1)
    expect(s[0]).toContain('team t1 chief-of-staff=ghost (unknown)')
    expect(s[0]).not.toContain('Secret Name')
  })
  it('(b) logs a soft-deleted chair with its reason', async () => {
    writeTeams([team({ chiefOfStaffId: 'gone-agent' })])
    const s = await tick()
    expect(s).toHaveLength(1)
    expect(s[0]).toContain('team t1 chief-of-staff=gone-agent (soft-deleted)')
  })
  it('(c) logs nothing for a healthy team', async () => {
    writeTeams([team({ chiefOfStaffId: 'live-agent', orchestratorId: 'live-agent' })])
    expect(await tick()).toEqual([])
  })
  it('(d) logs nothing and does not throw when the teams file is missing', async () => {
    expect(fs.existsSync(teamsFile)).toBe(false)
    expect(await tick()).toEqual([])
  })
  it('LIMITATION: a corrupt teams file is not read as "no findings" - loadTeams throws, so the leg logs a failure line (non-fatal)', async () => {
    fs.mkdirSync(path.dirname(teamsFile), { recursive: true })
    fs.writeFileSync(teamsFile, '{ this is not json')
    const s = await tick()
    expect(s).toHaveLength(1)
    expect(s[0]).toContain('team-slot check failed (non-fatal)')
    expect(s[0]).not.toContain('resolved')
  })
})
