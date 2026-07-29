/**
 * Governance drift tests — the CHIEF-OF-STAFF team-scoping guards in
 * `lib/authorization.ts` (`docs/GOVERNANCE-ENFORCEMENT-MAP.md` rows R8.4, R10.3, R26.3).
 *
 * All three are the same underlying invariant seen from three angles: a COS's authority
 * stops at its OWN team, and "own team" is resolved from `Team.agentIds[]` — never from
 * the free-text `Agent.team` field. Every test calls the REAL exported `authorize()` and
 * asserts the refusal, with the real `loadTeams()` reading a real (sandboxed) teams.json.
 *
 * CITATION FIXED IN THIS COMMIT: the map cited R10.3 at `lib/authorization.ts:456-466`.
 * That range is the TRDD refuse-RUNG code (`callerRung < requiredRung`) and has nothing to
 * do with wake/hibernate scoping; the real guard is the general COS branch at :530-541,
 * which `wakeAgent`/`hibernateAgent` reach through `authorize(auth, 'wake-agent', id)`.
 * Found by reading the cited lines rather than trusting them — the citation named real
 * code, so an existence check could never have caught it.
 *
 * NOT pinned here, and NOT quietly skipped — see the batch note in the commit:
 *   - **R39.5 / R39.7** (ASSISTANT channel + invisibility). Their guards encode the
 *     PRE-2026-07-22 shape: the rule text now grants an ASSISTANT↔MANAGER channel
 *     (R39.9) and a MANAGER-assigned collaborator carve-out (R39.10), and the code has
 *     neither — `AssistantSenderContext` has no `recipientIsManager` field, and the
 *     static edge set for `assistant` is empty, so the MANAGER cannot reach one either.
 *     The map already records R39.9/R39.10 as UNENFORCED, which is the same gap from the
 *     other side, while R39.5/R39.7 read ENFORCED unqualified. Pinning them would launder
 *     a superseded guard into a green row, so they are filed instead.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { mkdirSync, writeFileSync, existsSync } from 'fs'
import path from 'path'

const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const fsSync = require('fs')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const osSync = require('os')
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const pathSync = require('path')
  const home = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r8r10-home-'))
  const state = fsSync.mkdtempSync(pathSync.join(osSync.tmpdir(), 'r8r10-state-'))
  fsSync.mkdirSync(pathSync.join(state, 'teams'), { recursive: true })
  fsSync.mkdirSync(pathSync.join(state, 'agents'), { recursive: true })
  return { FAKE_HOME: home, FAKE_STATE: state }
})

vi.mock('os', async importOriginal => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => FAKE_HOME }, homedir: () => FAKE_HOME }
})

vi.mock('@/lib/ecosystem-constants', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

// Must return a promise — every caller attaches `.catch()` to the result, so a
// `() => {}` stub kills the caller on `undefined.catch`.
vi.mock('@/lib/governance-sync', () => ({ broadcastGovernanceSync: async () => {} }))

const TEAMS_FILE = path.join(FAKE_STATE, 'teams', 'teams.json')
const REGISTRY_FILE = path.join(FAKE_STATE, 'agents', 'registry.json')

const ALPHA = 'team-alpha-id'
const BETA = 'team-beta-id'
const COS_ALPHA = 'agent-cos-alpha'
const MEMBER_ALPHA = 'agent-member-alpha'
const MEMBER_BETA = 'agent-member-beta'
/** In NO team's agentIds — but its registry row claims one. That is the R8.4 probe. */
const PRETENDER = 'agent-pretender'

