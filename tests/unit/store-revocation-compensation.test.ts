/**
 * The two module-owned revocation seams — R51 / TRDD-DQ6XN2VP.
 *
 * WHY THESE LIVE INSIDE THEIR MODULES
 * -----------------------------------
 * Four of the six stores DeleteAgent mutates export their writer, so their rollback is ordinary
 * pipeline-layer code. `lib/amp-auth.ts` and `lib/aid-token.ts` do not: their load/save are
 * module-private and every mutation runs under `withLock`. Exporting those writers so a pipeline
 * could snapshot-and-restore from outside would bypass the serialization the locks exist for — a
 * concurrency regression, not a convenience. So each module grew its own compensable revoker.
 *
 * The two are NOT the same code, because the two mutations are not the same shape: amp-auth flips
 * `status` in place (undo needs only the hashes), aid-token REMOVES rows (undo needs the rows).
 *
 * 0-IMPACT: both modules resolve their paths at MODULE LOAD (`getStateDir()` / `statePath()`), so
 * containment has to be in place before the first import — hence the hoisted `vi.mock` below and
 * the `vi.resetModules()` + dynamic import in every fixture loader. The final test proves the
 * containment positively rather than trusting it.
 */
import { describe, it, expect, vi, afterAll } from 'vitest'
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import type { AMPApiKeyRecord } from '@/lib/types/amp'
import type { AIDTokenRecord } from '@/lib/aid-token'

const { FAKE_HOME, FAKE_STATE } = vi.hoisted(() => {
  const os = require('os') as typeof import('os')
  const fs = require('fs') as typeof import('fs')
  const path = require('path') as typeof import('path')
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'aim-revocation-'))
  return { FAKE_HOME: path.join(root, 'home'), FAKE_STATE: path.join(root, 'state') }
})

vi.mock('@/lib/ecosystem-constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/ecosystem-constants')>()
  const { fakeEcosystemPaths } = await import('@/tests/helpers/fake-ecosystem-home')
  return fakeEcosystemPaths(actual, FAKE_HOME, FAKE_STATE)
})

const API_KEYS_FILE = join(FAKE_STATE, 'amp-api-keys.json')
const TOKENS_FILE = join(FAKE_STATE, 'governance-tokens', 'active-tokens.json')

afterAll(() => {
  rmSync(FAKE_STATE, { recursive: true, force: true })
  rmSync(FAKE_HOME, { recursive: true, force: true })
})

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function apiKey(agentId: string, suffix: string, status: AMPApiKeyRecord['status']): AMPApiKeyRecord {
  return {
    key_hash: `sha256:${suffix.padEnd(64, '0')}`,
    agent_id: agentId,
    tenant_id: 'default',
    address: `${agentId}@default.local`,
    created_at: '2026-07-01T00:00:00.000Z',
    expires_at: null,
    status,
  }
}

function token(agentId: string, suffix: string, expiresAt: string): AIDTokenRecord {
  return {
    token_hash: `sha256:${suffix.padEnd(64, '0')}`,
    agent_id: agentId,
    agent_name: agentId,
    governance_title: 'member',
    team_id: null,
    scope: 'governance',
    issued_at: '2026-07-01T00:00:00.000Z',
    expires_at: expiresAt,
  }
}

/** An hour out, so a seeded record is unambiguously live for the duration of a test. */
const FUTURE = () => new Date(Date.now() + 3_600_000).toISOString()

/**
 * Seed the store on disk and import the module FRESH.
 *
 * The reset is load-bearing, not hygiene: both modules cache their file in memory (30 s for keys,
 * 5 s for tokens), so a module carried over from the previous test would answer from that cache and
 * never read the fixture just written.
 */
async function loadAmp(seed: AMPApiKeyRecord[]) {
  vi.resetModules()
  mkdirSync(FAKE_STATE, { recursive: true })
  writeFileSync(API_KEYS_FILE, JSON.stringify(seed, null, 2))
  return import('@/lib/amp-auth')
}

async function loadAid(seed: AIDTokenRecord[]) {
  vi.resetModules()
  mkdirSync(join(FAKE_STATE, 'governance-tokens'), { recursive: true })
  writeFileSync(TOKENS_FILE, JSON.stringify(seed, null, 2))
  return import('@/lib/aid-token')
}

/** Read the store back from DISK, not from the module — the assertion must not trust the cache. */
const keysOnDisk = (): AMPApiKeyRecord[] => JSON.parse(readFileSync(API_KEYS_FILE, 'utf-8'))
const tokensOnDisk = (): AIDTokenRecord[] => JSON.parse(readFileSync(TOKENS_FILE, 'utf-8'))

