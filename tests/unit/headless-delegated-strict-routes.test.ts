import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * TRDD-BZW1QAZ5 — DELETE /api/agents/cemetery (permanent purge) in headless is served by the SAME Next.js handler as
 * full mode (delegateNextRoute via DELEGATED_STRICT_ROUTES), so the sudo gate applies. Requests go through the real
 * createHeadlessRouter().handle(); only the identity seam (authenticateAgent and the sync request wrapper over it) is
 * replaced, and the state dir is redirected to a temp dir. Every refusal asserts the archive is still on disk.
 */
const m = vi.hoisted(() => ({ authenticateAgent: vi.fn() as import('vitest').Mock<(...a: any[]) => any>, modelOn: vi.fn(() => false) }))
const tmp = vi.hoisted(() => {
  const fs = require('node:fs'); const os = require('node:os'); const p = require('node:path')
  return { dir: fs.realpathSync(fs.mkdtempSync(p.join(os.tmpdir(), 'bzw-delegated-'))) as string }
})


describe('TRDD-BZW1QAZ5 — the delegated purge can still say yes', () => {
  it('POSITIVE CONTROL — the owner WITH an accepted sudo token purges the archive and the twin answers JSON', async () => {
    /** The refusals are decisions, not a dead route */
    m.authenticateAgent.mockReturnValue({})
    const out = await purge({ 'x-sudo-token': 'good-token' })
    expect(out.status).toBe(200)
    expect(out.json).toMatchObject({ success: true, purged: FILE })
    expect(await archiveExists()).toBe(false)
  })
})


// Positive-control seams: a token the guard accepts, and an empty registry (the purge cascade lists agents; never read the real one).
vi.mock('../../lib/sudo-auth', async (orig) => {
  const actual = await orig<typeof import('../../lib/sudo-auth')>()
  return { ...actual, verifyAndConsumeSudoToken: (t: string | null, ...r: never[]) => t === 'good-token' ? { ok: true } : (actual.verifyAndConsumeSudoToken as (...a: unknown[]) => unknown)(t, ...r) }
})
vi.mock('../../lib/agent-registry', async (orig) => ({ ...(await orig<object>()), listAgents: () => [] }))

vi.mock('../../lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('../../lib/agent-auth')>()
  return {
    ...actual,
    authenticateAgent: (...a: unknown[]) => m.authenticateAgent(...a),
    // the twin and lib/sudo-guard authenticate through this; the actual one calls the module-internal function
    authenticateFromRequest: (r: { headers: { get(n: string): string | null } }) =>
      m.authenticateAgent(r.headers.get('Authorization'), r.headers.get('X-Agent-Id'), r.headers.get('Cookie')),
    // the router's semantic credential gate runs before the handler; let it through so the TWIN answers
    // lib/sudo-guard calls buildAuthContext, which reads the user-authority flag through a runtime require('./governance')
    // that cannot see this file's governance mock (the flag silently reads OFF). Apply the model-ON owner rule here as
    // lib/agent-auth.ts defines it: owner = no agentId AND userTitle in {maestro, maestro-delegate}.
    buildAuthContext: (a: { agentId?: string; userTitle?: string; error?: string }) => {
      const c = actual.buildAuthContext(a as never)
      return m.modelOn() && !a.error
        ? { ...c, isSystemOwner: !a.agentId && (a.userTitle === 'maestro' || a.userTitle === 'maestro-delegate') }
        : c
    },
    authenticateFromRequestAsync: vi.fn(async () => ({ agentId: undefined, error: undefined })),
  }
})
vi.mock('../../lib/governance', async (orig) => ({ ...(await orig<object>()), isUserAuthorityModelEnabled: () => m.modelOn() }))
vi.mock('../../lib/ecosystem-constants', async (orig) => {
  const actual = await orig<typeof import('../../lib/ecosystem-constants')>()
  const { join } = await import('node:path')
  return { ...actual, statePath: (...p: string[]) => join(tmp.dir, ...p) }
})

const FILE = 'ghost-export-2026-01-01T00-00-00.zip'
const archive = () => tmp.dir + '/cemetery/' + FILE
const OWNER = {}
const MEMBER = { agentId: '22222222-2222-4222-8222-222222222222', governanceTitle: 'member' }
const MANAGER = { agentId: '11111111-1111-4111-8111-111111111111', governanceTitle: 'manager' }
const PLAIN_USER = { userId: 'user-plain', userTitle: 'user' }

