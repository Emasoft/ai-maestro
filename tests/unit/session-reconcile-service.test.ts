/**
 * TRDD-1ee4a3c1 Phase 1 — session-reconcile-service unit tests.
 *
 * Covers ensureSessionsJsonBootstrapped()'s three load-bearing invariants:
 *   1. BOOTSTRAP-WHEN-MISSING — when ~/.aimaestro/sessions.json is absent/empty,
 *      synthesize one PersistedSession per (non-deleted, workdir-exists) agent ×
 *      session index, using computeSessionName(name, index). An agent with no
 *      `sessions` array defaults to index [0].
 *   2. PATH VALIDATION / SKIPS — an agent whose workingDirectory no longer exists
 *      on disk is skipped AND counted; a soft-deleted (deletedAt) agent is skipped
 *      but NOT counted — matching the service's two distinct skip paths (a stale
 *      cache entry is surfaced to the orphan path, never synthesized here).
 *   3. NON-DESTRUCTIVE — when sessions.json already has ANY entries, the file is
 *      left byte-identical and the call is a no-op (bootstrapped:false). This is
 *      the governance invariant: entries are never pruned or rewritten here.
 *
 * Isolation follows the repo's user-registry.test.ts pattern: os.homedir() →
 * a temp dir so every getStateDir()-derived read/write lands in a sandbox, NOT
 * the real ~/.aimaestro. ONLY the environment edge (homedir) is mocked; the
 * reconcile logic, real fs, real session-persistence, and real computeSessionName
 * all run unmocked (no mocking of the code under test).
 */
import fs from 'fs'
import os from 'os'
import path from 'path'
import { describe, it, expect, beforeEach, vi } from 'vitest'

// ── Isolation: os.homedir() → temp dir BEFORE any real module loads ──────────
// getStateDir() (lib/ecosystem-constants) is called at MODULE LOAD by transitive
// imports (e.g. hosts-config.ts), so homedir() fires during the service import —
// before ordinary top-level consts initialize. vi.hoisted() creates TMP_HOME
// ahead of both the mock and the imports, so the hoisted mock factory can close
// over it without a temporal-dead-zone error. The factory keeps ...actual so
// os.tmpdir() and everything else stay real; only homedir is overridden.
const { TMP_HOME } = vi.hoisted(() => {
  const nodeOs = require('os') as typeof import('os')
  const nodeFs = require('fs') as typeof import('fs')
  const nodePath = require('path') as typeof import('path')
  return { TMP_HOME: nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'aim-session-reconcile-')) }
})
vi.mock('os', async (importOriginal) => {
  const actual = await importOriginal<typeof import('os')>()
  return { ...actual, default: { ...actual, homedir: () => TMP_HOME }, homedir: () => TMP_HOME }
})

import { ensureSessionsJsonBootstrapped } from '@/services/session-reconcile-service'
import { loadPersistedSessions } from '@/lib/session-persistence'

const STATE_DIR = path.join(TMP_HOME, '.aimaestro')
const AGENTS_DIR = path.join(STATE_DIR, 'agents')
const REGISTRY_FILE = path.join(AGENTS_DIR, 'registry.json')
const SESSIONS_FILE = path.join(STATE_DIR, 'sessions.json')

function writeRegistry(agents: unknown[]): void {
  fs.mkdirSync(AGENTS_DIR, { recursive: true })
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(agents, null, 2))
}

