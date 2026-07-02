/**
 * Unit tests for lib/aid-ledger-authority.ts (R33 / R34).
 *
 * These exercise the REAL ledger + REAL Ed25519 host-keys (no mocking of the
 * unit under test). os.homedir() is redirected to a per-test temp dir so the
 * signed-ledger files, archives, and recovery cache land in a sandbox, not
 * ~/.aimaestro. host-keys are auto-created in the sandbox so the chain signs.
 *
 * Coverage:
 *   - isAidAssociated: false with no entry; true after recordAidAssociation;
 *     false after a later recordAidRevocation; reads from a rotation ARCHIVE
 *     file (Risk R3); cache-hit avoids the walk.
 *   - reconstructAgentAuthState: replays aid_associate→change_title→change_team
 *     to the latest title/team; null when no association; null after revoke.
 *   - recordAidReissue: the OLD foreign fingerprint stays unbacked, the NEW one
 *     is backed (R34.2 impersonation defense).
 *
 * NOTE on the toggle: this module's record/read functions are flag-INDEPENDENT
 * (only the token-route MINT and agent-auth SPEND gates read
 * enforceAidAssociation). The OFF/ON behavior of those gates is covered in
 * tests/token-route-ledger-gate.test.ts and tests/agent-auth-spend-gate.test.ts.
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'

// ── Redirect os.homedir() to a sandbox BEFORE any real module loads. ─────────
const TMP_HOME = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-aid-authority-'))
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return {
    ...actual,
    default: { ...actual, homedir: () => TMP_HOME, hostname: () => 'test-host-auth' },
    homedir: () => TMP_HOME,
    hostname: () => 'test-host-auth',
  }
})

type AuthorityModule = typeof import('@/lib/aid-ledger-authority')
type RegistryModule = typeof import('@/lib/agent-registry')

let authority: AuthorityModule
let registry: RegistryModule
const AGENTS_DIR = path.join(TMP_HOME, '.aimaestro', 'agents')
const REGISTRY_LEDGER = path.join(AGENTS_DIR, 'registry.ledger.json')
const RECOVERY_CACHE = path.join(TMP_HOME, '.aimaestro', 'aid-recovery-cache.json')

beforeAll(async () => {
  // Auto-create host keys in the sandbox so SignedLedger.append can sign.
  const hostKeys = await import('@/lib/host-keys')
  hostKeys.getOrCreateHostKeyPair()
  authority = await import('@/lib/aid-ledger-authority')
  registry = await import('@/lib/agent-registry')
})

afterAll(() => {
  try { fs.rmSync(TMP_HOME, { recursive: true, force: true }) } catch { /* best-effort */ }
})

beforeEach(async () => {
  // Wipe the registry ledger + archives + recovery cache between tests so each
  // starts from an empty chain (host keys are preserved → signatures still valid).
  try {
    if (fs.existsSync(AGENTS_DIR)) {
      for (const f of fs.readdirSync(AGENTS_DIR)) {
        if (/^registry\.ledger/.test(f)) fs.rmSync(path.join(AGENTS_DIR, f), { force: true })
      }
    }
    if (fs.existsSync(RECOVERY_CACHE)) fs.rmSync(RECOVERY_CACHE, { force: true })
  } catch { /* best-effort */ }
  // The registryLedger singleton caches `this.entries`; verify() does
  // `loaded=false; ensureLoaded()` which re-reads the now-empty file so the
  // in-memory entries reset to match. Without this, recordAidAssociation's
  // ledger-backed dedupe would see a PRIOR test's entries and falsely skip.
  await registry.registryLedger.verify()
  authority.invalidateRecoveryCache()
})

/** Append a raw change_title entry to the registry ledger via emitAgentOp. */
async function emitChangeTitle(agentId: string, title: string): Promise<void> {
  const { emitAgentOp } = await import('@/lib/ledger-emit')
  emitAgentOp('change_title', [{ op: 'replace', path: `/agents/${agentId}/governanceTitle`, value: title }], {
    action: 'change-title', agentId: null, actor: 'user',
  })
  await flushLedger()
}

