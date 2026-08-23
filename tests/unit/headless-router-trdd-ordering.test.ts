/**
 * Route-ORDER guard for the headless `/api/trdd/*` family (TRDD-KJQZEYXW).
 *
 * THE BUG THIS FORBIDS: `matchRoute` scans `routes[]` in order and takes the
 * FIRST match. `/^\/api\/trdd\/([^/]+)$/` matches `/api/trdd/kanban` just as
 * happily as it matches `/api/trdd/ABCD1234`. So if the parameterized `[id]`
 * route is ever moved above the static `kanban` route, the kanban index quietly
 * stops existing: the request lands in the `[id]` handler, `isValidTrddId`
 * rejects `kanban` as a non-8-char id, and the caller gets `400 Invalid TRDD id`
 * for a path that is not an id at all. Nothing else in the suite would notice —
 * both routes answer 401 to an unauthenticated caller, so the ordering is
 * invisible until a real, authorized caller asks for the board.
 *
 * WHY AUTH IS MOCKED HERE, AND ONLY HERE: the thing under test is ROUTING, and
 * the ordering is only observable AFTER the auth gate passes. `requireAuth` is
 * incidental to that question — its real behavior is asserted, unmocked, in
 * headless-router-auth-mirror.test.ts, which drives the same handlers with a
 * forged token. Mocking it there would defeat that file's purpose; mocking it
 * here is what makes this file's question answerable at all.
 *
 * THE FALSIFICATION PAIR — neither assertion means much alone:
 *   - `/api/trdd/kanban` returns the index (200 + `columns`), so the static route
 *     won the match.
 *   - `/api/trdd/notanid` returns `400 Invalid TRDD id`, proving the `[id]`
 *     handler IS reachable and DOES reject a non-8-char segment. Which is exactly
 *     what it would have done to `kanban` had it matched first.
 * Together they pin the order. Swap the two routes in headless-router.ts and the
 * first assertion turns into that same 400.
 */

import { describe, it, expect, vi } from 'vitest'
import { EventEmitter } from 'events'
import { Readable } from 'stream'

// Hoisted by vitest above the router import, so the dynamically-imported Next.js
// route modules resolve to this stub. Only the auth verdict is faked; every other
// thing the handlers do (id validation, the kanban index build) runs for real.
// TRDD-8Q5EVGV1: this file's subject is ROUTE ORDERING, not auth — the bearer
// below exists only to clear the credential gate. That gate now validates for
// real, so without this mock every ordering assertion 401s before a route is
// ever matched.
vi.mock('@/lib/agent-auth', async importOriginal => ({
  ...(await importOriginal<typeof import('@/lib/agent-auth')>()),
  authenticateFromRequestAsync: async () => ({ agentId: 'test-agent' }),
}))

vi.mock('@/lib/route-auth', () => ({
  requireAuth: () => ({ ok: true as const, agentId: null }),
}))

import { createHeadlessRouter } from '@/services/headless-router'

function makeReq(method: string, url: string, headers: Record<string, string> = {}) {
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  const req = Readable.from([]) as never as { method: string; url: string; headers: Record<string, string> }
  req.method = method
  req.url = url
  req.headers = lower
  return req as never
}

function makeRes() {
  const res: any = new EventEmitter()
  res.headersSent = false
  res.statusCode = 0
  res._chunks = []
  res.setHeader = () => {}
  res.writeHead = (status: number) => { res.statusCode = status; res.headersSent = true; return res }
  res.write = (c: any) => { res._chunks.push(Buffer.from(c)); return true }
  res.end = (c?: any) => { if (c) res._chunks.push(Buffer.from(c)); res.finished = true }
  res.bodyJson = () => { try { return JSON.parse(Buffer.concat(res._chunks).toString('utf-8')) } catch { return null } }
  return res
}

const router = createHeadlessRouter()

// Shape-valid so it clears the structural credential gate and reaches the handler,
// where the mocked requireAuth admits it.
const BEARER = 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA'

async function get(url: string) {
  const res = makeRes()
  const handled = await router.handle(makeReq('GET', url, { Authorization: BEARER }), res)
  return { res, handled }
}

describe('headless /api/trdd route ORDER — static `kanban` beats the `[id]` catch-all', () => {
  it('GET /api/trdd/kanban serves the kanban index, not the [id] handler', async () => {
    const { res, handled } = await get('/api/trdd/kanban')
    expect(handled).toBe(true)
    expect(res.statusCode).toBe(200)
    // The index's own shape — the [id] handler can never produce this.
    expect(Array.isArray(res.bodyJson()?.columns)).toBe(true)
    expect(res.bodyJson()?.error).toBeUndefined()
  })

  it('GET /api/trdd/notanid DOES 400 on a non-8-char segment (so the 200 above could only be kanban)', async () => {
    const { res, handled } = await get('/api/trdd/notanid')
    expect(handled).toBe(true)
    expect(res.statusCode).toBe(400)
    expect(res.bodyJson()?.error).toMatch(/Invalid TRDD id/i)
  })

  it('GET /api/trdd/ABCD1234 reaches the [id] handler (valid id → a lookup, not a 400)', async () => {
    const { res } = await get('/api/trdd/ABCD1234')
    // No such TRDD in the corpus, so the handler's own 404 — which is proof it
    // got past isValidTrddId and actually performed the read.
    expect(res.statusCode).toBe(404)
    expect(res.bodyJson()?.error).toMatch(/not found/i)
  })
})
