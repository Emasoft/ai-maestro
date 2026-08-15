/**
 * Integration test — R34.2 / R35 foreign-agent import + approval.
 *
 * REAL fs + REAL host-keys + sandbox os.homedir() — no mocking of the units
 * under test. Exercises the genuine service/library flow:
 *
 *   1. importAgent(foreignZip) → 202 + pendingApprovalId, NO agent in the
 *      registry, NO keys imported, the foreign AID is NOT valid (isAidAssociated
 *      false), and a pending ForeignApprovalEntry holds the staged ZIP.
 *   2. The MAESTRO approval (what the approve route does at the service layer):
 *      materialize via importAgent(..., {bypassForeignApproval:true}) → re-issue
 *      a FRESH native AID → emit aid_reissue + aid_associate(new) +
 *      aid_approve_foreign. Asserts the new agent exists, the NEW fingerprint is
 *      ledger-backed, the FOREIGN fingerprint is permanently UNbacked (R34.2
 *      impersonation defense), the three aid_* ops are present, and the registry
 *      ledger still verify()s.
 *
 * The approve ROUTE's enforceMaestro (R37 alias of enforceSystemOwner) + sudo
 * gate is covered by tsc + the sudo-guard fail-closed agent dual-path (a strict
 * route with no STRICT_AGENT_RULES entry → 403 for any agent caller); here we
 * verify the security CORE (no-auto-accept, re-issue discards the foreign key).
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import archiver from 'archiver'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-foreign-import-'))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual, homedir: () => TMP_HOME, hostname: () => 'this-host' },
    homedir: () => TMP_HOME,
    hostname: () => 'this-host',
  }
})

type TransferModule = typeof import('@/services/agents-transfer-service')
type AuthorityModule = typeof import('@/lib/aid-ledger-authority')
type RegistryModule = typeof import('@/lib/agent-registry')
type ForeignRegModule = typeof import('@/lib/foreign-approval-registry')
type AmpKeysModule = typeof import('@/lib/amp-keys')
type ForeignSvcModule = typeof import('@/services/foreign-approval-service')

let transfer: TransferModule
let authority: AuthorityModule
let registry: RegistryModule
let foreignReg: ForeignRegModule
let ampKeys: AmpKeysModule
let foreignSvc: ForeignSvcModule
let foreignFingerprint: string
let foreignPubPem: string
let foreignPrivPem: string

beforeAll(async () => {
  const hostKeys = await import('@/lib/host-keys')
  hostKeys.getOrCreateHostKeyPair()
  transfer = await import('@/services/agents-transfer-service')
  authority = await import('@/lib/aid-ledger-authority')
  registry = await import('@/lib/agent-registry')
  foreignReg = await import('@/lib/foreign-approval-registry')
  ampKeys = await import('@/lib/amp-keys')
  foreignSvc = await import('@/services/foreign-approval-service')
  // A "foreign" keypair — the AID the remote host shipped.
  const kp = await ampKeys.generateKeyPair()
  foreignFingerprint = kp.fingerprint
  foreignPubPem = kp.publicPem
  foreignPrivPem = kp.privatePem
})

afterAll(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch { /* best-effort */ }
})

beforeEach(async () => {
  // Reset registry + ledger + foreign-approvals + cache between tests.
  const aimDir = path.join(TMP_HOME, '.aimaestro')
  const agentsDir = path.join(aimDir, 'agents')
  try {
    if (fs.existsSync(agentsDir)) {
      for (const f of fs.readdirSync(agentsDir)) {
        if (/^registry/.test(f)) fs.rmSync(path.join(agentsDir, f), { recursive: true, force: true })
      }
    }
    for (const f of ['foreign-approvals.json', 'foreign-approvals.ledger.json', 'aid-recovery-cache.json']) {
      const p = path.join(aimDir, f)
      if (fs.existsSync(p)) fs.rmSync(p, { force: true })
    }
    const tmpDir = path.join(aimDir, 'tmp')
    if (fs.existsSync(tmpDir)) fs.rmSync(tmpDir, { recursive: true, force: true })
  } catch { /* best-effort */ }
  await registry.registryLedger.verify()
  authority.invalidateRecoveryCache()
  // foreign-approval registry keeps a _prev singleton — re-sync it by loading
  // the (now-absent) file.
  foreignReg.loadForeignApprovals()
})

