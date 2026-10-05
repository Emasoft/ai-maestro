import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import type { IncomingMessage, ServerResponse } from 'http'
import { conversationSlug } from '@/lib/claude-conversation'

/**
 * TRDD-QSB64KKQ box 5 — POST /api/conversations/parse through the HEADLESS router with an AGENT credential.
 *
 * services/headless-router.ts serves this path by delegating to the same Next handler as full mode
 * (`delegateNextRoute`, which forwards the auth headers and the body). Requests enter through the real
 * createHeadlessRouter().handle(); the REAL route and the REAL parseConversationFile run. Only the identity
 * seam (authenticateFromRequest / authenticateFromRequestAsync, one shared mock) and the registry lookup
 * (getAgent) are replaced; HOME is redirected to a temp dir so the real ~/.claude and ~/.aimaestro are untouched.
 *
 * NEUTER: in services/config-service.ts disable the own-slug guard (`if (!ownSlug || requestedSlug !== ownSlug)`
 * -> `if (false && ...)`) -> the cross-agent case goes red by name.
 */
const home = vi.hoisted(() => {
  const fs = require('node:fs'), os = require('node:os'), p = require('node:path')
  const dir = fs.realpathSync(fs.mkdtempSync(p.join(os.tmpdir(), 'qsb-hlparse-'))) as string
  const prev = process.env.HOME
  process.env.HOME = dir
  return { dir, prev }
})

const m = vi.hoisted(() => ({ identity: vi.fn() as import('vitest').Mock<(...a: any[]) => any> }))
vi.mock('@/lib/agent-registry', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-registry')>()
  return { ...actual, getAgent: (id: string) => mockGetAgent(id) }
})
vi.mock('../../lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('../../lib/agent-auth')>()
  return {
    ...actual,
    authenticateFromRequest: (...a: unknown[]) => m.identity(...a),
    authenticateFromRequestAsync: async (...a: unknown[]) => m.identity(...a),
  }
})
const mockGetAgent = vi.fn()

const AGENT_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const AGENT_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const WD_A = '/Users/host/agents/alice'
const WD_B = '/Users/host/agents/bob'
const MARKER = 'SECRET-OF-BOB-MARKER'
const DENIED = 'Access denied — an agent may read only its own conversation transcript'

const transcriptFile = (wd: string) =>
  path.join(home.dir, '.claude', 'projects', conversationSlug(wd), 'session.jsonl')

async function parse(conversationFile: string, headers: Record<string, string> = { authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA' }) {
  const chunks = [Buffer.from(JSON.stringify({ conversationFile }))]
  const req = {
    url: '/api/conversations/parse', method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
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
  const text = out.body ? out.body.toString() : 'null'
  return { status: out.status, text, json: JSON.parse(text) }
}

beforeAll(() => {
  expect(os.homedir()).toBe(home.dir) // containment: every path below is under the temp HOME
  for (const [wd, text] of [[WD_A, 'hello from alice'], [WD_B, MARKER]] as const) {
    fs.mkdirSync(path.dirname(transcriptFile(wd)), { recursive: true })
    fs.writeFileSync(
      transcriptFile(wd),
      JSON.stringify({ type: 'user', message: { content: text }, sessionId: 's', timestamp: '2026-01-01T00:00:00Z' }) + '\n',
    )
  }
})
afterAll(() => {
  if (home.prev === undefined) delete process.env.HOME
  else process.env.HOME = home.prev
  fs.rmSync(home.dir, { recursive: true, force: true })
})
beforeEach(() => {
  m.identity.mockReset()
  mockGetAgent.mockReset()
  mockGetAgent.mockImplementation((id: string) =>
    id === AGENT_A ? { id: AGENT_A, workingDirectory: WD_A }
      : id === AGENT_B ? { id: AGENT_B, workingDirectory: WD_B } : null)
})

describe('TRDD-QSB64KKQ — headless conversations/parse with an agent credential', () => {
  it('agent A naming agent B\'s transcript through the headless router gets 403 and no transcript content', async () => {
    /** Validates headless parity: the delegated handler refuses a foreign transcript exactly as full mode does */
    m.identity.mockReturnValue({ agentId: AGENT_A })
    const out = await parse(transcriptFile(WD_B))

    expect(out.status).toBe(403)
    expect(out.json).toEqual({ success: false, error: DENIED })
    expect(out.text).not.toContain(MARKER)
  })

  it('POSITIVE CONTROL — agent A reading its OWN transcript through the headless router gets 200', async () => {
    /** Validates the refusal above is by owner: the body and the agent identity both survive the delegation */
    m.identity.mockReturnValue({ agentId: AGENT_A })
    const out = await parse(transcriptFile(WD_A))

    expect(out.status).toBe(200)
    expect(out.json.success).toBe(true)
    expect(out.json.messages).toHaveLength(1)
  })

  it('a request with NO credential is refused 401 auth_required before any transcript is read', async () => {
    /** Validates the unauthenticated case at the router's structural gate */
    const out = await parse(transcriptFile(WD_B), {})

    expect(out.status).toBe(401)
    expect(out.json.error).toBe('auth_required')
    expect(out.text).not.toContain(MARKER)
  })

  it('a credential-shaped but INVALID token is refused 401 invalid_credential and reads no transcript', async () => {
    /** Validates the unauthenticated case at the router's semantic gate */
    m.identity.mockReturnValue({ error: 'Invalid or expired token', status: 401 })
    const out = await parse(transcriptFile(WD_B))

    expect(out.status).toBe(401)
    expect(out.json.error).toBe('invalid_credential')
    expect(out.text).not.toContain(MARKER)
  })
})
