/**
 * POST /api/auth/sudo-password
 *
 * Issues a short-lived sudo-mode token after verifying the governance
 * password. Required before invoking any API route classified "strict" in
 * security-registry.json (e.g. DELETE agent, DELETE team, change title).
 *
 * Body: { password: string }
 * Response: { token: string, expiresAt: number (unix ms) }
 *
 * Failure modes:
 *   - 400 missing/invalid body
 *   - 401 caller not authenticated at all (middleware rejects first)
 *   - 403 password mismatch
 *   - 503 governance password not configured yet (bootstrap state)
 */

import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { authenticateFromRequest, buildAuthContext } from '@/lib/agent-auth'
import { issueSudoToken, countBySubject, type SudoOperation } from '@/lib/sudo-auth'
import { recordAuthFailure, recordAuthSuccess, isLockedDown } from '@/lib/kill-switch'
import { matchedEntryKey } from '@/lib/security-registry'

// R32 (SUDO-05): at most this many USER sudo tokens may be outstanding at
// once. subject is always 'system-owner' under R32, so this is a global cap
// on un-consumed USER tokens — ample for a single-user UI, and it stops a
// flood of mints from accumulating.
const MAX_OUTSTANDING_USER_SUDO_TOKENS = 2

// TRDD-X8R2HP9D. Two buckets, mirroring /api/v1/auth/token (API2-MAJ-05).
//
// The bug: this route used a single `checkAndRecordAttempt('sudo-password', 5)`
// on a CONSTANT key and never called resetRateLimit on success. Since
// checkAndRecordAttempt records every ALLOWED attempt, a *successful* mint was
// charged to the same bucket as a failed password guess. Sudo tokens are
// one-shot and bound to one (method, pathTemplate), so each strict operation
// costs exactly one mint — which capped the WHOLE MACHINE at five strict
// operations per minute. Deleting six agents 429'd on the sixth.
//
// The fix keeps brute-force resistance exactly where it belongs. Failed guesses
// still accumulate against the caller's own bucket; correct passwords reset it.
// An attacker who supplies the correct governance password has already won —
// charging them for it protects nothing and only punishes the real user.
const SUDO_GLOBAL_MAX_ATTEMPTS = 200
const SUDO_SUBJECT_MAX_ATTEMPTS = 5

/** Per-caller bucket. Under the user-authority model this is per-user; with the
 *  model off, `subject` is the legacy 'system-owner' sentinel for everyone, so it
 *  degrades to one shared bucket — still reset-on-success, which is the half of
 *  the fix that actually unblocks the UI. */
const subjectRateKey = (subject: string) => `sudo-password:${subject}`

const SudoSchema = z.object({
  password: z.string().min(1).max(256),
  // SUDO-01 (R32, two-phase / optional): bind the minted token to one
  // operation so it cannot be replayed for a different strict route. The
  // client sends the (method, pathTemplate) of the action it is confirming.
  operation: z
    .object({
      method: z.string().min(1).max(16),
      path: z.string().min(1).max(256),
    })
    .strict()
    .optional(),
}).strict()

