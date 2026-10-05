import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'http'

/**
 * TRDD-BZW1QAZ5 — the headless handlers that authenticated but did not AUTHORIZE now mirror their full-mode twins.
 *
 * Drives the REAL createHeadlessRouter().handle() with the REAL authorize() and the REAL buildAuthContext(); only
 * authenticateAgent (the handler's identity seam) and the services are replaced, at their module boundary, so no
 * test touches ~/.aimaestro. Every refusal case also asserts the service was NOT called (a check placed after the
 * call would still return 403 and must not pass). The password verifier is a stub: no secret value appears here.
 */

const m = vi.hoisted(() => {
  const fns = [
    'authenticateAgent', 'verifyPassword', 'modelOn', 'isLockedDown', 'checkAndRecordAttempt', 'resetRateLimit',
    'deployConfigToAgent', 'importAgent', 'CreateAgent', 'addTrust', 'removeTrust', 'listMessages',
    'addAMPAddressToAgent', 'updateAMPAddressOnAgent', 'removeAMPAddressFromAgent',
    'addEmailAddressToAgent', 'updateEmailAddressOnAgent', 'removeEmailAddressFromAgent',
    'addNewHost', 'updateExistingHost', 'deleteExistingHost', 'setOrganizationName', 'initializeStartup',
    'syncDirectory', 'normalizeHosts', 'testWebhookById', 'updateDomainById', 'deleteDomainById',
    'createPersona', 'createDockerAgent', 'writeFile', 'mkdir', 'sendAgentSessionCommand', 'createSession',
  ] as const
  type AnyFn = (...a: any[]) => any
  const o = {} as Record<(typeof fns)[number], import('vitest').Mock<AnyFn>>
  for (const f of fns) o[f] = vi.fn<AnyFn>()
  return o
})
const tmp = vi.hoisted(() => {
  const fs = require('node:fs'); const os = require('node:os'); const p = require('node:path')
  // realpath: the download handler compares realpathSync(file) against the cemetery dir, and macOS tmpdir is a symlink
  return { dir: fs.realpathSync(fs.mkdtempSync(p.join(os.tmpdir(), 'bzw-cemetery-'))) as string }
})