/** Build a foreign agent export ZIP in memory (exportedFrom.hostname=remote-host). */
async function buildForeignExportZip(agentName: string, includeKeys = true): Promise<Buffer> {
  const manifest = {
    version: '1.2.0',
    exportedAt: new Date().toISOString(),
    exportedFrom: { hostname: 'remote-host', platform: 'linux', aiMaestroVersion: '0.29.0' },
    // M4: real exports always carry a uuidv4() id (the registry id). The id is
    // now validated as a strict UUID before it touches any filesystem path, so
    // the fixture must use a valid UUID to reflect a genuine export.
    agent: { id: 'f0e1d2c3-b4a5-4968-8778-69504a3b2c1d', name: agentName },
    contents: { hasRegistry: true, hasDatabase: false, hasMessages: false, hasKeys: includeKeys, hasRegistrations: false },
  }
  const agentRecord = {
    id: 'f0e1d2c3-b4a5-4968-8778-69504a3b2c1d',
    name: agentName,
    alias: agentName,
    governanceTitle: 'autonomous',
    workingDirectory: path.join(TMP_HOME, 'agents', agentName),
    deployment: { type: 'local', local: { hostname: 'remote-host', platform: 'linux' } },
    sessions: [],
    status: 'offline',
    tools: {},
    ampIdentity: includeKeys
      ? { fingerprint: foreignFingerprint, publicKeyHex: 'deadbeef', keyAlgorithm: 'Ed25519', createdAt: new Date().toISOString(), ampAddress: `${agentName}@default.aimaestro.local`, tenant: 'default' }
      : undefined,
    metadata: includeKeys ? { amp: { fingerprint: foreignFingerprint } } : {},
  }

  return await new Promise<Buffer>((resolve, reject) => {
    const archive = archiver('zip', { zlib: { level: 9 } })
    const chunks: Buffer[] = []
    archive.on('data', (c: Buffer) => chunks.push(c))
    archive.on('end', () => resolve(Buffer.concat(chunks)))
    archive.on('error', reject)
    archive.append(JSON.stringify(manifest), { name: 'manifest.json' })
    archive.append(JSON.stringify(agentRecord), { name: 'registry.json' })
    if (includeKeys) {
      archive.append(foreignPrivPem, { name: 'keys/private.pem' })
      archive.append(foreignPubPem, { name: 'keys/public.pem' })
    }
    archive.finalize()
  })
}

async function flushLedger(name: string): Promise<void> {
  const { acquireLock } = await import('@/lib/file-lock')
  const release = await acquireLock(`ledger:${name}`)
  release()
  await new Promise(r => setTimeout(r, 5))
}

describe('foreign-import-approval — step 1: import is NOT auto-accepted', () => {
  it('returns 202 + pendingApprovalId, imports NO agent, foreign AID NOT valid', async () => {
    const zip = await buildForeignExportZip('alpha-foreign')
    const res = await transfer.importAgent(zip)

    // 202 with a pending approval id; success:false.
    expect(res.status).toBe(202)
    expect(res.data?.success).toBe(false)
    expect(res.data?.pendingApprovalId).toBe(`${foreignFingerprint}@remote-host`)

    // No agent was created.
    expect(registry.getAgentByName('alpha-foreign')).toBeNull()

    // The foreign AID is NOT valid (no association recorded).
    authority.invalidateRecoveryCache()
    await registry.registryLedger.verify()
    expect(authority.isAidAssociated(foreignFingerprint).ok).toBe(false)

    // A pending entry exists with a staged ZIP.
    await flushLedger('foreign-approvals')
    const pending = foreignReg.getForeignApproval(`${foreignFingerprint}@remote-host`)
    expect(pending).not.toBeNull()
    expect(pending!.status).toBe('pending')
    expect(pending!.kind).toBe('agent')
    expect(pending!.importPayloadPath).toBeTruthy()
    expect(fs.existsSync(pending!.importPayloadPath!)).toBe(true)
  })
})

