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
    expect(res.bodyJson()?.error).toMatch(/token|Authentication required|invalid_credential/i)
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

/**
 * SF1/SF2 drift-fix coverage for commit 9d7065c7 (fix(headless): mirror Next.js
 * auth/validation into headless-router). Two NEW gate families were added that
 * were previously protected ONLY by the forgeable structural credential gate:
 *
 *   SF2 — the role-plugins strict handlers
 *           POST   /api/agents/role-plugins/install
 *           DELETE /api/agents/role-plugins/install
 *           DELETE /api/agents/role-plugins
 *         now authenticateAgent() FIRST (401 on auth.error), then
 *         authorize(auth, 'manage-skills') (403 if not allowed) — mirroring the
 *         Next.js routes' requireSudoToken → requireAidTitle → authorize chain.
 *         Before the fix a forged structural bearer could install/uninstall a
 *         plugin into an ARBITRARY agentDir with no real auth at all.
 *
 *   SF1 — the cross-host governance vote handlers
 *           POST /api/v1/governance/requests/:id/approve
 *           POST /api/v1/governance/requests/:id/reject  (local, non-host-signed path)
 *         now authenticateAgent() and derive the voter from auth.agentId ONLY —
 *         never from a self-asserted body field — closing the IDOR where any
 *         caller who knew the global password could vote AS ANY MANAGER/COS.
 *
 * Same harness as above: the forged `aim_tk_AAAA…` token is shape-valid (so it
 * PASSES the structural gate and genuinely reaches the per-handler auth) but
 * cryptographically invalid (so authenticateAgent → 401). A credential-less
 * request is bounced earlier by the structural gate (401 `auth_required`). No
 * service mocking is needed because every rejection lands before any service
 * call. For the governance handlers a VALID UUID is used in the path so the
 * request reaches the auth gate rather than being bounced by the UUID-format
 * check (isValidUuid runs first) — the assertion targets the auth gate.
 */
