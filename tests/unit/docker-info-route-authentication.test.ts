import { describe, it, expect, vi, beforeEach } from 'vitest'

/**
 * TRDD-1V7UZ38I — `GET /api/docker/info` authenticates before spawning `docker version`.
 * The headless twin is pinned by headless-handler-auth-ledger.test.ts (its ledger entry was removed,
 * so a handler without an auth needle reds "no handler is added without auth").
 */

const mockAuthenticate = vi.fn()

vi.mock('@/lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('@/lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (...a: unknown[]) => mockAuthenticate(...a) }
})

// The docker probe must never fire on a refused call.
const mockProbe = vi.fn()
vi.mock('@/services/config-service', () => ({
  getDockerInfo: (...a: unknown[]) => mockProbe(...a),
}))

const req = () => new Request('http://localhost/api/docker/info', { method: 'GET' }) as never

describe('TRDD-1V7UZ38I — docker/info authenticates before probing docker', () => {
  beforeEach(() => {
    mockAuthenticate.mockReset()
    mockProbe.mockReset()
    mockProbe.mockResolvedValue({ data: { available: true, version: '27.0.0' }, status: 200 })
  })

  it('refuses an unauthenticated caller with 401 and never runs the docker probe', async () => {
    /** Validates the subprocess spawn is unreachable without a credential */
    mockAuthenticate.mockReturnValue({ error: 'Missing or invalid authorization', status: 401 })
    const { GET } = await import('@/app/api/docker/info/route')
    const res = await GET(req())

    expect(res.status).toBe(401)
    expect((await res.json()).error).toBe('Missing or invalid authorization')
    expect(mockProbe).not.toHaveBeenCalled()
  })

  it('POSITIVE CONTROL — an authenticated caller gets the docker info', async () => {
    /** Validates the gate can say yes, so the refusal above is the gate and not a broken route */
    mockAuthenticate.mockReturnValue({ agentId: 'bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb', governanceTitle: 'member' })
    const { GET } = await import('@/app/api/docker/info/route')
    const res = await GET(req())

    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ available: true, version: '27.0.0' })
    expect(mockProbe).toHaveBeenCalledTimes(1)
  })
})