vi.mock('../../lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('../../lib/agent-auth')>()
  return {
    ...actual,
    authenticateAgent: (...a: unknown[]) => m.authenticateAgent(...a),
    // buildAuthContext reads the user-authority flag through a runtime `require('./governance')`, which under vitest
    // cannot see this file's governance mock (the flag silently reads OFF). So the model-ON flip is applied here exactly
    // as lib/agent-auth.ts:395-399 defines it: owner = no agentId AND userTitle in {maestro, maestro-delegate}.
    buildAuthContext: (a: { agentId?: string; userTitle?: string }) => {
      const c = actual.buildAuthContext(a as never)
      return m.modelOn() && !(a as { error?: string }).error
        ? { ...c, isSystemOwner: !a.agentId && (a.userTitle === 'maestro' || a.userTitle === 'maestro-delegate') }
        : c
    },
    // the router's semantic credential gate runs before the handler; let it through
    authenticateFromRequestAsync: vi.fn(async () => ({ agentId: undefined, error: undefined })),
  }
})
vi.mock('../../lib/governance', async (orig) => {
  const actual = await orig<typeof import('../../lib/governance')>()
  return {
    ...actual,
    verifyPassword: (...a: unknown[]) => m.verifyPassword(...a),
    isUserAuthorityModelEnabled: () => m.modelOn(),
    loadGovernance: () => ({ passwordHash: 'stub-hash' }),
    getManagerId: () => '11111111-1111-4111-8111-111111111111',
  }
})
vi.mock('../../lib/kill-switch', async (orig) => {
  const actual = await orig<typeof import('../../lib/kill-switch')>()
  return { ...actual, isLockedDown: () => m.isLockedDown() }
})
vi.mock('../../lib/rate-limit', async (orig) => {
  const actual = await orig<typeof import('../../lib/rate-limit')>()
  return {
    ...actual,
    checkAndRecordAttempt: (...a: unknown[]) => m.checkAndRecordAttempt(...a),
    resetRateLimit: (...a: unknown[]) => m.resetRateLimit(...a),
  }
})
vi.mock('../../lib/session-auth', async (orig) => {
  const actual = await orig<typeof import('../../lib/session-auth')>()
  return { ...actual, createSession: (...a: unknown[]) => m.createSession(...a), buildSessionCookie: () => 'aim_session=stub' }
})
vi.mock('../../lib/ecosystem-constants', async (orig) => {
  const actual = await orig<typeof import('../../lib/ecosystem-constants')>()
  const { join } = await import('node:path')
  return { ...actual, statePath: (...p: string[]) => join(tmp.dir, ...p) }
})
vi.mock('fs/promises', async (orig) => {
  const actual = await orig<typeof import('fs/promises')>()
  return { ...actual, default: actual, writeFile: (...a: unknown[]) => m.writeFile(...a), mkdir: (...a: unknown[]) => m.mkdir(...a) }
})
vi.mock('../../services/agents-config-deploy-service', async (orig) => ({ ...(await orig<object>()), deployConfigToAgent: (...a: unknown[]) => m.deployConfigToAgent(...a) }))
vi.mock('../../services/agents-transfer-service', async (orig) => ({ ...(await orig<object>()), importAgent: (...a: unknown[]) => m.importAgent(...a) }))
vi.mock('../../services/element-management-service', async (orig) => ({ ...(await orig<object>()), CreateAgent: (...a: unknown[]) => m.CreateAgent(...a) }))
vi.mock('../../services/governance-service', async (orig) => ({ ...(await orig<object>()), addTrust: (...a: unknown[]) => m.addTrust(...a), removeTrust: (...a: unknown[]) => m.removeTrust(...a) }))
vi.mock('../../services/agents-messaging-service', async (orig) => {
  const actual = await orig<typeof import('../../services/agents-messaging-service')>()
  // listMessages: the REAL service answers a foreign-mailbox call (its denial runs before any disk access); an
  // allowed call is stubbed so no mailbox is read. A router that passes NO context therefore gets the stub (200).
  m.listMessages.mockImplementation(async (id: string, p: never, ctx?: { agentId?: string; isSystemOwner?: boolean }) =>
    ctx && !ctx.isSystemOwner && ctx.agentId !== id ? actual.listMessages(id, p, ctx as never) : { data: { messages: [] }, status: 200 })
  return {
    ...actual,
    listMessages: (...a: unknown[]) => m.listMessages(...a),
    addAMPAddressToAgent: (...a: unknown[]) => m.addAMPAddressToAgent(...a),
    updateAMPAddressOnAgent: (...a: unknown[]) => m.updateAMPAddressOnAgent(...a),
    removeAMPAddressFromAgent: (...a: unknown[]) => m.removeAMPAddressFromAgent(...a),
    addEmailAddressToAgent: (...a: unknown[]) => m.addEmailAddressToAgent(...a),
    updateEmailAddressOnAgent: (...a: unknown[]) => m.updateEmailAddressOnAgent(...a),
    removeEmailAddressFromAgent: (...a: unknown[]) => m.removeEmailAddressFromAgent(...a),
  }
})
vi.mock('../../services/hosts-service', async (orig) => ({ ...(await orig<object>()), addNewHost: (...a: unknown[]) => m.addNewHost(...a), updateExistingHost: (...a: unknown[]) => m.updateExistingHost(...a), deleteExistingHost: (...a: unknown[]) => m.deleteExistingHost(...a) }))
vi.mock('../../services/config-service', async (orig) => ({ ...(await orig<object>()), setOrganizationName: (...a: unknown[]) => m.setOrganizationName(...a) }))
vi.mock('../../services/agents-core-service', async (orig) => ({ ...(await orig<object>()), initializeStartup: (...a: unknown[]) => m.initializeStartup(...a), sendAgentSessionCommand: (...a: unknown[]) => m.sendAgentSessionCommand(...a) }))
vi.mock('../../services/agents-directory-service', async (orig) => ({ ...(await orig<object>()), syncDirectory: (...a: unknown[]) => m.syncDirectory(...a), normalizeHosts: (...a: unknown[]) => m.normalizeHosts(...a) }))
vi.mock('../../services/webhooks-service', async (orig) => ({ ...(await orig<object>()), testWebhookById: (...a: unknown[]) => m.testWebhookById(...a) }))
vi.mock('../../services/domains-service', async (orig) => ({ ...(await orig<object>()), updateDomainById: (...a: unknown[]) => m.updateDomainById(...a), deleteDomainById: (...a: unknown[]) => m.deleteDomainById(...a) }))
vi.mock('../../services/role-plugin-service', async (orig) => ({ ...(await orig<object>()), createPersona: (...a: unknown[]) => m.createPersona(...a) }))
// the revive handler looks up a soft-deleted registry entry by name; read an empty registry, never the real one
vi.mock('../../lib/agent-registry', async (orig) => ({ ...(await orig<object>()), loadAgents: () => [] }))
vi.mock('../../services/agents-docker-service', async (orig) => ({ ...(await orig<object>()), createDockerAgent: (...a: unknown[]) => m.createDockerAgent(...a) }))

