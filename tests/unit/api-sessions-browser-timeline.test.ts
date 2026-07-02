/**
 * Phase 6 API route tests.
 *
 * Direct-imports each of the 4 new route handlers and invokes them with
 * hand-built Request objects, asserting on the NextResponse JSON status
 * + body. The service layer is mocked so these tests focus purely on
 * the HTTP shape (auth, param parsing, error mapping, schema validation).
 *
 * We do NOT spawn the Rust child here — that coverage lives in the Rust
 * integration tests. Service-layer coverage lives in
 * `sessions-timeline-service.test.ts`.
 */

import { describe, it, expect, vi, beforeEach, beforeAll, afterAll } from 'vitest'

// Mock the service layer before importing routes.
vi.mock('@/services/sessions-timeline-service', () => ({
  openTimeline: vi.fn(),
  readTimelineRange: vi.fn(),
  searchTimeline: vi.fn(),
  contextAt: vi.fn(),
}))

import {
  openTimeline,
  readTimelineRange,
  searchTimeline,
  contextAt,
} from '@/services/sessions-timeline-service'
import { GET as getTimeline } from '@/app/api/sessions-browser/agents/[id]/timeline/route'
import { GET as getRange } from '@/app/api/sessions-browser/timelines/[tid]/range/route'
import { GET as getSearch } from '@/app/api/sessions-browser/timelines/[tid]/search/route'
import { GET as getContextAt } from '@/app/api/sessions-browser/timelines/[tid]/context-at/route'
import { createSession, invalidateSession } from '@/lib/session-auth'

// A real session token: the validating auth gate (TRDD-9e1e4b29) now rejects a
// junk `aim_session` value, so the authenticated-request helper must carry a
// token the store actually issued. createSession is the same mint the login
// routes use; validateSession (inside the route gate) accepts it.
let validCookie = ''
beforeAll(async () => {
  validCookie = `aim_session=${await createSession()}`
})
afterAll(() => {
  const token = validCookie.slice('aim_session='.length)
  if (token) invalidateSession(token)
})

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeRequest(url: string, options: RequestInit = {}): Request {
  return new Request(url, {
    headers: { cookie: validCookie, ...(options.headers ?? {}) },
    ...options,
  })
}

function makeNoAuthRequest(url: string): Request {
  return new Request(url)
}

function asParams<T extends object>(obj: T): { params: Promise<T> } {
  return { params: Promise.resolve(obj) }
}

beforeEach(() => {
  vi.mocked(openTimeline).mockReset()
  vi.mocked(readTimelineRange).mockReset()
  vi.mocked(searchTimeline).mockReset()
  vi.mocked(contextAt).mockReset()
})

// ---------------------------------------------------------------------------
// GET /agents/:id/timeline
// ---------------------------------------------------------------------------

describe('GET /api/sessions-browser/agents/:id/timeline', () => {
  const url = 'http://localhost:23000/api/sessions-browser/agents/agent-1/timeline'

  it('rejects unauthenticated requests with 401', async () => {
    const res = await getTimeline(makeNoAuthRequest(url), asParams({ id: 'agent-1' }))
    expect(res.status).toBe(401)
    const body = await res.json()
    expect(body.error).toBe('unauthenticated')
  })

  it('forwards agent_not_found as 404', async () => {
    vi.mocked(openTimeline).mockResolvedValue({
      ok: false,
      status: 404,
      error: 'agent_not_found',
    })
    const res = await getTimeline(makeRequest(url), asParams({ id: 'ghost' }))
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('agent_not_found')
  })

  it('returns the manifest on success', async () => {
    vi.mocked(openTimeline).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        timelineId: 'tl-abc',
        agentId: 'agent-1',
        files: [
          {
            absPath: '/abs/sess.jsonl',
            sessionId: 'sess',
            kind: 'main',
            laneId: 'main',
            parentSessionId: null,
            agentId: null,
            slug: null,
            size: 100,
            lastModified: '2026-01-01T00:00:00.000Z',
          },
        ],
        totalLines: 5,
        projectDirs: ['/abs'],
        generatedAt: '2026-01-01T00:00:00.000Z',
        lanes: [
          {
            laneId: 'main',
            fileIndexes: [0],
            firstTimestampIso: '2026-01-01T00:00:00.000Z',
            lastTimestampIso: '2026-01-01T00:00:01.000Z',
            lineCount: 5,
          },
        ],
      },
    })
    const res = await getTimeline(makeRequest(url), asParams({ id: 'agent-1' }))
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.timelineId).toBe('tl-abc')
    expect(body.totalLines).toBe(5)
    expect(body.files).toHaveLength(1)
  })
})