describe('headless-router auth mirror — SF1/SF2 new gates (commit 9d7065c7)', () => {
  // A real, well-formed UUID so the governance handlers' isValidUuid() gate
  // passes and the request reaches authenticateAgent() (the gate under test).
  const VALID_UUID = '11111111-1111-4111-8111-111111111111'

  // ── SF2 — POST /api/agents/role-plugins/install ────────────────────────────
  it('SF2: POST /api/agents/role-plugins/install — credential-less request is bounced by the structural gate (401)', async () => {
    const res = await call('POST', '/api/agents/role-plugins/install')
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('auth_required')
    expect(res.bodyJson()?.success).toBeUndefined() // never installs
  })

  it('SF2: POST /api/agents/role-plugins/install — forged token passes the structural gate but is rejected by handler auth (401, not auth_required)', async () => {
    const res = await call('POST', '/api/agents/role-plugins/install', { Authorization: FORGED_BEARER, 'Content-Type': 'application/json' })
    expect(res.statusCode).toBe(401) // authenticateAgent rejects the invalid token before authorize/install
    expect(res.bodyJson()?.error).not.toBe('auth_required') // handler auth, not the structural gate
    expect(res.bodyJson()?.error).toMatch(/token|Authentication required|invalid_credential/i)
    expect(res.bodyJson()?.success).toBeUndefined()
  })

  // ── SF2 — DELETE /api/agents/role-plugins/install ──────────────────────────
  it('SF2: DELETE /api/agents/role-plugins/install — credential-less request is bounced by the structural gate (401)', async () => {
    const res = await call('DELETE', '/api/agents/role-plugins/install')
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('auth_required')
    expect(res.bodyJson()?.success).toBeUndefined() // never uninstalls
  })

  it('SF2: DELETE /api/agents/role-plugins/install — forged token is rejected by handler auth (401, not auth_required)', async () => {
    const res = await call('DELETE', '/api/agents/role-plugins/install', { Authorization: FORGED_BEARER, 'Content-Type': 'application/json' })
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    expect(res.bodyJson()?.error).toMatch(/token|Authentication required|invalid_credential/i)
    expect(res.bodyJson()?.success).toBeUndefined()
  })

  // ── SF2 — DELETE /api/agents/role-plugins ──────────────────────────────────
  it('SF2: DELETE /api/agents/role-plugins — credential-less request is bounced by the structural gate (401)', async () => {
    const res = await call('DELETE', '/api/agents/role-plugins?name=scen-test-plugin')
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('auth_required')
    expect(res.bodyJson()?.success).toBeUndefined() // never deletes
  })

  it('SF2: DELETE /api/agents/role-plugins — forged token is rejected by handler auth before any delete (401, not auth_required)', async () => {
    const res = await call('DELETE', '/api/agents/role-plugins?name=scen-test-plugin', { Authorization: FORGED_BEARER })
    expect(res.statusCode).toBe(401) // authenticateAgent rejects before the name guard / deleteRolePlugin
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    expect(res.bodyJson()?.error).toMatch(/token|Authentication required|invalid_credential/i)
    expect(res.bodyJson()?.success).toBeUndefined()
  })

  // ── SF1 — POST /api/v1/governance/requests/:id/approve ─────────────────────
  it('SF1: POST /api/v1/governance/requests/:id/approve — credential-less request is bounced by the structural gate (401)', async () => {
    const res = await call('POST', `/api/v1/governance/requests/${VALID_UUID}/approve`)
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('auth_required') // never reaches approveCrossHostRequest
  })

  it('SF1: POST /api/v1/governance/requests/:id/approve — forged token is rejected by handler auth, voter not spoofable (401, not auth_required)', async () => {
    // Valid UUID in the path → isValidUuid() passes → request reaches
    // authenticateAgent(), which rejects the forged token (the approver is
    // derived from auth.agentId, never from body.approverAgentId).
    const res = await call('POST', `/api/v1/governance/requests/${VALID_UUID}/approve`, { Authorization: FORGED_BEARER, 'Content-Type': 'application/json' })
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    expect(res.bodyJson()?.error).toMatch(/token|Authentication required|invalid_credential/i)
  })

  // ── SF1 — POST /api/v1/governance/requests/:id/reject (local path) ──────────
  it('SF1: POST /api/v1/governance/requests/:id/reject — credential-less request is bounced by the structural gate (401)', async () => {
    const res = await call('POST', `/api/v1/governance/requests/${VALID_UUID}/reject`)
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('auth_required') // never reaches rejectCrossHostRequest
  })

  it('SF1: POST /api/v1/governance/requests/:id/reject — forged token (no host-signature) is rejected by handler auth (401, not auth_required)', async () => {
    // No X-Host-Signature headers → the local-rejection branch runs, which
    // authenticateAgent()s and derives the rejector from auth.agentId only.
    // Valid UUID so the upstream isValidUuid() gate passes and we exercise auth.
    const res = await call('POST', `/api/v1/governance/requests/${VALID_UUID}/reject`, { Authorization: FORGED_BEARER, 'Content-Type': 'application/json' })
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    expect(res.bodyJson()?.error).toMatch(/token|Authentication required|invalid_credential/i)
  })

  // ── SF1 — gate-ordering parity for the reject handler's TWO auth modes ──────
  it('SF1: POST /api/v1/governance/requests/:id/reject — host-signature path enforces UUID validation before the host-sig branch (400 on a bad id)', async () => {
    // The reject handler validates isValidUuid(params.id) BEFORE the host-signed
    // branch (and before the local-auth branch). A forged host signature on a
    // malformed id is rejected at the UUID gate (400), never reaching
    // verifyHostAttestation / receiveRemoteRejection — mirroring MF-014.
    const res = await call('POST', '/api/v1/governance/requests/not-a-uuid/reject', {
      Authorization: FORGED_BEARER,
      'X-Host-Signature': 'AAAA',
      'X-Host-Timestamp': new Date().toISOString(),
      'X-Host-Id': 'unknown-host',
      'Content-Type': 'application/json',
    })
    // TRDD-8Q5EVGV1 (2026-08-23): WAS 400. The semantic credential gate now
    // rejects the forged token before the handler runs, so the UUID gate is no
    // longer reachable by an unauthenticated caller. The property this test
    // protected — a forged host signature on a malformed id never reaches
    // verifyHostAttestation / receiveRemoteRejection — now holds STRICTLY MORE
    // STRONGLY: the request never reaches the handler at all.
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('invalid_credential')
  })

  it('SF1: POST /api/v1/governance/requests/:id/approve — forged token with a malformed id is still rejected (auth gate fires first; no vote, never 200)', async () => {
    // For approve, authenticateAgent() runs BEFORE isValidUuid(), so the forged
    // token is rejected at auth (401) — the malformed id never reaches the
    // service. Either way the request is refused and no vote is cast.
    const res = await call('POST', '/api/v1/governance/requests/not-a-uuid/approve', { Authorization: FORGED_BEARER, 'Content-Type': 'application/json' })
    expect(res.statusCode).toBe(401) // auth gate precedes the UUID gate on approve
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    expect(res.statusCode).not.toBe(200)
  })
})