const MANAGER = '11111111-1111-4111-8111-111111111111'
const MEMBER = '22222222-2222-4222-8222-222222222222'
const TARGET = '33333333-3333-4333-8333-333333333333'
const MEMBER_AUTH = { agentId: MEMBER, governanceTitle: 'member' }
const MANAGER_AUTH = { agentId: MANAGER, governanceTitle: 'manager' }
// User-authority model ON shapes, quoted from lib/agent-auth.ts authenticateAgent: a web session resolves to
// { userId, userTitle } with NO agentId.
const PLAIN_USER = { userId: 'user-plain', userTitle: 'user' }
const OWNER = {}

const MEMBER_REASON = 'member cannot modify-agent other agents'
const CREATE_REASON = 'Only MANAGER and CHIEF-OF-STAFF can create agents (R30.1/R30.2); a COS additionally requires a MANAGER mandate'
const OWNER_REASON = 'Forbidden — system owner only'
const CEMETERY_REASON = 'Only the system owner can access cemetery archives'
const IMPORT_REASON = 'This operation is restricted to the system owner.'
const BOUNDARY = 'BZWBOUNDARY'
const MULTIPART = Buffer.from(`--${BOUNDARY}\r\nContent-Disposition: form-data; name="file"; filename="a.zip"\r\nContent-Type: application/zip\r\n\r\nPK-bytes\r\n--${BOUNDARY}--\r\n`)

function drive(method: string, url: string, body?: unknown, extraHeaders: Record<string, string> = {}) {
  const chunks = body instanceof Buffer ? [body] : body === undefined ? [] : [Buffer.from(JSON.stringify(body))]
  const req = {
    url, method,
    // must satisfy the router's structural credential gate (24+ chars after the prefix)
    headers: { authorization: 'Bearer aim_tk_AAAAAAAAAAAAAAAAAAAAAAAA', 'content-type': 'application/json', ...extraHeaders },
    [Symbol.asyncIterator]: async function* () { for (const c of chunks) yield c },
    on(event: string, cb: (...a: unknown[]) => void) {
      if (event === 'data') chunks.forEach((c) => cb(c))
      if (event === 'end') cb()
      return this
    },
  } as unknown as IncomingMessage
  const out: { status?: number; body?: string | Buffer } = {}
  const res = {
    writeHead(status: number) { out.status = status; return this },
    setHeader() { return this },
    end(payload?: string | Buffer) { out.body = payload },
    headersSent: false,
  } as unknown as ServerResponse
  return { req, res, out }
}
async function run(method: string, url: string, body?: unknown, headers?: Record<string, string>) {
  const { createHeadlessRouter } = await import('../../services/headless-router')
  const d = drive(method, url, body, headers)
  await createHeadlessRouter().handle(d.req, d.res)
  return d.out
}
const text = (o: { body?: string | Buffer }) => (o.body ? o.body.toString() : '')

type Row = { name: string; method: string; url: string; body?: unknown; spy: () => import('vitest').Mock<(...a: never[]) => unknown>; extraHeaders?: Record<string, string> }