/** Create a real, existing working directory under the sandbox so path validation passes. */
function makeWorkdir(name: string): string {
  const dir = path.join(TMP_HOME, 'agents', name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

beforeEach(() => {
  // Clean slate: each test fully controls both files. Removing/rewriting the
  // registry also bumps its mtime, so loadAgents()'s mtime cache is invalidated
  // between tests (it never returns another test's agents).
  for (const f of [SESSIONS_FILE, REGISTRY_FILE]) {
    if (fs.existsSync(f)) fs.rmSync(f)
  }
})

describe('ensureSessionsJsonBootstrapped (TRDD-1ee4a3c1 Phase 1)', () => {
  it('synthesizes one entry per session index for live agents with an existing workdir, skipping missing-dir (counted) and soft-deleted (uncounted) agents', () => {
    const alphaDir = makeWorkdir('alpha')
    const betaDir = makeWorkdir('beta')
    const deltaDir = makeWorkdir('delta')
    writeRegistry([
      // no sessions array → defaults to index [0] → one entry "alpha"
      { id: 'id-alpha', name: 'alpha', workingDirectory: alphaDir, createdAt: '2026-01-01T00:00:00.000Z' },
      // two indexes → "beta" (index 0) and "beta_2" (index 2)
      { id: 'id-beta', name: 'beta', workingDirectory: betaDir, createdAt: '2026-01-02T00:00:00.000Z', sessions: [{ index: 0 }, { index: 2 }] },
      // workdir gone → skipped + counted
      { id: 'id-gamma', name: 'gamma', workingDirectory: path.join(TMP_HOME, 'agents', 'gamma-gone'), createdAt: '2026-01-03T00:00:00.000Z' },
      // soft-deleted (tombstone) → skipped but NOT counted, even though its dir exists
      { id: 'id-delta', name: 'delta', workingDirectory: deltaDir, createdAt: '2026-01-04T00:00:00.000Z', deletedAt: '2026-06-01T00:00:00.000Z' },
    ])

    const res = ensureSessionsJsonBootstrapped()

    expect(res.bootstrapped).toBe(true)
    expect(res.written).toBe(3) // alpha + beta + beta_2
    expect(res.skipped).toBe(1) // gamma (missing dir); delta is continue'd uncounted

    const sessions = loadPersistedSessions()
    expect(sessions.map(s => s.id).sort()).toEqual(['alpha', 'beta', 'beta_2'])

    const alpha = sessions.find(s => s.id === 'alpha')
    expect(alpha).toBeDefined()
    expect(alpha?.name).toBe('alpha')
    expect(alpha?.workingDirectory).toBe(alphaDir)
    expect(alpha?.agentId).toBe('id-alpha')
    expect(alpha?.createdAt).toBe('2026-01-01T00:00:00.000Z')

    // The index-2 session name follows computeSessionName(name, index).
    expect(sessions.find(s => s.id === 'beta_2')?.workingDirectory).toBe(betaDir)

    // No entry for the soft-deleted or missing-dir agents.
    expect(sessions.some(s => s.id === 'delta')).toBe(false)
    expect(sessions.some(s => s.id === 'gamma')).toBe(false)
  })

  it('is a non-destructive no-op when sessions.json already has entries', () => {
    // Pre-seed a stale entry — the kind the orphan/unregistered-session path
    // (not this service) owns. It must survive untouched.
    fs.mkdirSync(STATE_DIR, { recursive: true })
    const preexisting = [
      {
        id: 'stale-session',
        name: 'stale-session',
        workingDirectory: '/gone',
        createdAt: '2025-01-01T00:00:00.000Z',
        lastSavedAt: '2025-01-01T00:00:00.000Z',
        agentId: 'ghost',
      },
    ]
    fs.writeFileSync(SESSIONS_FILE, JSON.stringify(preexisting, null, 2))
    const before = fs.readFileSync(SESSIONS_FILE, 'utf-8')

    // A live agent that WOULD be synthesized if the non-destructive guard were absent.
    writeRegistry([
      { id: 'id-live', name: 'live', workingDirectory: makeWorkdir('live'), createdAt: '2026-01-01T00:00:00.000Z' },
    ])

    const res = ensureSessionsJsonBootstrapped()

    expect(res).toEqual({ bootstrapped: false, written: 0, skipped: 0 })
    // File untouched byte-for-byte: no prune, no rewrite, no synthesis appended.
    expect(fs.readFileSync(SESSIONS_FILE, 'utf-8')).toBe(before)
    expect(loadPersistedSessions()).toHaveLength(1)
  })
})