// ---------------------------------------------------------------------------
// GET /timelines/:tid/range
// ---------------------------------------------------------------------------

describe('GET /api/sessions-browser/timelines/:tid/range', () => {
  const base = 'http://localhost:23000/api/sessions-browser/timelines/tl-x/range'

  it('rejects unauthenticated with 401', async () => {
    const res = await getRange(
      makeNoAuthRequest(`${base}?fromGlobal=0&toGlobal=10`),
      asParams({ tid: 'tl-x' }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when fromGlobal or toGlobal is missing', async () => {
    const res = await getRange(makeRequest(base), asParams({ tid: 'tl-x' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_request')
  })

  it('returns 400 when fromGlobal is not an integer', async () => {
    const res = await getRange(
      makeRequest(`${base}?fromGlobal=abc&toGlobal=10`),
      asParams({ tid: 'tl-x' }),
    )
    expect(res.status).toBe(400)
  })

  it('returns 404 when the service reports timeline_not_found', async () => {
    vi.mocked(readTimelineRange).mockResolvedValue({
      ok: false,
      status: 404,
      error: 'timeline_not_found',
    })
    const res = await getRange(
      makeRequest(`${base}?fromGlobal=0&toGlobal=10`),
      asParams({ tid: 'tl-missing' }),
    )
    expect(res.status).toBe(404)
    const body = await res.json()
    expect(body.error).toBe('timeline_not_found')
  })

  it('returns rows on success', async () => {
    vi.mocked(readTimelineRange).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        rows: [
          {
            sessionId: 'sid-1',
            laneId: 'main',
            fileIndex: 0,
            localLineIndex: 3,
            globalLineIndex: 3,
            raw: { foo: 'bar' },
          },
        ],
      },
    })
    const res = await getRange(
      makeRequest(`${base}?fromGlobal=0&toGlobal=10`),
      asParams({ tid: 'tl-x' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.rows).toHaveLength(1)
    expect(body.fromGlobal).toBe(0)
    expect(body.toGlobal).toBe(10)
    expect(body.timelineId).toBe('tl-x')
  })
})

// ---------------------------------------------------------------------------
// GET /timelines/:tid/search
// ---------------------------------------------------------------------------

describe('GET /api/sessions-browser/timelines/:tid/search', () => {
  const base = 'http://localhost:23000/api/sessions-browser/timelines/tl-x/search'

  it('rejects unauthenticated with 401', async () => {
    const res = await getSearch(
      makeNoAuthRequest(`${base}?q=hit`),
      asParams({ tid: 'tl-x' }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when q is missing', async () => {
    const res = await getSearch(makeRequest(base), asParams({ tid: 'tl-x' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_request')
  })

  it('returns 400 when kind is not substring/regex', async () => {
    const res = await getSearch(
      makeRequest(`${base}?q=hit&kind=glob`),
      asParams({ tid: 'tl-x' }),
    )
    expect(res.status).toBe(400)
  })

  it('returns matches on success', async () => {
    vi.mocked(searchTimeline).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        matches: [
          {
            globalLineIndex: 2,
            laneId: 'main',
            sessionId: 'sid-1',
            fileIndex: 0,
            localLineIndex: 2,
            byteOffset: 42,
            snippet: '…hit…',
          },
        ],
      },
    })
    const res = await getSearch(
      makeRequest(`${base}?q=hit&kind=substring&ci=true`),
      asParams({ tid: 'tl-x' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.matches).toHaveLength(1)
    expect(body.matches[0].snippet).toBe('…hit…')
    expect(body.timelineId).toBe('tl-x')
  })

  it('returns 404 when timeline is missing', async () => {
    vi.mocked(searchTimeline).mockResolvedValue({
      ok: false,
      status: 404,
      error: 'timeline_not_found',
    })
    const res = await getSearch(
      makeRequest(`${base}?q=hit`),
      asParams({ tid: 'tl-missing' }),
    )
    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// GET /timelines/:tid/context-at
// ---------------------------------------------------------------------------

describe('GET /api/sessions-browser/timelines/:tid/context-at', () => {
  const base = 'http://localhost:23000/api/sessions-browser/timelines/tl-x/context-at'

  it('rejects unauthenticated with 401', async () => {
    const res = await getContextAt(
      makeNoAuthRequest(`${base}?anchorUuid=u1`),
      asParams({ tid: 'tl-x' }),
    )
    expect(res.status).toBe(401)
  })

  it('returns 400 when no anchor is provided', async () => {
    const res = await getContextAt(makeRequest(base), asParams({ tid: 'tl-x' }))
    expect(res.status).toBe(400)
    const body = await res.json()
    expect(body.error).toBe('invalid_request')
  })

  it('returns 400 when globalLineIndex is negative', async () => {
    const res = await getContextAt(
      makeRequest(`${base}?globalLineIndex=-3`),
      asParams({ tid: 'tl-x' }),
    )
    expect(res.status).toBe(400)
  })

  it('returns the context result on success', async () => {
    vi.mocked(contextAt).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        anchorGlobalLine: 4,
        cumulative: {
          systemPrompt: 1,
          systemTools: 0,
          mcpTools: 0,
          customAgents: 0,
          memory: 0,
          messages: 10,
          cacheRead: 0,
          total: 11,
          freeSpace: 199_989,
          modelContextLimit: 200_000,
          approximate: false,
          modelId: 'claude-sonnet-4-6',
        },
        exactAtCursor: {
          systemPrompt: 1,
          systemTools: 0,
          mcpTools: 0,
          customAgents: 0,
          memory: 0,
          messages: 10,
          cacheRead: 0,
          total: 11,
          freeSpace: 199_989,
          modelContextLimit: 200_000,
          approximate: false,
          modelId: 'claude-sonnet-4-6',
        },
        phaseHistory: [
          { phaseId: 0, pre: 0, peak: 11, post: null },
        ],
      },
    })
    const res = await getContextAt(
      makeRequest(`${base}?anchorUuid=u1`),
      asParams({ tid: 'tl-x' }),
    )
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.anchorGlobalLine).toBe(4)
    expect(body.phaseHistory).toHaveLength(1)
    expect(body.timelineId).toBe('tl-x')
  })

  it('accepts globalLineIndex as the anchor form', async () => {
    vi.mocked(contextAt).mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        anchorGlobalLine: 7,
        cumulative: {
          systemPrompt: 0,
          systemTools: 0,
          mcpTools: 0,
          customAgents: 0,
          memory: 0,
          messages: 0,
          cacheRead: 0,
          total: 0,
          freeSpace: 200_000,
          modelContextLimit: 200_000,
          approximate: false,
          modelId: null,
        },
        exactAtCursor: {
          systemPrompt: 0,
          systemTools: 0,
          mcpTools: 0,
          customAgents: 0,
          memory: 0,
          messages: 0,
          cacheRead: 0,
          total: 0,
          freeSpace: 200_000,
          modelContextLimit: 200_000,
          approximate: false,
          modelId: null,
        },
        phaseHistory: [],
      },
    })
    const res = await getContextAt(
      makeRequest(`${base}?globalLineIndex=7`),
      asParams({ tid: 'tl-x' }),
    )
    expect(res.status).toBe(200)
    expect(vi.mocked(contextAt)).toHaveBeenCalledWith('tl-x', {
      anchorUuid: undefined,
      globalLineIndex: 7,
    })
  })
})
