// The DAEMON PRINCIPAL — an authenticated, non-agent caller with a two-verb grant
// (TRDD-APN5WB2L; ai-maestro#60, design published as that issue's 2026-08-05 comment).
//
// ── WHY A NEW PRINCIPAL CLASS AND NOT AN AGENT ───────────────────────────────────────────────────
// The ai-maestro-janitor's machine-wide daemon must recover a FROZEN agent session: submit a
// recovery prompt, or break a wedged turn with a raw interrupt. It cannot be modelled as an agent,
// because R42 / TRDD-BF3JN4TL made `send-command` SELF-ONLY for agents — an agent may only type
// into its own pane, and the daemon has no pane. The only otherwise-reachable path is the
// system-owner credential, i.e. total authority, which is exactly the over-privilege the janitor's
// own issue asked to avoid. So: a principal that can do these two things and NOTHING else.
//
// ── WHY IT REUSES lib/amp-keys AND ADDS ONLY REPLAY PROTECTION ───────────────────────────────────
// ai-maestro already implements Ed25519 across ten modules. `verifySignature` here is amp-keys',
// unchanged. A second signing scheme beside it would be a second thing to rotate, revoke and audit
// — and the two would drift, which is the defect class this repo keeps paying for. What amp-keys
// does NOT cover is replay protection, and that is the only new crypto-adjacent logic below.
//
// ── THE THREAT MODEL, STATED SO THE GATES ARE READABLE AS ANSWERS ────────────────────────────────
//   · A local process that is not the daemon must not be able to inject.      → signature over the
//     canonical request, verified against the ENROLLED pubkey.
//   · A captured request must not be replayable.                              → nonce + skew.
//   · A compromised daemon must not become an admin.                          → the grant is two
//     verbs, checked here, and the principal carries no agent identity at all.
//   · The daemon must not be able to enroll ITSELF.                           → enrollment is
//     owner-gated at the route layer (strict/sudo), never by this module.

import * as fs from 'fs'
import * as path from 'path'
import { statePath } from '@/lib/ecosystem-constants'
import { verifySignature } from '@/lib/amp-keys'

/** The complete grant. A verb outside this set is refused even with a valid signature — least
 *  privilege is enforced here, not by trusting callers to send only these two. */
export const DAEMON_VERBS = ['submit-recovery-prompt', 'interrupt'] as const
export type DaemonVerb = (typeof DAEMON_VERBS)[number]

/** Max age of a signed request. 60s is the janitor's own proposal and is generous for a local
 *  call; a wider window is a wider replay window for a request whose nonce was never seen here. */
export const MAX_SKEW_S = 60

/** How many recent nonces to remember. The store is bounded ON PURPOSE: an unbounded one is a
 *  memory leak an attacker controls. Bounded means an ancient nonce may be forgotten — which is
 *  harmless, because `issued_at` already refuses anything older than MAX_SKEW_S, so a forgotten
 *  nonce can only belong to a request that is already stale. The two gates cover each other. */
export const NONCE_CAPACITY = 4096

export interface DaemonEnrollment {
  /** Ed25519 public key, hex, 64 chars (32 bytes) — the format amp-keys' verifySignature takes. */
  publicKeyHex: string
  enrolledAt: string
  /** Free-text label for the human reading the store ("ai-maestro-janitor daemon @ hostname"). */
  label?: string
}

export interface SignedDaemonRequest {
  /** The agent UUID. NEVER a tmux session name: that is derived from the agent name and changes
   *  on rename, so a persisted one aims a recovery at whatever now owns the old pane. */
  target: string
  action: DaemonVerb
  /** The prompt line for `submit-recovery-prompt`; ignored (and must be absent/empty) for
   *  `interrupt`, which carries no payload. */
  payload?: string
  nonce: string
  /** Epoch SECONDS. Seconds, not millis: a millis value parses fine and reads as permanently
   *  fresh — the same trap the daemon-response envelope documents. */
  issued_at: number
  /** base64 Ed25519 signature over `canonicalRequest(...)`. */
  signature: string
}

export type DaemonAuthFailure =
  | 'not_enrolled'
  | 'malformed_request'
  | 'unknown_verb'
  | 'stale_request'
  | 'replayed_nonce'
  | 'bad_signature'

export interface DaemonAuthResult {
  ok: boolean
  reason?: DaemonAuthFailure
  message?: string
  verb?: DaemonVerb
  target?: string
}

const ENROLLMENT_FILE = () => statePath('daemon-principal.json')

/**
 * The signed byte string. Every field that changes the EFFECT of the request is inside it: a
 * signature that did not cover `action` would let a captured submit-prompt request be replayed as
 * an interrupt (and vice-versa) by editing one unsigned field.
 *
 * Field ORDER is part of the contract — the janitor signs the same string, so changing it is a
 * breaking change to a cross-repo consumer, not a refactor.
 */
export function canonicalRequest(r: Pick<SignedDaemonRequest, 'target' | 'action' | 'payload' | 'nonce' | 'issued_at'>): string {
  return JSON.stringify({
    target: r.target,
    action: r.action,
    payload: r.payload ?? '',
    nonce: r.nonce,
    issued_at: r.issued_at,
  })
}

