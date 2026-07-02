/**
 * AID Ledger Authority (R33 / R34) — the single source of truth for
 * "is this AID real?".
 *
 * The signed ledger (lib/signed-ledger.ts) is a host-signed, hash-chained,
 * append-only log. R34.1 makes it the ULTIMATE source of truth for identity: a
 * valid-looking AID with no ledger history of its emission + association to the
 * agent it claims is UNTRUSTED. This module is where that check lives.
 *
 * It records the AID↔agent binding via four ledger ops (types/ledger.ts):
 *   - aid_associate       — binds a fingerprint → agentId (THE row R34.1 searches).
 *   - aid_reissue         — a foreign AID retired, a fresh native AID minted (R34.2).
 *   - aid_approve_foreign — MAESTRO approved a foreign AID for this host (R35.2).
 *   - aid_revoke          — an AID association revoked; recovery must honor it.
 *
 * R33: on token-store loss, reconstructAgentAuthState() replays the ledger to
 * rebuild {agentId, title, team} — auth is recovered from the signed history,
 * not hard-failed.
 *
 * PERFORMANCE (Risk R2): the hot auth path must not walk the whole ledger on
 * every request. A fingerprint-keyed recovery cache (~/.aimaestro/
 * aid-recovery-cache.json, NOT ledger-tracked — a derived rebuild artifact)
 * holds the last successful reconstruction. Reads hit the cache first; the
 * ledger (live + ROTATION ARCHIVES, Risk R3) is walked only on a cache miss.
 * Any aid_* emit invalidates the cache.
 *
 * SECURITY: this module only READS the ledger to decide validity and only EMITS
 * the new aid_* ops. It never weakens an existing gate; it is consulted by the
 * token MINT (app/api/v1/auth/token) and SPEND (lib/agent-auth) paths ONLY when
 * the ledger.enforceAidAssociation flag is ON (decision D5, default OFF).
 */

import fs from 'fs'
import path from 'path'
import { getStateDir } from '@/lib/ecosystem-constants'
import { registryLedger } from '@/lib/agent-registry'
import { emitAgentOp } from '@/lib/ledger-emit'
import type { JsonPatch } from '@/types/json-patch'
import type { LedgerEntry } from '@/types/ledger'

// STATIC imports of registryLedger + emitAgentOp are SAFE despite the
// agent-registry → (lazy) aid-ledger-authority → agent-registry shape: this is
// the SAME cycle ledger-emit already has (it static-imports registryLedger too).
// agent-registry only lazy-requires this module AFTER it has finished defining
// `registryLedger`, so the binding is always resolved by the time we use it. We
// use static (not runtime `require('./x')`) so the module resolves identically
// in production (tsc/Next) AND under vitest (the `@` alias), where a bare
// relative `require('./ledger-emit')` does NOT resolve the .ts extension.

// ── Recovery cache (NOT ledger-tracked — a derived index, never authority) ──

interface RecoveryCacheRow {
  agentId: string
  governanceTitle: string
  teamId: string | null
  revoked: boolean
}
interface RecoveryCacheFile {
  version: 1
  rows: Record<string, RecoveryCacheRow> // keyed by fingerprint
}

function getRecoveryCachePath(): string {
  return path.join(getStateDir(), 'aid-recovery-cache.json')
}

function loadRecoveryCache(): RecoveryCacheFile {
  const p = getRecoveryCachePath()
  try {
    if (!fs.existsSync(p)) return { version: 1, rows: {} }
    const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'))
    if (parsed && parsed.version === 1 && parsed.rows && typeof parsed.rows === 'object') {
      return parsed as RecoveryCacheFile
    }
    return { version: 1, rows: {} }
  } catch {
    // Pure cache — a corrupt file is just rebuilt from the ledger on demand.
    return { version: 1, rows: {} }
  }
}

function writeRecoveryCache(cache: RecoveryCacheFile): void {
  const p = getRecoveryCachePath()
  try {
    const dir = path.dirname(p)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const tmp = `${p}.tmp.${process.pid}.${Date.now()}`
    fs.writeFileSync(tmp, JSON.stringify(cache, null, 2), { mode: 0o600 })
    fs.renameSync(tmp, p)
  } catch (err) {
    // Best-effort: a cache-write failure must never break auth. The next miss
    // simply re-walks the ledger.
    console.warn('[aid-ledger-authority] recovery-cache write failed (non-fatal):',
      err instanceof Error ? err.message : err)
  }
}