const AGENT_GATED: Array<Row & { reason: string }> = [
  { name: 'W1 POST agents/:id/config/deploy', method: 'POST', url: `/api/agents/${TARGET}/config/deploy`, body: { operation: 'update-hooks', hooks: {} }, spy: () => m.deployConfigToAgent, reason: MEMBER_REASON },
  { name: 'W3 POST agents', method: 'POST', url: '/api/agents', body: { name: 'x' }, spy: () => m.CreateAgent, reason: CREATE_REASON },
  { name: 'W7 POST agents/docker/create', method: 'POST', url: '/api/agents/docker/create', body: { name: 'x' }, spy: () => m.createDockerAgent, reason: CREATE_REASON },
  { name: 'W7 POST agents/create-persona', method: 'POST', url: '/api/agents/create-persona', body: { personaName: 'p', pluginName: 'x' }, spy: () => m.createPersona, reason: CREATE_REASON },
  { name: 'W7 POST agents/create-from-toml', method: 'POST', url: '/api/agents/create-from-toml', body: { personaName: 'p', tomlContent: 't' }, spy: () => m.createPersona, reason: CREATE_REASON },
  { name: 'W7 POST agents/:id/amp/addresses', method: 'POST', url: `/api/agents/${TARGET}/amp/addresses`, body: { address: 'a' }, spy: () => m.addAMPAddressToAgent, reason: MEMBER_REASON },
  { name: 'W7 PATCH agents/:id/amp/addresses/:a', method: 'PATCH', url: `/api/agents/${TARGET}/amp/addresses/a`, body: {}, spy: () => m.updateAMPAddressOnAgent, reason: MEMBER_REASON },
  { name: 'W7 DELETE agents/:id/amp/addresses/:a', method: 'DELETE', url: `/api/agents/${TARGET}/amp/addresses/a`, spy: () => m.removeAMPAddressFromAgent, reason: MEMBER_REASON },
  { name: 'W7 POST agents/:id/email/addresses', method: 'POST', url: `/api/agents/${TARGET}/email/addresses`, body: { address: 'a' }, spy: () => m.addEmailAddressToAgent, reason: MEMBER_REASON },
  { name: 'W7 PATCH agents/:id/email/addresses/:a', method: 'PATCH', url: `/api/agents/${TARGET}/email/addresses/a`, body: {}, spy: () => m.updateEmailAddressOnAgent, reason: MEMBER_REASON },
  { name: 'W7 DELETE agents/:id/email/addresses/:a', method: 'DELETE', url: `/api/agents/${TARGET}/email/addresses/a`, spy: () => m.removeEmailAddressFromAgent, reason: MEMBER_REASON },
]

const OWNER_ONLY: Array<Row & { reason: string }> = [
  { name: 'W5 POST agents/import', method: 'POST', url: '/api/agents/import', body: MULTIPART, extraHeaders: { 'content-type': `multipart/form-data; boundary=${BOUNDARY}` }, spy: () => m.importAgent, reason: IMPORT_REASON },
  { name: 'W6 POST governance/trust', method: 'POST', url: '/api/governance/trust', body: { hostId: 'h' }, spy: () => m.addTrust, reason: OWNER_REASON },
  { name: 'W6 DELETE governance/trust/:hostId', method: 'DELETE', url: '/api/governance/trust/h1', body: {}, spy: () => m.removeTrust, reason: OWNER_REASON },
  { name: 'W7 POST hosts', method: 'POST', url: '/api/hosts', body: {}, spy: () => m.addNewHost, reason: OWNER_REASON },
  { name: 'W7 PUT hosts/:id', method: 'PUT', url: '/api/hosts/h1', body: {}, spy: () => m.updateExistingHost, reason: OWNER_REASON },
  { name: 'W7 DELETE hosts/:id', method: 'DELETE', url: '/api/hosts/h1', spy: () => m.deleteExistingHost, reason: OWNER_REASON },
  { name: 'W7 POST organization', method: 'POST', url: '/api/organization', body: { name: 'o' }, spy: () => m.setOrganizationName, reason: OWNER_REASON },
  { name: 'W7 POST agents/startup', method: 'POST', url: '/api/agents/startup', body: {}, spy: () => m.initializeStartup, reason: OWNER_REASON },
  { name: 'W7 POST agents/directory/sync', method: 'POST', url: '/api/agents/directory/sync', body: {}, spy: () => m.syncDirectory, reason: OWNER_REASON },
  { name: 'W7 POST agents/normalize-hosts', method: 'POST', url: '/api/agents/normalize-hosts', body: {}, spy: () => m.normalizeHosts, reason: OWNER_REASON },
  { name: 'W7 POST webhooks/:id/test', method: 'POST', url: '/api/webhooks/w1/test', body: {}, spy: () => m.testWebhookById, reason: OWNER_REASON },
  { name: 'W7 PATCH domains/:id', method: 'PATCH', url: '/api/domains/d1', body: {}, spy: () => m.updateDomainById, reason: OWNER_REASON },
  { name: 'W7 DELETE domains/:id', method: 'DELETE', url: '/api/domains/d1', spy: () => m.deleteDomainById, reason: OWNER_REASON },
  { name: 'W7 POST agents/creation-helper/raw-materials', method: 'POST', url: '/api/agents/creation-helper/raw-materials', body: { materials: [] }, spy: () => m.writeFile, reason: OWNER_REASON },
  { name: 'W4 POST agents/cemetery (revive)', method: 'POST', url: '/api/agents/cemetery', body: { filename: 'ghost-export-2026-01-01T00-00-00.zip' }, spy: () => m.importAgent, reason: 'Only system owner can revive agents' },
]

