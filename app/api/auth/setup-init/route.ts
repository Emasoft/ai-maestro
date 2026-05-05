/**
 * POST /api/auth/setup-init
 *
 * First-run setup step 1 (SEC-PHASE-6). Triggers a 6-digit verification
 * code that the server sends to the user via macOS notification (or
 * notify-send on Linux, or a 0600-permissioned file as last resort).
 *
 * The response describes WHERE the user should look for the code but
 * NEVER returns the code itself — that channel separation is the whole
 * point. The user must be physically able to read the OS notification
 * (or open the local file) to prove they own the host.
 *
 * Whitelisted in middleware.ts so it works before any auth is set up.
 * REJECTED with 409 if a governance password is already configured —
 * this endpoint is exclusively for first-run bootstrap.
 */

import { NextRequest, NextResponse } from 'next/server'
import { loadGovernance } from '@/lib/governance'
import { startSetupFlow } from '@/lib/setup-bootstrap'
import { checkAndRecordAttempt } from '@/lib/rate-limit'

export const dynamic = 'force-dynamic'

/**
 * API-MAJ-02 fix (2026-05-04) — rate limit before startSetupFlow().
 *
 * Without this, any caller (any localhost process or any Tailscale
 * peer) could spam this endpoint and:
 *   - flood the user with OS notifications,
 *   - reset the pending setup code on every call (the internal verify
 *     limiter only caps verification attempts, NOT issuance), so the
 *     attacker keeps invalidating the legitimate user's code,
 *   - effectively DoS the first-run bootstrap.
 *
 * The cap is intentionally conservative — first-run bootstrap is a
 * single-shot operation, not a workflow with retries. 3 issuances per
 * 5-minute window per source IP is far more than a real user needs
 * (one click → one notification) but tight enough that an attacker
 * cannot keep the user trapped in a "your code keeps changing" loop.
 *
 * NOTE: source-IP-keyed rate limit only. We deliberately do NOT key on
 * a session cookie because this endpoint runs BEFORE any session
 * exists. The IP comes from the X-Forwarded-For-aware extractor; if
 * absent (direct connection), we fall back to the connection's source
 * address attached by Next.js.
 */
const SETUP_INIT_MAX_ATTEMPTS = 3
const SETUP_INIT_WINDOW_MS = 5 * 60_000 // 5 minutes

function extractSourceIp(req: NextRequest): string {
  const xff = req.headers.get('x-forwarded-for')
  if (xff) {
    const first = xff.split(',')[0]?.trim()
    if (first) return first
  }
  const xri = req.headers.get('x-real-ip')
  if (xri) return xri.trim()
  // Next.js exposes ip via NextRequest in some adapters; fall back to a
  // string sentinel that still lets us rate-limit "all unknown sources"
  // in aggregate so a fully spoofed/empty header set still gets capped.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const maybeIp = (req as unknown as { ip?: string }).ip
  if (maybeIp) return maybeIp
  return 'unknown-source'
}

export async function POST(request: NextRequest) {
  // ── Pre-flight rate limit ───────────────────────────────────
  const sourceIp = extractSourceIp(request)
  const rateKey = `setup-init:${sourceIp}`
  const rl = checkAndRecordAttempt(rateKey, SETUP_INIT_MAX_ATTEMPTS, SETUP_INIT_WINDOW_MS)
  if (!rl.allowed) {
    const retryAfterSeconds = Math.ceil(rl.retryAfterMs / 1000)
    return NextResponse.json(
      {
        error: 'rate_limited',
        message: `Too many setup-init attempts. Wait ${retryAfterSeconds}s and try again.`,
        retryAfterSeconds,
      },
      {
        status: 429,
        headers: { 'Retry-After': String(retryAfterSeconds) },
      }
    )
  }

  // Refuse if a password already exists — there's no reason to
  // re-trigger the first-run flow on an already-bootstrapped host.
  // (Password change uses POST /api/governance/password instead.)
  const config = loadGovernance()
  if (config.passwordHash) {
    return NextResponse.json(
      {
        error: 'already_bootstrapped',
        message: 'Governance password already configured. Use POST /api/governance/password to change it.',
      },
      { status: 409 }
    )
  }

  try {
    const { channel, hint, expiresAt } = await startSetupFlow()
    return NextResponse.json({
      ok: true,
      channel,
      hint,
      expiresAt,
      ttlSeconds: 300,
    })
  } catch (err) {
    console.error('[setup-init] failed:', err)
    return NextResponse.json(
      { error: 'setup_failed', message: 'Could not dispatch setup code. Check server logs.' },
      { status: 500 }
    )
  }
}