function cacheGet(fingerprint: string): RecoveryCacheRow | undefined {
  return loadRecoveryCache().rows[fingerprint]
}

function cachePut(fingerprint: string, row: RecoveryCacheRow): void {
  const cache = loadRecoveryCache()
  cache.rows[fingerprint] = row
  writeRecoveryCache(cache)
}

/**
 * Invalidate the recovery cache. Called after EVERY aid_* emit so a stale
 * association/revocation never lingers. Removes a specific fingerprint when
 * given, else clears the whole cache.
 */
export function invalidateRecoveryCache(fingerprint?: string): void {
  try {
    if (fingerprint === undefined) {
      // Drop the whole file — cheapest correct invalidation.
      const p = getRecoveryCachePath()
      if (fs.existsSync(p)) fs.unlinkSync(p)
      return
    }
    const cache = loadRecoveryCache()
    if (fingerprint in cache.rows) {
      delete cache.rows[fingerprint]
      writeRecoveryCache(cache)
    }
  } catch {
    // Non-fatal: a failed invalidation at worst serves a stale cache row until
    // the next emit; the boot-verify + ledger remain the authority.
  }
}

// ── Ledger reads (lock-free, live chain + rotation archives) ────────────────

/**
 * The registry ledger lives at <stateDir>/agents/registry.ledger.json and its
 * rotation archives at <stateDir>/agents/registry.ledger.<ts>.archive.json
 * (signed-ledger.ts::rotateLedger). isAidAssociated/reconstruct MUST consult the
 * archives too (Risk R3) because an old aid_associate can be archived out of the
 * live tail. The recovery cache is the durable index that never prunes.
 */
function getRegistryLedgerDir(): string {
  return path.join(getStateDir(), 'agents')
}

/**
 * Return ALL registry-ledger entries — the live chain followed by every
 * rotation archive, oldest-first overall (archives in filename order then the
 * live tail). Lock-free: getEntries() is REG-MIN-01 lock-free and archives are
 * immutable once written.
 */
function getAllRegistryEntries(): LedgerEntry[] {
  const dir = getRegistryLedgerDir()
  const entries: LedgerEntry[] = []

  // Archives first (older). Sort by the embedded timestamp so older archives
  // come before newer ones; the live tail is appended last.
  try {
    if (fs.existsSync(dir)) {
      const archiveFiles = fs.readdirSync(dir)
        .filter(f => /^registry\.ledger\.\d+\.archive\.json$/.test(f))
        .sort((a, b) => {
          const ta = Number(a.match(/\.ledger\.(\d+)\.archive\.json$/)?.[1] ?? 0)
          const tb = Number(b.match(/\.ledger\.(\d+)\.archive\.json$/)?.[1] ?? 0)
          return ta - tb
        })
      for (const f of archiveFiles) {
        try {
          const parsed = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf-8'))
          if (parsed && Array.isArray(parsed.entries)) {
            entries.push(...(parsed.entries as LedgerEntry[]))
          }
        } catch {
          // A single unreadable archive must not blind the whole walk.
        }
      }
    }
  } catch {
    // Directory listing failed — fall through to the live chain only.
  }

  // Live chain (newest). registryLedger.getEntries() is lock-free (REG-MIN-01).
  try {
    entries.push(...registryLedger.getEntries())
  } catch (err) {
    console.warn('[aid-ledger-authority] could not read live registry ledger:',
      err instanceof Error ? err.message : err)
  }

  return entries
}

/**
 * Read the agentId + fingerprint out of an aid_associate / aid_reissue diff.
 * The diff shape is the typed-op form from §2.1, so this is a deterministic
 * field read — no fragile string-scan.
 */