const CEMETERY_FILE = 'ghost-export-2026-01-01T00-00-00.zip'
const CEMETERY: Array<{ name: string; url: string; leak: string }> = [
  // The list is reachable only because the cemetery routes are registered ABOVE GET agents/:id (whose pattern matches
  // 'cemetery'); the owner POSITIVE CONTROL below fails if they are moved back. The refusal bodies never contain the
  // filename, so `leak` = the archive filename proves nothing was listed.
  { name: 'W4 GET agents/cemetery (list)', url: '/api/agents/cemetery', leak: CEMETERY_FILE },
  { name: 'W4 GET agents/cemetery/download', url: `/api/agents/cemetery/download?file=${CEMETERY_FILE}`, leak: 'ZIPBYTES-MARKER' },
]

beforeEach(async () => {
  for (const f of Object.values(m)) f.mockClear()
  m.modelOn.mockReturnValue(false)
  m.isLockedDown.mockReturnValue(false)
  m.checkAndRecordAttempt.mockReturnValue({ allowed: true, retryAfterMs: 0 })
  m.verifyPassword.mockResolvedValue(true)
  m.createSession.mockResolvedValue('stub-token')
  for (const f of [m.deployConfigToAgent, m.importAgent, m.addTrust, m.removeTrust, m.addAMPAddressToAgent, m.updateAMPAddressOnAgent,
    m.removeAMPAddressFromAgent, m.addEmailAddressToAgent, m.updateEmailAddressOnAgent, m.removeEmailAddressFromAgent, m.addNewHost,
    m.updateExistingHost, m.deleteExistingHost, m.setOrganizationName, m.initializeStartup, m.syncDirectory, m.normalizeHosts,
    m.testWebhookById, m.updateDomainById, m.deleteDomainById, m.createPersona, m.createDockerAgent, m.sendAgentSessionCommand]) {
    f.mockResolvedValue({ data: { ok: true }, status: 200 })
  }
  // these three services are synchronous (the router does not await them)
  for (const f of [m.setOrganizationName, m.updateDomainById, m.deleteDomainById]) f.mockReturnValue({ data: { ok: true }, status: 200 })
  m.CreateAgent.mockResolvedValue({ success: true })
  m.writeFile.mockResolvedValue(undefined)
  m.mkdir.mockResolvedValue(undefined)
  const { mkdirSync, writeFileSync } = await import('node:fs')
  const { join } = await import('node:path')
  mkdirSync(join(tmp.dir, 'cemetery'), { recursive: true })
  writeFileSync(join(tmp.dir, 'cemetery', CEMETERY_FILE), 'ZIPBYTES-MARKER')
})

describe('TRDD-BZW1QAZ5 — agent-authorized headless handlers (twin: authorize())', () => {
  for (const r of AGENT_GATED) {
    it(`${r.name}: a MEMBER agent is refused 403 with the authorize() reason and the service is not called`, async () => {
      /** The audit's exploit: authentication alone let any agent through */
      m.authenticateAgent.mockReturnValue(MEMBER_AUTH)
      const out = await run(r.method, r.url, r.body)
      expect(out.status).toBe(403)
      expect(JSON.parse(text(out)).error).toBe(r.reason)
      expect(r.spy()).not.toHaveBeenCalled()
    })
    it(`${r.name}: POSITIVE CONTROL — a MANAGER agent reaches the service`, async () => {
      /** The gate can say yes, so the refusal above is a decision */
      m.authenticateAgent.mockReturnValue(MANAGER_AUTH)
      const out = await run(r.method, r.url, r.body)
      expect(out.status).toBeLessThan(400)
      expect(r.spy()).toHaveBeenCalledTimes(1)
    })
  }
})

