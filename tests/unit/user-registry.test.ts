/**
 * R36/R37/R38 — user-registry unit tests.
 *
 * Covers the registry invariants that the comm-graph + delegate-handoff depend
 * on:
 *   - getActiveMaestroUserId(): delegate SUSPENDS the maestro (R37.2) — returns
 *     the delegate's id when a delegate exists, else the maestro's.
 *   - R39.6 ASSISTANT cascade soft-delete: deleting a USER soft-deletes its
 *     bound ASSISTANT (and only when one is bound).
 *   - R34 ledger: every mutation appends to the users ledger.
 *
 * The registry uses REAL fs + file-lock + SignedLedger; only the environment
 * edges are isolated:
 *   - os.homedir() → a temp dir (so writes land in a sandbox, not ~/.aimaestro),
 *   - host keys are auto-created in that sandbox so the ledger can sign,
 *   - the agent-registry runtime `require` in softDeleteUser() is redirected to
 *     a .cjs stub (vi.mock can't intercept a runtime require — see the stub).
 *
 * Note: the user-authority MODEL FLAG is irrelevant to the registry itself —
 * the registry is pure storage. The flag only gates whether the migration
 * POPULATES it (tested in governance) and whether callers CONSULT it. Here we
 * drive records directly, exercising both "no delegate" and "delegate present"
 * states.
 */
import { describe, it, expect, beforeAll, afterAll, beforeEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { Module } from 'module'
import { v4 as uuidv4 } from 'uuid'

// ── Isolation: os.homedir() → temp dir BEFORE any real module loads ──────────
// user-registry captures AIMAESTRO_DIR = getStateDir() at module-load, so the
// homedir mock MUST be hoisted above the import (vi.mock is hoisted).
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-user-registry-'))
import { vi } from 'vitest'
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => TMP_HOME }, homedir: () => TMP_HOME }
})

// ── Redirect the runtime require('./agent-registry') in softDeleteUser to a stub.
// The require is resolved relative to lib/, so the resolved specifier ends with
// 'agent-registry'. Match the common shapes Node may present.
const AGENT_STUB = path.join(__dirname, '__user_registry_stubs__', 'agent-registry.cjs')
const _origResolve = (Module as unknown as { _resolveFilename: (...a: unknown[]) => string })._resolveFilename
;(Module as unknown as { _resolveFilename: (req: string, ...rest: unknown[]) => string })._resolveFilename = function (
  this: unknown,
  request: string,
  ...rest: unknown[]
) {
  if (request === './agent-registry' || request === '@/lib/agent-registry' || request.endsWith('/lib/agent-registry')) {
    return AGENT_STUB
  }
  return _origResolve.call(this, request, ...rest)
}
const agentStub = require('@/lib/agent-registry') as {
  __getDeletedIds: () => { id: string; hard: boolean }[]
  __reset: () => void
  __setThrowOnDelete: (v: boolean) => void
}

type RegistryModule = typeof import('@/lib/user-registry')
type UserRecord = import('@/types/user').UserRecord
let reg: RegistryModule

function makeUser(over: Partial<UserRecord> = {}): UserRecord {
  const now = new Date().toISOString()
  return {
    id: uuidv4(),
    aid: '',
    name: 'u-' + Math.random().toString(36).slice(2, 8),
    title: 'user',
    native: true,
    passwordHash: 'argon2$stub',
    passwordSetAt: now,
    assistantAgentId: null,
    createdAt: now,
    ...over,
  }
}

beforeAll(async () => {
  // Auto-create host keys in the sandbox so SignedLedger.append can sign.
  const hostKeys = await import('@/lib/host-keys')
  hostKeys.getOrCreateHostKeyPair()
  reg = await import('@/lib/user-registry')
})