function readAidBindingFromEntry(
  entry: LedgerEntry,
): { agentId: string; fingerprint: string; revoked: boolean } | null {
  if (entry.op !== 'aid_associate' && entry.op !== 'aid_reissue' && entry.op !== 'aid_revoke') {
    return null
  }
  for (const patch of entry.diff) {
    // aid_associate: add /aid/<fp> {agentId, fingerprint, ...}
    // aid_reissue:  replace /aid/<fp> {agentId, newFingerprint, ...}
    // aid_revoke:   replace /aid/<fp> {agentId, fingerprint, revoked:true, ...}
    if ((patch.op === 'add' || patch.op === 'replace') && patch.path.startsWith('/aid/')) {
      const v = patch.value as Record<string, unknown> | undefined
      if (!v || typeof v !== 'object') continue
      const agentId = typeof v.agentId === 'string' ? v.agentId : undefined
      // Prefer the explicit fingerprint field; fall back to the new one or the path tail.
      const fingerprint =
        (typeof v.fingerprint === 'string' && v.fingerprint) ||
        (typeof v.newFingerprint === 'string' && (v.newFingerprint as string)) ||
        decodeURIComponent(patch.path.slice('/aid/'.length))
      if (!agentId || !fingerprint) continue
      const revoked = entry.op === 'aid_revoke' || v.revoked === true
      return { agentId, fingerprint, revoked }
    }
  }
  return null
}

export interface AidAssociationResult {
  ok: boolean
  agentId?: string
  revoked?: boolean
}

/**
 * R34.1 gate — is this fingerprint backed by a signed-ledger association?
 *
 * Cache-first. On a cache miss, walks the live registry ledger + every rotation
 * archive for the LATEST aid_associate / aid_reissue / aid_revoke touching the
 * fingerprint (later entries win, so an aid_revoke after an aid_associate
 * correctly yields revoked:true). Returns {ok:false} when no association exists.
 */
export function isAidAssociated(fingerprint: string): AidAssociationResult {
  if (!fingerprint) return { ok: false }

  const cached = cacheGet(fingerprint)
  if (cached) {
    return { ok: !cached.revoked, agentId: cached.agentId, revoked: cached.revoked }
  }

  // Miss — walk the full chain. Iterate in order; the LAST binding for this
  // fingerprint is authoritative.
  let last: { agentId: string; fingerprint: string; revoked: boolean } | null = null
  for (const entry of getAllRegistryEntries()) {
    const binding = readAidBindingFromEntry(entry)
    if (binding && binding.fingerprint === fingerprint) {
      last = binding
    }
  }

  if (!last) {
    // No association at all — do NOT cache a negative (the cache models known
    // bindings, not absence; an agent associated later must be picked up on its
    // next call without a manual invalidate). The walk for a truly-unknown
    // fingerprint is cheap relative to the security value of never serving a
    // stale "unknown".
    return { ok: false }
  }

  // Cache the resolved binding so repeated gate hits are O(1). The title/team
  // are left as unresolved markers (''/null) — the bare R34.1 gate does not need
  // them, and reconstructAgentAuthState() always re-walks + overwrites with the
  // authoritative values when the R33 recovery path is taken.
  cachePut(fingerprint, {
    agentId: last.agentId,
    governanceTitle: '',
    teamId: null,
    revoked: last.revoked,
  })
  return { ok: !last.revoked, agentId: last.agentId, revoked: last.revoked }
}

export interface RecoveredAuthState {
  agentId: string
  governanceTitle: string
  teamId: string | null
  fingerprint: string
}

/**
 * R33 — rebuild an agent's auth state from the signed ledger.
 *
 * Resolves the fingerprint → agentId via the latest aid_associate/aid_reissue
 * (refusing if a later aid_revoke killed it), then replays the LATEST
 * change_title and change_team ops for that agentId to recover the current
 * governanceTitle + teamId. Writes the result into the recovery cache so the
 * next isAidAssociated() hit is O(1). Returns null when no (non-revoked)
 * association exists for the fingerprint.
 */