describe('foreign-import-approval — M4: path-traversal agent id is rejected, writes nothing outside tmp', () => {
  it('a manifest with id "../../../../tmp/evil" is rejected (400) and writes no file outside the staging dir', async () => {
    // M4 regression: importedAgent.id comes from the UNTRUSTED ZIP. Before the
    // fix it was interpolated into the staging path.join() and written with
    // fs.writeFileSync, so "../../../../tmp/evil" escaped ~/.aimaestro/tmp.
    const MALICIOUS_ID = '../../../../tmp/evil'
    const manifest = {
      version: '1.2.0',
      exportedAt: new Date().toISOString(),
      // foreign origin → would otherwise hit the staging-write code path.
      exportedFrom: { hostname: 'remote-host', platform: 'linux', aiMaestroVersion: '0.29.0' },
      agent: { id: MALICIOUS_ID, name: 'evil-foreign' },
      contents: { hasRegistry: true, hasDatabase: false, hasMessages: false, hasKeys: false, hasRegistrations: false },
    }
    const agentRecord = {
      id: MALICIOUS_ID, name: 'evil-foreign', alias: 'evil-foreign', governanceTitle: 'autonomous',
      workingDirectory: path.join(TMP_HOME, 'agents', 'evil-foreign'),
      deployment: { type: 'local', local: { hostname: 'remote-host', platform: 'linux' } },
      sessions: [], status: 'offline', tools: {}, metadata: {},
    }
    const zip = await new Promise<Buffer>((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } })
      const chunks: Buffer[] = []
      archive.on('data', (c: Buffer) => chunks.push(c))
      archive.on('end', () => resolve(Buffer.concat(chunks)))
      archive.on('error', reject)
      archive.append(JSON.stringify(manifest), { name: 'manifest.json' })
      archive.append(JSON.stringify(agentRecord), { name: 'registry.json' })
      archive.finalize()
    })

    const aimDir = path.join(TMP_HOME, '.aimaestro')
    const stagingDir = path.join(aimDir, 'tmp')
    // The path the traversal payload would have escaped to:
    // path.join('<TMP_HOME>/.aimaestro/tmp', 'foreign-import-../../../../tmp/evil-<ts>.zip')
    // resolves under '<TMP_HOME>/tmp/'. Assert nothing lands there.
    const escapeDir = path.join(TMP_HOME, 'tmp')
    const escapeBefore = fs.existsSync(escapeDir) ? fs.readdirSync(escapeDir).length : 0

    const res = await transfer.importAgent(zip)

    // (a) FAIL FAST: rejected at validation, before any write.
    expect(res.status).toBe(400)
    expect(res.data?.success).not.toBe(true)

    // (b) No staged ZIP was written anywhere — neither inside the staging dir
    //     nor at the escaped location.
    const stagedNow = fs.existsSync(stagingDir)
      ? fs.readdirSync(stagingDir).filter(f => f.endsWith('.zip'))
      : []
    expect(stagedNow).toEqual([])
    const escapeAfter = fs.existsSync(escapeDir) ? fs.readdirSync(escapeDir).length : 0
    expect(escapeAfter).toBe(escapeBefore)
    // No 'evil' file materialized at the traversal target.
    expect(fs.existsSync(path.join(escapeDir, 'evil.zip'))).toBe(false)

    // (c) No agent and no pending approval were created.
    expect(registry.getAgentByName('evil-foreign')).toBeNull()
    await flushLedger('foreign-approvals')
    const approvals = foreignReg.loadForeignApprovals()
    expect(approvals.find(a => a.displayName === 'evil-foreign')).toBeUndefined()
  })
})