/** Status of the seeded key with this suffix, read from disk. */
const statusOf = (suffix: string): AMPApiKeyRecord['status'] | undefined =>
  keysOnDisk().find(k => k.key_hash === apiKey('', suffix, 'active').key_hash)?.status

// ---------------------------------------------------------------------------
// lib/amp-auth.ts — status flip, undone from the hashes
// ---------------------------------------------------------------------------

describe('revokeAllKeysForAgentCompensable', () => {
  it('flips only the target agent\'s ACTIVE keys and reports how many', async () => {
    const amp = await loadAmp([
      apiKey('agent-a', 'a', 'active'),
      apiKey('agent-a', 'b', 'active'),
      apiKey('agent-b', 'c', 'active'),
    ])

    const revocation = await amp.revokeAllKeysForAgentCompensable('agent-a')

    expect(revocation.count).toBe(2)
    expect(statusOf('a')).toBe('revoked')
    expect(statusOf('b')).toBe('revoked')
    expect(statusOf('c')).toBe('active')
  })

  it('restores exactly what it flipped', async () => {
    const amp = await loadAmp([
      apiKey('agent-a', 'a', 'active'),
      apiKey('agent-b', 'c', 'active'),
    ])

    const revocation = await amp.revokeAllKeysForAgentCompensable('agent-a')
    expect(statusOf('a')).toBe('revoked')

    const restored = await revocation.restore()

    expect(restored).toBe(1)
    expect(statusOf('a')).toBe('active')
    expect(statusOf('c')).toBe('active')
  })

  /**
   * THE security property. A rollback that reactivated every revoked key of the agent would
   * resurrect a key that was rotated out long before this call — the undo contract says reverse
   * only what `run` recorded, and here that distinction is a live credential.
   */
  it('leaves a key that was ALREADY revoked before the call still revoked', async () => {
    const amp = await loadAmp([
      apiKey('agent-a', 'a', 'active'),
      apiKey('agent-a', 'd', 'revoked'), // rotated out earlier — must NOT come back
    ])

    const revocation = await amp.revokeAllKeysForAgentCompensable('agent-a')
    expect(revocation.count).toBe(1)

    const restored = await revocation.restore()

    expect(restored).toBe(1)
    expect(statusOf('a')).toBe('active')
    expect(statusOf('d')).toBe('revoked')
  })

  it('is idempotent — a second restore changes nothing', async () => {
    const amp = await loadAmp([apiKey('agent-a', 'a', 'active')])

    const revocation = await amp.revokeAllKeysForAgentCompensable('agent-a')
    expect(await revocation.restore()).toBe(1)
    expect(await revocation.restore()).toBe(0)
    expect(statusOf('a')).toBe('active')
  })

  /**
   * "run did none of it" has to be TRUE, not merely tolerated. `loadApiKeys` copies the ARRAY but
   * shares the record OBJECTS with the module cache, so an in-place flip followed by a failing save
   * would leave the cache reporting keys as revoked that are still active on disk — a residue no
   * undo is ever handed, because the gate's `run` threw before returning the handle.
   */
  it('leaves the store AND the in-memory cache untouched when the save fails', async () => {
    const amp = await loadAmp([apiKey('agent-a', 'a', 'active')])

    // Deterministic write failure: put a DIRECTORY where saveApiKeys wants its temp file (EISDIR).
    // Not chmod — a permissions fixture passes vacuously whenever the suite runs as root.
    const tmpPath = `${API_KEYS_FILE}.tmp.${process.pid}`
    mkdirSync(tmpPath, { recursive: true })
    try {
      await expect(amp.revokeAllKeysForAgentCompensable('agent-a')).rejects.toThrow()

      expect(statusOf('a')).toBe('active')                              // disk unchanged
      expect(amp.getKeysForAgent('agent-a')[0]?.status).toBe('active')  // cache not poisoned
    } finally {
      rmSync(tmpPath, { recursive: true, force: true })
    }
  })

  it('reports 0 and restores 0 when the agent has no active keys', async () => {
    const amp = await loadAmp([apiKey('agent-b', 'c', 'active')])

    const revocation = await amp.revokeAllKeysForAgentCompensable('agent-a')

    expect(revocation.count).toBe(0)
    expect(await revocation.restore()).toBe(0)
    expect(statusOf('c')).toBe('active')
  })
})