/**
 * Info-leak GET drift-fix coverage (TRDD-47a35ba2 §B items (a)+(b)).
 *
 * Two headless GET handlers were the still-open siblings of already-hardened
 * Next.js routes:
 *   - GET /api/agents/role-plugins/status — enumerated EVERY agent's name,
 *     governanceTitle, absolute workingDirectory and role-plugin state with NO
 *     auth, AND compiled a user-controlled `new RegExp(filter)` (ReDoS) BEFORE
 *     any auth. Now: authenticateAgent() first (401 on forged token) + a plain
 *     case-insensitive substring match (no RegExp).
 *   - GET /api/governance/reachable — exposed the comm-reachability graph with
 *     NO auth. Now: authenticateAgent() first, mirroring the route's enforceAuth.
 *
 * Same forged-bearer harness: shape-valid `aim_tk_AAAA…` passes the structural
 * gate and reaches the per-handler auth, where authenticateAgent rejects it (401,
 * NOT 'auth_required'), and no data is returned.
 */
describe('headless-router auth mirror — info-leak GETs (TRDD-47a35ba2)', () => {
  it('role-plugins/status: credential-less request is rejected (401), no roster leak', async () => {
    const res = await call('GET', '/api/agents/role-plugins/status')
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.agents).toBeUndefined()
  })

  it('role-plugins/status: forged token rejected by handler auth (401), no roster/path leak', async () => {
    const res = await call('GET', '/api/agents/role-plugins/status', { Authorization: FORGED_BEARER })
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    expect(res.bodyJson()?.error).toMatch(/token|Authentication required|invalid_credential/i)
    expect(res.bodyJson()?.agents).toBeUndefined()
  })

  it('role-plugins/status: a catastrophic-backtracking filter is auth-gated and no longer a user-controlled RegExp', async () => {
    // Pre-fix this compiled `new RegExp('(a+)+$')` before any auth (ReDoS). Now
    // auth runs first (forged token → 401) and the filter is a plain substring
    // match, so the evil pattern can neither hang nor be reached.
    const evil = encodeURIComponent('(a+)+$')
    const res = await call('GET', `/api/agents/role-plugins/status?filter=${evil}`, { Authorization: FORGED_BEARER })
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.agents).toBeUndefined()
  })

  it('governance/reachable: credential-less request is rejected (401)', async () => {
    const res = await call('GET', '/api/governance/reachable?agentId=victim')
    expect(res.statusCode).toBe(401)
  })

  it('governance/reachable: forged token rejected by handler auth (401), no comm-graph leak', async () => {
    const res = await call('GET', '/api/governance/reachable?agentId=victim', { Authorization: FORGED_BEARER })
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    expect(res.bodyJson()?.error).toMatch(/token|Authentication required|invalid_credential/i)
  })
})

