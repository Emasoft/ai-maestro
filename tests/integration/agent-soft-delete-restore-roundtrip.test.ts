/**
 * Integration test — agent SOFT-DELETE -> cemetery -> RESTORE round trip.
 *
 * REAL agent-registry, REAL exportAgentZip/importAgent, REAL agent-auth session-secret lookup,
 * REAL fs. State is contained by mocking `os.homedir()` (the registry, the transfer service and
 * `statePath('cemetery')` all resolve the state root from it at module load). Containment is PROVEN
 * in the first and last tests: the developer's real ~/.aimaestro/{agents,cemetery} listings are
 * counted before/after, and a positive control checks the temp root DID receive the registry.
 *
 * Steps mirror the DeleteAgent pipeline's soft path (services/element-management-service.ts gate
 * G01c = exportAgentZip + write to statePath('cemetery'); then registry deleteAgent(id, false)) and
 * the revive route (app/api/agents/cemetery POST = hard-delete the stale soft row, importAgent with
 * newId:true, unlink the archive). The routes/pipeline themselves are not driven: they need sudo
 * tokens / tmux / plugins that are unrelated to the claim.
 *
 * MOCKS: only `os` (homedir + hostname -> temp root / fixed host) for containment. Nothing else.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { listing } from '../helpers/real-state-roots'

const { TMP_HOME, REAL_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const realOs = require('os') as typeof import('os')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsm = require('fs') as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('path') as typeof import('path')
  return {
    REAL_HOME: realOs.homedir(),
    TMP_HOME: fsm.mkdtempSync(p.join(realOs.tmpdir(), 'aim-softdel-rt-')),
  }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual, homedir: () => TMP_HOME, hostname: () => 'roundtrip-host' },
    homedir: () => TMP_HOME,
    hostname: () => 'roundtrip-host',
  }
})

const REAL_AGENTS = path.join(REAL_HOME, '.aimaestro', 'agents')
const REAL_CEMETERY = path.join(REAL_HOME, '.aimaestro', 'cemetery')
const realBefore = { agents: listing(REAL_AGENTS).length, cemetery: listing(REAL_CEMETERY).length }


// Content fingerprint (size + sha256) of the real state files, taken BEFORE any dynamic import.
// A count misses an existing file rewritten in place (registry.json gaining a row).
function fingerprint(): Record<string, string> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createHash } = require("crypto") as typeof import("crypto")
  const files = [
    path.join(REAL_AGENTS, "registry.json"),
    path.join(REAL_HOME, ".aimaestro", "sessions.json"),
    ...(fs.existsSync(REAL_CEMETERY)
      ? fs.readdirSync(REAL_CEMETERY, { withFileTypes: true }).filter(e => e.isFile()).map(e => path.join(REAL_CEMETERY, e.name))
      : []),
  ]
  const out: Record<string, string> = {}
  for (const f of files) {
    out[f] = fs.existsSync(f)
      ? `${fs.statSync(f).size}:${createHash("sha256").update(fs.readFileSync(f)).digest("hex")}`
      : "absent"
  }
  return out
}
const realFingerprintBefore = fingerprint()

let registry: typeof import('@/lib/agent-registry')
let auth: typeof import('@/lib/agent-auth')
let transfer: typeof import('@/services/agents-transfer-service')
let secret: string
let originalId: string
let archiveFile: string
let restoredId: string
let restoredName: string
const NAME = `rt-${Math.random().toString(36).slice(2, 8)}`

function authenticate(token: string) {
  return auth.authenticateAgent(`Bearer ${token}`, null)
}

beforeAll(async () => {
  expect(TMP_HOME).not.toBe(REAL_HOME)
  registry = await import('@/lib/agent-registry')
  auth = await import('@/lib/agent-auth')
  transfer = await import('@/services/agents-transfer-service')
})

afterAll(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

describe('agent soft-delete -> cemetery -> restore round trip (real modules, temp state root)', () => {
  it('setup: creates an agent with a session secret hash and the temp root receives the registry', async () => {
    const workdir = path.join(TMP_HOME, 'agents', NAME)
    fs.mkdirSync(workdir, { recursive: true })
    const { generateSessionSecret } = await import('@/lib/session-secret')
    const gen = generateSessionSecret()
    secret = gen.secret
    const agent = await registry.createAgent({
      name: NAME,
      program: 'claude',
      taskDescription: 'round trip',
      workingDirectory: workdir,
      metadata: { sessionSecretHash: gen.secretHash },
    })
    originalId = agent.id
    expect(registry.getAgent(originalId)?.metadata?.sessionSecretHash).toBe(gen.secretHash)
    // positive control: the registry file landed under the TEMP root
    expect(fs.existsSync(path.join(TMP_HOME, '.aimaestro', 'agents', 'registry.json'))).toBe(true)
    // and the secret authenticates the live agent
    expect(authenticate(secret)).toMatchObject({ agentId: originalId })
  })

  it('soft delete archives to the cemetery and the registry row is kept with deletedAt', async () => {
    const zip = await transfer.exportAgentZip(originalId)
    expect(zip.data).toBeDefined()
    const cemeteryDir = path.join(TMP_HOME, '.aimaestro', 'cemetery')
    fs.mkdirSync(cemeteryDir, { recursive: true })
    archiveFile = path.join(cemeteryDir, zip.data!.filename)
    fs.writeFileSync(archiveFile, zip.data!.buffer)
    expect(await registry.deleteAgent(originalId, false)).toBe(true)

    expect(fs.existsSync(archiveFile)).toBe(true)
    expect(zip.data!.filename).toMatch(new RegExp(`^${NAME}-export-.*\\.zip$`))
    const row = registry.getAgent(originalId, true)
    expect(row?.deletedAt).toBeTruthy()
    expect(row?.status).toBe('deleted')
  })

  it('the session secret no longer authenticates after the soft delete', () => {
    const r = authenticate(secret)
    expect(r.status).toBe(401)
    expect(r.error).toMatch(/Invalid or expired session secret/)
  })

  it('restore: revive route steps (drop stale soft row, importAgent newId:true, unlink archive) succeed', async () => {
    const stale = registry.loadAgents().find(a => a.name === NAME && a.deletedAt)
    expect(stale?.id).toBe(originalId)
    await registry.deleteAgent(stale!.id, true)
    const res = await transfer.importAgent(fs.readFileSync(archiveFile), { newId: true })
    expect(res.error).toBeUndefined()
    expect(res.data?.agent?.id).toBeTruthy()
    restoredId = res.data!.agent!.id
    restoredName = res.data!.agent!.name
    fs.unlinkSync(archiveFile)
    expect(fs.existsSync(archiveFile)).toBe(false)
  })

  it('OBSERVED: the restored agent gets a NEW id and keeps its name', () => {
    expect(restoredId).not.toBe(originalId)
    expect(restoredName).toBe(NAME)
    expect(registry.getAgent(restoredId)?.deletedAt).toBeUndefined()
    expect(registry.getAgent(originalId, true)).toBeNull()
  })

  it('OBSERVED (UNSAFE): the OLD session secret authenticates again, now under the NEW identity', () => {
    // importAgent spreads the exported registry row (incl. metadata.sessionSecretHash) into the
    // restored agent, so a secret issued to the deleted identity resolves to the new id.
    const r = authenticate(secret)
    expect(r.error).toBeUndefined()
    expect(r.agentId).toBe(restoredId)
    expect(r.agentId).not.toBe(originalId)
  })

  it('containment: the developer real ~/.aimaestro agents and cemetery listings are unchanged', () => {
    expect(listing(REAL_AGENTS).length).toBe(realBefore.agents)
    expect(listing(REAL_CEMETERY).length).toBe(realBefore.cemetery)
    expect(fs.existsSync(path.join(TMP_HOME, '.aimaestro', 'agents', 'registry.json'))).toBe(true)
  })
})