/** Read the enrollment, or null when the daemon has never enrolled. */
export function loadDaemonEnrollment(): DaemonEnrollment | null {
  try {
    const raw = fs.readFileSync(ENROLLMENT_FILE(), 'utf8')
    const parsed = JSON.parse(raw) as Partial<DaemonEnrollment>
    if (typeof parsed?.publicKeyHex !== 'string' || !/^[0-9a-fA-F]{64}$/.test(parsed.publicKeyHex)) return null
    return { publicKeyHex: parsed.publicKeyHex, enrolledAt: parsed.enrolledAt ?? '', label: parsed.label }
  } catch {
    // Absent is the normal pre-enrollment state; unreadable is treated the same way ON PURPOSE
    // here, because the consequence is a REFUSAL (fail-closed), never an accepted request.
    return null
  }
}

/**
 * Persist the enrollment. CALLERS MUST GATE THIS ON THE OWNER — this module deliberately holds no
 * authorization logic of its own, so that the gate lives in one visible place (the strict route)
 * rather than being half-implemented in two.
 *
 * Written atomically (tmp + rename): a reader polling this file must never observe a half-written
 * document, which would parse as garbage or, worse, as a partial object with a truncated key.
 */
export function saveDaemonEnrollment(e: DaemonEnrollment): void {
  const dest = ENROLLMENT_FILE()
  fs.mkdirSync(path.dirname(dest), { recursive: true })
  const tmp = `${dest}.tmp.${process.pid}`
  fs.writeFileSync(tmp, JSON.stringify(e, null, 2) + '\n', { mode: 0o600 })
  fs.renameSync(tmp, dest)
}

// ── The nonce store ──────────────────────────────────────────────────────────────────────────────
// In-memory and per-process, which is correct here and worth stating: a signed request is only
// accepted within MAX_SKEW_S, and a server restart takes longer than that in every real case —
// so a nonce that survives a restart would be protecting a request `issued_at` already refuses.
// Persisting it would add a file to corrupt for no gain.
const seenNonces = new Map<string, number>()

function rememberNonce(nonce: string, atS: number): void {
  seenNonces.set(nonce, atS)
  if (seenNonces.size > NONCE_CAPACITY) {
    // Evict oldest-first. Map preserves insertion order, and insertion order here IS arrival
    // order, so the first key is the oldest.
    const excess = seenNonces.size - NONCE_CAPACITY
    let dropped = 0
    for (const k of seenNonces.keys()) {
      seenNonces.delete(k)
      if (++dropped >= excess) break
    }
  }
}

/** Test seam — the store is module-global by design, so a suite must be able to reset it. */
export function _resetNonceStoreForTests(): void {
  seenNonces.clear()
}

/**
 * Verify a signed daemon request. Returns a DISTINCT reason per failure, deliberately: a caller
 * (and a test) that can only see "denied" cannot tell a replay from a bad key from an ungranted
 * verb, and a refusal whose cause is unreadable is one nobody can act on.
 *
 * The order is cheapest-and-most-specific first, and every gate runs before any effect: shape →
 * grant → freshness → replay → signature. Signature verification is last because it is the only
 * expensive step, and because a malformed request should not consume it.
 */
export function verifyDaemonRequest(req: unknown, nowS: number = Math.floor(Date.now() / 1000)): DaemonAuthResult {
  const enrollment = loadDaemonEnrollment()
  if (!enrollment) {
    return { ok: false, reason: 'not_enrolled', message: 'No daemon principal is enrolled on this host' }
  }

  const r = req as Partial<SignedDaemonRequest> | null
  if (
    !r ||
    typeof r.target !== 'string' ||
    !r.target ||
    typeof r.action !== 'string' ||
    typeof r.nonce !== 'string' ||
    !r.nonce ||
    typeof r.issued_at !== 'number' ||
    !Number.isFinite(r.issued_at) ||
    typeof r.signature !== 'string' ||
    !r.signature ||
    (r.payload !== undefined && typeof r.payload !== 'string')
  ) {
    return { ok: false, reason: 'malformed_request', message: 'Request is missing a required field or has a wrong type' }
  }

  if (!(DAEMON_VERBS as readonly string[]).includes(r.action)) {
    return {
      ok: false,
      reason: 'unknown_verb',
      message: `The daemon principal grants only: ${DAEMON_VERBS.join(', ')}`,
    }
  }

  // Skew is checked in BOTH directions: a future-dated request is as suspect as a stale one (it
  // would otherwise stay valid past its own window by exactly the amount it lies about).
  if (Math.abs(nowS - r.issued_at) > MAX_SKEW_S) {
    return {
      ok: false,
      reason: 'stale_request',
      message: `issued_at is outside the ${MAX_SKEW_S}s window`,
    }
  }

  if (seenNonces.has(r.nonce)) {
    return { ok: false, reason: 'replayed_nonce', message: 'This nonce has already been used' }
  }

  const canonical = canonicalRequest(r as SignedDaemonRequest)
  if (!verifySignature(canonical, r.signature, enrollment.publicKeyHex)) {
    return { ok: false, reason: 'bad_signature', message: 'Signature does not verify against the enrolled daemon key' }
  }

  // Remember the nonce only AFTER every other gate passed. Recording it earlier would let an
  // attacker burn a legitimate nonce by sending it with a broken signature.
  rememberNonce(r.nonce, nowS)
  return { ok: true, verb: r.action as DaemonVerb, target: r.target }
}