export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  // Kill switch: reject sudo attempts during lockdown
  if (isLockedDown()) {
    return NextResponse.json(
      { error: 'System is in emergency lockdown. Try again later.' },
      { status: 503 }
    )
  }

  // Outer, generous, PRE-AUTH flood guard. Deliberately never reset on success
  // (same reasoning as `aid-token-exchange:global`): a successful mint must not
  // launder away the failures an attacker has already accumulated.
  const { checkAndRecordAttempt, resetRateLimit } = await import('@/lib/rate-limit')
  const globalCheck = checkAndRecordAttempt('sudo-password:global', SUDO_GLOBAL_MAX_ATTEMPTS)
  if (!globalCheck.allowed) {
    return NextResponse.json(
      { error: 'Too many sudo attempts. Try again later.' },
      { status: 429 }
    )
  }

  const authResult = authenticateFromRequest(request)
  if (authResult.error) {
    return NextResponse.json({ error: authResult.error }, { status: authResult.status ?? 401 })
  }
  const ctx = buildAuthContext(authResult)

  // R32.2 HARD GATE — a sudo password may be requested ONLY of the USER, ONLY
  // via the UI. Any authenticated AGENT (has agentId → !isSystemOwner) is
  // refused; agents authorize by AID + title + portfolio (R28/R32.1), never by
  // minting a sudo token. This closes the prior violation where the route
  // issued a token to `(ctx.agentId ?? 'unknown')`.
  if (!ctx.isSystemOwner) {
    return NextResponse.json(
      {
        error: 'sudo_user_only',
        message: 'A sudo password may be requested only of the USER via the UI. Agents authorize by their AID, never with a sudo token.',
      },
      { status: 403 }
    )
  }
  // R32: a sudo token is always minted for a USER (never an agent — the
  // isSystemOwner gate above already refused agents).
  //
  // R37.4: under the user-authority model the token must be bound to the ACTING
  // user's id so issueSudoToken verifies against THAT user's own password (a
  // delegate's password while it acts, not the maestro's). With the model OFF
  // ctx.userId is undefined, so the subject stays the legacy 'system-owner'
  // sentinel — byte-identical to pre-model behavior and what the existing tests
  // assert. The per-subject quota cap (countBySubject) therefore caps per-user
  // when the model is on, and globally when it is off.
  const subject = ctx.userId ?? 'system-owner'

  // TRDD-X8R2HP9D: the per-caller bucket. It can only be charged HERE, after
  // authentication, because before this line the subject is unknown — which is
  // exactly why the original code used a constant key and became a machine-wide
  // cap. Charged before the body is parsed, so an over-limit caller cannot make
  // us do work. Agents never reach this line (the isSystemOwner gate refused
  // them above), so a rejected agent costs only the global bucket.
  const rateKey = subjectRateKey(subject)
  const subjectCheck = checkAndRecordAttempt(rateKey, SUDO_SUBJECT_MAX_ATTEMPTS)
  if (!subjectCheck.allowed) {
    return NextResponse.json(
      { error: 'Too many sudo attempts. Try again later.' },
      { status: 429 }
    )
  }

  let raw: unknown
  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = SudoSchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'password required' }, { status: 400 })
  }
  const { password, operation } = parsed.data

  // SUDO-01: the client sends the LITERAL request path; normalize it to the
  // strict-route TEMPLATE so the guard (which compares against the template it
  // was called with) matches. matchedEntryKey returns "METHOD_/api/template";
  // strip the "METHOD_" prefix to recover the template. If the literal path
  // matches no strict entry, bind to the literal path verbatim (the guard's op
  // check then simply won't match a strict route — harmless, fails closed).
  let boundOperation: SudoOperation | undefined = operation
  if (operation) {
    const key = matchedEntryKey(operation.method, operation.path)
    const template = key ? key.slice(operation.method.toUpperCase().length + 1) : operation.path
    boundOperation = { method: operation.method.toUpperCase(), path: template }
  }

  // SUDO-05: cap outstanding USER tokens. Reject before verifying the password
  // so a flood can't accumulate even with a correct password.
  if (countBySubject(subject) >= MAX_OUTSTANDING_USER_SUDO_TOKENS) {
    return NextResponse.json(
      {
        error: 'sudo_token_quota_exceeded',
        message: 'Too many outstanding confirmations. Complete or let an existing one expire, then try again.',
      },
      { status: 429 }
    )
  }

  try {
    const { token, expiresAt } = await issueSudoToken(password, subject, boundOperation)
    // TRDD-X8R2HP9D: reset ONLY this subject's bucket on success — the standard
    // "count attempts, reset on success" pattern lib/rate-limit.ts documents and
    // /api/auth/login already follows. The global bucket is intentionally NOT
    // reset (mirroring `aid-token-exchange:global`), so a correct password never
    // launders another caller's accumulated failures out of the window.
    resetRateLimit(rateKey)
    recordAuthSuccess()
    return NextResponse.json({ token, expiresAt })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (msg.startsWith('sudo_mode_unavailable')) {
      return NextResponse.json(
        { error: 'governance password not configured' },
        { status: 503 }
      )
    }
    if (msg === 'sudo_mode_bad_password') {
      recordAuthFailure()
      return NextResponse.json(
        { error: 'invalid password' },
        { status: 403 }
      )
    }
    console.error('[sudo-password] unexpected error:', msg)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
