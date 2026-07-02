/**
 * Portfolio store — the secure-enclave persistence layer (R28).
 *
 * One file per SUBJECT agent at
 *   ~/.aimaestro/agents/portfolios/<subject_agent_id>.json
 * (dir 0o700, file 0o600). A dedicated dir — NOT `agent.metadata` — because
 * co-locating revocable security grants with the immutable-identity surface
 * (R26) risks copy/leak through ChangeName/ChangeClient and would pollute the
 * registry-ledger diff. The dedicated dir gets its own `withLock('portfolios')`
 * lane, an independent 5s cache, and an independent token index.
 *
 * Patterns cloned from lib/aid-token.ts:
 *  - writes happen under `withLock('portfolios')` (awaited)
 *  - reads are cached with a 5s TTL behind a Map index keyed by token_id
 *  - atomic write (.tmp → rename), restrictive perms
 *  - prune-on-load (drop expired + consumed-to-zero, flipping their status)
 *
 * This module is pure persistence: it never signs, never anchors to the
 * ledger, and never decides who-may-mint. Those live in portfolio-sign.ts,
 * portfolio-ledger.ts, and portfolio-issue-guard.ts respectively.
 */

import fs from 'fs'
import path from 'path'
import { withLock } from '@/lib/file-lock'
import { statePath } from '@/lib/ecosystem-constants'
import type { PortfolioToken } from '@/types/portfolio'

const PORTFOLIOS_DIR = statePath('agents', 'portfolios')

// Same 5s blind-window discipline as aid-token.ts (AUTH-MIN-01): a revoked
// token must not stay usable in-cache for long after revocation.
const CACHE_TTL_MS = 5_000

// Per-subject cache of the loaded token list + the load timestamp.
const _cache = new Map<string, { tokens: PortfolioToken[]; ts: number }>()
// Global token_id → token index for O(1) lookup across all loaded subjects.
// Rebuilt lazily whenever a subject's file is (re)loaded.
let _index: Map<string, PortfolioToken> | null = null

// ============================================================================
// Storage primitives
// ============================================================================

function ensureDir(): void {
  if (!fs.existsSync(PORTFOLIOS_DIR)) {
    fs.mkdirSync(PORTFOLIOS_DIR, { recursive: true, mode: 0o700 })
  }
}

/**
 * Reject any subject id that is not a plain identifier. A subject id flows
 * straight into a filename, so a `..` / `/` would escape the portfolios dir
 * (path traversal). Fail closed.
 */
function assertSafeSubjectId(agentId: string): void {
  if (!agentId || typeof agentId !== 'string' || !/^[a-zA-Z0-9._@-]+$/.test(agentId)) {
    throw new Error(`[portfolio-store] Unsafe subject agent id: ${JSON.stringify(agentId)}`)
  }
}

function portfolioFilePath(agentId: string): string {
  assertSafeSubjectId(agentId)
  return path.join(PORTFOLIOS_DIR, `${agentId}.json`)
}

/** Has this token expired? (null expires_at = never.) */
function isExpired(t: PortfolioToken, now: number): boolean {
  return t.expires_at !== null && new Date(t.expires_at).getTime() <= now
}

/**
 * Normalize an in-memory token list: flip the `status` of expired or
 * uses-zero tokens, but KEEP them in the file as a tombstone so the audit
 * record and the cache stay consistent. (The ledger is the ultimate truth;
 * the file is a fast mirror.)
 */
function pruneStatuses(tokens: PortfolioToken[], now: number): PortfolioToken[] {
  return tokens.map(t => {
    if (t.status === 'active' && isExpired(t, now)) {
      return { ...t, status: 'expired' as const }
    }
    if (t.status === 'active' && t.uses_remaining !== null && t.uses_remaining <= 0) {
      return { ...t, status: 'consumed' as const }
    }
    return t
  })
}

function reindex(): void {
  const idx = new Map<string, PortfolioToken>()
  for (const { tokens } of _cache.values()) {
    for (const t of tokens) idx.set(t.token_id, t)
  }
  _index = idx
}

/**
 * Load a subject's portfolio (cached, 5s TTL). Prunes expired/consumed
 * statuses in-memory on every load so callers always see current status.
 * Returns the token array (possibly empty); never throws on a missing file.
 */
export function loadPortfolio(agentId: string): PortfolioToken[] {
  const now = Date.now()
  const cached = _cache.get(agentId)
  if (cached && now - cached.ts < CACHE_TTL_MS) {
    return cached.tokens
  }

  ensureDir()
  const filePath = portfolioFilePath(agentId)
  if (!fs.existsSync(filePath)) {
    _cache.set(agentId, { tokens: [], ts: now })
    reindex()
    return []
  }

  let tokens: PortfolioToken[] = []
  try {
    const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'))
    tokens = Array.isArray(data?.tokens) ? (data.tokens as PortfolioToken[]) : []
  } catch (err) {
    // A corrupt portfolio file makes EVERY token for this subject silently
    // fail. Mirror aid-token.ts: log loudly, return empty (fail closed), do
    // not crash the request.
    console.error(
      `[portfolio-store] Failed to parse ${path.basename(filePath)} — all of this subject's tokens will be treated as absent until repaired:`,
      err instanceof Error ? err.message : err,
    )
    tokens = []
  }

  const pruned = pruneStatuses(tokens, now)
  _cache.set(agentId, { tokens: pruned, ts: now })
  reindex()
  return pruned
}

