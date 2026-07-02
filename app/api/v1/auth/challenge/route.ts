/**
 * AID Proof-of-Possession Challenge Endpoint (TRDD-15ff13ae)
 *
 * POST /api/v1/auth/challenge
 *
 * Issues a single-use, subject-bound, short-TTL server nonce that the client
 * signs and presents to POST /api/v1/auth/token. This replaces the old
 * replayable timestamp window as the anti-replay mechanism for AID token
 * exchange (see lib/aid-nonce.ts for the WHY).
 *
 * ANONYMOUS BY DESIGN — this is a bootstrap endpoint, exactly like
 * /api/v1/register: the calling agent does not yet hold a governance token
 * (obtaining one is the whole point of the challenge→token exchange). It is
 * therefore whitelisted in the credential-shape gate (middleware.ts and
 * services/headless-router.ts). This is SAFE because:
 *   - it returns only a random, single-use, 30s-TTL value (leaks nothing —
 *     no agent lookup, no enumeration, no secret);
 *   - the nonce is bound to the CLAIMED fingerprint but that claim is not
 *     trusted here — the real authentication happens at /api/v1/auth/token,
 *     which Ed25519-verifies a proof against the agent's REGISTERED key AND
 *     requires the presented fingerprint to match the nonce's binding;
 *   - issuance is rate-limited (global + per-fingerprint) and the store is
 *     hard-capped, so it cannot be used to exhaust memory.
 *
 * The handler self-authenticates to the extent this endpoint needs: it is
 * intentionally unauthenticated (no identity is proven and none is required to
 * hand out a freshness nonce). It never derives any authority from the body.
 */

import { NextResponse } from 'next/server'
import { issueNonce } from '@/lib/aid-nonce'

// AID fingerprints look like "SHA256:<base64>". Accept a bounded, safe charset
// only — this value is used solely as an opaque binding key, never interpolated
// into a shell/SQL/path, but validating it fail-closed keeps junk out of the
// store and bounds the per-fingerprint rate-limit key space.
const FINGERPRINT_RE = /^[A-Za-z0-9:+/=_-]{1,200}$/

export async function POST(request: Request) {
  try {
    // Rate limit: a generous global cap (headroom above the token route's
    // 200/min global, since every exchange fetches a challenge first, plus
    // retries) and a tighter per-fingerprint cap so one identity cannot churn
    // the nonce store. Not reset on success — issuance is intentionally
    // counted so a single caller cannot mint unbounded nonces.
    const { checkAndRecordAttempt } = await import('@/lib/rate-limit')
    const globalCheck = checkAndRecordAttempt('aid-challenge:global', 400)
    if (!globalCheck.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many challenge requests. Try again later.' },
        { status: 429 }
      )
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return NextResponse.json(
        { error: 'invalid_request', message: 'Request body must be JSON' },
        { status: 400 }
      )
    }

    const fingerprint = (body as { fingerprint?: unknown })?.fingerprint
    if (typeof fingerprint !== 'string' || !FINGERPRINT_RE.test(fingerprint)) {
      return NextResponse.json(
        { error: 'invalid_request', message: 'fingerprint (AID fingerprint string) is required' },
        { status: 400 }
      )
    }

    // Per-fingerprint rate limit (after validation so the key space is bounded).
    const identityCheck = checkAndRecordAttempt(`aid-challenge:${fingerprint}`, 60)
    if (!identityCheck.allowed) {
      return NextResponse.json(
        { error: 'rate_limited', message: 'Too many challenge requests for this identity. Try again later.' },
        { status: 429 }
      )
    }

    const issued = issueNonce(fingerprint)
    if (!issued) {
      // Store at capacity — fail closed rather than evict a live nonce.
      return NextResponse.json(
        { error: 'nonce_capacity', message: 'Challenge store temporarily full. Retry shortly.' },
        { status: 503 }
      )
    }

    const response = NextResponse.json({
      nonce: issued.nonce,
      expires_in: issued.expires_in,
    })
    response.headers.set('Cache-Control', 'no-store')
    return response
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error(`[AID Challenge] Error issuing challenge nonce: ${msg}`)
    return NextResponse.json(
      { error: 'server_error', message: 'Internal server error issuing challenge' },
      { status: 500 }
    )
  }
}
