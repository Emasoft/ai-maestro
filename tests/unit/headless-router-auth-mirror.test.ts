/**
 * Regression test for the headless-router auth mirror (security audit
 * reports/security-audit/20260619_062114+0200-R26-R40-audit.md, unit
 * `xc-headless-mirror`, findings C1/C2/H1/H2/H3/M5).
 *
 * THE BUG (refute-by-default, confirmed at HEAD c8bae574): the session's
 * Next.js auth/IDOR fixes were NOT mirrored into services/headless-router.ts,
 * so in MAESTRO_MODE=headless several handlers were protected ONLY by the
 * STRUCTURAL credential gate (`_headlessHasCredential`). That gate — by its own
 * documentation — is "DEFENCE-IN-DEPTH, NOT AUTHENTICATION": it admits any
 * well-formed `Bearer aim_tk_<24+ junk>` without verifying it. So a caller that
 * mints a SHAPE-VALID but cryptographically-INVALID token could:
 *   - C1  read any text file under ~/agents / ~/.claude (browse-dir),
 *   - C2  SET the host governance/sudo password (host takeover),
 *   - H1  read/mark/delete ANY agent's mailbox (/api/messages),
 *   - H2  dump any agent's local element config (and skills/repos),
 *   - H3  list the cross-host session topology,
 * with NO real authentication.
 *
 * THE FIX: every one of those handlers now authenticates the caller for real
 * (authenticateAgent / requireAuth / enforceSystemOwner — the structural gate
 * is never the sole gate) and, where the Next.js twin does, applies the same
 * object-level authorization (own-id / agent-param override / sudo).
 *
 * THE TEST: drive the REAL `createHeadlessRouter().handle()` with a forged
 * `Bearer aim_tk_AAAA…` token — exactly the shape that PASSES the structural
 * gate but FAILS cryptographic verification (validateGovernanceToken returns
 * null → "Invalid or expired governance token", 401). Each vulnerable endpoint
 * MUST now return 401/403 and MUST NOT return its data (200). Before the fix
 * each returned 200 with the leaked data (or, for C2, performed the mutation);
 * after the fix each is rejected. No service mocking is needed because the auth
 * rejection happens BEFORE any service call — the test exercises the real
 * handler auth path end-to-end.
 *
 * The forged token is 24 'A's after the prefix, which the tightened structural
 * gate regex `^Bearer\s+(aim_tk_|…)[A-Za-z0-9_\-\.]{24,}$` accepts, so the
 * request genuinely reaches the per-handler auth (it is NOT bounced by the
 * structural gate — proven by the dedicated "structural gate" control below).
 */

import { describe, it, expect } from 'vitest'
import { EventEmitter } from 'events'
import { Readable } from 'stream'
import { createHeadlessRouter } from '@/services/headless-router'

// A forged token: correct SHAPE (passes _headlessHasCredential's
// `aim_tk_` + 24-char regex) but NOT a real issued governance token, so
// validateGovernanceToken returns null and authenticateAgent → 401.
const FORGED_BEARER = 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA' // 24 'A's after prefix

/**
 * Minimal IncomingMessage-shaped request for the router. Backed by a real
 * Readable stream so the handlers' `readJsonBody`/`readRawBody` (which await
 * the stream 'end' event) resolve instead of hanging. An empty body resolves
 * to null — fine here because every endpoint rejects on auth before the body
 * content matters.
 */
function makeReq(method: string, url: string, headers: Record<string, string> = {}, body = '') {
  // lower-case the header keys to match Node's IncomingMessage.headers contract
  const lower: Record<string, string> = {}
  for (const [k, v] of Object.entries(headers)) lower[k.toLowerCase()] = v
  const req = Readable.from(body ? [Buffer.from(body)] : []) as never as {
    method: string; url: string; headers: Record<string, string>
  }
  req.method = method
  req.url = url
  req.headers = lower
  return req as never
}

/** Minimal capturing ServerResponse — records status + JSON body. */
function makeRes() {
  const res: any = new EventEmitter()
  res.headersSent = false
  res.statusCode = 0
  res._chunks = []
  res.setHeader = () => {}
  res.writeHead = (status: number) => { res.statusCode = status; res.headersSent = true; return res }
  res.write = (c: any) => { res._chunks.push(Buffer.from(c)); return true }
  res.end = (c?: any) => { if (c) res._chunks.push(Buffer.from(c)); res.finished = true }
  res.bodyText = () => Buffer.concat(res._chunks).toString('utf-8')
  res.bodyJson = () => { try { return JSON.parse(res.bodyText()) } catch { return null } }
  return res
}

const router = createHeadlessRouter()

