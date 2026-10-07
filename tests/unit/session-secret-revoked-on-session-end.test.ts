/**
 * TRDD-EC9DB4GM — an agent's session secret (the mst_ value behind AID_AUTH) has no expiry of its
 * own: its whole lifetime is "the hash is stored in the registry". Only hibernate used to clear it,
 * so a session ended any other way left a credential that still authenticated after its pane died.
 *
 * Every test drives the REAL registry, session-secret, agent-auth and TmuxRuntime against a temp
 * state root (0-IMPACT: ecosystem-constants + os.homedir redirected, child_process replaced by a
 * recorder with a set of "live" tmux sessions). The proof each time is the same two steps:
 *   1. positive control — the secret issued before the stop authenticates (so the harness really
 *      reads the registry the code under test writes), and
 *   2. after the session-ending operation, the SAME secret is refused.
 *
 * The distinct helpers that end a session: TmuxRuntime.killSession (what DeleteAgent, deleteSession,
 * refused launches and orphan reconcile all call), hibernateAgent, registry deleteAgent (soft) and
 * removeSessionFromAgent, team freeze (blockAllTeams), the /kill route, and fleet hard recovery.
 * The last test pins that no NEW tmux-kill call site appears without being classified here.
 */
import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, rmSync, readdirSync, statSync } from 'fs'
import { join } from 'path'

const H = vi.hoisted(() => {
  const { mkdtempSync } = require('fs') as typeof import('fs')
  const { join: j } = require('path') as typeof import('path')
  const root = (process.env.TMPDIR || '/tmp').replace(/\/$/, '')
  const FAKE_HOME = mkdtempSync(j(root, 'aim-secret-revoke-'))
  return { FAKE_HOME, FAKE_STATE: j(FAKE_HOME, '.aimaestro'), alive: new Set<string>() }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, homedir: () => H.FAKE_HOME, default: { ...actual, homedir: () => H.FAKE_HOME } }
})
vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, H.FAKE_HOME, H.FAKE_STATE)
})
// tmux is a recorder: `has-session` / `kill-session` consult H.alive, everything else succeeds.
vi.mock('child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('child_process')>()
  const tmux = (argv: string[]) => {
    const target = argv[argv.indexOf('-t') + 1]
    if (argv[0] === 'kill-session') {
      if (!H.alive.delete(target)) throw new Error(`can't find session: ${target}`)
    } else if (argv[0] === 'has-session') {
      if (!H.alive.has(target)) throw new Error(`can't find session: ${target}`)
    }
  }
  const execFile = (_bin: string, argv: string[], ...rest: unknown[]) => {
    const cb = rest[rest.length - 1] as (e: Error | null, out?: string, err?: string) => void
    try { tmux(argv); cb(null, '', '') } catch (e) { cb(e as Error) }
  }
  const execFileSync = (_bin: string, argv: string[]) => { tmux(argv); return '' }
  return { ...actual, execFile, execFileSync, default: { ...actual, execFile, execFileSync } }
})
vi.mock('@/lib/sudo-guard', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/sudo-guard')>()),
  requireSudoToken: () => null,
}))
vi.mock('@/lib/agent-auth', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/lib/agent-auth')>()),
  authenticateFromRequest: () => ({ isSystemOwner: true }),
}))

import { hostname } from 'os'
import { authenticateAgent } from '@/lib/agent-auth'
import { generateSessionSecret } from '@/lib/session-secret'
import { getRuntime } from '@/lib/agent-runtime'
import { deleteAgent, removeSessionFromAgent, loadAgents } from '@/lib/agent-registry'
import { blockAllTeams } from '@/lib/team-registry'
import { hibernateAgent } from '@/services/agents-core-service'
import { deleteSession } from '@/services/sessions-service'
import { defaultHardRecoveryDeps } from '@/lib/fleet-hard-recovery-runner'
import { POST as killRoute } from '../../app/api/sessions/[id]/kill/route'

const ROOT = join(__dirname, '..', '..')
const SELF_HOST = hostname().toLowerCase().replace(/\.local$/, '')
const OWNER = { isSystemOwner: true } as const

afterAll(() => { rmSync(H.FAKE_HOME, { recursive: true, force: true }) })

interface Seeded { id: string; name: string; secret: string }