/** Atomic write of a subject's portfolio (caller holds the lock). */
function savePortfolio(agentId: string, tokens: PortfolioToken[]): void {
  ensureDir()
  const filePath = portfolioFilePath(agentId)
  const payload = { agent_id: agentId, tokens, updated_at: new Date().toISOString() }
  const tmpPath = `${filePath}.tmp.${process.pid}.${Date.now()}`
  fs.writeFileSync(tmpPath, JSON.stringify(payload, null, 2), { mode: 0o600 })
  fs.renameSync(tmpPath, filePath)
  _cache.set(agentId, { tokens, ts: Date.now() })
  reindex()
}

// ============================================================================
// Mutations (all under withLock('portfolios'), awaited)
// ============================================================================

/**
 * Append a token to its subject's portfolio (atomic). The caller is
 * responsible for having signed the token and (immediately after) anchoring
 * it in the ledger + writing back `ledger_seq` via `setLedgerSeq`.
 */
export async function issueToken(token: PortfolioToken): Promise<void> {
  await withLock('portfolios', () => {
    const tokens = loadPortfolio(token.subject_agent_id)
    tokens.push(token)
    savePortfolio(token.subject_agent_id, tokens)
  })
}

/**
 * Write back the ledger anchor seq onto a just-issued token (R34). Separate
 * from issueToken because the ledger append must happen between mint and
 * anchor-back, and emitPortfolioOp returns the seq.
 */
export async function setLedgerSeq(tokenId: string, seq: number): Promise<void> {
  await withLock('portfolios', () => {
    // The token may live in any subject's file; resolve via the index, then
    // rewrite that subject's file.
    loadPortfolioForToken(tokenId) // refreshes index/cache for the holder
    const holder = findSubjectOf(tokenId)
    if (!holder) return
    const tokens = loadPortfolio(holder).map(t =>
      t.token_id === tokenId ? { ...t, ledger_seq: seq } : t,
    )
    savePortfolio(holder, tokens)
  })
}

/**
 * Find the ACTIVE tokens for a subject (status active AND not expired AND, for
 * approval tokens, uses_remaining > 0). Pure read.
 */
export function findActiveTokens(subjectAgentId: string): PortfolioToken[] {
  const now = Date.now()
  return loadPortfolio(subjectAgentId).filter(
    t =>
      t.status === 'active' &&
      !isExpired(t, now) &&
      (t.uses_remaining === null || t.uses_remaining > 0),
  )
}

/** Look up a single token by id across all loaded subjects (read). */
export function getTokenById(tokenId: string): PortfolioToken | undefined {
  if (!_index) reindex()
  return _index?.get(tokenId)
}

/**
 * Decrement a one-shot approval token's `uses_remaining`; flip to `consumed`
 * at 0. Mandate tokens (uses_remaining null) are never consumed — calling
 * this on one is a no-op. Returns true if a token was found and updated.
 */
export async function consumeToken(tokenId: string): Promise<boolean> {
  let changed = false
  await withLock('portfolios', () => {
    const holder = findSubjectOf(tokenId)
    if (!holder) return
    const tokens = loadPortfolio(holder).map(t => {
      if (t.token_id !== tokenId) return t
      if (t.uses_remaining === null) return t // mandate — never consumed
      const remaining = t.uses_remaining - 1
      changed = true
      return {
        ...t,
        uses_remaining: remaining,
        status: remaining <= 0 ? ('consumed' as const) : t.status,
      }
    })
    if (changed) savePortfolio(holder, tokens)
  })
  return changed
}

/** Explicitly revoke a single token by id. Returns true if found. */
export async function revokeToken(tokenId: string): Promise<boolean> {
  let revoked = false
  await withLock('portfolios', () => {
    const holder = findSubjectOf(tokenId)
    if (!holder) return
    const tokens = loadPortfolio(holder).map(t => {
      if (t.token_id !== tokenId) return t
      if (t.status === 'active') {
        revoked = true
        return { ...t, status: 'revoked' as const }
      }
      return t
    })
    if (revoked) savePortfolio(holder, tokens)
  })
  return revoked
}

/** Revoke every active token in a subject's own portfolio (e.g. agent deleted). */
export async function revokeTokensForSubject(agentId: string): Promise<number> {
  let count = 0
  await withLock('portfolios', () => {
    const tokens = loadPortfolio(agentId).map(t => {
      if (t.status === 'active') {
        count++
        return { ...t, status: 'revoked' as const }
      }
      return t
    })
    if (count > 0) savePortfolio(agentId, tokens)
  })
  return count
}