describe('TRDD-BZW1QAZ5 — system-owner-only headless handlers (twin: enforceSystemOwner / hand-rolled agentId check)', () => {
  for (const r of OWNER_ONLY) {
    it(`${r.name}: a MEMBER agent is refused 403 and the service is not called`, async () => {
      /** Any agent identity is refused */
      m.authenticateAgent.mockReturnValue(MEMBER_AUTH)
      const out = await run(r.method, r.url, r.body, r.extraHeaders)
      expect(out.status).toBe(403)
      expect(JSON.parse(text(out)).error).toBe(r.reason)
      expect(r.spy()).not.toHaveBeenCalled()
    })
    it(`${r.name}: a MANAGER agent is refused 403 and the service is not called`, async () => {
      /** Not even the MANAGER title substitutes for the system owner */
      m.authenticateAgent.mockReturnValue(MANAGER_AUTH)
      const out = await run(r.method, r.url, r.body, r.extraHeaders)
      expect(out.status).toBe(403)
      expect(JSON.parse(text(out)).error).toBe(r.reason)
      expect(r.spy()).not.toHaveBeenCalled()
    })
    it(`${r.name}: model ON, a signed-in non-owner user { userId, userTitle: user } is refused 403 and the service is not called`, async () => {
      /** Stricter than a bare `!auth.agentId`: a user session without maestro authority is not the owner */
      m.modelOn.mockReturnValue(true)
      m.authenticateAgent.mockReturnValue(PLAIN_USER)
      const out = await run(r.method, r.url, r.body, r.extraHeaders)
      expect(out.status).toBe(403)
      expect(JSON.parse(text(out)).error).toBe(r.reason)
      expect(r.spy()).not.toHaveBeenCalled()
    })
    it(`${r.name}: POSITIVE CONTROL — the system owner shape {} reaches the service`, async () => {
      /** The gate can say yes */
      m.authenticateAgent.mockReturnValue(OWNER)
      const out = await run(r.method, r.url, r.body, r.extraHeaders)
      expect(out.status).toBeLessThan(400)
      expect(r.spy()).toHaveBeenCalled()
    })
  }

  for (const c of CEMETERY) {
    it(`${c.name}: a MEMBER agent is refused 403 and nothing from the cemetery is returned`, async () => {
      /** The archive holds the deleted agent's keys */
      m.authenticateAgent.mockReturnValue(MEMBER_AUTH)
      const out = await run('GET', c.url)
      expect(out.status).toBe(403)
      expect(JSON.parse(text(out)).error).toBe(CEMETERY_REASON)
      expect(text(out)).not.toContain(c.leak)
    })
    it(`${c.name}: a MANAGER agent is refused 403 and nothing from the cemetery is returned`, async () => {
      /** Owner only, whatever the title */
      m.authenticateAgent.mockReturnValue(MANAGER_AUTH)
      const out = await run('GET', c.url)
      expect(out.status).toBe(403)
      expect(JSON.parse(text(out)).error).toBe(CEMETERY_REASON)
      expect(text(out)).not.toContain(c.leak)
    })
    it(`${c.name}: model ON, a non-owner user is refused 403 and nothing from the cemetery is returned`, async () => {
      /** Stricter than the twin's `if (auth.agentId)` */
      m.modelOn.mockReturnValue(true)
      m.authenticateAgent.mockReturnValue(PLAIN_USER)
      const out = await run('GET', c.url)
      expect(out.status).toBe(403)
      expect(JSON.parse(text(out)).error).toBe(CEMETERY_REASON)
      expect(text(out)).not.toContain(c.leak)
    })
    it(`${c.name}: POSITIVE CONTROL — the system owner receives the cemetery content`, async () => {
      /** The gate can say yes */
      m.authenticateAgent.mockReturnValue(OWNER)
      const out = await run('GET', c.url)
      expect(out.status).toBe(200)
      expect(text(out)).toContain(c.leak)
    })
  }
})

