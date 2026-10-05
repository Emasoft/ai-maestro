/**
 * Unit tests — TRDD-SOPULLUB: a failed read of the agent registry must not be followed
 * by a write that replaces it.
 *
 * `loadAgents` returns [] for a corrupt/unreadable/non-array registry.json, so a writer
 * that pushed a row onto that [] and called `saveAgents` used to overwrite the whole
 * registry with a near-empty file. The guard lives at the write primitive (saveAgents):
 * it strictly re-reads the registry BEFORE the write when the file exists and refuses
 * (throws) naming the file; a MISSING file keeps saving (first-run host).
 *
 * REAL agent-registry, REAL fs, REAL importAgent (transfer service). State is contained
 * by mocking `os.homedir()` to a temp root — the same pattern as
 * tests/integration/agent-soft-delete-restore-roundtrip.test.ts. Containment is PROVEN:
 * the real ~/.aimaestro registry.json mtime and the ledger UUID count are captured
 * before/after, and a positive control checks the temp root DID receive the registry.
 *
 * MOCKS: only `os` (homedir + hostname -> temp root / fixed host). Nothing else.
 */
import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest'
import fs from 'fs'
import path from 'path'
import { createHash } from 'crypto'

const { TMP_HOME, REAL_HOME } = vi.hoisted(() => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const realOs = require('os') as typeof import('os')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const fsm = require('fs') as typeof import('fs')
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const p = require('path') as typeof import('path')
  return {
    REAL_HOME: realOs.homedir(),
    TMP_HOME: fsm.mkdtempSync(p.join(realOs.tmpdir(), 'aim-reg-guard-')),
  }
})

vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual, homedir: () => TMP_HOME, hostname: () => 'guard-host' },
    homedir: () => TMP_HOME,
    hostname: () => 'guard-host',
  }
})

const REAL_AGENTS_DIR = path.join(REAL_HOME, '.aimaestro', 'agents')
const REAL_REGISTRY = path.join(REAL_AGENTS_DIR, 'registry.json')
const REAL_LEDGER = path.join(REAL_AGENTS_DIR, 'registry.ledger.json')
/** Content fingerprint (size + sha256) of a file — stable under a live server rewriting identical bytes. */
function realFingerprint(f: string): string {
  return fs.existsSync(f)
    ? `${fs.statSync(f).size}:${createHash('sha256').update(fs.readFileSync(f)).digest('hex')}`
    : 'absent'
}
const REAL_REGISTRY_FP_BEFORE = realFingerprint(REAL_REGISTRY)
const REAL_LEDGER_UUID_COUNT_BEFORE = fs.existsSync(REAL_LEDGER)
  ? (fs.readFileSync(REAL_LEDGER, 'utf-8').match(/33333333-3333-4333-8333-333333333333/g) ?? [])
      .length
  : 0

const REGISTRY = path.join(TMP_HOME, '.aimaestro', 'agents', 'registry.json')

let registry: typeof import('@/lib/agent-registry')
let transfer: typeof import('@/services/agents-transfer-service')

function makeAgent(name: string): Record<string, unknown> {
  return {
    // hex-only id: isValidUuid (import gate) requires hex, so the name contributes nothing
    id: `11111111-2222-4333-8333-${(name.length % 16).toString(16).repeat(12)}`,
    name,
    label: name,
    workingDirectory: path.join(TMP_HOME, 'agents', name),
    sessions: [],
    hostId: 'guard-host',
    status: 'offline',
    createdAt: new Date().toISOString(),
    lastActive: new Date().toISOString(),
    metrics: { totalSessions: 0, totalMessages: 0 },
  }
}


/** A minimal CreateAgentRequest — taskDescription is required by the type. */
function createReq(name: string) {
  return {
    name,
    program: 'claude' as const,
    taskDescription: 'registry-write-guard test agent',
    workingDirectory: path.join(TMP_HOME, 'agents', name),
  }
}

/** Build a minimal importable ZIP (manifest + registry.json row) the same way the
 * transfer service's own fixtures do — real archiver, real yauzl-extractable format. */
async function makeImportZip(agentName: string): Promise<Buffer> {
  const archiver = (await import('archiver')).default
  const out = archiver('zip')
  const chunks: Buffer[] = []
  out.on('data', (c: Buffer) => chunks.push(c))
  const done = new Promise<void>((res, rej) => {
    out.on('error', rej)
    out.on('end', res)
  })
  out.append(
    JSON.stringify({
      version: '1.1.0',
      exportedAt: new Date().toISOString(),
      exportedFrom: {
        hostname: 'guard-host',
        platform: process.platform,
        aiMaestroVersion: 'test',
      },
      agent: { id: makeAgent(agentName).id as string, name: agentName },
      contents: { hasRegistry: true, hasDatabase: false, hasMessages: false },
    }),
    { name: 'manifest.json' }
  )
  out.append(JSON.stringify(makeAgent(agentName)), { name: 'registry.json' })
  void out.finalize()
  await done
  return Buffer.concat(chunks)
}