/**
 * Revoke every active token an issuer ever minted, across ALL subjects (e.g.
 * the issuer was demoted out of manager/COS, or deleted). Walks every
 * portfolio file on disk because an issuer's grants live in its SUBJECTS'
 * files, not its own.
 */
export async function revokeTokensFromIssuer(issuerId: string): Promise<number> {
  let count = 0
  await withLock('portfolios', () => {
    for (const subjectId of listSubjectIds()) {
      const tokens = loadPortfolio(subjectId)
      let touched = false
      const next = tokens.map(t => {
        if (t.issuer_agent_id === issuerId && t.status === 'active') {
          count++
          touched = true
          return { ...t, status: 'revoked' as const }
        }
        return t
      })
      if (touched) savePortfolio(subjectId, next)
    }
  })
  return count
}

/**
 * Revoke every active mandate scoped to a team (R5 COS-immutability cascade:
 * a deleted team's mandates die). Matches either `target_team_id` or
 * `issuer_team_id` equal to the team.
 */
export async function revokeMandatesForTeam(teamId: string): Promise<number> {
  let count = 0
  await withLock('portfolios', () => {
    for (const subjectId of listSubjectIds()) {
      const tokens = loadPortfolio(subjectId)
      let touched = false
      const next = tokens.map(t => {
        const teamScoped = t.target_team_id === teamId || t.issuer_team_id === teamId
        if (teamScoped && t.status === 'active') {
          count++
          touched = true
          return { ...t, status: 'revoked' as const }
        }
        return t
      })
      if (touched) savePortfolio(subjectId, next)
    }
  })
  return count
}

/**
 * GC sweep: flip expired active tokens to `expired` on disk across all
 * subjects (the cron counterpart of aid-token's cleanupExpiredTokens). Pure
 * status maintenance — the records stay for audit.
 */
export async function cleanupExpiredPortfolioTokens(): Promise<number> {
  const now = Date.now()
  let cleaned = 0
  await withLock('portfolios', () => {
    for (const subjectId of listSubjectIds()) {
      const tokens = loadPortfolio(subjectId)
      let touched = false
      const next = tokens.map(t => {
        if (t.status === 'active' && isExpired(t, now)) {
          cleaned++
          touched = true
          return { ...t, status: 'expired' as const }
        }
        return t
      })
      if (touched) savePortfolio(subjectId, next)
    }
  })
  return cleaned
}

// ============================================================================
// Internal helpers
// ============================================================================

/** Every subject id that has a portfolio file on disk. */
function listSubjectIds(): string[] {
  ensureDir()
  try {
    return fs
      .readdirSync(PORTFOLIOS_DIR)
      .filter(f => f.endsWith('.json') && !f.endsWith('.ledger.json') && !f.includes('.tmp.'))
      .map(f => f.slice(0, -'.json'.length))
  } catch {
    return []
  }
}

/** Resolve which subject's file holds a given token id (scans disk if needed). */
function findSubjectOf(tokenId: string): string | undefined {
  // Fast path: a loaded index already knows the token's subject.
  const cached = getTokenById(tokenId)
  if (cached) return cached.subject_agent_id
  // Slow path: load every file once (token may live in an unloaded subject).
  for (const subjectId of listSubjectIds()) {
    const tokens = loadPortfolio(subjectId)
    if (tokens.some(t => t.token_id === tokenId)) return subjectId
  }
  return undefined
}

/** Force a holder-load so the index resolves the token (used by setLedgerSeq). */
function loadPortfolioForToken(tokenId: string): void {
  if (getTokenById(tokenId)) return
  for (const subjectId of listSubjectIds()) {
    loadPortfolio(subjectId)
    if (getTokenById(tokenId)) return
  }
}

/**
 * Replace the ENTIRE on-disk portfolio store from a reconstructed
 * subject→tokens map (R33 recovery only — invoked by
 * portfolio-ledger.ts::reconstructPortfoliosFromLedger after a tamper-clean
 * boot). Every existing portfolio file for a subject NOT in the map is left
 * untouched; subjects present in the map are overwritten with their replayed
 * token lists. Returns the number of subject files written.
 *
 * This is a deliberate bulk-overwrite, distinct from the granular mutations
 * above, because the ledger is the ultimate source of truth (R33/R34) and
 * recovery must make the file mirror match the chain exactly.
 */
export async function replaceAllPortfolios(
  bySubject: Map<string, PortfolioToken[]>,
): Promise<number> {
  let written = 0
  await withLock('portfolios', () => {
    for (const [subjectId, tokens] of bySubject.entries()) {
      savePortfolio(subjectId, tokens)
      written++
    }
  })
  return written
}

/**
 * Test-only: clear in-memory cache + index so a fresh fs state is re-read.
 * NOT used in production paths (cache TTL handles staleness there).
 */
export function _resetPortfolioCacheForTests(): void {
  _cache.clear()
  _index = null
}
