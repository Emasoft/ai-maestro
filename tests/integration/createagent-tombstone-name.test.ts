/**
 * CreateAgent G01b — a name held by a soft-deleted agent whose folder still exists is TAKEN
 * (TRDD-HNJ3T3W0). REAL agent-registry + REAL CreateAgent; state is contained by redirecting
 * os.homedir() to a temp root. Only `os` is mocked.
 *
 * The control name is stopped deterministically at G01c (rate limit: a live agent was created
 * just now), so no real pipeline work runs: "G01b … is unique" in the ops trace proves G01b passed.
 */
import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest'
import fs from 'fs'
import path from 'path'

const { TMP_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const realOs = require('os') as typeof import('os')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsm = require('fs') as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('path') as typeof import('path')
  return { TMP_HOME: fsm.mkdtempSync(p.join(realOs.tmpdir(), 'aim-tombstone-name-')) }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual, homedir: () => TMP_HOME, hostname: () => 'tomb-host' },
    homedir: () => TMP_HOME,
    hostname: () => 'tomb-host',
  }
})

const REGISTRY = path.join(TMP_HOME, '.aimaestro', 'agents', 'registry.json')
const GHOST = path.join(TMP_HOME, 'agents', 'tomb-ghost')

let registry: typeof import('@/lib/agent-registry')
let svc: typeof import('@/services/element-management-service')
let auth: typeof import('@/lib/agent-auth')
let tick = 1_000_000_000

function row(id: string, name: string, extra: Record<string, unknown> = {}) {
  return {
    id, name, label: name, workingDirectory: path.join(TMP_HOME, 'agents', name),
    sessions: [], hostId: 'tomb-host', status: 'offline',
    createdAt: new Date().toISOString(), lastActive: new Date().toISOString(),
    metrics: { totalSessions: 0, totalMessages: 0 }, ...extra,
  }
}

function create(name: string) {
  return svc.CreateAgent({
    name, program: 'claude', taskDescription: 't',
    authContext: auth.buildSystemAuthContext('tombstone-name-test'),
  })
}

function snapshot(): string {
  return fs.readFileSync(REGISTRY, 'utf-8') + '|' + fs.readdirSync(path.join(TMP_HOME, 'agents')).sort().join(',')
}

beforeAll(async () => {
  registry = await import('@/lib/agent-registry')
  svc = await import('@/services/element-management-service')
  auth = await import('@/lib/agent-auth')
})

beforeEach(() => {
  fs.rmSync(path.join(TMP_HOME, 'agents'), { recursive: true, force: true })
  fs.mkdirSync(GHOST, { recursive: true })
  fs.mkdirSync(path.dirname(REGISTRY), { recursive: true })
  // tomb-ghost: soft-deleted tombstone; live-one: a just-created live agent (arms the G01c rate limit)
  fs.writeFileSync(REGISTRY, JSON.stringify([
    row('aaaaaaaa-0000-4000-8000-000000000001', 'tomb-ghost', { deletedAt: new Date().toISOString(), status: 'deleted' }),
    row('aaaaaaaa-0000-4000-8000-000000000002', 'live-one'),
  ]))
  // the registry read-cache is keyed on mtime: give every seed a distinct one
  tick += 5
  fs.utimesSync(REGISTRY, tick, tick)
  fs.mkdirSync(path.join(TMP_HOME, 'agents', 'live-one'), { recursive: true })
})

afterAll(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

describe('CreateAgent G01b — tombstoned name with a surviving folder', () => {
  it('refuses the name, says how to free it, and writes nothing', async () => {
    const before = snapshot()
    const r = await create('tomb-ghost')
    expect(r.success).toBe(false)
    expect(r.error).toMatch(/held by a soft-deleted agent \(id=aaaaaaaa-0000-4000-8000-000000000001\)/)
    expect(r.error).toMatch(/Restore that agent from the cemetery, or purge it/)
    expect(r.operations.some(o => o.startsWith('G01b'))).toBe(false)
    expect(snapshot()).toBe(before)
  })

  it('an unrelated name passes G01b (control)', async () => {
    const r = await create('someone-else')
    expect(r.operations).toContain('G01b: Name "someone-else" is unique in registry')
    expect(r.error).toMatch(/rate limit/)
  })

  it('the name is free again once the tombstone folder is gone', async () => {
    fs.rmSync(GHOST, { recursive: true, force: true })
    const r = await create('tomb-ghost')
    expect(r.operations).toContain('G01b: Name "tomb-ghost" is unique in registry')
  })

  it('the name is free again once the tombstone is purged (hard delete)', async () => {
    expect(await registry.deleteAgent('aaaaaaaa-0000-4000-8000-000000000001', true)).toBe(true)
    // hard delete removes the folder too; recreate it so only the registry row decides
    fs.mkdirSync(GHOST, { recursive: true })
    const r = await create('tomb-ghost')
    expect(r.operations).toContain('G01b: Name "tomb-ghost" is unique in registry')
  })
})
