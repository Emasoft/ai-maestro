/**
 * The portfolio mint stamps `issuer_team_id` from the REGISTRY, not from the caller's credential
 * (TRDD-8E6XMDEX). A governance token's team claim is up to an hour old, so an issuer moved out of a
 * team would otherwise keep minting tokens stamped with its old team.
 *
 * The team registry and the portfolio store are REAL: os.homedir() is redirected to a temp dir
 * before they load. Only auth, ledger, signing and the live-subject lookup are stubbed.
 */

import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { NextRequest } from 'next/server'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-portfolio-issuer-team-'))

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => TMP_HOME }, homedir: () => TMP_HOME }
})

const { mockAuth } = vi.hoisted(() => ({
  mockAuth: {
    authenticateFromRequest: vi.fn(() => ({})),
    buildAuthContext: vi.fn((): Record<string, unknown> => ({})),
  },
}))
vi.mock('@/lib/agent-auth', () => mockAuth)
vi.mock('@/lib/portfolio-ledger', () => ({
  emitPortfolioOp: vi.fn(() => Promise.resolve(1)),
  issueDiff: vi.fn(() => []),
  revokeDiff: vi.fn(() => []),
}))
vi.mock('@/lib/portfolio-sign', () => ({ signPortfolioToken: vi.fn(() => 'sig') }))
vi.mock('@/lib/agent-registry', () => ({ getAgent: vi.fn(() => ({ id: 'sub-team' })) }))

const SUBJECT = 'sub-team'
const ISSUER = 'issuer-mgr'
const TEAMS_DIR = path.join(TMP_HOME, '.aimaestro', 'teams')
const TEAMS_FILE = path.join(TEAMS_DIR, 'teams.json')

let route: typeof import('@/app/api/agents/[id]/portfolio/route')
let store: typeof import('@/lib/portfolio-store')

beforeAll(async () => {
  store = await import('@/lib/portfolio-store')
  route = await import('@/app/api/agents/[id]/portfolio/route')
})

afterAll(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

beforeEach(() => {
  fs.rmSync(path.join(TMP_HOME, '.aimaestro', 'agents'), { recursive: true, force: true })
  store._resetPortfolioCacheForTests()
})

function writeTeams(teams: Array<{ id: string; agentIds: string[] }>): void {
  fs.mkdirSync(TEAMS_DIR, { recursive: true })
  fs.writeFileSync(
    TEAMS_FILE,
    JSON.stringify({ version: 1, teams: teams.map(t => ({ ...t, name: t.id, type: 'closed' })) }),
  )
}

/** Mint as a MANAGER whose CREDENTIAL says `credentialTeam`; returns the stamped token. */
async function mintWithCredentialTeam(credentialTeam: string | null) {
  mockAuth.buildAuthContext.mockReturnValue({
    agentId: ISSUER,
    isSystemOwner: false,
    governanceTitle: 'manager',
    teamId: credentialTeam,
  })
  const res = await route.POST(
    new NextRequest(new URL(`http://localhost:23000/api/agents/${SUBJECT}/portfolio`), {
      method: 'POST',
      body: JSON.stringify({ kind: 'approval', scope: 'agent:create' }),
      headers: { 'content-type': 'application/json' },
    }),
    { params: Promise.resolve({ id: SUBJECT }) },
  )
  expect(res.status).toBe(201)
  const { token_id } = await res.json()
  const token = store.getTokenById(token_id)
  expect(token).toBeTruthy()
  return token!
}

describe('portfolio mint: issuer_team_id comes from the registry', () => {
  it('credential says team A, registry says team B: the token is stamped B', async () => {
    writeTeams([{ id: 'team-B', agentIds: [ISSUER] }])
    const token = await mintWithCredentialTeam('team-A')
    expect(token.issuer_team_id).toBe('team-B')
  })

  it('credential and registry agree: the token is stamped with that team', async () => {
    writeTeams([{ id: 'team-A', agentIds: [ISSUER] }])
    const token = await mintWithCredentialTeam('team-A')
    expect(token.issuer_team_id).toBe('team-A')
  })

  it('registry says the issuer is in no team: no issuer_team_id is stamped, whatever the credential says', async () => {
    writeTeams([{ id: 'team-other', agentIds: ['someone-else'] }])
    const token = await mintWithCredentialTeam('team-A')
    expect(token.issuer_team_id).toBeUndefined()
  })
})