describe('foreign-import-approval — step 2: MAESTRO approval re-issues a native AID', () => {
  it('materializes the agent, backs a NEW fingerprint, leaves the FOREIGN one unbacked, records the 3 ops', async () => {
    // Stage the pending import (step 1).
    const zip = await buildForeignExportZip('beta-foreign')
    const staged = await transfer.importAgent(zip)
    expect(staged.status).toBe(202)
    const approvalId = staged.data!.pendingApprovalId!

    // ── The approval — through the REAL service pipeline (TRDD-LMAZO2ET).
    // This used to hand-replicate the route's sequence at the service layer;
    // now that approveForeignAgent IS the sequence, calling anything else here
    // would pin a copy that drifts from the shipped pipeline.
    const res = await foreignSvc.approveForeignAgent(approvalId)
    expect(res.error, res.error).toBeUndefined()
    expect(res.status).toBe(200)
    const newAgentId = res.data!.newAgentId
    const newFingerprint = res.data!.newFingerprint
    expect(newFingerprint).not.toBe(foreignFingerprint)

    await flushLedger('registry')
    authority.invalidateRecoveryCache()
    await registry.registryLedger.verify()

    // Assertions:
    // (a) the NEW fingerprint is ledger-backed and bound to the new agent.
    const newRes = authority.isAidAssociated(newFingerprint)
    expect(newRes.ok).toBe(true)
    expect(newRes.agentId).toBe(newAgentId)
    // (b) the FOREIGN fingerprint is NEVER backed (R34.2 impersonation defense).
    expect(authority.isAidAssociated(foreignFingerprint).ok).toBe(false)
    // (b2) the on-disk keypair carries the FRESH fingerprint (foreign keys gone).
    expect(ampKeys.loadKeyPair(newAgentId)?.fingerprint).toBe(newFingerprint)
    // (c) the reissue + foreign-approval ops are present.
    const ops = registry.registryLedger.getEntries().map(e => e.op)
    expect(ops).toContain('aid_reissue')
    expect(ops).toContain('aid_associate')
    expect(ops).toContain('aid_approve_foreign')
    // (d) the chain still verifies (additivity / signatures intact).
    const verify = await registry.registryLedger.verify()
    expect(verify.ok).toBe(true)
    // (e) the approval entry is approved and the staged ZIP was consumed.
    const after = foreignReg.getForeignApproval(approvalId)
    expect(after?.status).toBe('approved')
    expect(after?.importPayloadPath).toBeUndefined()
    // (f) a replayed approval is refused by the pending-check — no duplicate.
    const replay = await foreignSvc.approveForeignAgent(approvalId)
    expect(replay.status).toBe(409)
    expect(registry.loadAgents().filter(a => a.name === 'beta-foreign')).toHaveLength(1)
  })
})