async function purge(headers: Record<string, string> = {}) {
  const chunks = [Buffer.from(JSON.stringify({ filename: FILE }))]
  const req = {
    url: '/api/agents/cemetery', method: 'DELETE',
    headers: { authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA', 'content-type': 'application/json', ...headers },
    [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c },
    on(event: string, cb: (...a: unknown[]) => void) {
      if (event === 'data') chunks.forEach((c) => cb(c))
      if (event === 'end') cb()
      return this
    },
  } as unknown as IncomingMessage
  const out: { status?: number; body?: string | Buffer } = {}
  const res = {
    writeHead(s: number) { out.status = s; return this }, setHeader() { return this },
    end(p?: string | Buffer) { out.body = p }, headersSent: false,
  } as unknown as ServerResponse
  const { createHeadlessRouter } = await import('../../services/headless-router')
  await createHeadlessRouter().handle(req, res)
  return { status: out.status, json: JSON.parse(out.body ? out.body.toString() : 'null') }
}
const archiveExists = async () => (await import('node:fs')).existsSync(archive())

beforeEach(async () => {
  m.authenticateAgent.mockReset()
  m.modelOn.mockReset(); m.modelOn.mockReturnValue(false)
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(tmp.dir + '/cemetery', { recursive: true })
  writeFileSync(archive(), 'ZIPBYTES-MARKER')
})

describe('TRDD-BZW1QAZ5 — headless purge goes through the twin (sudo layer + owner-only)', () => {
  it('the system owner WITHOUT a sudo token is refused 403 sudo_required (missing) and the archive survives', async () => {
    /** The gate the hand-rolled headless handler lacked */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await purge()
    expect(out.status).toBe(403)
    expect(out.json).toMatchObject({ error: 'sudo_required', reason: 'missing', route: 'DELETE /api/agents/cemetery' })
    expect(await archiveExists()).toBe(true)
  })
  it('the system owner with a bogus sudo token is refused 403 sudo_required and the archive survives', async () => {
    /** A token that was never minted is not a token */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await purge({ 'x-sudo-token': 'not-a-minted-token' })
    expect(out.status).toBe(403)
    expect(out.json.error).toBe('sudo_required')
    expect(await archiveExists()).toBe(true)
  })
  it('a MEMBER agent is refused 403 by the title gate and the archive survives', async () => {
    /** No agent path: agents never face sudo, and a member lacks delete-agent */
    m.authenticateAgent.mockReturnValue(MEMBER)
    const out = await purge()
    expect(out.status).toBe(403)
    expect(out.json.error).toBe('aid_title_forbidden')
    expect(await archiveExists()).toBe(true)
  })
  it('a MANAGER agent passes the title gate but is refused 403 by the twin owner-only check, archive survives', async () => {
    /** Full mode has no agent path for purge: route line `if (auth.agentId)` */
    m.authenticateAgent.mockReturnValue(MANAGER)
    const out = await purge()
    expect(out.status).toBe(403)
    expect(out.json.error).toBe('Only the system owner can purge cemetery archives')
    expect(await archiveExists()).toBe(true)
  })
  it('an unauthenticated caller gets the twin 401 and the archive survives', async () => {
    /** The twin authenticates before reading any sudo token */
    m.authenticateAgent.mockReturnValue({ error: 'Invalid token', status: 401 })
    const out = await purge()
    expect(out.status).toBe(401)
    expect(out.json.error).toBe('Invalid token')
    expect(await archiveExists()).toBe(true)
  })
  it('model ON: a signed-in NON-owner user with a VALID sudo token is refused 403 by the title gate and the archive survives', async () => {
    /** Refused by lib/sudo-guard -> authorize (userId + title not maestro), not by the missing token: the token is accepted */
    m.modelOn.mockReturnValue(true)
    m.authenticateAgent.mockReturnValue(PLAIN_USER)
    const out = await purge({ 'x-sudo-token': 'good-token' })
    expect(out.status).toBe(403)
    expect(out.json).toMatchObject({ error: 'aid_title_forbidden', message: 'User "user" is not authorized to delete-agent via the AI Maestro API', route: 'DELETE /api/agents/cemetery' })
    expect(await archiveExists()).toBe(true)
  })
})