describe('TRDD-BZW1QAZ5 W4 — DELETE agents/cemetery (purge) is system-owner only (twin: if (auth.agentId); headless is stricter)', () => {
  const PURGE_REASON = 'Only system owner can purge archives'
  const purge = () => run('DELETE', '/api/agents/cemetery', { filename: CEMETERY_FILE })
  const archiveExists = async () => (await import('node:fs')).existsSync((tmp.dir + '/cemetery/' + CEMETERY_FILE))
  it('a MEMBER agent is refused 403 and the archive is not removed', async () => {
    /** Any agent identity is refused */
    m.authenticateAgent.mockReturnValue(MEMBER_AUTH)
    const out = await purge()
    expect(out.status).toBe(403)
    expect(JSON.parse(text(out)).error).toBe(PURGE_REASON)
    expect(await archiveExists()).toBe(true)
  })
  it('a MANAGER agent is refused 403 and the archive is not removed', async () => {
    /** Owner only, whatever the title */
    m.authenticateAgent.mockReturnValue(MANAGER_AUTH)
    const out = await purge()
    expect(out.status).toBe(403)
    expect(JSON.parse(text(out)).error).toBe(PURGE_REASON)
    expect(await archiveExists()).toBe(true)
  })
  it('model ON, a signed-in non-owner user is refused 403 and the archive is not removed', async () => {
    /** Stricter than a bare `!auth.agentId`: this case reaches the unlink if the check regresses to it */
    m.modelOn.mockReturnValue(true)
    m.authenticateAgent.mockReturnValue(PLAIN_USER)
    const out = await purge()
    expect(out.status).toBe(403)
    expect(JSON.parse(text(out)).error).toBe(PURGE_REASON)
    expect(await archiveExists()).toBe(true)
  })
  it('POSITIVE CONTROL — the system owner purges the archive', async () => {
    /** The gate can say yes */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await purge()
    expect(out.status).toBe(200)
    expect(JSON.parse(text(out)).purged).toBe(CEMETERY_FILE)
    expect(await archiveExists()).toBe(false)
  })
})

describe('TRDD-BZW1QAZ5 W9 — GET agents/:id/messages passes the caller context (twin: requireAuth + auth.context)', () => {
  it('a MEMBER reading its OWN mailbox succeeds and the service receives its context', async () => {
    /** The fix must not break the legitimate read */
    m.authenticateAgent.mockReturnValue(MEMBER_AUTH)
    const out = await run('GET', `/api/agents/${MEMBER}/messages?box=inbox`)
    expect(out.status).toBe(200)
    expect(m.listMessages).toHaveBeenCalledTimes(1)
    expect(m.listMessages.mock.calls[0][2]).toMatchObject({ agentId: MEMBER, isSystemOwner: false })
  })
  it('a MEMBER reading ANOTHER agent mailbox is refused 403 by the real service denial', async () => {
    /** Before the fix no context was passed and the read was unchecked */
    m.authenticateAgent.mockReturnValue(MEMBER_AUTH)
    const out = await run('GET', `/api/agents/${TARGET}/messages?box=inbox`)
    expect(out.status).toBe(403)
    expect(JSON.parse(text(out)).error).toBe('Forbidden — you may only access your own mailbox')
  })
  it('even a MANAGER agent is refused 403 on a foreign mailbox', async () => {
    /** Own-mailbox-only applies to every agent title */
    m.authenticateAgent.mockReturnValue(MANAGER_AUTH)
    const out = await run('GET', `/api/agents/${TARGET}/messages?box=inbox`)
    expect(out.status).toBe(403)
    expect(JSON.parse(text(out)).error).toBe('Forbidden — you may only access your own mailbox')
  })
  it('model ON, a non-owner user is refused 403 on any mailbox', async () => {
    /** A user session without maestro authority has no mailbox */
    m.modelOn.mockReturnValue(true)
    m.authenticateAgent.mockReturnValue(PLAIN_USER)
    const out = await run('GET', `/api/agents/${TARGET}/messages?box=inbox`)
    expect(out.status).toBe(403)
    expect(JSON.parse(text(out)).error).toBe('Forbidden — you may only access your own mailbox')
  })
  it('POSITIVE CONTROL — the system owner may read any mailbox', async () => {
    /** The gate can say yes */
    m.authenticateAgent.mockReturnValue(OWNER)
    const out = await run('GET', `/api/agents/${TARGET}/messages?box=inbox`)
    expect(out.status).toBe(200)
    expect(m.listMessages.mock.calls[0][2]).toMatchObject({ isSystemOwner: true })
  })
})

