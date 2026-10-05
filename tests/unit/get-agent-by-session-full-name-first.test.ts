/**
 * TRDD-DEL16Q96 — getAgentBySession resolves the FULL session name before the parsed base name, so an agent
 * legitimately named "alpha_1" is not mistaken for agent "alpha" (session index 1). Real registry, real files,
 * in a temp HOME (the state dir is fixed at module load, so HOME is set before the import).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'gabs-'))
const realHome = process.env.HOME
process.env.HOME = tmpHome

type Registry = typeof import('@/lib/agent-registry')
let reg: Registry
let selfHost: string
const OTHER_HOST = 'other-host'

beforeAll(async () => {
  reg = await import('@/lib/agent-registry')
  selfHost = (await import('@/lib/hosts-config')).getSelfHostId()
})
afterAll(() => {
  process.env.HOME = realHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

const row = (id: string, name: string, hostId: string, deletedAt?: string) =>
  ({ id, name, hostId, ...(deletedAt ? { deletedAt } : {}) }) as never

function seed(rows: unknown[]) {
  expect(reg.saveAgents(rows as never)).toBe(true)
  // positive control: the seed went to the temp HOME, not the developer's real registry
  expect(reg.loadAgents().map(a => a.id).sort()).toEqual((rows as { id: string }[]).map(r => r.id).sort())
}

describe.each([
  ['default host', undefined],
  ['explicit host', 'self'],
])('getAgentBySession (%s)', (_label, mode) => {
  const host = () => (mode === 'self' ? selfHost : undefined)

  it('only "alpha" exists: session alpha_1 → alpha (parsed fallback, unchanged)', () => {
    /** Indexed session of an agent whose name has no suffix still resolves to the base agent */
    seed([row('id-alpha', 'alpha', selfHost)])
    expect(reg.getAgentBySession('alpha_1', host())?.id).toBe('id-alpha')
  })

  it('only "alpha_1" exists: session alpha_1 → alpha_1', () => {
    /** An agent named with an index-like suffix is found by its exact name */
    seed([row('id-alpha1', 'alpha_1', selfHost)])
    expect(reg.getAgentBySession('alpha_1', host())?.id).toBe('id-alpha1')
  })

  it('both exist: alpha_1 → alpha_1 and alpha → alpha', () => {
    /** Exact name wins over the parsed base name; the base session still maps to the base agent */
    seed([row('id-alpha', 'alpha', selfHost), row('id-alpha1', 'alpha_1', selfHost)])
    expect(reg.getAgentBySession('alpha_1', host())?.id).toBe('id-alpha1')
    expect(reg.getAgentBySession('alpha', host())?.id).toBe('id-alpha')
  })

  it('soft-deleted alpha_1 plus live alpha: session alpha_1 → alpha', () => {
    /** getAgentByName skips soft-deleted rows, so the deleted exact match is ignored and the parsed base agent answers (as before) */
    seed([row('id-alpha', 'alpha', selfHost), row('id-alpha1', 'alpha_1', selfHost, '2026-01-01T00:00:00.000Z')])
    expect(reg.getAgentBySession('alpha_1', host())?.id).toBe('id-alpha')
  })
})

describe('getAgentBySession host scoping', () => {
  it('an exact-name agent on ANOTHER host does not capture the session', () => {
    /** With an explicit host id the full-name lookup is host-scoped: alpha_1 on other-host is invisible to the self host */
    seed([row('id-alpha', 'alpha', selfHost), row('id-alpha1-remote', 'alpha_1', OTHER_HOST)])
    expect(reg.getAgentBySession('alpha_1', selfHost)?.id).toBe('id-alpha')
    expect(reg.getAgentBySession('alpha_1', OTHER_HOST)?.id).toBe('id-alpha1-remote')
  })
})