/** Write the registry with the given agents, each holding a fresh session secret, each tmux-alive. */
function seed(...names: string[]): Seeded[] {
  const out = names.map((name, i) => {
    const { secret, secretHash } = generateSessionSecret()
    return { id: `agent-${i + 1}`, name, secret, secretHash }
  })
  const rows = out.map(a => ({
    id: a.id,
    name: a.name,
    hostId: SELF_HOST,
    program: 'claude',
    status: 'active',
    workingDirectory: H.FAKE_HOME,
    sessions: [{ index: 0, status: 'online', workingDirectory: H.FAKE_HOME, createdAt: '2026-01-01T00:00:00.000Z' }],
    metadata: { sessionSecretHash: a.secretHash },
    createdAt: '2026-01-01T00:00:00.000Z',
  }))
  mkdirSync(join(H.FAKE_STATE, 'agents'), { recursive: true })
  writeFileSync(join(H.FAKE_STATE, 'agents', 'registry.json'), JSON.stringify(rows, null, 2))
  H.alive.clear()
  for (const a of out) H.alive.add(a.name)
  return out.map(({ id, name, secret }) => ({ id, name, secret }))
}

/** Does the secret still authenticate as `id`? Reads the real registry through the real validator. */
const accepted = (a: Seeded) => authenticateAgent('Bearer ' + a.secret, null).agentId === a.id
const hashOf = (id: string) => loadAgents().find(r => r.id === id)?.metadata?.sessionSecretHash