describe('foreign-import-approval — R51 rollback: a mid-sequence failure leaves NO residue (TRDD-LMAZO2ET)', () => {
  /** Stage a fresh pending foreign import and return its approval handle. */
  async function stagePending(name: string): Promise<{ approvalId: string; zipPath: string }> {
    const zip = await buildForeignExportZip(name)
    const staged = await transfer.importAgent(zip)
    expect(staged.status).toBe(202)
    const approvalId = staged.data!.pendingApprovalId!
    const entry = foreignReg.getForeignApproval(approvalId)!
    return { approvalId, zipPath: entry.importPayloadPath! }
  }

  /** Every store back to the pre-call state: no agent, approval pending, ZIP intact. */
  function expectFullRollback(name: string, approvalId: string, zipPath: string): void {
    expect(registry.loadAgents().filter(a => a.name === name)).toHaveLength(0)
    const entry = foreignReg.getForeignApproval(approvalId)
    expect(entry?.status).toBe('pending')
    expect(entry?.importPayloadPath).toBe(zipPath)
    expect(fs.existsSync(zipPath)).toBe(true)
  }

  it('G01 — importAgent fails: nothing is created, the approval stays pending', async () => {
    const { approvalId, zipPath } = await stagePending('g1-fail')
    const res = await foreignSvc.approveForeignAgent(approvalId, {
      importAgent: async () => ({ error: 'seeded import failure', status: 500 }),
    })
    expect(res.status).toBe(500)
    // R51.3 — the exact "no changes were made" wording, and NOT the invalid-state one.
    expect(res.error).toMatch(/^THE COMMAND FAILED/)
    expect(res.error).not.toMatch(/INVALID STATE/)
    expect(res.error).toContain('seeded import failure')
    expectFullRollback('g1-fail', approvalId, zipPath)
  })

  it('G02 — saveKeyPair throws: the imported agent is un-imported, no orphan remains', async () => {
    const { approvalId, zipPath } = await stagePending('g2-fail')
    const res = await foreignSvc.approveForeignAgent(approvalId, {
      saveKeyPair: () => { throw new Error('seeded keypair write failure') },
    })
    expect(res.status).toBe(500)
    expect(res.error).toMatch(/^THE COMMAND FAILED/)
    expect(res.error).not.toMatch(/INVALID STATE/)
    expectFullRollback('g2-fail', approvalId, zipPath)
  })

  it('G03 — markAgentAsAMPRegistered throws: agent + keys rolled back, fresh fp not backed', async () => {
    const { approvalId, zipPath } = await stagePending('g3-fail')
    const res = await foreignSvc.approveForeignAgent(approvalId, {
      markAgentAsAMPRegistered: async () => { throw new Error('seeded registry bind failure') },
    })
    expect(res.status).toBe(500)
    expectFullRollback('g3-fail', approvalId, zipPath)
  })

  it('G04 — updateForeignApproval writes nothing: the already-associated fresh fp is REVOKED', async () => {
    const { approvalId, zipPath } = await stagePending('g4-fail')
    let capturedFp: string | undefined
    const res = await foreignSvc.approveForeignAgent(approvalId, {
      updateForeignApproval: (_id, patch) => {
        capturedFp = patch.newFingerprint
        return null
      },
    })
    expect(res.status).toBe(500)
    expectFullRollback('g4-fail', approvalId, zipPath)
    // The rollback must have appended the compensating aid_revoke for the fresh
    // fp. `revoked: true` (not just `ok: false`) is the non-vacuous half: a bare
    // ok-false is also satisfied when no association ever landed (in this test
    // env markAgentAsAMPRegistered's fire-and-forget associate emit fails its
    // lazy require and logs an AUDIT GAP), whereas revoked-true can ONLY come
    // from the revoke row the compensation wrote.
    expect(capturedFp).toBeTruthy()
    await flushLedger('registry')
    authority.invalidateRecoveryCache()
    await registry.registryLedger.verify()
    const assoc = authority.isAidAssociated(capturedFp!)
    expect(assoc.ok).toBe(false)
    expect(assoc.revoked).toBe(true)
  })

  it('G05 — the final ledger append fails: full rollback, and the RETRY mints no duplicate', async () => {
    const { approvalId, zipPath } = await stagePending('g5-fail')
    let capturedFp: string | undefined
    let capturedAgentId: string | undefined
    const res = await foreignSvc.approveForeignAgent(approvalId, {
      recordAidReissue: (agentId, _oldFp, newFp) => {
        capturedAgentId = agentId
        capturedFp = newFp
        throw new Error('seeded ledger append failure')
      },
    })
    expect(res.status).toBe(500)
    expect(res.error).toMatch(/^THE COMMAND FAILED/)
    expectFullRollback('g5-fail', approvalId, zipPath)
    // The agent data dir is gone too, not just the registry row.
    const dataDir = path.join(TMP_HOME, '.aimaestro', 'agents', capturedAgentId!)
    expect(fs.existsSync(dataDir)).toBe(false)
    // After the rollback the fresh fp must not be ledger-backed (the G04 test
    // pins the stronger revoked-true half; here ok-false is enough because the
    // retry below re-derives everything from scratch either way).
    await flushLedger('registry')
    authority.invalidateRecoveryCache()
    await registry.registryLedger.verify()
    expect(authority.isAidAssociated(capturedFp!).ok).toBe(false)

    // THE regression this card exists for: the retry after a failed approve
    // succeeds and produces exactly ONE agent — no duplicate, no orphan.
    const retry = await foreignSvc.approveForeignAgent(approvalId)
    expect(retry.error, retry.error).toBeUndefined()
    expect(retry.status).toBe(200)
    expect(registry.loadAgents().filter(a => a.name === 'g5-fail')).toHaveLength(1)
    expect(foreignReg.getForeignApproval(approvalId)?.status).toBe('approved')
    // The retry minted a DIFFERENT fresh fingerprint, and that one is backed.
    expect(retry.data!.newFingerprint).not.toBe(capturedFp)
    await flushLedger('registry')
    authority.invalidateRecoveryCache()
    await registry.registryLedger.verify()
    expect(authority.isAidAssociated(retry.data!.newFingerprint).ok).toBe(true)
  })
})