async function emitChangeTeam(agentId: string, teamId: string | null): Promise<void> {
  const { emitAgentOp } = await import('@/lib/ledger-emit')
  emitAgentOp('change_team', [{ op: 'replace', path: `/agents/${agentId}/team`, value: teamId }], {
    action: 'change-team', agentId: null, actor: 'user',
  })
  await flushLedger()
}

/**
 * emitAgentOp / record* are fire-and-forget (append() not awaited). Draining the
 * registry-ledger lock is the DETERMINISTIC way to wait for every queued append
 * to finish + persist: acquireLock blocks until the in-flight appends release,
 * so once we get the lock the file is fully written. A small extra tick lets the
 * .catch chains settle.
 */
async function flushLedger(): Promise<void> {
  const { acquireLock } = await import('@/lib/file-lock')
  // The SignedLedger lock name for agents/registry.json is `ledger:registry`.
  const release = await acquireLock('ledger:registry')
  release()
  await new Promise(r => setTimeout(r, 5))
}

describe('aid-ledger-authority — isAidAssociated (R34.1 gate)', () => {
  it('returns {ok:false} for a fingerprint with no association', async () => {
    // Force a fresh chain read by recording an unrelated association first.
    authority.recordAidAssociation('agent-x', 'SHA256:other', 'test-host-auth')
    await flushLedger()
    authority.invalidateRecoveryCache()
    const res = authority.isAidAssociated('SHA256:nope-no-entry')
    expect(res.ok).toBe(false)
  })

  it('returns {ok:true, agentId} after recordAidAssociation', async () => {
    authority.recordAidAssociation('agent-1', 'SHA256:fp-one', 'test-host-auth')
    await flushLedger()
    authority.invalidateRecoveryCache()
    const res = authority.isAidAssociated('SHA256:fp-one')
    expect(res.ok).toBe(true)
    expect(res.agentId).toBe('agent-1')
    expect(res.revoked).toBe(false)
  })

  it('returns {ok:false, revoked:true} after a LATER recordAidRevocation', async () => {
    authority.recordAidAssociation('agent-2', 'SHA256:fp-two', 'test-host-auth')
    await flushLedger()
    authority.recordAidRevocation('agent-2', 'SHA256:fp-two', 'compromised')
    await flushLedger()
    authority.invalidateRecoveryCache()
    const res = authority.isAidAssociated('SHA256:fp-two')
    expect(res.ok).toBe(false)
    expect(res.revoked).toBe(true)
  })

  it('reads an association from a ROTATION ARCHIVE file (Risk R3)', async () => {
    // Record an association, then SIMULATE a rotation by moving the live ledger
    // to an archive file. isAidAssociated must still find it.
    authority.recordAidAssociation('agent-arch', 'SHA256:fp-archived', 'test-host-auth')
    await flushLedger()
    authority.invalidateRecoveryCache()
    // Sanity: live read sees it.
    expect(authority.isAidAssociated('SHA256:fp-archived').ok).toBe(true)

    // Move the live ledger to an archive file (matching rotateLedger's naming).
    const archivePath = path.join(AGENTS_DIR, `registry.ledger.${Date.now()}.archive.json`)
    fs.renameSync(REGISTRY_LEDGER, archivePath)
    authority.invalidateRecoveryCache()
    // Force the live registryLedger to drop its cached entries by appending an
    // unrelated op (which reloads the now-missing live file as empty, then writes).
    authority.recordAidAssociation('agent-other', 'SHA256:fp-live-after', 'test-host-auth')
    await flushLedger()
    authority.invalidateRecoveryCache()

    const res = authority.isAidAssociated('SHA256:fp-archived')
    expect(res.ok).toBe(true)
    expect(res.agentId).toBe('agent-arch')
  })

  it('serves a cache HIT without re-walking (cache populated by a prior miss)', async () => {
    authority.recordAidAssociation('agent-cache', 'SHA256:fp-cache', 'test-host-auth')
    await flushLedger()
    authority.invalidateRecoveryCache()
    // First call: miss → walk → populates cache.
    expect(authority.isAidAssociated('SHA256:fp-cache').ok).toBe(true)
    // The cache file now exists with the row.
    expect(fs.existsSync(RECOVERY_CACHE)).toBe(true)
    const cache = JSON.parse(fs.readFileSync(RECOVERY_CACHE, 'utf-8'))
    expect(cache.rows['SHA256:fp-cache']).toBeDefined()
    expect(cache.rows['SHA256:fp-cache'].agentId).toBe('agent-cache')
    // Second call: hit → still ok.
    expect(authority.isAidAssociated('SHA256:fp-cache').ok).toBe(true)
  })
})