/**
 * The TRDD / 3-pillars task API in headless mode (TRDD-KJQZEYXW).
 *
 * Two distinct claims, and they need two distinct signals:
 *
 *  1. REGISTERED. `handle()` returns false for a path no route matches, and the
 *     caller then 404s. Every one of the eight handlers used to be unregistered
 *     here — the whole family (search, read, edit, and the four lifecycle
 *     transitions) existed only in full mode. So we assert on the BOOLEAN, not
 *     just the status: a 401 alone would also be produced by the structural gate
 *     bouncing a credential-less request, and would prove nothing about routing.
 *
 *  2. AUTHENTICATED. Five of the eight are `strict` in security-registry.json,
 *     and this router has no sudo layer, so each handler delegates to its Next.js
 *     twin. A forged-but-shape-valid token must therefore be rejected by the
 *     DELEGATED gate (401, never 'auth_required', never 200 with data). If a
 *     future edit "simplifies" the delegation into a direct service call, this
 *     block fails — which is the drift YEE33F3A found across this file.
 *
 * The forged token is the same one used above: it passes `_headlessHasCredential`
 * and reaches the per-handler auth, so a 401 here is the handler's verdict.
 */
describe('headless-router — /api/trdd/* is registered AND authenticates (TRDD-KJQZEYXW)', () => {
  /** Like `call`, but keeps `handle()`'s boolean — the registration signal. */
  async function callHandled(method: string, url: string, headers: Record<string, string> = {}, body = '') {
    const res = makeRes()
    const handled = await router.handle(makeReq(method, url, headers, body), res)
    return { res, handled }
  }

  // A shape-valid 8-char base36 id, so `isValidTrddId` never short-circuits the
  // auth check we are actually asserting on.
  const ID = 'ABCD1234'

  const ROUTES: Array<[string, string]> = [
    ['GET', '/api/trdd'],
    ['GET', '/api/trdd?column=dev&q=widget'],
    ['GET', '/api/trdd/kanban'],
    ['GET', `/api/trdd/${ID}`],
    ['PATCH', `/api/trdd/${ID}`],
    ['POST', `/api/trdd/${ID}/approve`],
    ['POST', `/api/trdd/${ID}/refuse`],
    ['POST', `/api/trdd/${ID}/promote`],
    ['POST', `/api/trdd/${ID}/archive`],
  ]

  it('control: an UNREGISTERED /api/trdd sub-path is still unhandled (the assertions below are not vacuous)', async () => {
    // Proves `handled === true` is a real signal and not something every request
    // gets: this path matches no route, so the router declines it and the caller
    // 404s. Without this control, a router that blindly handled everything would
    // pass the whole block.
    const { handled } = await callHandled('GET', `/api/trdd/${ID}/no-such-verb`, { Authorization: FORGED_BEARER })
    expect(handled).toBe(false)
  })

  it.each(ROUTES)('%s %s is registered and rejects the forged token (401)', async (method, url) => {
    const { res, handled } = await callHandled(method, url, { Authorization: FORGED_BEARER }, '{}')
    expect(handled).toBe(true)                        // claim 1: the route exists here
    expect(res.statusCode).toBe(401)                  // claim 2: the delegated gate ran
    expect(res.bodyJson()?.error).not.toBe('auth_required') // …the HANDLER refused, not the structural gate
    // and nothing leaked on the way out
    expect(res.bodyJson()?.trdds).toBeUndefined()
    expect(res.bodyJson()?.trdd).toBeUndefined()
    expect(res.bodyJson()?.rows).toBeUndefined()
  })

  it('a credential-less request never reaches the TRDD handlers (structural gate, 401)', async () => {
    const { res } = await callHandled('POST', `/api/trdd/${ID}/approve`, {}, '{}')
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('auth_required')
  })
})