describe('TRDD-BZW1QAZ5 W2 — PATCH agents/:id/session builds the service params explicitly', () => {
  it("a MANAGER's authAction 'unblock-prompt' and extra fields are NOT forwarded", async () => {
    /** The caller must not choose the authorize() row the service evaluates */
    m.authenticateAgent.mockReturnValue(MANAGER_AUTH)
    await run('PATCH', `/api/agents/${TARGET}/session`, { command: 'x', authAction: 'unblock-prompt', evil: 1 })
    expect(m.sendAgentSessionCommand).toHaveBeenCalledTimes(1)
    const params = m.sendAgentSessionCommand.mock.calls[0][1]
    expect(Object.keys(params).sort()).toEqual(['addNewline', 'command', 'requireIdle'])
    expect(params.command).toBe('x')
    expect(params.authAction).toBeUndefined()
  })
  it("a MANAGER's authAction 'view-agent' is NOT forwarded", async () => {
    /** The R42 re-opening vector named in the audit */
    m.authenticateAgent.mockReturnValue(MANAGER_AUTH)
    await run('PATCH', `/api/agents/${TARGET}/session`, { command: 'x', authAction: 'view-agent' })
    expect(m.sendAgentSessionCommand.mock.calls[0][1].authAction).toBeUndefined()
  })
  it('an agent sending a command to ITSELF reaches the service with exactly { command, requireIdle, addNewline }', async () => {
    /** The legitimate path is unchanged */
    m.authenticateAgent.mockReturnValue(MEMBER_AUTH)
    await run('PATCH', `/api/agents/${MEMBER}/session`, { command: 'ls', requireIdle: false, addNewline: true })
    expect(m.sendAgentSessionCommand.mock.calls[0][0]).toBe(MEMBER)
    expect(m.sendAgentSessionCommand.mock.calls[0][1]).toStrictEqual({ command: 'ls', requireIdle: false, addNewline: true })
    expect(m.sendAgentSessionCommand.mock.calls[0][2]).toMatchObject({ agentId: MEMBER })
  })
})

describe('TRDD-BZW1QAZ5 W8 — POST auth/login lockdown and rate limit (twin: app/api/auth/login/route.ts)', () => {
  const login = (headers: Record<string, string> = { 'x-forwarded-for': '9.9.9.9' }) => run('POST', '/api/auth/login', { password: 'stub' }, headers)
  it('during lockdown login is refused 503 and the password is not checked', async () => {
    /** Kill-switch parity */
    m.isLockedDown.mockReturnValue(true)
    const out = await login()
    expect(out.status).toBe(503)
    expect(JSON.parse(text(out)).error).toBe('System is in emergency lockdown. Try again later.')
    expect(m.verifyPassword).not.toHaveBeenCalled()
  })
  it('a per-source limit hit is refused 429 and the password is not checked', async () => {
    /** The unlimited-guessing hole */
    m.checkAndRecordAttempt.mockReturnValue({ allowed: false, retryAfterMs: 1000 })
    const out = await login()
    expect(out.status).toBe(429)
    expect(JSON.parse(text(out)).error).toBe('Too many login attempts. Try again later.')
    expect(m.checkAndRecordAttempt).toHaveBeenCalledWith('auth-login:9.9.9.9')
    expect(m.verifyPassword).not.toHaveBeenCalled()
  })
  it('a global limit hit is refused 429 and the password is not checked', async () => {
    /** An IPv6-rotation attacker still hits the host-wide cap */
    m.checkAndRecordAttempt.mockImplementation((key: string) => ({ allowed: key !== 'auth-login:global', retryAfterMs: 0 }))
    const out = await login()
    expect(out.status).toBe(429)
    expect(m.checkAndRecordAttempt).toHaveBeenCalledWith('auth-login:global', 200)
    expect(m.verifyPassword).not.toHaveBeenCalled()
  })
  it('POSITIVE CONTROL — a correct password logs in 200 and resets only the per-source bucket', async () => {
    /** The gate can say yes */
    const out = await login()
    expect(out.status).toBe(200)
    expect(m.verifyPassword).toHaveBeenCalledWith('stub')
    expect(m.resetRateLimit).toHaveBeenCalledTimes(1)
    expect(m.resetRateLimit).toHaveBeenCalledWith('auth-login:9.9.9.9')
  })
  it('a wrong password is refused 401 and does not reset the counter', async () => {
    /** Failures keep accumulating */
    m.verifyPassword.mockResolvedValue(false)
    const out = await login()
    expect(out.status).toBe(401)
    expect(m.resetRateLimit).not.toHaveBeenCalled()
  })
})
