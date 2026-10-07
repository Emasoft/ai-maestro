/**
 * TRDD-91TLL7DW — behavioural pins for the three handlers that took the agent to act on from the
 * request and never tied it to the authenticated caller. Each section drives the REAL handler
 * (Next route or `createHeadlessRouter().handle()`), the real `authorize()` and the real
 * `buildAuthContext()`; only the identity seam (which credential means which agent) and the
 * service we assert was NOT reached are replaced.
 *
 *   1. GET  /api/agents/[id]/chat            (Next + headless) — returned ANY agent's transcript
 *   2. GET  /api/agents/[id]/panel/feedback  (Next)            — DRAINED any agent's feedback queue
 *   3. POST/DELETE /api/agents/:id/repos     (headless only)   — rewrote any agent's repo list
 *
 * Every refusal below returned 200 / performed the effect against the old handlers; each section
 * pairs it with a positive control (the agent acting on ITSELF succeeds) so a refusal cannot be a
 * handler that simply fails for everyone. All ids and credentials are obviously fake.
 *
 * HOME is redirected to a temp dir BEFORE any module loads: the chat service reads
 * `~/.claude/projects/<slug>/*.jsonl`, and the positive control needs a real file there.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'http'
import fs from 'fs'
import path from 'path'

const TEMP_HOME = vi.hoisted(() => {
  const dir = `/tmp/aim-91TLL7DW-home-${process.pid}`
  process.env.HOME = dir
  return dir
})

const m = vi.hoisted(() => ({
  /** which credential means which agent: the test sets this, every auth entry point reads it */
  who: { v: {} as Record<string, unknown> },
  updateRepos: vi.fn() as import('vitest').Mock<(...a: any[]) => any>,
  removeRepo: vi.fn() as import('vitest').Mock<(...a: any[]) => any>,
}))

vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return {
    ...actual,
    authenticateAgent: () => m.who.v,
    authenticateFromRequest: () => m.who.v,
    authenticateFromRequestAsync: async () => ({}),
  }
})
// The registry answers only for TARGET and MEMBER; nothing else in the suite is registered.
vi.mock('@/lib/agent-registry', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-registry')>()
  const rows: Record<string, unknown> = {
    '33333333-3333-4333-8333-333333333333': { id: '33333333-3333-4333-8333-333333333333', name: 'target-fake', workingDirectory: '/tmp/aim-fake-work/target' },
    '22222222-2222-4222-8222-222222222222': { id: '22222222-2222-4222-8222-222222222222', name: 'member-fake', workingDirectory: '/tmp/aim-fake-work/member' },
  }
  return { ...actual, getAgent: (id: string) => rows[id] ?? null }
})
vi.mock('@/services/agents-repos-service', async (orig) => {
  const actual = await orig<typeof import('@/services/agents-repos-service')>()
  return {
    ...actual,
    updateRepos: (...a: unknown[]) => m.updateRepos(...a),
    removeRepo: (...a: unknown[]) => m.removeRepo(...a),
  }
})

const MEMBER = '22222222-2222-4222-8222-222222222222'
const TARGET = '33333333-3333-4333-8333-333333333333'
const MANAGER = '11111111-1111-4111-8111-111111111111'
const AS_MEMBER = { agentId: MEMBER, governanceTitle: 'member', teamId: null }
const AS_MANAGER = { agentId: MANAGER, governanceTitle: 'manager', teamId: null }
const AS_OWNER = {} // a web session: no agentId

const MESSAGE_TEXT = 'fake-transcript-line-for-91TLL7DW'

beforeAll(async () => {
  // A real conversation file for MEMBER and TARGET under the redirected HOME, at the slug the service derives.
  const { conversationSlug } = await import('@/lib/claude-conversation')
  for (const dir of ['/tmp/aim-fake-work/target', '/tmp/aim-fake-work/member']) {
    const convDir = path.join(TEMP_HOME, '.claude', 'projects', conversationSlug(dir))
    fs.mkdirSync(convDir, { recursive: true })
    fs.writeFileSync(
      path.join(convDir, 'c1.jsonl'),
      JSON.stringify({ type: 'user', uuid: 'u1', timestamp: '2026-01-01T00:00:00Z', message: { role: 'user', content: MESSAGE_TEXT } }) + '\n',
    )
  }
})
afterAll(() => {
  fs.rmSync(TEMP_HOME, { recursive: true, force: true })
})
beforeEach(() => {
  m.who.v = AS_MEMBER
  m.updateRepos.mockReset().mockReturnValue({ data: { success: true }, status: 200 })
  m.removeRepo.mockReset().mockReturnValue({ data: { success: true }, status: 200 })
})

