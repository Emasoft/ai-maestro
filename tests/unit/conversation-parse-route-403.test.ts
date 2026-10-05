import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { conversationSlug } from '@/lib/claude-conversation'

/**
 * TRDD-QSB64KKQ box 4 — the JOIN between the route and the service.
 *
 * conversation-parse-ownership.test.ts pins the service refusal (real parseConversationFile) and
 * the route's forwarding (mocked parseConversationFile) separately; nothing asserted that the
 * route turns the service's `status: 403` into an HTTP 403. Here the REAL route handler calls the
 * REAL parseConversationFile. Mocked: only the credential seam (authenticateFromRequest) and the
 * registry lookup (getAgent). HOME is redirected to a temp dir so the real ~/.claude and
 * ~/.aimaestro are never touched.
 *
 * NEUTER: in app/api/conversations/parse/route.ts make the error branch answer 200 regardless of
 * `result.status` -> the refusal test goes red by name.
 */
const home = vi.hoisted(() => {
  const fs = require('node:fs'), os = require('node:os'), p = require('node:path')
  const dir = fs.realpathSync(fs.mkdtempSync(p.join(os.tmpdir(), 'qsb-parse403-'))) as string
  const prev = process.env.HOME
  process.env.HOME = dir
  return { dir, prev }
})

const mockGetAgent = vi.fn()
vi.mock('@/lib/agent-registry', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-registry')>()
  return { ...actual, getAgent: (...a: unknown[]) => mockGetAgent(...a) }
})
const mockAuthenticate = vi.fn()
vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

const AGENT_A = 'aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa'
const AGENT_B = 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb'
const WD_A = '/Users/host/agents/alice'
const WD_B = '/Users/host/agents/bob'
const MARKER = 'SECRET-OF-BOB-MARKER'

const transcriptFile = (wd: string) =>
  path.join(home.dir, '.claude', 'projects', conversationSlug(wd), 'session.jsonl')

function post(conversationFile: string) {
  return new Request('http://localhost/api/conversations/parse', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer tok' },
    body: JSON.stringify({ conversationFile }),
  }) as never
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
  mockAuthenticate.mockReset()
  mockGetAgent.mockReset()
  mockGetAgent.mockImplementation((id: string) =>
    id === AGENT_A ? { id: AGENT_A, workingDirectory: WD_A }
      : id === AGENT_B ? { id: AGENT_B, workingDirectory: WD_B } : null)
})

describe('TRDD-QSB64KKQ — the route maps the service refusal to HTTP 403 (real route, real service)', () => {
  it('agent A naming agent B\'s transcript gets HTTP 403 with the ownership error and no transcript content', async () => {
    /** Validates the route->service join: a service-level refusal reaches the client as 403 */
    mockAuthenticate.mockReturnValue({ agentId: AGENT_A })
    const { POST } = await import('@/app/api/conversations/parse/route')
    const res = await POST(post(transcriptFile(WD_B)))
    const text = await res.text()

    expect(res.status).toBe(403)
    expect(JSON.parse(text)).toEqual({
      success: false,
      error: 'Access denied — an agent may read only its own conversation transcript',
    })
    expect(text).not.toContain(MARKER)
  })

  it('POSITIVE CONTROL — agent A reading its OWN transcript gets 200 and the messages', async () => {
    /** Validates the 403 above is a decision by owner, not a route that refuses every agent */
    mockAuthenticate.mockReturnValue({ agentId: AGENT_A })
    const { POST } = await import('@/app/api/conversations/parse/route')
    const res = await POST(post(transcriptFile(WD_A)))
    const body = await res.json()

    expect(res.status).toBe(200)
    expect(body.success).toBe(true)
    expect(body.messages).toHaveLength(1)
  })

  it('POSITIVE CONTROL — the system owner (no agentId) may read any transcript', async () => {
    /** Validates the owner exemption survives through the real route */
    mockAuthenticate.mockReturnValue({})
    const { POST } = await import('@/app/api/conversations/parse/route')
    const res = await POST(post(transcriptFile(WD_B)))

    expect(res.status).toBe(200)
    expect(JSON.stringify(await res.json())).toContain(MARKER)
  })
})