afterAll(() => {
  ;(Module as unknown as { _resolveFilename: typeof _origResolve })._resolveFilename = _origResolve
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

beforeEach(() => {
  agentStub.__reset()
  // Wipe the users file + ledger between tests for isolation.
  const dir = path.join(TMP_HOME, '.aimaestro')
  for (const f of ['users.json', 'users.ledger.json']) {
    const p = path.join(dir, f)
    if (fs.existsSync(p)) fs.rmSync(p, { force: true })
  }
})

describe('getActiveMaestroUserId — R37.2 delegate suspends maestro', () => {
  it('returns the maestro id when no delegate exists', async () => {
    const maestro = makeUser({ title: 'maestro' })
    await reg.saveUser(maestro)
    await reg.saveUser(makeUser({ title: 'user' }))
    expect(reg.getActiveMaestroUserId()).toBe(maestro.id)
    expect(reg.getMaestroUserId()).toBe(maestro.id)
    expect(reg.getMaestroDelegateUserId()).toBeNull()
  })

  it('returns the DELEGATE id when a delegate exists (maestro suspended)', async () => {
    const maestro = makeUser({ title: 'maestro' })
    const delegate = makeUser({ title: 'maestro-delegate' })
    await reg.saveUser(maestro)
    await reg.saveUser(delegate)
    // The delegate is the ACTIVE maestro; the maestro id is still resolvable.
    expect(reg.getActiveMaestroUserId()).toBe(delegate.id)
    expect(reg.getMaestroDelegateUserId()).toBe(delegate.id)
    expect(reg.getMaestroUserId()).toBe(maestro.id)
  })

  it('returns null when neither a maestro nor a delegate exists', async () => {
    await reg.saveUser(makeUser({ title: 'user' }))
    expect(reg.getActiveMaestroUserId()).toBeNull()
  })

  it('ignores soft-deleted maestro/delegate records', async () => {
    const maestro = makeUser({ title: 'maestro' })
    await reg.saveUser(maestro)
    await reg.saveUser({ ...maestro, deletedAt: new Date().toISOString() })
    expect(reg.getActiveMaestroUserId()).toBeNull()
  })
})

describe('R39.6 — ASSISTANT cascade soft-delete', () => {
  it('soft-deletes the bound ASSISTANT when the user is deleted', async () => {
    const u = makeUser({ assistantAgentId: 'assistant-agent-1' })
    await reg.saveUser(u)
    const res = await reg.softDeleteUser(u.id)
    expect(res?.deletedAt).toBeTruthy()
    // R39.6: the bound ASSISTANT got a (soft) delete (hard=false).
    const deleted = agentStub.__getDeletedIds()
    expect(deleted).toContainEqual({ id: 'assistant-agent-1', hard: false })
  })

  it('does NOT attempt an ASSISTANT delete when the user has no ASSISTANT', async () => {
    const u = makeUser({ assistantAgentId: null })
    await reg.saveUser(u)
    await reg.softDeleteUser(u.id)
    expect(agentStub.__getDeletedIds()).toHaveLength(0)
  })

  it('user soft-delete survives even if the ASSISTANT cascade throws (best-effort)', async () => {
    agentStub.__setThrowOnDelete(true)
    const u = makeUser({ assistantAgentId: 'assistant-agent-2' })
    await reg.saveUser(u)
    const res = await reg.softDeleteUser(u.id)
    // The user IS soft-deleted (authoritative action); the cascade failure is
    // logged, not propagated.
    expect(res?.deletedAt).toBeTruthy()
    expect(reg.getUser(u.id)).toBeNull()
  })

  it('returns null when soft-deleting an unknown or already-deleted user', async () => {
    expect(await reg.softDeleteUser('does-not-exist')).toBeNull()
    const u = makeUser()
    await reg.saveUser(u)
    await reg.softDeleteUser(u.id)
    expect(await reg.softDeleteUser(u.id)).toBeNull() // already deleted
  })
})

describe('R34 — ledger append on every mutation', () => {
  function ledgerEntryCount(): number {
    const p = path.join(TMP_HOME, '.aimaestro', 'users.ledger.json')
    if (!fs.existsSync(p)) return 0
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'))
    return Array.isArray(parsed.entries) ? parsed.entries.length : 0
  }

  it('appends a ledger entry on create and on update', async () => {
    const u = makeUser()
    await reg.saveUser(u)
    // The ledger append is fire-and-forget (catch logs); give the microtask a tick.
    await new Promise(r => setTimeout(r, 20))
    const afterCreate = ledgerEntryCount()
    expect(afterCreate).toBeGreaterThanOrEqual(1)

    await reg.saveUser({ ...u, name: 'renamed' })
    await new Promise(r => setTimeout(r, 20))
    expect(ledgerEntryCount()).toBeGreaterThan(afterCreate)
  })

  it('appends a ledger entry on soft-delete', async () => {
    const u = makeUser({ assistantAgentId: null })
    await reg.saveUser(u)
    await new Promise(r => setTimeout(r, 20))
    const before = ledgerEntryCount()
    await reg.softDeleteUser(u.id)
    await new Promise(r => setTimeout(r, 20))
    expect(ledgerEntryCount()).toBeGreaterThan(before)
  })
})

describe('lookups', () => {
  it('getUser / getUserByAid / getUserByName resolve active records and skip tombstones', async () => {
    const u = makeUser({ aid: 'aid-xyz', name: 'lookup-me' })
    await reg.saveUser(u)
    expect(reg.getUser(u.id)?.id).toBe(u.id)
    expect(reg.getUserByAid('aid-xyz')?.id).toBe(u.id)
    expect(reg.getUserByName('lookup-me')?.id).toBe(u.id)
    await reg.softDeleteUser(u.id)
    expect(reg.getUser(u.id)).toBeNull()
    expect(reg.getUserByAid('aid-xyz')).toBeNull()
    expect(reg.getUserByName('lookup-me')).toBeNull()
  })
})