export function reconstructAgentAuthState(fingerprint: string): RecoveredAuthState | null {
  if (!fingerprint) return null

  const allEntries = getAllRegistryEntries()

  // 1. Resolve fingerprint → agentId (latest binding wins; honor revoke).
  let binding: { agentId: string; fingerprint: string; revoked: boolean } | null = null
  for (const entry of allEntries) {
    const b = readAidBindingFromEntry(entry)
    if (b && b.fingerprint === fingerprint) binding = b
  }
  if (!binding || binding.revoked) return null
  const agentId = binding.agentId

  // 2. Replay change_title / change_team for that agentId — latest wins.
  let governanceTitle: string | null = null
  let teamId: string | null = null
  let teamSeen = false
  // NOTE: we match the SUBJECT agent via the diff PATH (/agents/<id>/…), never
  // via entry.authAgentId — that field is the ACTOR who made the change, not the
  // agent being changed.
  for (const entry of allEntries) {
    if (entry.op === 'change_title') {
      const t = extractTitleForAgent(entry, agentId)
      if (t !== undefined) governanceTitle = t
    } else if (entry.op === 'change_team') {
      const tm = extractTeamForAgent(entry, agentId)
      if (tm !== undefined) { teamId = tm; teamSeen = true }
    } else if (entry.op === 'create_agent') {
      // create_agent records {governanceTitle, team} for /agents/<id>.
      const created = extractCreateForAgent(entry, agentId)
      if (created) {
        if (governanceTitle === null && created.governanceTitle != null) governanceTitle = created.governanceTitle
        if (!teamSeen && created.team !== undefined) { teamId = created.team }
      }
    }
  }

  const recovered: RecoveredAuthState = {
    agentId,
    governanceTitle: governanceTitle ?? 'autonomous',
    teamId,
    fingerprint,
  }
  cachePut(fingerprint, {
    agentId,
    governanceTitle: recovered.governanceTitle,
    teamId: recovered.teamId,
    revoked: false,
  })
  return recovered
}

/** Extract the new governanceTitle for `agentId` from a change_title entry, or undefined. */
function extractTitleForAgent(entry: LedgerEntry, agentId: string): string | undefined {
  for (const patch of entry.diff) {
    if ((patch.op === 'replace' || patch.op === 'add') &&
        patch.path === `/agents/${agentId}/governanceTitle`) {
      return typeof patch.value === 'string' ? patch.value : undefined
    }
  }
  return undefined
}

/** Extract the new team for `agentId` from a change_team entry, or undefined. */
function extractTeamForAgent(entry: LedgerEntry, agentId: string): string | null | undefined {
  for (const patch of entry.diff) {
    if ((patch.op === 'replace' || patch.op === 'add') &&
        patch.path === `/agents/${agentId}/team`) {
      const v = patch.value
      return typeof v === 'string' ? v : null
    }
  }
  return undefined
}

/** Extract {governanceTitle, team} for `agentId` from a create_agent entry, or null. */
function extractCreateForAgent(
  entry: LedgerEntry,
  agentId: string,
): { governanceTitle: string | null; team: string | null } | null {
  for (const patch of entry.diff) {
    if (patch.op === 'add' && patch.path === `/agents/${agentId}`) {
      const v = patch.value as Record<string, unknown> | undefined
      if (!v || typeof v !== 'object') return null
      return {
        governanceTitle: typeof v.governanceTitle === 'string' ? v.governanceTitle : null,
        team: typeof v.team === 'string' ? v.team : null,
      }
    }
  }
  return null
}

// ── Record helpers (thin wrappers over emitAgentOp; invalidate the cache) ───

/**
 * Emit a typed aid_* op against agents/registry.json (the same chain as
 * create_agent). Lazy-requires ledger-emit to avoid a static cycle. Always
 * invalidates the affected fingerprint's recovery-cache row afterward.
 */
function emitAidOp(
  op: 'aid_associate' | 'aid_reissue' | 'aid_approve_foreign' | 'aid_revoke',
  diff: JsonPatch,
  fingerprint: string,
  action: string,
  agentId: string | null,
  actor: 'user' | 'agent' | 'system',
): void {
  try {
    emitAgentOp(op, diff, { action, agentId, actor })
  } catch (err) {
    console.error(`[aid-ledger-authority] AUDIT GAP: ${op} NOT recorded:`,
      err instanceof Error ? err.message : err)
  }
  invalidateRecoveryCache(fingerprint)
}

/**
 * Record an AID↔agent association (R34.1). IDEMPOTENT against the durable
 * LEDGER (not just the volatile cache): skipped (no duplicate row) when a
 * non-revoked association for this exact fingerprint+agent already exists in the
 * chain. This dedupes the two emit hooks (markAgentAsAMPRegistered + backfill)
 * AND makes a re-run of the startup backfill a no-op. We check via
 * isAidAssociated (cache-first, then ledger+archive walk) rather than cacheGet
 * alone, because emitAidOp INVALIDATES the cache after each write — so a pure
 * cache check would miss a just-persisted association and re-emit on the next
 * run. isAidAssociated also re-populates the cache on its walk, so subsequent
 * record calls dedupe cheaply.
 */
