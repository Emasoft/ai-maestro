import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * TRDD-BZW1QAZ5 — the full-mode cemetery handlers (POST revive, DELETE purge) call the route module directly with a
 * NextRequest. Only the identity seam, the sudo-token verifier, the user-authority flag and the state dir are replaced;
 * the REAL sudo guard and the REAL buildAuthContext run.
 *
 * WHICH GATE REFUSES WHAT: the sudo guard runs BEFORE the handler, and with the model ON it sends a non-owner user to
 * decideAidTitle, which refuses a plain `user` for delete-agent. The handler's own owner check is therefore NOT
 * reachable for a model-ON non-owner user without mocking the guard itself — so the model-ON user test below asserts the
 * end-to-end refusal and names the guard as the refuser. It does NOT pin the handler's `buildAuthContext(auth)
 * .isSystemOwner` check; restoring `if (auth.agentId)` leaves it green. The handler's own check is pinned for agents.
 */
const m = vi.hoisted(() => ({ auth: vi.fn() as import('vitest').Mock<(...a: any[]) => any>, modelOn: vi.fn(() => false) }))
const tmp = vi.hoisted(() => {
  const fs = require('node:fs'); const os = require('node:os'); const p = require('node:path')
  return { dir: fs.realpathSync(fs.mkdtempSync(p.join(os.tmpdir(), 'cem-owner-'))) as string }
})

vi.mock('../../lib/sudo-auth', async (orig) => {
  const actual = await orig<typeof import('../../lib/sudo-auth')>()
  return { ...actual, verifyAndConsumeSudoToken: (t: string | null, ...r: never[]) => t === 'good-token' ? { ok: true } : (actual.verifyAndConsumeSudoToken as (...a: unknown[]) => unknown)(t, ...r) }
})
vi.mock('../../lib/agent-registry', async (orig) => ({ ...(await orig<object>()), listAgents: () => [] }))
vi.mock('../../lib/agent-auth', async (orig) => {
  const actual = await orig<typeof import('../../lib/agent-auth')>()
  return { ...actual, authenticateFromRequest: (r: NextRequest) => m.auth(r) }
})
vi.mock('../../lib/governance', async (orig) => ({ ...(await orig<object>()), isUserAuthorityModelEnabled: () => m.modelOn() }))
vi.mock('../../lib/ecosystem-constants', async (orig) => {
  const actual = await orig<typeof import('../../lib/ecosystem-constants')>()
  const { join } = await import('node:path')
  return { ...actual, statePath: (...p: string[]) => join(tmp.dir, ...p) }
})

import { GET as LIST, POST, DELETE } from '@/app/api/agents/cemetery/route'
import { GET as DOWNLOAD } from '@/app/api/agents/cemetery/download/route'

const FILE = 'ghost-export-2026-01-01T00-00-00.zip'
const OWNER = {}
const MANAGER = { agentId: '11111111-1111-4111-8111-111111111111', governanceTitle: 'manager' }
const PLAIN_USER = { userId: 'user-plain', userTitle: 'user' }

const call = (fn: typeof POST, method: string, body: object) =>
  fn(new NextRequest('http://localhost/api/agents/cemetery', {
    method, body: JSON.stringify(body), headers: { 'content-type': 'application/json', 'x-sudo-token': 'good-token' },
  }))

beforeEach(async () => {
  m.auth.mockReset(); m.modelOn.mockReset(); m.modelOn.mockReturnValue(false)
  const { mkdirSync, writeFileSync } = await import('node:fs')
  mkdirSync(tmp.dir + '/cemetery', { recursive: true })
  writeFileSync(tmp.dir + '/cemetery/' + FILE, 'ZIPBYTES-MARKER')
})
const archiveExists = async () => (await import('node:fs')).existsSync(tmp.dir + '/cemetery/' + FILE)

describe('cemetery POST/DELETE owner check', () => {
  it('POSITIVE CONTROL — the owner purges the archive (DELETE 200)', async () => {
    m.auth.mockReturnValue(OWNER)
    const res = await call(DELETE as never, 'DELETE', { filename: FILE })
    expect(res.status).toBe(200)
    expect(await archiveExists()).toBe(false)
  })
  it('POSITIVE CONTROL — the owner passes the revive owner check (POST reaches body validation, 400)', async () => {
    m.auth.mockReturnValue(OWNER)
    const res = await call(POST as never, 'POST', {})
    expect(res.status).toBe(400)
    expect((await res.json()).error).toBe('filename is required')
  })
  it('an agent is refused by the handler\'s own check on DELETE (guard title gate passes a manager) and the archive survives', async () => {
    m.auth.mockReturnValue(MANAGER)
    const res = await call(DELETE as never, 'DELETE', { filename: FILE })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Only the system owner can purge cemetery archives')
    expect(await archiveExists()).toBe(true)
  })
  it('an agent is refused by the handler\'s own check on POST', async () => {
    m.auth.mockReturnValue(MANAGER)
    const res = await call(POST as never, 'POST', { filename: FILE })
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe('Only the system owner can revive agents')
  })
  it('model ON: a signed-in non-owner user is refused 403 END-TO-END by the SUDO GUARD (aid_title_forbidden), not the handler check', async () => {
    m.modelOn.mockReturnValue(true)
    m.auth.mockReturnValue(PLAIN_USER)
    const del = await call(DELETE as never, 'DELETE', { filename: FILE })
    expect(del.status).toBe(403)
    expect((await del.json()).error).toBe('aid_title_forbidden')
    expect(await archiveExists()).toBe(true)
    const post = await call(POST as never, 'POST', { filename: FILE })
    expect(post.status).toBe(403)
    expect((await post.json()).error).toBe('aid_title_forbidden')
  })
})

/**
 * GET (list) and download are NOT sudo-strict (security-registry.json), so the handler's own owner check is their ONLY
 * gate and these tests pin it directly. NOTE: the POST/DELETE handler checks above remain un-isolatable from the sudo
 * guard for a model-ON non-owner user; only these two handlers are pinned for that case.
 */
const OWNER_ON = { userId: 'user-owner', userTitle: 'maestro' }
const ERR = 'Only the system owner can access cemetery archives'
const get = (fn: typeof LIST, url: string) => fn(new NextRequest(url))
const list = () => get(LIST, 'http://localhost/api/agents/cemetery')
const download = () => get(DOWNLOAD as never, 'http://localhost/api/agents/cemetery/download?file=' + FILE)

describe('cemetery GET list owner check', () => {
  it('POSITIVE CONTROL — model ON, the maestro owner lists the archive (200)', async () => {
    m.modelOn.mockReturnValue(true); m.auth.mockReturnValue(OWNER_ON)
    const res = await list()
    expect(res.status).toBe(200)
    expect((await res.json()).archives.map((a: { filename: string }) => a.filename)).toContain(FILE)
  })
  it('model ON: a signed-in non-owner user is refused 403 by the handler (no sudo guard on GET)', async () => {
    m.modelOn.mockReturnValue(true); m.auth.mockReturnValue(PLAIN_USER)
    const res = await list()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe(ERR)
  })
  it('an agent (manager) is refused 403', async () => {
    m.auth.mockReturnValue(MANAGER)
    const res = await list()
    expect(res.status).toBe(403)
    expect((await res.json()).error).toBe(ERR)
  })
  it('model OFF: a plain user is unchanged (200)', async () => {
    m.auth.mockReturnValue(PLAIN_USER)
    expect((await list()).status).toBe(200)
  })
})

describe('cemetery download owner check', () => {
  it('POSITIVE CONTROL — model ON, the maestro owner downloads the archive bytes (200)', async () => {
    m.modelOn.mockReturnValue(true); m.auth.mockReturnValue(OWNER_ON)
    const res = await download()
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('ZIPBYTES-MARKER')
  })
  it('model ON: a signed-in non-owner user is refused 403 and no archive bytes are returned', async () => {
    m.modelOn.mockReturnValue(true); m.auth.mockReturnValue(PLAIN_USER)
    const res = await download()
    expect(res.status).toBe(403)
    const text = await res.text()
    expect(JSON.parse(text).error).toBe(ERR)
    expect(text).not.toContain('ZIPBYTES-MARKER')
  })
  it('an agent (manager) is refused 403 and no archive bytes are returned', async () => {
    m.auth.mockReturnValue(MANAGER)
    const res = await download()
    expect(res.status).toBe(403)
    expect(await res.text()).not.toContain('ZIPBYTES-MARKER')
  })
  it('model OFF: a plain user is unchanged (200, archive bytes)', async () => {
    m.auth.mockReturnValue(PLAIN_USER)
    const res = await download()
    expect(res.status).toBe(200)
    expect(Buffer.from(await res.arrayBuffer()).toString()).toBe('ZIPBYTES-MARKER')
  })
})
