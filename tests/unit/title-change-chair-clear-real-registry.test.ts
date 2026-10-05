/**
 * G11's chair clear over the REAL team-registry (TRDD-XTDMQO68): the fail-closed throw in ChangeTitle
 * is only safe if a legitimate demotion's clear can actually succeed. A mocked updateTeam cannot answer
 * that. HOME is redirected before module load (the registry fixes its paths at load); containment is
 * proven by comparing the real teams dir before and after.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

const { fakeHome, realTeamsDir } = vi.hoisted(() => {
  const fs = require('fs') as typeof import('fs')
  const os = require('os') as typeof import('os')
  const path = require('path') as typeof import('path')
  const realTeamsDir = path.join(os.homedir(), '.aimaestro', 'teams')
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'g11-real-registry-'))
  process.env.HOME = fakeHome
  return { fakeHome, realTeamsDir }
})

const listing = (dir: string): string =>
  fs.existsSync(dir)
    ? fs.readdirSync(dir).sort().map((n) => `${n}:${fs.statSync(path.join(dir, n)).size}`).join('|')
    : '(absent)'
const realBefore = listing(realTeamsDir)

let reg: typeof import('@/lib/team-registry')
let teamsFile: string

const writeTeams = (teams: unknown[]) => {
  fs.mkdirSync(path.dirname(teamsFile), { recursive: true })
  fs.writeFileSync(teamsFile, JSON.stringify({ version: 1, teams }))
}
const team = (over: Record<string, unknown>) => ({
  id: 't1', name: 'Alpha Team', type: 'closed', agentIds: ['chair', 'm1'], chiefOfStaffId: 'chair',
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...over,
})

beforeAll(async () => {
  reg = await import('@/lib/team-registry')
  teamsFile = path.join((await import('@/lib/ecosystem-constants')).getStateDir(), 'teams', 'teams.json')
})
beforeEach(() => {
  fs.rmSync(path.dirname(teamsFile), { recursive: true, force: true })
})
afterAll(() => {
  fs.rmSync(fakeHome, { recursive: true, force: true })
  expect(listing(realTeamsDir)).toBe(realBefore)
})

describe('G11 chair clear against the real team-registry', () => {
  it('is contained under the temp HOME', () => {
    expect(teamsFile.startsWith(fakeHome)).toBe(true)
    expect(realTeamsDir.startsWith(fakeHome)).toBe(false)
  })

  it('(1) with NO manager (managerId null) the clear succeeds and persists', async () => {
    writeTeams([team({})])
    const updated = await reg.updateTeam('t1', { chiefOfStaffId: null }, null)
    expect(updated?.chiefOfStaffId).toBeNull()
    expect(reg.loadTeams().find((t) => t.id === 't1')?.chiefOfStaffId).toBeNull()
  })

  it('(2) a team left with no chair is accepted, and the old chair stays a member', async () => {
    writeTeams([team({})])
    await reg.updateTeam('t1', { chiefOfStaffId: null }, null)
    const t = reg.loadTeams().find((x) => x.id === 't1')!
    expect(t.chiefOfStaffId).toBeNull()
    expect(t.agentIds).toEqual(['chair', 'm1'])
  })

  it('the clear also succeeds when the chair is a slot-only holder (not in agentIds)', async () => {
    writeTeams([team({ agentIds: ['m1'] })])
    const updated = await reg.updateTeam('t1', { chiefOfStaffId: null }, null)
    expect(updated?.chiefOfStaffId).toBeNull()
  })

  it('a team with a stale chair id for an agent that no longer exists still clears', async () => {
    writeTeams([team({ chiefOfStaffId: 'ghost', agentIds: ['m1'] })])
    const updated = await reg.updateTeam('t1', { chiefOfStaffId: null }, null)
    expect(updated?.chiefOfStaffId).toBeNull()
  })
})