export function recordAidAssociation(
  agentId: string,
  fingerprint: string,
  hostId: string,
  opts?: { backfill?: boolean; actor?: 'user' | 'agent' | 'system' },
): void {
  if (!agentId || !fingerprint) return
  const existing = isAidAssociated(fingerprint)
  if (existing.ok && existing.agentId === agentId && !existing.revoked) {
    // Already associated to the same agent in the ledger — no-op (dedupe).
    return
  }
  const value: Record<string, unknown> = {
    agentId,
    fingerprint,
    hostId,
    kind: 'agent',
    issuedAt: new Date().toISOString(),
  }
  if (opts?.backfill) value.backfill = true
  emitAidOp(
    'aid_associate',
    [{ op: 'add', path: `/aid/${encodeURIComponent(fingerprint)}`, value }],
    fingerprint,
    opts?.backfill ? 'aid-associate-backfill' : 'aid-associate',
    agentId,
    opts?.actor ?? 'system',
  )
}

/**
 * Record a foreign-AID re-issue (R34.2): the foreign fingerprint is retired and
 * a fresh native fingerprint is bound to the agent. The new fingerprint becomes
 * the backed identity; the old one never gets an aid_associate on this host, so
 * it stays permanently unbacked (impersonation defense, Risk R5).
 */
export function recordAidReissue(
  agentId: string,
  oldFingerprint: string,
  newFingerprint: string,
  sourceHostId: string,
  actor: 'user' | 'agent' | 'system' = 'user',
): void {
  if (!agentId || !newFingerprint) return
  const value = {
    agentId,
    oldFingerprint,
    newFingerprint,
    sourceHostId,
    issuedAt: new Date().toISOString(),
  }
  emitAidOp(
    'aid_reissue',
    [{ op: 'replace', path: `/aid/${encodeURIComponent(newFingerprint)}`, value }],
    newFingerprint,
    'aid-reissue',
    agentId,
    actor,
  )
  // The re-issue IS the association of the new native fingerprint — record it so
  // R34.1 immediately accepts the new AID (R34.2 "recorded … counts as
  // verification"). The old fingerprint cache row, if any, is invalidated below.
  invalidateRecoveryCache(oldFingerprint)
  recordAidAssociation(agentId, newFingerprint, sourceHostId, { actor })
}

/**
 * Record a MAESTRO approval of a foreign agent/user AID for this host (R35.2).
 * Recorded against /aid-approval/<fingerprint> so the audit trail shows WHO
 * approved a foreign principal and WHEN.
 */
export function recordForeignApproval(
  fingerprint: string,
  kind: 'agent' | 'user',
  sourceHostId: string,
  approvedBy: string,
  actor: 'user' | 'agent' | 'system' = 'user',
): void {
  if (!fingerprint) return
  const value = {
    fingerprint,
    kind,
    sourceHostId,
    approvedBy,
    decidedAt: new Date().toISOString(),
  }
  emitAidOp(
    'aid_approve_foreign',
    [{ op: 'add', path: `/aid-approval/${encodeURIComponent(fingerprint)}`, value }],
    fingerprint,
    'aid-approve-foreign',
    null,
    actor,
  )
}

/**
 * Record an AID revocation (compromise / agent delete). Reconstruction + the
 * R34.1 gate honor this: a later aid_revoke beats an earlier aid_associate. We
 * write a `replace` (not a bare `remove`) so the audit value {agentId, reason,
 * revoked:true} survives — JSON-patch `remove` carries no value.
 */
export function recordAidRevocation(
  agentId: string,
  fingerprint: string,
  reason: string,
  actor: 'user' | 'agent' | 'system' = 'user',
): void {
  if (!fingerprint) return
  const value = {
    agentId,
    fingerprint,
    revoked: true,
    reason,
    revokedAt: new Date().toISOString(),
  }
  emitAidOp(
    'aid_revoke',
    [{ op: 'replace', path: `/aid/${encodeURIComponent(fingerprint)}`, value }],
    fingerprint,
    'aid-revoke',
    agentId,
    actor,
  )
}