describe('a session secret dies with the session that held it (TRDD-EC9DB4GM)', () => {
  let a: Seeded
  let b: Seeded
  beforeEach(() => {
    ;[a, b] = seed('alpha', 'beta')
    // Positive control for every test: both secrets authenticate before anything is stopped.
    expect(accepted(a)).toBe(true)
    expect(accepted(b)).toBe(true)
  })

  it('TmuxRuntime.killSession: the killed agent’s secret is refused', async () => {
    /** the shared async kill revokes the secret of the agent the session belongs to */
    await getRuntime().killSession('alpha')
    expect(H.alive.has('alpha')).toBe(false)
    expect(accepted(a)).toBe(false)
  })

  it('TmuxRuntime.killSession: tmux saying "no such session" still revokes, and still rejects', async () => {
    /** a dead pane is the reason to revoke, not a reason to skip; the kill error is not swallowed */
    H.alive.delete('alpha')
    await expect(getRuntime().killSession('alpha')).rejects.toThrow(/can't find session/)
    expect(accepted(a)).toBe(false)
  })

  it('TmuxRuntime.killSession: another agent’s secret survives (no over-revocation)', async () => {
    /** revocation is scoped to the killed session's agent, and a name resolving to no agent is a no-op */
    await getRuntime().killSession('alpha')
    expect(accepted(b)).toBe(true)
    await getRuntime().killSession('no-such-agent').catch(() => {})
    expect(accepted(b)).toBe(true)
  })

  it('hibernateAgent: the hibernated agent’s secret is refused', async () => {
    /** the hibernate path (kill + explicit revoke) ends with the old AID_AUTH invalid */
    const r = await hibernateAgent(a.id, { authContext: OWNER })
    expect(r.error).toBeUndefined()
    expect(r.data?.hibernated).toBe(true)
    expect(accepted(a)).toBe(false)
    expect(accepted(b)).toBe(true)
  })

  it('hibernateAgent: a pane that already died on its own is revoked too', async () => {
    /** the early "session already terminated" return never reaches a kill, so it must revoke itself */
    H.alive.delete('alpha')
    const r = await hibernateAgent(a.id, { authContext: OWNER })
    expect(r.data?.hibernated).toBe(true)
    expect(accepted(a)).toBe(false)
  })

  it('deleteSession service: the deleted session’s secret is refused', async () => {
    /** DELETE /api/sessions/[id] routes through runtime.killSession */
    const r = await deleteSession('alpha', OWNER)
    expect(r.error).toBeUndefined()
    expect(accepted(a)).toBe(false)
    expect(accepted(b)).toBe(true)
  })

  it('registry deleteAgent (soft): the hash is gone from the kept row, so a rolled-back delete does not revalidate it', async () => {
    /** soft delete keeps the row for resurrection; removing deletedAt must NOT bring the dead pane's secret back */
    await deleteAgent(a.id, false)
    expect(hashOf(a.id)).toBeNull()
    const rows = loadAgents()
    delete (rows.find(r => r.id === a.id) as { deletedAt?: string }).deletedAt
    writeFileSync(join(H.FAKE_STATE, 'agents', 'registry.json'), JSON.stringify(rows, null, 2))
    expect(accepted(a)).toBe(false)
    expect(accepted(b)).toBe(true)
  })

  it('registry removeSessionFromAgent: the removed session’s secret is refused', async () => {
    /** the in-lock kill nulls the hash in its own write */
    expect(await removeSessionFromAgent(a.id, 0)).toBe(true)
    expect(accepted(a)).toBe(false)
    expect(accepted(b)).toBe(true)
  })

  it('team freeze (blockAllTeams): the frozen team agent’s secret is refused', async () => {
    /** this path kills tmux directly, not through runtime.killSession, so it revokes by agent id */
    mkdirSync(join(H.FAKE_STATE, 'teams'), { recursive: true })
    writeFileSync(
      join(H.FAKE_STATE, 'teams', 'teams.json'),
      JSON.stringify({ version: 1, teams: [{ id: 'team-1', name: 'team', type: 'closed', agentIds: [a.id], createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z' }] }),
    )
    expect(await blockAllTeams()).toEqual([a.id])
    expect(accepted(a)).toBe(false)
    expect(accepted(b)).toBe(true)
  })

  it('POST /api/sessions/[id]/kill: the killed session’s secret is refused', async () => {
    /** the route uses the sync kill, which does not revoke, so the route must */
    const res = await killRoute({} as never, { params: Promise.resolve({ id: 'alpha' }) })
    expect(res.status).toBe(200)
    expect(H.alive.has('alpha')).toBe(false)
    expect(accepted(a)).toBe(false)
    expect(accepted(b)).toBe(true)
  })

  it('fleet hard recovery killRemnant: the torn-down pane’s secret is refused', async () => {
    /** the remnant teardown uses the sync kill too, so the actuator revokes by agent id */
    const r = await defaultHardRecoveryDeps(true).killRemnant!(a.id)
    expect(r.ok).toBe(true)
    expect(accepted(a)).toBe(false)
    expect(accepted(b)).toBe(true)
  })
})

describe('no tmux-kill call site goes unclassified', () => {
  // Every file that kills a tmux session without going through TmuxRuntime.killSession, and why that is safe.
  // A new entry in the scan below fails this test until it is added here with a revocation story.
  const CLASSIFIED: Record<string, string> = {
    'lib/agent-runtime.ts': 'defines killSession (revokes) and killSessionSync (documented: callers revoke)',
    'lib/agent-registry.ts': 'killAgentSessions / removeSessionFromAgent null the hash in their own locked write',
    'lib/team-registry.ts': 'hibernateTeamAgentSession calls deps.revokeSessionSecret',
    'lib/fleet-hard-recovery-runner.ts': 'killRemnant calls revokeSessionSecret',
    'app/api/sessions/[id]/kill/route.ts': 'awaits revokeSessionSecretForSession after the sync kill',
    'app/api/agents/creation-helper/kill/route.ts': 'the _aim-creation-helper session is minted without AID_AUTH — no secret exists',
    'app/api/agents/creation-helper/cleanup/route.ts': 'same helper session — no secret exists',
    'server.mjs': 'kills the _aim-creation-helper session at boot — no secret exists',
  }

  function sources(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(join(ROOT, dir))) {
      const rel = `${dir}/${name}`
      if (statSync(join(ROOT, rel)).isDirectory()) sources(rel, out)
      else if (/\.(ts|tsx|mjs)$/.test(name)) out.push(rel)
    }
    return out
  }

  it('the files that kill a tmux session directly are exactly the classified set', () => {
    /** a new killSessionSync / kill-session site must be classified (and revoke) before this passes */
    const files = [...sources('lib'), ...sources('services'), ...sources('app'), 'server.mjs']
    // Pattern assembled from parts so this file never matches itself.
    const needle = new RegExp(['killSession' + 'Sync\\(', "'kill-" + "session'"].join('|'))
    const found = files.filter(f => needle.test(readFileSync(join(ROOT, f), 'utf-8'))).sort()
    expect(found).toEqual(Object.keys(CLASSIFIED).sort())
  })

  it('every classified file that revokes by calling the helper still does', () => {
    /** the classification above is only true while those call sites keep the call */
    for (const f of ['lib/team-registry.ts', 'lib/fleet-hard-recovery-runner.ts', 'app/api/sessions/[id]/kill/route.ts']) {
      expect(readFileSync(join(ROOT, f), 'utf-8'), f).toMatch(/revokeSessionSecret/)
    }
    expect(readFileSync(join(ROOT, 'lib/agent-registry.ts'), 'utf-8').match(/sessionSecretHash = null/g)?.length).toBe(2)
  })
})