/**
 * Headless-parity governance holes closed by the 2026-07-14 governance audit —
 * same class as the mint-MANAGER (a5256fd8) and R17.14 core-plugin-uninstall
 * (89b0d017) fixes: a guard present in the full-mode Next.js route was absent in
 * the headless twin, so the invariant held in one serving mode and not the other.
 *
 *  1. PUT /api/teams/[id] — RBAC bypass. The headless handler authenticated the
 *     caller and then called updateTeamById() directly. Its ONLY authorization was
 *     updateTeamById → checkTeamAccess, which admits ANY team MEMBER, and the body
 *     was a raw rest-spread with NO zod .strict() — so a non-MANAGER member could
 *     rename a team, add/remove members, relink team.githubProject, or inject
 *     {"blocked":false} (clearing the manager-gated freeze). The Next.js twin gates
 *     the SAME route with requireSudoToken → authorize('manage-team') (MANAGER-only
 *     for agents) + a zod .strict() schema. FIX: the headless handler now forwards
 *     through the hardened Next.js PUT via delegateNextRoute, so the full gate stack
 *     runs in headless too.
 *
 *  2. POST /api/sessions/[id]/restart — R10 manager-gate. Full mode refuses to
 *     restart a team agent when no MANAGER exists on the host (reviving one would
 *     bypass R10's hibernate-until-MANAGER freeze). Headless authorize()'d the
 *     caller but dropped this second gate. FIX: mirror the exact full-mode check.
 *     (The manager-gate runs AFTER authenticate+authorize, so the forged-token
 *     harness below cannot reach it — it exercises the auth-layer parity the gate
 *     builds on.
 *
 *     CORRECTED 2026-07-30: this note used to end "…the gate's condition is
 *     byte-identical to full mode's and is covered there by the governance suite."
 *     MEASURED: the string "Cannot restart team agent" appears in ZERO tests, in
 *     either mode. Only the WAKE twin is driven — `r3-r9-team-governance.test.ts`
 *     calls the real `wakeAgent` and asserts its 403. So no test reaches ANY of
 *     R10.6's three restart gates, and this comment was asserting a coverage that
 *     does not exist — which is worse than admitting the gap, because it tells the
 *     next reader not to look. R10.6 is tracked as unpinned in TRDD-H4Y9F25J; the
 *     harness it needs is described in that card's STATE block.)
 *
 * Same forged-bearer harness: `aim_tk_AAAA…` is shape-valid (passes the structural
 * gate, reaches the per-handler / delegated auth) but cryptographically invalid
 * (rejected → 401), and a credential-less request is bounced earlier by the
 * structural gate (401 `auth_required`). No service mocking is needed — every
 * rejection lands before any team/session mutation.
 */
describe('headless-router auth mirror — team-update + session-restart parity (governance audit 2026-07-14)', () => {
  // A real, well-formed UUID so the delegated PUT's isValidUuid() gate passes and
  // the request reaches the auth layer (the gate actually under test).
  const VALID_UUID = '22222222-2222-4222-8222-222222222222'

  // ── PUT /api/teams/[id] — now delegated to the hardened Next.js route ──────
  it('team-update: credential-less PUT is bounced by the structural gate (401), no mutation', async () => {
    const res = await call('PUT', `/api/teams/${VALID_UUID}`)
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('auth_required')
    expect(res.bodyJson()?.team).toBeUndefined() // never renames / mutates
  })

  it('team-update: forged token is rejected by the delegated handler auth (401, not auth_required), no team data', async () => {
    const res = await call('PUT', `/api/teams/${VALID_UUID}`, { Authorization: FORGED_BEARER, 'Content-Type': 'application/json' })
    expect(res.statusCode).toBe(401)
    // The rejection comes from the delegated Next.js route's authenticateFromRequest,
    // not the structural gate — so it is the token error, not 'auth_required'.
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    expect(res.bodyJson()?.error).toMatch(/token|Authentication required|invalid_credential/i)
    expect(res.bodyJson()?.team).toBeUndefined()
  })

  it('team-update: DELEGATION proof — forged token + malformed id returns 400 (isValidUuid runs before auth in full mode)', async () => {
    // This is the regression guard that a future "simplify back to a direct
    // updateTeamById() call" turns red. The full-mode PUT validates isValidUuid
    // BEFORE authenticateFromRequest, so a forged token on a malformed id is
    // rejected at the UUID gate (400). The OLD headless handler authenticated
    // FIRST, so the same request would have returned 401 — the two gate orders
    // are distinguishable, and only the delegated (fixed) path yields 400 here.
    // TRDD-8Q5EVGV1 (2026-08-23): WAS 400, and THIS ONE LOST REAL COVERAGE —
    // recorded rather than quietly rewritten. The 400-vs-401 difference was the
    // only thing distinguishing the delegated path from a direct
    // updateTeamById() call, so this test WAS the regression guard against
    // "simplify the delegation away". The semantic gate now rejects the forged
    // token before either path runs, so both orders yield 401 and the
    // discrimination is gone. The security property is unharmed (strictly
    // stronger); the ARCHITECTURE guard is not, and needs a different vehicle —
    // tracked as an EHT of TRDD-8Q5EVGV1. Do not read this as still proving
    // delegation.
    const res = await call('PUT', '/api/teams/not-a-uuid', { Authorization: FORGED_BEARER, 'Content-Type': 'application/json' })
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('invalid_credential')
  })

  // ── session stop/restart — auth-layer parity the R10 gate builds on ────────
  it('session-stop: forged token is rejected by handler auth (401, not auth_required), no stop', async () => {
    const res = await call('POST', '/api/sessions/victim-session/stop', { Authorization: FORGED_BEARER, 'Content-Type': 'application/json' })
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    expect(res.bodyJson()?.error).toMatch(/token|Authentication required|invalid_credential/i)
    expect(res.bodyJson()?.success).toBeUndefined()
  })

  it('session-stop: credential-less request is bounced by the structural gate (401), no stop', async () => {
    const res = await call('POST', '/api/sessions/victim-session/stop')
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('auth_required')
    expect(res.bodyJson()?.success).toBeUndefined()
  })

  it('session-restart: forged token is rejected by handler auth before the R10 manager-gate (401, not auth_required), no restart', async () => {
    const res = await call('POST', '/api/sessions/victim-session/restart', { Authorization: FORGED_BEARER, 'Content-Type': 'application/json' })
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    expect(res.bodyJson()?.error).toMatch(/token|Authentication required|invalid_credential/i)
    expect(res.bodyJson()?.success).toBeUndefined()
  })

  it('session-restart: credential-less request is bounced by the structural gate (401), no restart', async () => {
    const res = await call('POST', '/api/sessions/victim-session/restart')
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('auth_required')
    expect(res.bodyJson()?.success).toBeUndefined()
  })
})

