/**
 * POST /api/governance/password/invalidate — revoke the password using the password.
 *
 * TRDD-P7XKV3N9. Supplying the CURRENT password is the proof of possession. On
 * success the credential is DESTROYED and the next login asks the user to create
 * a new one. It is never replaced with a known value, so there is no window in
 * which a leaked password is still live.
 *
 * Two factors, because possession alone must not rotate the master credential:
 *
 *   1. the password         — proves you KNOW the secret
 *   2. a code on the desktop — proves you are AT the machine
 *
 * The code is dispatched by `lib/setup-bootstrap.ts` (SEC-PHASE-6) — the same
 * mechanism first-run setup uses — over the host OS's own notification channel.
 * It is NEVER returned in a response body, a log, or an error. An attacker who
 * holds the password but is not at the console cannot read it. That is the entire
 * security property; the moment the code travels over HTTP, this is theater.
 *
 * SCOPE (TRDD-P7XKV3N9 §2b): the console requirement binds THIS operation and
 * MAESTRO login. Every other route stays usable from any device on the Tailscale
 * VPN — remote administration from a phone is a feature, not a leak. Do not copy
 * the loopback check anywhere else.
 *
 * Flow (two calls):
 *   POST { password }         -> 200 { codeRequired: true, channel, hint }  (+ code on the desktop)
 *   POST { password, code }   -> 200 { invalidated: true }
 */
import { NextRequest, NextResponse } from 'next/server'
import { z } from 'zod'
import { verifyPassword, invalidatePassword, loadGovernance } from '@/lib/governance'
import { isConsolePeer, peerAddress } from '@/lib/peer-address'
import { startSetupFlow, verifySetupCode } from '@/lib/setup-bootstrap'
import { checkAndRecordAttempt, resetRateLimit } from '@/lib/rate-limit'

const BodySchema = z.object({
  password: z.string().min(1),
  code: z.string().min(4).max(12).optional(),
})

/** Tight: this endpoint's input IS the secret. 5 tries per 15 min, per peer. */
const MAX_ATTEMPTS = 5
const WINDOW_MS = 15 * 60_000

export async function POST(request: NextRequest) {
  const peer = peerAddress(request) ?? ''
  const rlKey = `pw-invalidate:${peer}`

  // ── 1. Console presence — checked FIRST, before the credential is touched ──
  // Deliberately ahead of the password check so a remote caller can never use
  // this endpoint as an oracle: distinct "wrong password" vs "not at console"
  // replies would leak whether a guess was right. Remote gets one answer, always
  // the same, and never a code.
  if (!isConsolePeer(peer)) {
    return NextResponse.json(
      {
        error: 'console_required',
        message:
          'The password can only be invalidated from the machine running AI Maestro. ' +
          'Remote devices on the VPN can use every other function — not this one.',
      },
      { status: 403 },
    )
  }

  // ── 2. Throttle — this route takes the SECRET ITSELF as input ─────────────
  // Every other route takes a token. Unthrottled, this one is a free guessing
  // oracle against the master credential: the endpoint built to protect it would
  // be the thing that exposes it.
  const rl = checkAndRecordAttempt(rlKey, MAX_ATTEMPTS, WINDOW_MS)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'too_many_attempts', retryAfterMs: rl.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    )
  }

  let body: z.infer<typeof BodySchema>
  try {
    body = BodySchema.parse(await request.json())
  } catch {
    return NextResponse.json({ error: 'invalid_request' }, { status: 400 })
  }

  if (!loadGovernance().passwordHash) {
    return NextResponse.json({ error: 'no_password_set' }, { status: 409 })
  }

  if (!(await verifyPassword(body.password))) {
    return NextResponse.json({ error: 'invalid_password' }, { status: 401 })
  }

  // ── 3. No code yet ⇒ put one on the desktop ───────────────────────────────
  if (!body.code) {
    let flow: Awaited<ReturnType<typeof startSetupFlow>>
    try {
      flow = await startSetupFlow()
    } catch {
      // FAIL CLOSED. No channel to the desktop ⇒ presence cannot be proven ⇒
      // refuse. Waving it through "because notifications are broken" silently
      // reduces this to password-only, which is precisely what we are preventing.
      return NextResponse.json(
        {
          error: 'presence_channel_unavailable',
          message: 'Could not deliver a confirmation code to this machine, so presence cannot be proven.',
        },
        { status: 503 },
      )
    }
    // Note what is NOT in this response: the code.
    return NextResponse.json({ codeRequired: true, channel: flow.channel, hint: flow.hint, expiresAt: flow.expiresAt })
  }

  // ── 4. Code supplied ⇒ verify (one-shot; setup-bootstrap consumes it) ─────
  const v = verifySetupCode(body.code)
  if (!v.ok) {
    return NextResponse.json({ error: `code_${v.reason}` }, { status: 401 })
  }

  await invalidatePassword()
  resetRateLimit(rlKey)

  return NextResponse.json({
    invalidated: true,
    message: 'Password invalidated. The next login will ask you to create a new one.',
  })
}
