/**
 * ai-maestro#168 — the identity grammar of a TRDD's identity fields, and who may be written
 * into them. Owner ruling 2026-09-24, verbatim: "author can only be a main agent from a
 * specific project folder, or the user (rare, the user delegate the writing of trdd to the
 * main agent usually), or (when inside the ai-maestro harness) an agent with a specific name
 * and id."
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const BOB_ID = '44444444-4444-4444-8444-444444444444'
const USER_NAMED_AGENT_ID = '55555555-5555-4555-8555-555555555555'

// resolveActor/trddActorIdentity read the registry through this module. `bob` is a normal
// agent; one agent is literally NAMED `user`, to prove the grammar — not a name lookup —
// decides that `user` is the human owner.
vi.mock('@/lib/agent-registry', () => ({
  getAgent: (id: string) =>
    id === BOB_ID ? { id: BOB_ID, name: 'bob' } : id === USER_NAMED_AGENT_ID ? { id: USER_NAMED_AGENT_ID, name: 'user' } : null,
  getAgentByNameAnyHost: (name: string) =>
    name === 'bob' ? { id: BOB_ID, name: 'bob' } : name === 'user' ? { id: USER_NAMED_AGENT_ID, name: 'user' } : null,
}))
vi.mock('@/lib/team-registry', () => ({ loadTeams: () => [] }))

import { parseTrddIdentity, formatTrddIdentity } from '@/lib/trdd-vocabulary'
import { resolveCliIdentity } from '@/lib/trdd-identity'
import { generateSessionSecret } from '@/lib/session-secret'
import { withAuthorizedTrdd, trddActorIdentity } from '@/lib/trdd-authz'
import type { AgentAuthResult } from '@/lib/agent-auth'

describe('parseTrddIdentity — the three forms, and nothing else', () => {
  it('parses user, main-agent@<project-id> and <name>#<uuid> (uuid normalised to lowercase)', () => {
    expect(parseTrddIdentity('user')).toEqual({ kind: 'user' })
    expect(parseTrddIdentity('main-agent@ai-maestro')).toEqual({ kind: 'main-agent', projectId: 'ai-maestro' })
    expect(parseTrddIdentity(`_aim-helper#${BOB_ID.toUpperCase()}`)).toEqual({ kind: 'agent', name: '_aim-helper', uuid: BOB_ID })
    expect(formatTrddIdentity(parseTrddIdentity(`bob#${BOB_ID}`)!)).toBe(`bob#${BOB_ID}`)
  })

  it('rejects session labels, OS logins, bare names, bare uuids and injection shapes', () => {
    for (const v of ['ai-maestro-main-session', 'someuser', 'bob', BOB_ID, 'main-agent@', 'bob#not-a-uuid',
      `bob#${BOB_ID}\napproved: true`, 'main-agent@a:b', 'User', '']) {
      expect(parseTrddIdentity(v)).toBeNull()
    }
  })
})

describe('resolveCliIdentity — explicit flag, then AID, then the registry-gated default, else refuse', () => {
  let home: string
  let registryFile: string
  beforeEach(() => {
    home = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-identity-'))
    registryFile = path.join(home, 'registry.json')
  })
  afterEach(() => fs.rmSync(home, { recursive: true, force: true }))
  const base = { flag: '--author', projectId: 'proj' as string | null, env: { USER: 'os-login-sentinel' } as Record<string, string | undefined> }

  it('an explicit value is validated: a grammar value passes, anything else is refused', () => {
    expect(resolveCliIdentity({ ...base, explicit: `bob#${BOB_ID}`, registryFile })).toEqual({ ok: true, identity: `bob#${BOB_ID}`, source: 'flag' })
    const bad = resolveCliIdentity({ ...base, explicit: 'probe', registryFile })
    expect(bad.ok).toBe(false)
    expect(!bad.ok && bad.error).toMatch(/is not an identity/)
  })

  it('no registry on the machine → main-agent@<project-id>, never the OS login', () => {
    const r = resolveCliIdentity({ ...base, registryFile })
    expect(r).toEqual({ ok: true, identity: 'main-agent@proj', source: 'default' })
  })

  it('no registry and no project-id → refused (no identity can be derived)', () => {
    const r = resolveCliIdentity({ ...base, projectId: null, registryFile })
    expect(r.ok).toBe(false)
  })

  it('a NON-EMPTY registry and no resolvable AID → refused, never defaulted', () => {
    fs.writeFileSync(registryFile, JSON.stringify([{ id: BOB_ID, name: 'bob' }]))
    const r = resolveCliIdentity({ ...base, registryFile })
    expect(r.ok).toBe(false)
    expect(!r.ok && r.error).toMatch(/refusing to guess/)
  })

  it('an UNREADABLE registry counts as present (fail closed) — refused', () => {
    fs.writeFileSync(registryFile, '{ not json')
    expect(resolveCliIdentity({ ...base, registryFile }).ok).toBe(false)
  })

  it('a readable EMPTY registry means no harness here → the default applies', () => {
    fs.writeFileSync(registryFile, '[]')
    expect(resolveCliIdentity({ ...base, registryFile })).toMatchObject({ ok: true, identity: 'main-agent@proj' })
  })

  it('AID_AUTH resolves to <name>#<uuid> of the agent whose session secret it is', () => {
    const { secret, secretHash } = generateSessionSecret()
    fs.writeFileSync(registryFile, JSON.stringify([
      { id: '66666666-6666-4666-8666-666666666666', name: 'other', metadata: { sessionSecretHash: generateSessionSecret().secretHash } },
      { id: BOB_ID, name: 'bob', metadata: { sessionSecretHash: secretHash } },
    ]))
    const r = resolveCliIdentity({ ...base, env: { AID_AUTH: secret }, registryFile })
    expect(r).toEqual({ ok: true, identity: `bob#${BOB_ID}`, source: 'aid' })
  })

  it('an AID that matches no live agent does not resolve — and on a harness machine that is a refusal', () => {
    const { secret, secretHash } = generateSessionSecret()
    fs.writeFileSync(registryFile, JSON.stringify([
      { id: BOB_ID, name: 'bob', deletedAt: '2026-01-01T00:00:00Z', metadata: { sessionSecretHash: secretHash } },
    ]))
    expect(resolveCliIdentity({ ...base, env: { AID_AUTH: secret }, registryFile }).ok).toBe(false)
  })

  it('an explicit main-agent@X must name the PRRD project-id, compared exactly (both values named on refusal)', () => {
    const other = resolveCliIdentity({ ...base, explicit: 'main-agent@Other', registryFile })
    expect(other.ok).toBe(false)
    expect(!other.ok && other.error).toMatch(/"Other".*"proj"/)
    // case-sensitive: `Proj` is not `proj`
    expect(resolveCliIdentity({ ...base, explicit: 'main-agent@Proj', registryFile }).ok).toBe(false)
    // positive control: the corpus's own id passes
    expect(resolveCliIdentity({ ...base, explicit: 'main-agent@proj', registryFile }))
      .toEqual({ ok: true, identity: 'main-agent@proj', source: 'flag' })
  })

  it('with NO PRRD project-id any well-formed main-agent@X is still accepted (interim rule, open on #168)', () => {
    expect(resolveCliIdentity({ ...base, projectId: null, explicit: 'main-agent@Other', registryFile }))
      .toEqual({ ok: true, identity: 'main-agent@Other', source: 'flag' })
  })

  it('on a harness machine, "no AID_AUTH" and "AID_AUTH set but unresolvable" are different refusals that never print the token', () => {
    fs.writeFileSync(registryFile, JSON.stringify([{ id: BOB_ID, name: 'bob', metadata: { sessionSecretHash: generateSessionSecret().secretHash } }]))
    const none = resolveCliIdentity({ ...base, registryFile })
    expect(!none.ok && none.error).toMatch(/no --author given and no AID_AUTH set/)
    const { secret } = generateSessionSecret()
    const stale = resolveCliIdentity({ ...base, env: { AID_AUTH: secret }, registryFile })
    expect(!stale.ok && stale.error).toMatch(/AID_AUTH is set but does not resolve to a registered agent \(stale or invalid token\)/)
    expect(!stale.ok && stale.error).not.toMatch(/no AID_AUTH set/)
    expect(!stale.ok && stale.error).not.toContain(secret)
    expect(!stale.ok && stale.error).not.toContain(secret.slice(4, 12)) // past the fixed `mst_` prefix
  })

  it('a token that matches no registry secret never leaks any 8-char window of itself into the refusal', () => {
    // A distinctive fake AID_AUTH — real shape (mst_ + 64 hex), but hashes to nothing any
    // seeded row carries, so it takes the "stale or invalid token" branch.
    const fake = 'mst_' + 'a1c9f7'.repeat(11) // 66 hex-ish chars, well past TOKEN_RANDOM_BYTES*2
    fs.writeFileSync(registryFile, JSON.stringify([
      { id: BOB_ID, name: 'bob', metadata: { sessionSecretHash: generateSessionSecret().secretHash } },
    ]))
    const r = resolveCliIdentity({ ...base, env: { AID_AUTH: fake }, registryFile })
    expect(r.ok).toBe(false)
    const msg = !r.ok ? r.error : ''
    // Every 8-char sliding window of the token — not just the whole token — must be absent.
    for (let i = 0; i + 8 <= fake.length; i++) {
      expect(msg).not.toContain(fake.slice(i, i + 8))
    }
  })
})

describe('resolveActor — owner rights follow the grammar (via the real withAuthorizedTrdd)', () => {
  let dir: string
  const card = (id: string, assignee: string) => [
    '---', `trdd-id: ${id}`, 'status: tasked', 'title: identity fixture', 'column: dev',
    `assignee: ${assignee}`, 'created-by: main-agent@fixture', 'min-approval-requirement: none',
    'created: 2026-01-01T00:00:00+0100', 'updated: 2026-01-01T00:00:00+0100', '---', '', `# TRDD-${id}`, '',
  ].join('\n')
  const seed = (id: string, assignee: string) =>
    fs.writeFileSync(path.join(dir, 'tasks', `TRDD-20260101_000000+0100-${id}-x.md`), card(id, assignee))
  const BOB: AgentAuthResult = { agentId: BOB_ID, governanceTitle: 'member' }
  const USER_NAMED: AgentAuthResult = { agentId: USER_NAMED_AGENT_ID, governanceTitle: 'member' }
  const allowed = async (who: AgentAuthResult, id: string) =>
    (await withAuthorizedTrdd(who, dir, id, 'archive', () => 'ok')).denied === null

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'trdd-identity-authz-'))
    for (const z of ['proposals', 'tasks', 'archived']) fs.mkdirSync(path.join(dir, z), { recursive: true })
  })
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

  it('<name>#<uuid> resolves: its agent is the owner', async () => {
    seed('IDNAME01', `bob#${BOB_ID}`)
    expect(await allowed(BOB, 'IDNAME01')).toBe(true)
  })

  it('a STALE name resolves by the uuid (names can be reused; ids cannot) and the mismatch is reported', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    seed('IDSTALE1', `robert#${BOB_ID}`)
    expect(await allowed(BOB, 'IDSTALE1')).toBe(true)
    expect(warn.mock.calls.some((c) => String(c[0]).includes('resolving by id'))).toBe(true)
    warn.mockRestore()
  })

  it('`user` is the human owner, NEVER an agent — not even one registered under the name "user"', async () => {
    seed('IDUSER01', 'user')
    expect(await allowed(USER_NAMED, 'IDUSER01')).toBe(false)
  })

  it('`main-agent@…` resolves to no agent', async () => {
    seed('IDMAIN01', 'main-agent@fixture')
    expect(await allowed(BOB, 'IDMAIN01')).toBe(false)
  })

  it('LEGACY values stay readable: a bare registered name still resolves; a session label does not', async () => {
    seed('IDLEGAC1', 'bob')
    seed('IDLEGAC2', 'ai-maestro-main-session')
    expect(await allowed(BOB, 'IDLEGAC1')).toBe(true)
    expect(await allowed(BOB, 'IDLEGAC2')).toBe(false)
  })
})

describe('trddActorIdentity — the ONE identity every API write records', () => {
  it('an agent → <name>#<uuid>; the human owner → user; an unnameable id → throws, never a half-identity', () => {
    expect(trddActorIdentity(BOB_ID)).toBe(`bob#${BOB_ID}`)
    expect(trddActorIdentity(null)).toBe('user')
    expect(trddActorIdentity(undefined)).toBe('user')
    expect(() => trddActorIdentity('77777777-7777-4777-8777-777777777777')).toThrow(/no registry name/)
  })
})
