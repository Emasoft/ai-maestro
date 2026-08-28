/**
 * TRDD-AGHPMRVI (c) — POST /api/teams/create-with-project must stream the REAL createNewTeam
 * pipeline's progress, not a fake timer. This pins the SSE branch: it hands createNewTeam an
 * onProgress spy (mocked at the service boundary — the pipeline internals are already covered
 * by tests/services/teams-service.test.ts) and asserts the route relays every stage as its own
 * SSE frame, then a single terminal `done` frame carrying the same status/payload the
 * non-streaming branch returns for identical input. Both branches run through the SAME `run()`
 * closure in the route, so this also proves they cannot drift into two behaviours.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const h = vi.hoisted(() => ({
  createNewTeam: vi.fn(),
  requireSudoToken: vi.fn(() => null),
}))

vi.mock('@/lib/route-auth', () => ({
  requireAuth: vi.fn(() => ({ ok: true, context: { isSystemOwner: true }, agentId: undefined })),
}))
vi.mock('@/lib/sudo-guard', () => ({ requireSudoToken: h.requireSudoToken }))
vi.mock('@/services/teams-service', () => ({ createNewTeam: h.createNewTeam }))

import { POST } from '@/app/api/teams/create-with-project/route'

const TEAM = { id: '11111111-1111-4111-8111-111111111111', name: 'Staged Team' }

function post(headers: Record<string, string> = {}) {
  const req = new NextRequest(new URL('http://localhost:23000/api/teams/create-with-project'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify({ name: 'Staged Team' }),
  } as never)
  return POST(req)
}

// Split an SSE body on the `data: ...\n\n` frame boundary and parse each frame's JSON payload.
function parseFrames(text: string): unknown[] {
  return text
    .split('\n\n')
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => JSON.parse(chunk.replace(/^data: /, '')))
}

beforeEach(() => {
  vi.clearAllMocks()
  h.requireSudoToken.mockReturnValue(null)
  h.createNewTeam.mockImplementation(async (_params: unknown, onProgress?: (s: string) => void) => {
    onProgress?.('Creating team')
    onProgress?.('Creating chief-of-staff agent')
    return { data: { team: TEAM }, status: 201 }
  })
})

describe('POST /api/teams/create-with-project — streaming progress (TRDD-AGHPMRVI)', () => {
  it('with Accept: text/event-stream, relays >= 2 real pipeline stages then one done frame', async () => {
    const res = await post({ accept: 'text/event-stream' })

    expect(res.headers.get('content-type')).toMatch(/text\/event-stream/)

    const body = await res.text()
    const frames = parseFrames(body) as Array<Record<string, unknown>>

    const stageFrames = frames.filter((f) => 'stage' in f)
    const doneFrames = frames.filter((f) => 'done' in f)

    expect(stageFrames.length).toBeGreaterThanOrEqual(2)
    expect(stageFrames.map((f) => f.stage)).toEqual(['Creating team', 'Creating chief-of-staff agent'])
    expect(doneFrames).toHaveLength(1)
    expect(doneFrames[0]).toMatchObject({
      done: true,
      status: 201,
      payload: { team: TEAM, message: `Team "${TEAM.name}" created successfully` },
    })
  })

  it('without the streaming Accept header, returns the same JSON as before — no SSE framing', async () => {
    const res = await post()

    expect(res.headers.get('content-type')).not.toMatch(/text\/event-stream/)
    const json = await res.json()
    expect(json).toEqual({ team: TEAM, message: `Team "${TEAM.name}" created successfully` })
    expect(res.status).toBe(201)
  })

  it('the streamed done frame matches the same status/payload the non-streaming call returns', async () => {
    const plain = await post()
    const plainJson = await plain.json()

    const streamed = await post({ accept: 'text/event-stream' })
    const frames = parseFrames(await streamed.text()) as Array<Record<string, unknown>>
    const done = frames.find((f) => 'done' in f) as { status: number; payload: unknown }

    expect(done.status).toBe(plain.status)
    expect(done.payload).toEqual(plainJson)
  })
})
