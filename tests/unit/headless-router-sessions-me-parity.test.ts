/**
 * TWO-MODE PARITY for the `/api/sessions/me/*` family (TRDD-T2Q4KXQH, ai-maestro#117).
 *
 * THE BUG THIS FORBIDS: `POST /api/sessions/me/user-input` existed as a Next route and in
 * NONE of the headless router's route-table entries. `services/headless-router.ts` matches
 * against an EXPLICIT table and returns `false` for anything unmatched, so the caller 404s.
 * In headless mode the agent's `UserPromptSubmit` hook therefore 404'd, presence was NEVER
 * recorded, and `fleet-recovery-runner` read a permanently stale record. Two server modes,
 * two different truths about whether a human is at the keyboard — and the difference is
 * invisible until recovery behaves differently on two hosts and nobody can explain why.
 *
 * WHY THE FIRST TEST ENUMERATES THE FILESYSTEM RATHER THAN NAMING THE ROUTE: a test that
 * names `user-input` pins the route I just added and nothing else. The gap class is
 * "somebody adds a Next route under sessions/me and forgets the headless table", so the
 * guard has to be written over the SET, not over the instance. Adding a sibling route to
 * `app/api/sessions/me/` alone now reddens this file.
 *
 * THE NON-VACUITY CONTROL: `handle()` returning `true` only means something if it can
 * return `false`. The last test drives a path that is deliberately not in the table and
 * asserts `false` — without it, a `handle()` hard-wired to `true` would satisfy every
 * assertion above.
 *
 * WHY AUTH IS MOCKED: the thing under test is ROUTING and the veto, both of which are only
 * observable after auth passes. `authenticateFromRequest`'s real behaviour is asserted
 * elsewhere (headless-router-auth-mirror.test.ts drives these handlers with a forged token).
 * `injectedPrompts` is deliberately NOT mocked — mocking the guard to prove the guard is how
 * a test survives its own subject's deletion.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { EventEmitter } from 'events'
import { Readable } from 'stream'
import { readdirSync } from 'fs'
import { join } from 'path'

// The subject is a HEAVY IMPORT: every handler here `await import()`s a Next route module, and
// the router module itself pulls in the whole route table. Warm that is sub-second; cold, under
// parallel file execution, it runs past vitest's 5s default and the file fails with five
// `Test timed out` errors and not one assertion — a failure that reads exactly like a
// regression. Raised at the file so the suite's own concurrency cannot decide the verdict.
vi.setConfig({ testTimeout: 30_000 })

const AGENT_ID = 'parity-agent-id'
const AGENT_NAME = 'parity-agent'

const AUTH_OK = { agentId: AGENT_ID, error: null as string | null, status: 0 }
vi.mock('@/lib/agent-auth', () => ({
  authenticateFromRequest: () => AUTH_OK,
  // The sibling me/restart route reaches for this one. It is mocked only so the enumeration
  // test does not log a spurious module error — that test asserts MATCHED, not the outcome.
  authenticateAgent: () => AUTH_OK,
}))

vi.mock('@/lib/agent-registry', () => ({
  getAgent: (id: string) =>
    id === AGENT_ID ? { id: AGENT_ID, name: AGENT_NAME, sessions: [{ index: 0, status: 'online' }] } : null,
}))

// Persistence is stubbed so the suite never writes the developer's real state dir. The claim
// under test is that headless REACHES this handler, not that the handler persists correctly —
// persistence is pinned in tests/integration/user-presence-api.test.ts against the real writer.
vi.mock('@/lib/user-presence', () => ({
  recordUserInput: vi.fn(async (epoch: number) => epoch),
  nowEpochSeconds: () => 1_700_000_000,
}))

import { createHeadlessRouter } from '@/services/headless-router'
import { injectedPrompts } from '@/services/shared-state'
import { computeSessionName } from '@/types/agent'

const SESSION_NAME = computeSessionName(AGENT_NAME, 0)

// Shape-valid for `_headlessHasCredential` (Bearer prefix + 24 chars). `mst_` deliberately:
// that is the family an AI Maestro session actually holds, so this also pins that a session
// secret clears the headless structural gate for this route.
const BEARER = 'Bearer mst_AAAAAAAAAAAAAAAAAAAAAAAA'

// Buffer chunks, NOT strings: the router concatenates the raw body with Buffer.concat, which
// rejects a string chunk with "list[0] must be an instance of Buffer" — surfaced as a 500 that
// looks exactly like a handler fault.
function makeReq(method: string, url: string, body = '{}') {
  const req = Readable.from([Buffer.from(body)]) as never as {
    method: string
    url: string
    headers: Record<string, string>
  }
  req.method = method
  req.url = url
  req.headers = { authorization: BEARER, 'content-type': 'application/json' }
  return req as never
}

function makeRes() {
  const res: any = new EventEmitter()
  res.headersSent = false
  res.statusCode = 0
  res._chunks = []
  res.setHeader = () => {}
  res.writeHead = (status: number) => {
    res.statusCode = status
    res.headersSent = true
    return res
  }
  res.write = (c: any) => {
    res._chunks.push(Buffer.from(c))
    return true
  }
  res.end = (c?: any) => {
    if (c) res._chunks.push(Buffer.from(c))
    res.finished = true
  }
  res.bodyJson = () => {
    try {
      return JSON.parse(Buffer.concat(res._chunks).toString('utf-8'))
    } catch {
      return null
    }
  }
  return res
}

const router = createHeadlessRouter()

async function viaHeadless(method: string, url: string) {
  const res = makeRes()
  const handled = await router.handle(makeReq(method, url), res)
  return { res, handled }
}

/** The same request, driven straight at the Next route module — the other mode. */
async function viaNext(url: string) {
  const mod = await import('@/app/api/sessions/me/user-input/route')
  const response = await mod.POST(new Request(`http://localhost${url}`, { method: 'POST' }))
  return { status: response.status, body: await response.json() }
}