/** Drive one request through the real router and return the captured response. */
async function call(method: string, url: string, headers: Record<string, string> = {}) {
  const res = makeRes()
  await router.handle(makeReq(method, url, headers), res)
  return res
}

describe('headless-router auth mirror — forged structural credential is rejected per-handler', () => {
  it('control: a credential-less request is bounced by the structural gate (401)', async () => {
    const res = await call('GET', '/api/sessions')
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('auth_required') // the structural gate, not a handler
  })

  it('control: the FORGED token PASSES the structural gate but is rejected by handler auth (not auth_required)', async () => {
    // This is the load-bearing premise of the whole test: the forged token is
    // shape-valid, so it reaches the per-handler auth. If it were bounced by
    // the structural gate the test below would pass for the wrong reason.
    const res = await call('GET', '/api/sessions', { Authorization: FORGED_BEARER })
    expect(res.statusCode).toBe(401)
    // The rejection comes from the HANDLER (authenticateAgent), NOT the
    // structural gate — so the error is the token error, not 'auth_required'.
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    expect(res.bodyJson()?.error).toMatch(/token|Authentication required/i)
  })

  // ── H3 — GET /api/sessions ────────────────────────────────────────────────
  it('H3: GET /api/sessions rejects the forged token (no session-topology leak)', async () => {
    const res = await call('GET', '/api/sessions', { Authorization: FORGED_BEARER })
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.sessions).toBeUndefined() // never leaks the list
  })

  // ── H2 — GET /api/agents/[id]/local-config + siblings skills/repos ─────────
  it('H2: GET /api/agents/:id/local-config rejects the forged token (no config dump)', async () => {
    const res = await call('GET', '/api/agents/00000000-0000-4000-8000-000000000000/local-config', { Authorization: FORGED_BEARER })
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.settings).toBeUndefined()
  })

  it('H2 sibling: GET /api/agents/:id/skills rejects the forged token', async () => {
    const res = await call('GET', '/api/agents/00000000-0000-4000-8000-000000000000/skills', { Authorization: FORGED_BEARER })
    expect(res.statusCode).toBe(401)
  })

  it('H2 sibling: GET /api/agents/:id/repos rejects the forged token', async () => {
    const res = await call('GET', '/api/agents/00000000-0000-4000-8000-000000000000/repos', { Authorization: FORGED_BEARER })
    expect(res.statusCode).toBe(401)
  })

  // ── H1 — /api/messages GET/PATCH/DELETE ────────────────────────────────────
  it('H1: GET /api/messages rejects the forged token (no cross-agent mailbox read)', async () => {
    const res = await call('GET', '/api/messages?agent=victim&box=inbox', { Authorization: FORGED_BEARER })
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.messages).toBeUndefined()
  })

  it('H1: PATCH /api/messages rejects the forged token (no cross-agent mark-read)', async () => {
    const res = await call('PATCH', '/api/messages?agent=victim&id=m1&action=read', { Authorization: FORGED_BEARER })
    expect(res.statusCode).toBe(401)
  })

  it('H1: DELETE /api/messages rejects the forged token (no cross-agent delete)', async () => {
    const res = await call('DELETE', '/api/messages?agent=victim&id=m1', { Authorization: FORGED_BEARER })
    expect(res.statusCode).toBe(401)
  })

  // ── C1 — GET /api/agents/browse-dir (forwarded to the hardened Next.js GET) ─
  it('C1: GET /api/agents/browse-dir rejects the forged token (no cross-agent file read)', async () => {
    const res = await call('GET', '/api/agents/browse-dir?path=' + encodeURIComponent('/etc'), { Authorization: FORGED_BEARER })
    // requireAuth (in the forwarded Next.js handler) rejects the forged token.
    expect([401, 403]).toContain(res.statusCode)
    expect(res.statusCode).not.toBe(200)
    expect(res.bodyJson()?.entries).toBeUndefined()
    expect(res.bodyJson()?.content).toBeUndefined()
  })

  // ── C2 — POST /api/governance/password (forwarded to the hardened Next.js POST) ─
  it('C2: POST /api/governance/password rejects the forged token (no host-takeover password set)', async () => {
    const res = await call(
      'POST',
      '/api/governance/password',
      { Authorization: FORGED_BEARER, 'Content-Type': 'application/json' },
    )
    // enforceSystemOwner (in the forwarded Next.js handler) rejects the forged
    // token BEFORE setGovernancePassword runs — closing the unauthenticated
    // first-time-set takeover vector.
    expect([401, 403]).toContain(res.statusCode)
    expect(res.statusCode).not.toBe(200)
  })
})
