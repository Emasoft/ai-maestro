/**
 * Integration test — R33 signed-ledger recovery roundtrip.
 *
 * REAL fs + REAL host-keys + sandbox os.homedir(). Simulates the R33 scenario:
 * an agent's live token-store / recovery cache is LOST, but the host-signed
 * ledger still records its full identity history. reconstructAgentAuthState()
 * must rebuild {agentId, governanceTitle, teamId} from the ledger alone.
 *
 *   1. Build a real ledger: aid_associate(agent) → change_title → change_team
 *      (all host-signed via the real SignedLedger).
 *   2. WIPE the recovery cache (the "token store lost" event).
 *   3. reconstructAgentAuthState(fingerprint) → returns the LEDGER-derived title
 *      + team (latest wins), and re-populates the recovery cache.
 *   4. A subsequent isAidAssociated hit is served from the rebuilt cache.
 *
 * The token-route's automatic recovery fallback (which calls this on a token
 * exchange when the AID is unbacked) is covered in
 * tests/token-route-ledger-gate.test.ts; here we prove the reconstruction itself
 * against a genuine signed chain.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-aid-recovery-'))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual, homedir: () => TMP_HOME, hostname: () => 'recovery-host' },
    homedir: () => TMP_HOME,
    hostname: () => 'recovery-host',
  }
})

type AuthorityModule = typeof import('@/lib/aid-ledger-authority')
type RegistryModule = typeof import('@/lib/agent-registry')
type LedgerEmitModule = typeof import('@/lib/ledger-emit')

let authority: AuthorityModule
let registry: RegistryModule
let ledgerEmit: LedgerEmitModule
const AGENTS_DIR = path.join(TMP_HOME, '.aimaestro', 'agents')
const RECOVERY_CACHE = path.join(TMP_HOME, '.aimaestro', 'aid-recovery-cache.json')

beforeAll(async () => {
  const hostKeys = await import('@/lib/host-keys')
  hostKeys.getOrCreateHostKeyPair()
  authority = await import('@/lib/aid-ledger-authority')
  registry = await import('@/lib/agent-registry')
  ledgerEmit = await import('@/lib/ledger-emit')
})

afterAll(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch { /* best-effort */ }
})

beforeEach(async () => {
  try {
    if (fs.existsSync(AGENTS_DIR)) {
      for (const f of fs.readdirSync(AGENTS_DIR)) {
        if (/^registry\.ledger/.test(f)) fs.rmSync(path.join(AGENTS_DIR, f), { force: true })
      }
    }
    if (fs.existsSync(RECOVERY_CACHE)) fs.rmSync(RECOVERY_CACHE, { force: true })
  } catch { /* best-effort */ }
  await registry.registryLedger.verify()
  authority.invalidateRecoveryCache()
})

async function flushLedger(): Promise<void> {
  const { acquireLock } = await import('@/lib/file-lock')
  const release = await acquireLock('ledger:registry')
  release()
  await new Promise(r => setTimeout(r, 5))
}

describe('aid-recovery-roundtrip — R33 reconstruct from the signed ledger', () => {
  it('rebuilds title + team from the ledger after the recovery cache is lost', async () => {
    const agentId = 'recover-agent-1'
    const fp = 'SHA256:recover-fp-1'

    // 1. Build a real, host-signed identity history on the ledger.
    authority.recordAidAssociation(agentId, fp, 'recovery-host')
    await flushLedger()
    ledgerEmit.emitAgentOp('change_title', [{ op: 'replace', path: `/agents/${agentId}/governanceTitle`, value: 'chief-of-staff' }], { action: 'change-title', agentId: null, actor: 'user' })
    await flushLedger()
    ledgerEmit.emitAgentOp('change_title', [{ op: 'replace', path: `/agents/${agentId}/governanceTitle`, value: 'manager' }], { action: 'change-title', agentId: null, actor: 'user' })
    await flushLedger()
    ledgerEmit.emitAgentOp('change_team', [{ op: 'replace', path: `/agents/${agentId}/team`, value: 'team-recover' }], { action: 'change-team', agentId: null, actor: 'user' })
    await flushLedger()

    // 2. "Token store lost" — wipe the derived recovery cache.
    if (fs.existsSync(RECOVERY_CACHE)) fs.rmSync(RECOVERY_CACHE, { force: true })
    authority.invalidateRecoveryCache()
    expect(fs.existsSync(RECOVERY_CACHE)).toBe(false)

    // 3. Reconstruct from the ledger alone.
    const recovered = authority.reconstructAgentAuthState(fp)
    expect(recovered).not.toBeNull()
    expect(recovered!.agentId).toBe(agentId)
    expect(recovered!.governanceTitle).toBe('manager')   // latest change_title wins
    expect(recovered!.teamId).toBe('team-recover')
    expect(recovered!.fingerprint).toBe(fp)

    // 4. The recovery cache was rebuilt; a subsequent gate hit is cache-served.
    expect(fs.existsSync(RECOVERY_CACHE)).toBe(true)
    const cache = JSON.parse(fs.readFileSync(RECOVERY_CACHE, 'utf-8'))
    expect(cache.rows[fp]).toBeDefined()
    expect(cache.rows[fp].governanceTitle).toBe('manager')
    expect(cache.rows[fp].teamId).toBe('team-recover')

    const assoc = authority.isAidAssociated(fp)
    expect(assoc.ok).toBe(true)
    expect(assoc.agentId).toBe(agentId)
  })

  it('reconstruct returns null when the agent was revoked (deleted) even if history exists', async () => {
    const agentId = 'recover-agent-2'
    const fp = 'SHA256:recover-fp-2'
    authority.recordAidAssociation(agentId, fp, 'recovery-host')
    await flushLedger()
    ledgerEmit.emitAgentOp('change_title', [{ op: 'replace', path: `/agents/${agentId}/governanceTitle`, value: 'manager' }], { action: 'change-title', agentId: null, actor: 'user' })
    await flushLedger()
    // Agent deleted → revoke.
    authority.recordAidRevocation(agentId, fp, 'agent-deleted')
    await flushLedger()
    authority.invalidateRecoveryCache()

    expect(authority.reconstructAgentAuthState(fp)).toBeNull()
  })

  it('recovers an association-only agent with default title (no change_title/team in the ledger)', async () => {
    const agentId = 'recover-agent-3'
    const fp = 'SHA256:recover-fp-3'
    authority.recordAidAssociation(agentId, fp, 'recovery-host')
    await flushLedger()
    authority.invalidateRecoveryCache()

    const recovered = authority.reconstructAgentAuthState(fp)
    expect(recovered).not.toBeNull()
    expect(recovered!.agentId).toBe(agentId)
    expect(recovered!.governanceTitle).toBe('autonomous') // default
    expect(recovered!.teamId).toBeNull()
  })
})
