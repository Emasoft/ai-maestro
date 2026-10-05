/**
 * TRDD-BZW1QAZ5 — an agent cannot be created with, or renamed to, a name that the
 * headless router would answer from the generic /api/agents/:id handlers. Real
 * registry, real files, in a temp HOME (the state dir is fixed at module load, so
 * HOME is set before the import).
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), 'name-collisions-'))
const realHome = process.env.HOME
process.env.HOME = tmpHome

type Registry = typeof import('@/lib/agent-registry')
let reg: Registry

beforeAll(async () => {
  reg = await import('@/lib/agent-registry')
})
afterAll(() => {
  process.env.HOME = realHome
  fs.rmSync(tmpHome, { recursive: true, force: true })
})

/** Fixed segments the headless router shadows behind /api/agents/:id (see SYSTEM_HELPER_NAMES). */
const RESERVED = ['role-plugins', 'creation-helper', 'cemetery']

/**
 * Fixed directories under app/api/agents/ that were reviewed and deliberately NOT
 * reserved. A new directory must be added here or to SYSTEM_HELPER_NAMES.
 */
const NOT_RESERVED_FIXED_SEGMENTS = [
  'browse-dir', 'by-name', 'commands', 'create-from-toml', 'create-persona', 'directory',
  'docker', 'email-index', 'folders', 'foreign-approvals', 'health', 'hibernation',
  'import', 'me', 'normalize-hosts', 'register', 'startup', 'unified',
]

const routeDirs = () =>
  fs
    .readdirSync(path.join(process.cwd(), 'app/api/agents'), { withFileTypes: true })
    .filter(d => d.isDirectory() && !d.name.startsWith('['))
    .map(d => d.name)

describe('reserved route segments as agent names', () => {
  it('every fixed directory under app/api/agents/ is reserved or explicitly allowlisted', () => {
    const undecided = routeDirs().filter(
      d => !reg.SYSTEM_HELPER_NAMES.has(d) && !NOT_RESERVED_FIXED_SEGMENTS.includes(d)
    )
    expect(undecided).toEqual([])
  })

  it('create refuses each reserved segment', async () => {
    for (const seg of RESERVED) {
      await expect(reg.createAgent({ name: seg } as never)).rejects.toThrow(
        `"${seg}" is a reserved system helper name and cannot be registered as an agent`
      )
    }
  })

  it('create refuses a case variant', async () => {
    await expect(reg.createAgent({ name: 'Role-Plugins' } as never)).rejects.toThrow(/reserved system helper name/)
  })

  it('create accepts a normal name (positive control)', async () => {
    const a = await reg.createAgent({ name: 'plain-agent' } as never)
    expect(a.name).toBe('plain-agent')
  })

  it('rename refuses each reserved segment and keeps the old name', async () => {
    const a = await reg.createAgent({ name: 'to-rename' } as never)
    for (const seg of RESERVED) {
      await expect(reg.updateAgent(a.id, { name: seg } as never)).rejects.toThrow(/reserved system helper name/)
    }
    expect(reg.getAgent(a.id)!.name).toBe('to-rename')
  })

  it('rename to a normal name succeeds (positive control)', async () => {
    const a = await reg.createAgent({ name: 'rename-src' } as never)
    const u = await reg.updateAgent(a.id, { name: 'rename-dst' } as never)
    expect(u!.name).toBe('rename-dst')
  })

  it('an update that keeps a legacy reserved-name agent\'s name does not fail', async () => {
    const a = await reg.createAgent({ name: 'legacy-row' } as never)
    // Simulate a pre-existing row carrying a reserved name, written straight into the store.
    const file = path.join(tmpHome, '.aimaestro', 'agents', 'registry.json')
    const rows = JSON.parse(fs.readFileSync(file, 'utf8'))
    rows.find((r: { id: string }) => r.id === a.id).name = 'cemetery'
    fs.writeFileSync(file, JSON.stringify(rows))
    const u = await reg.updateAgent(a.id, { name: 'cemetery', label: 'x' } as never)
    expect(u!.name).toBe('cemetery')
  })
})