// ── headless driver (pattern of tests/unit/headless-agent-mutations-authorization.test.ts) ──
function drive(method: string, url: string, body?: unknown) {
  const chunks = body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    url, method,
    headers: { authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA', 'content-type': 'application/json' },
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
  return { req, res, out }
}
async function headless(method: string, url: string, body?: unknown) {
  const { createHeadlessRouter } = await import('@/services/headless-router')
  const d = drive(method, url, body)
  await createHeadlessRouter().handle(d.req, d.res)
  return { status: d.out.status, json: JSON.parse(d.out.body ? d.out.body.toString() : 'null') }
}

describe('GET /api/agents/[id]/chat — a transcript is readable by its agent or the owner only', () => {
  async function nextChat(id: string) {
    const { GET } = await import('@/app/api/agents/[id]/chat/route')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest(new URL(`http://localhost:23000/api/agents/${id}/chat`), { method: 'GET' } as never)
    const res = await GET(req, { params: { id } as never })
    return { status: res.status, json: await res.json() }
  }

  it('Next: agent A asking for agent B\'s conversation is refused 403 and no transcript is returned', async () => {
    /** Returned 200 with B's whole conversation: this GET called no auth helper at all */
    m.who.v = AS_MEMBER
    const out = await nextChat(TARGET)
    expect(out.status).toBe(403)
    expect(String(out.json.error)).toMatch(/only read your own conversation/)
    expect(JSON.stringify(out.json)).not.toContain(MESSAGE_TEXT)
  })

  it('Next: even a MANAGER may not read another agent\'s conversation (same rule as /api/conversations/parse)', async () => {
    /** Title confers no right to a transcript; parseConversationFile is self-or-owner for every agent */
    m.who.v = AS_MANAGER
    const out = await nextChat(TARGET)
    expect(out.status).toBe(403)
    expect(JSON.stringify(out.json)).not.toContain(MESSAGE_TEXT)
  })

  it('Next: an agent reading its OWN conversation succeeds and gets the real transcript (positive control)', async () => {
    /** Proves the 403s above are the binding and not a handler that fails for everyone */
    m.who.v = AS_MEMBER
    const out = await nextChat(MEMBER)
    expect(out.status).toBe(200)
    expect(JSON.stringify(out.json)).toContain(MESSAGE_TEXT)
  })

  it('Next: the owner (web session, no agentId) may read any agent\'s conversation', async () => {
    /** The dashboard's ChatView is this caller */
    m.who.v = AS_OWNER
    const out = await nextChat(TARGET)
    expect(out.status).toBe(200)
    expect(JSON.stringify(out.json)).toContain(MESSAGE_TEXT)
  })

  it('Next: an unauthenticated credential is refused 401 before anything is read', async () => {
    /** The route used to rely on middleware.ts, which checks only the credential's SHAPE */
    m.who.v = { error: 'Invalid or expired governance token', status: 401 }
    const out = await nextChat(TARGET)
    expect(out.status).toBe(401)
    expect(JSON.stringify(out.json)).not.toContain(MESSAGE_TEXT)
  })

  it('headless: agent A asking for agent B\'s conversation is refused 403 and no transcript is returned', async () => {
    /** The headless twin called the service with no caller at all */
    m.who.v = AS_MEMBER
    const out = await headless('GET', `/api/agents/${TARGET}/chat`)
    expect(out.status).toBe(403)
    expect(JSON.stringify(out.json)).not.toContain(MESSAGE_TEXT)
  })

  it('headless: an agent reading its OWN conversation succeeds (positive control)', async () => {
    /** Non-vacuity for the headless refusal above */
    m.who.v = AS_MEMBER
    const out = await headless('GET', `/api/agents/${MEMBER}/chat`)
    expect(out.status).toBe(200)
    expect(JSON.stringify(out.json)).toContain(MESSAGE_TEXT)
  })
})

describe('GET /api/agents/[id]/panel/feedback — the drain deletes, so only the agent itself or the owner may drain', () => {
  async function drain(id: string) {
    const { GET } = await import('@/app/api/agents/[id]/panel/feedback/route')
    const { NextRequest } = await import('next/server')
    const req = new NextRequest(new URL(`http://localhost:23000/api/agents/${id}/panel/feedback`), { method: 'GET' } as never)
    const res = await GET(req, { params: Promise.resolve({ id }) })
    return { status: res.status, json: await res.json() }
  }
  async function seed(id: string) {
    const { pushPanelFeedback, panelFeedback } = await import('@/services/shared-state')
    panelFeedback.delete(id)
    pushPanelFeedback(id, { click: 'fake-button' })
    return panelFeedback
  }

  it('agent A draining agent B\'s queue is refused 403 and B\'s event is still queued', async () => {
    /** Authenticated-only: A emptied B's queue (and read its events) */
    const queues = await seed(TARGET)
    m.who.v = AS_MEMBER
    const out = await drain(TARGET)
    expect(out.status).toBe(403)
    expect(out.json.events).toBeUndefined()
    expect(queues.get(TARGET)?.length).toBe(1) // no side effect
  })

  it('a MANAGER draining another agent\'s queue is refused 403 (R42: the same capability as pushing the panel)', async () => {
    /** POST /panel is send-command, self-only for every title; its replies are the same surface */
    const queues = await seed(TARGET)
    m.who.v = AS_MANAGER
    const out = await drain(TARGET)
    expect(out.status).toBe(403)
    expect(queues.get(TARGET)?.length).toBe(1)
  })

  it('an agent draining its OWN queue gets its events and the queue is emptied (positive control)', async () => {
    /** The polling plugin is this caller */
    const queues = await seed(MEMBER)
    m.who.v = AS_MEMBER
    const out = await drain(MEMBER)
    expect(out.status).toBe(200)
    expect(out.json.count).toBe(1)
    expect(queues.has(MEMBER)).toBe(false)
  })

  it('the owner may drain any agent\'s queue', async () => {
    /** Owner has no agentId; authorize() grants the system owner */
    await seed(TARGET)
    m.who.v = AS_OWNER
    const out = await drain(TARGET)
    expect(out.status).toBe(200)
    expect(out.json.count).toBe(1)
  })
})

describe('POST/DELETE /api/agents/:id/repos (headless) — only the agent itself or the owner may change its repos', () => {
  const POST_BODY = { repositories: [{ remoteUrl: 'https://example.invalid/fake.git' }] }

  it('POST: agent A rewriting agent B\'s repo list is refused 403 and the service is never called', async () => {
    /** The handler called updateRepos(params.id, body) with no caller check */
    m.who.v = AS_MEMBER
    const out = await headless('POST', `/api/agents/${TARGET}/repos`, POST_BODY)
    expect(out.status).toBe(403)
    expect(String(out.json.error)).toMatch(/only change your own repos/)
    expect(m.updateRepos).not.toHaveBeenCalled()
  })

  it('DELETE: agent A removing a repo from agent B is refused 403 and the service is never called', async () => {
    /** Same gap on the DELETE twin */
    m.who.v = AS_MEMBER
    const out = await headless('DELETE', `/api/agents/${TARGET}/repos?url=${encodeURIComponent('https://example.invalid/fake.git')}`)
    expect(out.status).toBe(403)
    expect(m.removeRepo).not.toHaveBeenCalled()
  })

  it('POST and DELETE: an agent changing its OWN repos succeeds and reaches the service (positive control)', async () => {
    /** Proves the refusals are the binding, not a broken handler */
    m.who.v = AS_MEMBER
    const post = await headless('POST', `/api/agents/${MEMBER}/repos`, POST_BODY)
    expect(post.status).toBe(200)
    expect(m.updateRepos).toHaveBeenCalledWith(MEMBER, POST_BODY)
    const del = await headless('DELETE', `/api/agents/${MEMBER}/repos?url=x`)
    expect(del.status).toBe(200)
    expect(m.removeRepo).toHaveBeenCalledWith(MEMBER, 'x')
  })

  it('POST: the owner may change any agent\'s repos', async () => {
    /** Owner = a web session with no agentId */
    m.who.v = AS_OWNER
    const out = await headless('POST', `/api/agents/${TARGET}/repos`, POST_BODY)
    expect(out.status).toBe(200)
    expect(m.updateRepos).toHaveBeenCalledWith(TARGET, POST_BODY)
  })

  it('POST: an invalid credential is refused 401 and the service is never called', async () => {
    /** The handler used to run with only the router-wide gate behind it */
    m.who.v = { error: 'Invalid or expired governance token', status: 401 }
    const out = await headless('POST', `/api/agents/${TARGET}/repos`, POST_BODY)
    expect(out.status).toBe(401)
    expect(m.updateRepos).not.toHaveBeenCalled()
  })
})