beforeEach(() => {
  injectedPrompts.clear()
})
afterEach(() => {
  injectedPrompts.clear()
})

describe('headless/full parity — /api/sessions/me/*', () => {
  it('EVERY Next route under app/api/sessions/me/ is also in the headless table', async () => {
    const meDir = join(process.cwd(), 'app/api/sessions/me')
    const segments = readdirSync(meDir, { withFileTypes: true })
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort()

    // If this floor ever reads 0 the enumeration broke and every assertion below is vacuous.
    expect(segments.length).toBeGreaterThanOrEqual(2)
    expect(segments).toContain('user-input')

    const unmatched: string[] = []
    for (const seg of segments) {
      const { handled } = await viaHeadless('POST', `/api/sessions/me/${seg}`)
      if (!handled) unmatched.push(seg)
    }
    expect(unmatched).toEqual([])
  })

  it('POST /api/sessions/me/user-input records presence in HEADLESS, as it does in full mode', async () => {
    const headless = await viaHeadless('POST', '/api/sessions/me/user-input')
    expect(headless.handled).toBe(true)
    expect(headless.res.statusCode).toBe(200)
    expect(headless.res.bodyJson()?.recorded_at_epoch).toBe(1_700_000_000)

    const full = await viaNext('/api/sessions/me/user-input')
    expect(full.status).toBe(200)
    expect(full.body).toEqual(headless.res.bodyJson())
  })

  it('an INJECTED prompt is vetoed in HEADLESS exactly as in full mode (#117)', async () => {
    injectedPrompts.set(SESSION_NAME, Date.now())
    const headless = await viaHeadless('POST', '/api/sessions/me/user-input')
    expect(headless.handled).toBe(true)
    expect(headless.res.bodyJson()).toEqual({ recorded: false, reason: 'injected_prompt' })
    // Consume-once: the mark is spent by the headless call, not merely read.
    expect(injectedPrompts.has(SESSION_NAME)).toBe(false)

    injectedPrompts.set(SESSION_NAME, Date.now())
    const full = await viaNext('/api/sessions/me/user-input')
    expect(full.body).toEqual({ recorded: false, reason: 'injected_prompt' })
    expect(injectedPrompts.has(SESSION_NAME)).toBe(false)
  })

  it('NON-VACUITY: handle() returns false for a path absent from the table', async () => {
    const { handled } = await viaHeadless('POST', '/api/sessions/me/definitely-not-a-route')
    expect(handled).toBe(false)
  })
})