describe('foreign-import-approval — native (same-host) import is unaffected', () => {
  it('a same-host export (exportedFrom.hostname=this-host) imports directly + associates its AID', async () => {
    // Build a same-host export: override the manifest hostname to THIS host.
    const manifest = {
      version: '1.2.0',
      exportedAt: new Date().toISOString(),
      exportedFrom: { hostname: 'this-host', platform: 'darwin', aiMaestroVersion: '0.29.0' },
      // M4: valid uuidv4() id (real exports always have one).
      agent: { id: 'a1b2c3d4-e5f6-4789-9abc-def012345678', name: 'gamma-native' },
      contents: { hasRegistry: true, hasDatabase: false, hasMessages: false, hasKeys: true, hasRegistrations: false },
    }
    const agentRecord = {
      id: 'a1b2c3d4-e5f6-4789-9abc-def012345678', name: 'gamma-native', alias: 'gamma-native', governanceTitle: 'autonomous',
      workingDirectory: path.join(TMP_HOME, 'agents', 'gamma-native'),
      deployment: { type: 'local', local: { hostname: 'this-host', platform: 'darwin' } },
      sessions: [], status: 'offline', tools: {},
      ampIdentity: { fingerprint: foreignFingerprint, publicKeyHex: 'deadbeef', keyAlgorithm: 'Ed25519', createdAt: new Date().toISOString(), ampAddress: 'gamma-native@default.aimaestro.local', tenant: 'default' },
      metadata: { amp: { fingerprint: foreignFingerprint } },
    }
    const zip = await new Promise<Buffer>((resolve, reject) => {
      const archive = archiver('zip', { zlib: { level: 9 } })
      const chunks: Buffer[] = []
      archive.on('data', (c: Buffer) => chunks.push(c))
      archive.on('end', () => resolve(Buffer.concat(chunks)))
      archive.on('error', reject)
      archive.append(JSON.stringify(manifest), { name: 'manifest.json' })
      archive.append(JSON.stringify(agentRecord), { name: 'registry.json' })
      archive.append(foreignPrivPem, { name: 'keys/private.pem' })
      archive.append(foreignPubPem, { name: 'keys/public.pem' })
      archive.finalize()
    })

    const res = await transfer.importAgent(zip, { newId: true })
    // Native import succeeds directly (200), no approval queue.
    expect(res.status).toBe(200)
    expect(res.data?.success).toBe(true)
    const importedFp = res.data!.agent!.ampIdentity!.fingerprint

    await flushLedger('registry')
    authority.invalidateRecoveryCache()
    await registry.registryLedger.verify()
    // The native import recorded an association for the imported fingerprint.
    expect(authority.isAidAssociated(importedFp).ok).toBe(true)
  })
})