function seedTeams() {
  mkdirSync(path.dirname(TEAMS_FILE), { recursive: true })
  writeFileSync(
    TEAMS_FILE,
    JSON.stringify({
      version: 1,
      teams: [
        {
          id: ALPHA, name: 'Alpha Team', description: '', type: 'closed',
          agentIds: [COS_ALPHA, MEMBER_ALPHA], chiefOfStaffId: COS_ALPHA,
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: BETA, name: 'Beta Team', description: '', type: 'closed',
          agentIds: [MEMBER_BETA], chiefOfStaffId: MEMBER_BETA,
          createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    }),
    'utf-8',
  )
  // The R8.4 probe: PRETENDER's registry row carries `team: 'Alpha Team'` as free text,
  // while Alpha's agentIds do NOT contain it. If membership ever fell back to this field,
  // the COS-of-Alpha assertions below would flip from denied to allowed.
  mkdirSync(path.dirname(REGISTRY_FILE), { recursive: true })
  writeFileSync(
    REGISTRY_FILE,
    JSON.stringify([
      { id: PRETENDER, name: 'pretender', team: 'Alpha Team', status: 'offline', sessions: [] },
      { id: MEMBER_ALPHA, name: 'member-alpha', status: 'offline', sessions: [] },
    ]),
    'utf-8',
  )
}

/** No module state carried between cases — `loadTeams` is read-through, but be explicit. */
async function freshAuthorize() {
  vi.resetModules()
  const { authorize } = await import('@/lib/authorization')
  return authorize
}

const cosOfAlpha = { agentId: COS_ALPHA, governanceTitle: 'chief-of-staff' as const, teamId: null }

beforeEach(() => {
  seedTeams()
})

describe("R26.3 — a COS may change titles only inside its OWN team", () => {
  it('allows a COS to change the title of an agent in its own team', async () => {
    // POSITIVE CONTROL FIRST: without it, every refusal below is also satisfied by a
    // guard that denies everything — a broken lookup, an unseeded fixture, a bad mock.
    const authorize = await freshAuthorize()
    expect(authorize(cosOfAlpha, 'change-title', MEMBER_ALPHA)).toMatchObject({ allowed: true })
  })

  it("refuses a COS changing the title of ANOTHER team's agent", async () => {
    const authorize = await freshAuthorize()
    const r = authorize(cosOfAlpha, 'change-title', MEMBER_BETA)
    expect(r.allowed).toBe(false)
    // The REASON matters: `allowed:false` alone is also produced by the self-assignment
    // branch and by the catch-all deny, so asserting only the boolean would pass even if
    // the team comparison were deleted and the request fell through to a later refusal.
    expect(r.reason).toMatch(/own team/i)
  })

  it('refuses a COS changing its OWN title, even inside its own team', async () => {
    // The self-branch fires BEFORE the team comparison, so this is a different guard and
    // needs its own case — "COS + own team" would otherwise be allowed.
    const authorize = await freshAuthorize()
    const r = authorize(cosOfAlpha, 'change-title', COS_ALPHA)
    expect(r.allowed).toBe(false)
    expect(r.reason).toMatch(/own governance title/i)
  })
})

describe('R10.3 — a COS may wake or hibernate only its OWN team’s agents', () => {
  it('allows wake and hibernate inside its own team', async () => {
    const authorize = await freshAuthorize()
    expect(authorize(cosOfAlpha, 'wake-agent', MEMBER_ALPHA)).toMatchObject({ allowed: true })
    expect(authorize(cosOfAlpha, 'hibernate-agent', MEMBER_ALPHA)).toMatchObject({ allowed: true })
  })

  it("refuses wake and hibernate on ANOTHER team's agent", async () => {
    const authorize = await freshAuthorize()
    for (const action of ['wake-agent', 'hibernate-agent'] as const) {
      const r = authorize(cosOfAlpha, action, MEMBER_BETA)
      expect(r.allowed, `${action} across teams must be refused`).toBe(false)
      expect(r.reason).toMatch(/own team/i)
    }
  })

  it('refuses a COS that names no target at all', async () => {
    // Without a target there is no team to compare against, so a guard that defaulted to
    // "allow" here would hand a COS fleet-wide lifecycle control.
    const authorize = await freshAuthorize()
    expect(authorize(cosOfAlpha, 'wake-agent')).toMatchObject({ allowed: false })
  })
})

describe('R8.4 — membership comes from Team.agentIds[], never the free-text Agent.team', () => {
  it("refuses a COS acting on an agent whose registry row merely CLAIMS its team", async () => {
    // PRETENDER's registry entry says `team: 'Alpha Team'`; Alpha's agentIds do not list
    // it. `lookupTeamIdForAgent` consults ONLY teams.json, so the claim buys nothing —
    // which is exactly what "display-only" means. Add a fallback to `agent.team` and this
    // flips to allowed.
    const authorize = await freshAuthorize()
    for (const action of ['change-title', 'wake-agent', 'hibernate-agent'] as const) {
      const r = authorize(cosOfAlpha, action, PRETENDER)
      expect(r.allowed, `${action} on a self-declared member must be refused`).toBe(false)
    }
  })

  it('POSITIVE CONTROL — the same COS, same actions, on a REAL member, is allowed', async () => {
    // MEMBER_ALPHA differs from PRETENDER in exactly one respect: it appears in Alpha's
    // agentIds. That single difference is what the refusals above must hinge on.
    const authorize = await freshAuthorize()
    for (const action of ['change-title', 'wake-agent', 'hibernate-agent'] as const) {
      expect(authorize(cosOfAlpha, action, MEMBER_ALPHA), action).toMatchObject({ allowed: true })
    }
  })
})

describe('0-IMPACT containment holds', () => {
  it('the teams file the guard read is the sandboxed one', async () => {
    const { getStateDir } = await import('@/lib/ecosystem-constants')
    expect(getStateDir()).toBe(FAKE_STATE)
    expect(existsSync(TEAMS_FILE)).toBe(true)
    expect(
      TEAMS_FILE.startsWith('/private/') || TEAMS_FILE.startsWith('/tmp') || TEAMS_FILE.startsWith('/var'),
    ).toBe(true)
  })
})