describe('revokeAllKeysForAgent (delegating form)', () => {
  it('keeps its count-returning contract for its existing callers', async () => {
    const amp = await loadAmp([
      apiKey('agent-a', 'a', 'active'),
      apiKey('agent-a', 'b', 'active'),
      apiKey('agent-b', 'c', 'active'),
    ])

    expect(await amp.revokeAllKeysForAgent('agent-a')).toBe(2)
    expect(statusOf('a')).toBe('revoked')
    expect(statusOf('c')).toBe('active')
  })
})

// ---------------------------------------------------------------------------
// lib/aid-token.ts — row removal, undone from the rows
// ---------------------------------------------------------------------------

describe('revokeTokensForAgentCompensable', () => {
  it('removes only the target agent\'s rows and reports how many', async () => {
    const aid = await loadAid([
      token('agent-a', 'a', FUTURE()),
      token('agent-a', 'b', FUTURE()),
      token('agent-b', 'c', FUTURE()),
    ])

    const revocation = await aid.revokeTokensForAgentCompensable('agent-a')

    expect(revocation.count).toBe(2)
    expect(tokensOnDisk().map(t => t.agent_id)).toEqual(['agent-b'])
  })

  it('re-inserts exactly the rows it removed', async () => {
    const aid = await loadAid([
      token('agent-a', 'a', FUTURE()),
      token('agent-b', 'c', FUTURE()),
    ])

    const revocation = await aid.revokeTokensForAgentCompensable('agent-a')
    expect(tokensOnDisk()).toHaveLength(1)

    const restored = await revocation.restore()

    expect(restored).toBe(1)
    expect(tokensOnDisk().map(t => t.agent_id).sort()).toEqual(['agent-a', 'agent-b'])
  })

  /**
   * `loadTokens` prunes expired rows on EVERY load, so re-inserting one would write a row the next
   * read drops — a rollback that only appears to have worked. It is skipped, and the count says so.
   */
  it('does not re-insert a record that expired between the revoke and the restore', async () => {
    // The clock has to MOVE for this: the record must be live when revoked and expired when
    // restored. Fake timers are safe here because `acquireLock` only arms a timeout on the
    // CONTENDED path, and these calls are sequential.
    vi.useFakeTimers()
    try {
      const start = new Date('2026-07-30T12:00:00.000Z')
      vi.setSystemTime(start)

      const aid = await loadAid([
        token('agent-a', 'a', new Date(start.getTime() + 3_600_000).toISOString()), // +1h
        token('agent-b', 'c', new Date(start.getTime() + 7_200_000).toISOString()), // +2h
      ])

      const revocation = await aid.revokeTokensForAgentCompensable('agent-a')
      expect(revocation.count).toBe(1)

      vi.setSystemTime(new Date(start.getTime() + 5_400_000)) // +1h30 — agent-a's token has expired

      expect(await revocation.restore()).toBe(0)
      expect(tokensOnDisk().map(t => t.agent_id)).toEqual(['agent-b'])
    } finally {
      vi.useRealTimers()
    }
  })

  it('is idempotent — a second restore changes nothing', async () => {
    const aid = await loadAid([token('agent-a', 'a', FUTURE())])

    const revocation = await aid.revokeTokensForAgentCompensable('agent-a')
    expect(await revocation.restore()).toBe(1)
    expect(await revocation.restore()).toBe(0)
    expect(tokensOnDisk()).toHaveLength(1)
  })
})

describe('revokeTokensForAgent (delegating form)', () => {
  it('keeps its count-returning contract for its existing callers', async () => {
    const aid = await loadAid([
      token('agent-a', 'a', FUTURE()),
      token('agent-a', 'b', FUTURE()),
      token('agent-b', 'c', FUTURE()),
    ])

    expect(await aid.revokeTokensForAgent('agent-a')).toBe(2)
    expect(tokensOnDisk().map(t => t.agent_id)).toEqual(['agent-b'])
  })
})

// ---------------------------------------------------------------------------
// Containment, proved rather than assumed
// ---------------------------------------------------------------------------

describe('0-IMPACT containment', () => {
  it('wrote both stores under the fake state dir, which is under the OS temp dir', async () => {
    await loadAmp([apiKey('agent-a', 'a', 'active')])
    await loadAid([token('agent-a', 'a', FUTURE())])

    // POSITIVE proof: the artifacts are HERE. An "the real home is untouched" assertion alone
    // passes just as happily when the mock silently failed and the test wrote nothing at all.
    expect(existsSync(API_KEYS_FILE)).toBe(true)
    expect(existsSync(TOKENS_FILE)).toBe(true)
    expect(FAKE_STATE.startsWith(tmpdir()) || FAKE_STATE.startsWith('/private')).toBe(true)
  })
})