describe('aid-ledger-authority — reconstructAgentAuthState (R33)', () => {
  it('replays aid_associate → change_title → change_team to the latest values', async () => {
    authority.recordAidAssociation('agent-r1', 'SHA256:fp-r1', 'test-host-auth')
    await flushLedger()
    await emitChangeTitle('agent-r1', 'orchestrator')
    await emitChangeTitle('agent-r1', 'manager') // latest wins
    await emitChangeTeam('agent-r1', 'team-alpha')
    authority.invalidateRecoveryCache()

    const recovered = authority.reconstructAgentAuthState('SHA256:fp-r1')
    expect(recovered).not.toBeNull()
    expect(recovered!.agentId).toBe('agent-r1')
    expect(recovered!.governanceTitle).toBe('manager')
    expect(recovered!.teamId).toBe('team-alpha')
    expect(recovered!.fingerprint).toBe('SHA256:fp-r1')
  })

  it('returns null when the fingerprint has no association', async () => {
    authority.recordAidAssociation('agent-r2', 'SHA256:fp-r2', 'test-host-auth')
    await flushLedger()
    authority.invalidateRecoveryCache()
    expect(authority.reconstructAgentAuthState('SHA256:fp-unknown-r')).toBeNull()
  })

  it('returns null after the association is revoked', async () => {
    authority.recordAidAssociation('agent-r3', 'SHA256:fp-r3', 'test-host-auth')
    await flushLedger()
    authority.recordAidRevocation('agent-r3', 'SHA256:fp-r3', 'deleted')
    await flushLedger()
    authority.invalidateRecoveryCache()
    expect(authority.reconstructAgentAuthState('SHA256:fp-r3')).toBeNull()
  })

  it('defaults title to autonomous + team to null when only an association exists', async () => {
    authority.recordAidAssociation('agent-r4', 'SHA256:fp-r4', 'test-host-auth')
    await flushLedger()
    authority.invalidateRecoveryCache()
    const recovered = authority.reconstructAgentAuthState('SHA256:fp-r4')
    expect(recovered).not.toBeNull()
    expect(recovered!.governanceTitle).toBe('autonomous')
    expect(recovered!.teamId).toBeNull()
  })
})

describe('aid-ledger-authority — recordAidReissue (R34.2 impersonation defense)', () => {
  it('leaves the OLD foreign fingerprint unbacked and backs the NEW native one', async () => {
    // The foreign fingerprint was never associated on this host (correct — the
    // foreign import never associates it). Re-issue binds a NEW fingerprint.
    authority.recordAidReissue('agent-foreign', 'SHA256:foreign-old', 'SHA256:native-new', 'remote-host')
    await flushLedger()
    authority.invalidateRecoveryCache()

    const oldRes = authority.isAidAssociated('SHA256:foreign-old')
    expect(oldRes.ok).toBe(false) // foreign key never backed

    const newRes = authority.isAidAssociated('SHA256:native-new')
    expect(newRes.ok).toBe(true)
    expect(newRes.agentId).toBe('agent-foreign')
  })
})