beforeAll(async () => {
  expect(TMP_HOME).not.toBe(REAL_HOME)
  registry = await import('@/lib/agent-registry')
  transfer = await import('@/services/agents-transfer-service')
})

afterAll(() => {
  fs.rmSync(TMP_HOME, { recursive: true, force: true })
})

function fingerprintRegistryFile(): string {
  if (!fs.existsSync(REGISTRY)) return 'absent'
  const buf = fs.readFileSync(REGISTRY)
  return `${buf.length}:${createHash('sha256').update(buf).digest('hex')}`
}

describe('registry write refuses after a failed read (TRDD-SOPULLUB)', { shuffle: false }, () => {
  it('registry file missing -> createAgent works (first-run host unchanged)', async () => {
    expect(fs.existsSync(REGISTRY)).toBe(false)
    const agent = await registry.createAgent(createReq('first-run-agent'))
    expect(agent.id).toBeTruthy()
    expect(fs.existsSync(REGISTRY)).toBe(true)
    // positive control: the registry landed under the TEMP root, not the real one
    expect(fs.readFileSync(REGISTRY, 'utf-8')).toContain('"first-run-agent"')
  })

  it('valid registry -> createAgent works', async () => {
    expect(registry.loadAgents().map(a => a.name)).toContain('first-run-agent')
    const agent = await registry.createAgent(createReq('second-agent'))
    expect(agent.id).toBeTruthy()
    expect(registry.loadAgents().map(a => a.name)).toContain('second-agent')
  })

  it('corrupt JSON file present -> createAgent refuses, error names the registry file, file bytes unchanged', async () => {
    const before = fingerprintRegistryFile()
    fs.writeFileSync(REGISTRY, '{"corrupt": ', 'utf-8')
    expect(fingerprintRegistryFile()).not.toBe(before)
    const corruptBefore = fs.readFileSync(REGISTRY)
    await expect(
      registry.createAgent(createReq('refused-agent'))
    ).rejects.toThrow(/registry\.json/)
    // bytes UNCHANGED: the corrupt file was not replaced, not even by the .tmp dance
    expect(fs.readFileSync(REGISTRY).equals(corruptBefore)).toBe(true)
    expect(fingerprintRegistryFile()).toBe(`${corruptBefore.length}:${createHash('sha256').update(corruptBefore).digest('hex')}`)
  })

  it('non-array JSON ({}) -> createAgent refuses the same way', async () => {
    const before = fs.readFileSync(REGISTRY)
    fs.writeFileSync(REGISTRY, '{}', 'utf-8')
    await expect(
      registry.createAgent(createReq('refused-agent-2'))
    ).rejects.toThrow(/registry\.json/)
    expect(fs.readFileSync(REGISTRY).equals(Buffer.from('{}'))).toBe(true)
  })

  it('transfer import with a corrupt registry -> refuses the same way (importAgent error result)', async () => {
    // registry is still `{}` from the previous test
    const zip = await makeImportZip('imported-agent')
    const res = await transfer.importAgent(zip, { newName: 'imported-agent' })
    // importAgent catches the refusal in its outer catch: status 500, message in data.errors
    // (res.error is only set by its early-return shapes). Pin the REASON, not just the failure.
    expect(res.status).toBe(500)
    expect(res.data?.success).toBe(false)
    expect(res.data?.stats.registryImported).toBe(false)
    expect((res.data?.errors ?? []).join(' ')).toMatch(/registry\.json/)
    expect(registry.loadAgents().map(a => a.name)).not.toContain('imported-agent')
    expect(fs.readFileSync(REGISTRY).equals(Buffer.from('{}'))).toBe(true)
  })

  it('after the refusal, fixing the file to valid JSON -> createAgent succeeds again', async () => {
    fs.writeFileSync(REGISTRY, JSON.stringify([makeAgent('repaired-agent')], null, 2), 'utf-8')
    // purge the cached [] from the corrupt read: loadAgents caches only on success, and
    // loadAgentsStrict never writes the cache, so a fresh strict read re-parses from disk
    const agent = await registry.createAgent(createReq('after-repair-agent'))
    expect(agent.id).toBeTruthy()
    const names = registry.loadAgents().map(a => a.name)
    expect(names).toContain('repaired-agent')
    expect(names).toContain('after-repair-agent')
  })

  it('containment: the real ~/.aimaestro registry mtime and ledger UUID count are unchanged', () => {
    // content, not mtime: a live pm2 server may rewrite the real registry with identical bytes
    // mid-run (mtime moves, sha does not) — the same reason the roundtrip test fingerprints.
    expect(realFingerprint(REAL_REGISTRY)).toBe(REAL_REGISTRY_FP_BEFORE)
    expect(fs.existsSync(path.join(TMP_HOME, '.aimaestro', 'agents', 'registry.json'))).toBe(true)
    const ledgerCount = fs.existsSync(REAL_LEDGER)
      ? (fs.readFileSync(REAL_LEDGER, 'utf-8').match(/33333333-3333-4333-8333-333333333333/g) ?? [])
          .length
      : 0
    expect(ledgerCount).toBe(REAL_LEDGER_UUID_COUNT_BEFORE)
  })
})