/**
 * CC-GOV-001 session-name injection gate — headless parity for /stop and /restart
 * (TRDD-4P1M8I18 Phase 2b). Before this fix, the headless /stop and /restart
 * handlers interpolated the raw, %-decoded session name straight into
 * `execSync("tmux send-keys -t \"${sessionName}\"…")` — a shell-injection surface
 * the Next.js twins did NOT have (they validate the name against
 * `^[a-zA-Z0-9_@.-]+$` and drive tmux via execFileSync, no shell). The fix mirrors
 * the app-route order: validate the name FIRST — before auth, since headless has
 * no sudo layer the app route's sudo→validate→auth collapses to validate→auth — so
 * a name carrying a shell metachar is rejected with 400 before it can reach tmux.
 *
 * The forged bearer PASSES the structural gate and reaches the handler; because
 * validation now precedes auth, a malicious name yields 400 (not 401) — exactly
 * the app route's behavior. A well-formed name still falls through to the auth
 * gate (401), proving the 400 is the NAME gate and not a blanket rejection. Both
 * assertions run end-to-end through the REAL router — no service mocking, and the
 * 400 lands before any tmux call, so nothing is ever restarted/stopped.
 */
describe('headless-router — CC-GOV-001 session-name injection gate (TRDD-4P1M8I18 Phase 2b)', () => {
  // decodeURIComponent('victim%24%28whoami%29') === 'victim$(whoami)', which fails
  // ^[a-zA-Z0-9_@.-]+$ ($, (, ) are all excluded) → the metachar gate must fire.
  const EVIL = 'victim%24%28whoami%29'

  it('restart: a session name with shell metachars is rejected with 400 before reaching tmux', async () => {
    // TRDD-8Q5EVGV1 (2026-08-23): WAS 400 from the name gate. The semantic
    // credential gate now fires first, so a shell-metachar name from an
    // unauthenticated caller never reaches the handler — the tmux-injection
    // property this pins holds strictly more strongly. The name gate itself is
    // unchanged in the handler and still runs for authenticated callers.
    const res = await call('POST', `/api/sessions/${EVIL}/restart`, { Authorization: FORGED_BEARER, 'Content-Type': 'application/json' })
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('invalid_credential')
    expect(res.bodyJson()?.success).toBeUndefined() // never restarted
  })

  it('stop: a session name with shell metachars is rejected with 400 before reaching tmux', async () => {
    // TRDD-8Q5EVGV1 (2026-08-23): WAS 400 from the name gate. The semantic
    // credential gate now fires first, so a shell-metachar name from an
    // unauthenticated caller never reaches the handler — the tmux-injection
    // property this pins holds strictly more strongly. The name gate itself is
    // unchanged in the handler and still runs for authenticated callers.
    const res = await call('POST', `/api/sessions/${EVIL}/stop`, { Authorization: FORGED_BEARER, 'Content-Type': 'application/json' })
    expect(res.statusCode).toBe(401)
    expect(res.bodyJson()?.error).toBe('invalid_credential')
    expect(res.bodyJson()?.success).toBeUndefined() // never stopped
  })

  it('restart: a well-formed name still falls through to the auth gate (401), proving the 400 is the name gate', async () => {
    const res = await call('POST', '/api/sessions/valid-session/restart', { Authorization: FORGED_BEARER, 'Content-Type': 'application/json' })
    expect(res.statusCode).toBe(401) // valid name passes the gate → forged token rejected by handler auth
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    expect(res.bodyJson()?.success).toBeUndefined()
  })

  it('stop: a well-formed name still falls through to the auth gate (401), proving the 400 is the name gate (TRDD-OPNDCKVA parity)', async () => {
    const res = await call('POST', '/api/sessions/valid-session/stop', { Authorization: FORGED_BEARER, 'Content-Type': 'application/json' })
    expect(res.statusCode).toBe(401) // valid name passes the gate → forged token rejected by handler auth
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    expect(res.bodyJson()?.success).toBeUndefined()
  })

  // ── TRDD-R268J32X — GET /api/sessions/restore ─────────────────────────────
  /**
   * This handler's signature was `async (_req, res)` — it took no request, so it COULD NOT
   * authenticate, in BOTH server modes. SVC2-MAJ-12 added auth to the POST and DELETE siblings
   * ten lines away and skipped GET; both of those comments say "before re-spawning" / "before
   * deleting", i.e. that pass reasoned about SIDE EFFECTS and a read that discloses was never in
   * scope. `listRestorableSessions` returns whole `PersistedSession` records —
   * `workingDirectory` is an absolute home path — so unauthenticated it enumerates the fleet and
   * leaks the owner's filesystem layout.
   */
  // ── TRDD-R268J32X — POST /api/conversations/parse ─────────────────────────
  /**
   * This handler was a hand-rolled twin with NO auth call of any kind — two lines that read
   * `body.filePath` and passed it to `parseConversationFile`, which returns the FULL conversation
   * (every message, tool output and thinking block, plus the absolute `cwd`). The Next route
   * carries five guards it had none of: `enforceAuth`, a NUL check, the `~/.claude/projects/`
   * allowlist root, a `.jsonl` extension check, and a type check (API2-MAJ-14 / SF-016). The two
   * had even drifted on the field NAME — `filePath` here, `conversationFile` there.
   *
   * Now delegated through `delegateNextRoute`, which forwards the caller's real credentials, so
   * the same handler and the same validations run in both modes. This test pins the auth half of
   * that: a forged token must not reach the transcript reader.
   */
  /**
   * NEUTER RUN (2026-08-22 — OBSERVED, restore verified by blob hash). The mutation is in the
   * OTHER file, and that is the point:
   *
   *   app/api/conversations/parse/route.ts
   *   s/if \(authErr\) return authErr/if (false) return authErr/ if $. == 18
   *   → 1 red / 52 green: this test.
   *
   * Disabling the guard in the NEXT route reddens the HEADLESS test. That is stronger evidence
   * than neutering the delegation would have been: it proves the two modes now run ONE shared
   * guard rather than two copies that agree today. A first attempt — flipping the delegation's
   * own `method`/`withBody` args — correctly reddened NOTHING, because the delegation still
   * reached `enforceAuth` either way; that mutation was not aimed at the guard at all.
   */
  it('R268J32X: POST /api/conversations/parse rejects the forged token (no transcript leak)', async () => {
    const res = await call('POST', '/api/conversations/parse', {
      Authorization: FORGED_BEARER,
      'Content-Type': 'application/json',
    })
    expect(res.statusCode).toBe(401)
    // From the HANDLER, not the structural gate — the discrimination the controls above establish.
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    // And no transcript came back: `messages` is the success payload's field.
    expect(res.bodyJson()?.messages).toBeUndefined()
  })

  // ── TRDD-R268J32X — POST /api/agents/:id/install-skills ───────────────────
  /**
   * TRDD-D3RP7KQZ's fix was HALF-APPLIED. The Next route
   * (`app/api/agents/[id]/install-skills/route.ts:39-46`) authenticates and then calls
   * `authorize(auth, 'manage-skills', id)` — its comment: "installing skills is CONFIGURATION, so
   * no agent may do it to itself, and only a MANAGER (or the target's own COS) may do it to
   * another … precisely the self-reconfiguration the invariant forbids."
   *
   * The headless twin took `_req`: no authentication, no authorization, while doing the same work
   * — `convertElements(..., scope: 'user')` writes rooted at `process.env.HOME`
   * (`lib/converter/convert.ts:209-212`). In MAESTRO_MODE=headless the Next route never runs, so
   * that gate simply did not exist on this path. This is precisely the failure class this whole
   * file exists for, per its own header: several handlers "protected ONLY by the structural gate",
   * which a shape-valid forged token passes.
   */
  /**
   * NEUTER RUN (2026-08-22 — OBSERVED, restore verified by blob hash). BOTH halves of the new
   * gate were neutered, and the result is stated in full because HALF OF IT IS UNPINNED:
   *
   *   authentication  s/if \(auth.error\)/if (false)/ if $. == 1378   → 1 red / 51 green (this test)
   *   authorization   s/if \(!authz.allowed\)/if (false)/ if $. == 1380 → 0 red / 52 green ← UNPINNED
   *
   * The zero is a measurement of THIS FIXTURE, not of the guard. A forged token fails
   * `authenticateAgent` on the line ABOVE, so `authorize(auth, 'manage-skills', params.id)` is
   * never reached and no assertion here can see it change. Pinning it needs a caller that
   * AUTHENTICATES successfully and is then refused — i.e. a genuinely issued token for a
   * non-authorized agent, which this file's forged-credential harness cannot mint.
   *
   * Recorded rather than quietly left, because a test that passes for a reason you have not
   * established is the failure this whole file exists to prevent — and the `authorize` half is the
   * half carrying TRDD-D3RP7KQZ's actual invariant ("no agent may do it to itself"). The Next
   * route's own coverage pins the equivalent decision on its side; this router's does not yet.
   */
  it('R268J32X: POST /api/agents/:id/install-skills rejects the forged token (D3RP7KQZ parity)', async () => {
    const res = await call('POST', '/api/agents/00000000-0000-4000-8000-000000000000/install-skills', {
      Authorization: FORGED_BEARER,
      'Content-Type': 'application/json',
    })
    expect(res.statusCode).toBe(401)
    // From the HANDLER, not the structural gate — the discrimination the controls above establish.
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    // And nothing was written: `installed` is the success payload.
    expect(res.bodyJson()?.installed).toBeUndefined()
  })

  it('R268J32X: GET /api/sessions/restore rejects the forged token (no persisted-session leak)', async () => {
    const res = await call('GET', '/api/sessions/restore', { Authorization: FORGED_BEARER })
    expect(res.statusCode).toBe(401)
    // From the HANDLER, not the structural gate — same discrimination the controls above make.
    expect(res.bodyJson()?.error).not.toBe('auth_required')
    // And prove the payload never went out: workingDirectory is the field that matters.
    expect(res.bodyJson()?.sessions).toBeUndefined()
    expect(res.bodyText()).not.toMatch(/workingDirectory/)
  })
})
