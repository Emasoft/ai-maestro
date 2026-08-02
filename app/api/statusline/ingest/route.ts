/**
 * POST /api/statusline/ingest — take Claude Code's own statusline payload, for free.
 *
 * TRDD-D8OYFG35. Claude Code pipes its `statusLine` command a JSON payload that already contains
 * the 5-hour and 7-day rate-limit windows, computed locally and costing ZERO API tokens. Nothing
 * consumed it: the number arrived on stdin every few seconds and was thrown away while
 * `/api/oauth/usage` was polled up to 420 times an hour for the same two figures. This route is the
 * mouth of that pipe.
 *
 * ── LOCALHOST-ONLY, AND WHY THAT IS THE RIGHT GATE HERE ──────────────────────────────────────────
 * `lib/peer-address.mjs::isConsolePeer` (never `x-forwarded-for`, which is client-forgeable — a
 * phone on the VPN can send `X-Forwarded-For: 127.0.0.1`). The console list is deliberately short
 * and every entry has to argue for itself, so here is the argument, which is a DIFFERENT one from
 * the three R48 entries:
 *
 *   - those three (MAESTRO login, password change, dashboard re-login) use console presence as a
 *     SECOND FACTOR — physical presence proving the PERSON, on top of a credential;
 *   - this one uses it as an ORIGIN check on a data source that can only exist locally. A
 *     statusline payload is a description of a Claude Code process running ON THIS MACHINE. A
 *     remote caller has, by construction, nothing truthful to say here.
 *
 * So the check is not borrowed authority; it is the natural boundary of the fact being reported.
 *
 * ── WHAT THIS ROUTE IS NOT ───────────────────────────────────────────────────────────────────────
 * It confers no capability, returns no secret, and reads nothing. It accepts an observation and
 * answers `{ ok, sessionId }`. It is on the `middleware.ts` WHITELIST because Claude Code runs the
 * user's statusline in a terminal with no cookie and no AID token; see the entry there for the full
 * reasoning and the honest statement of the residual risk (a local process can lie about one
 * session's gauge).
 *
 * ── FAIL-SOFT IS THE CALLER'S CONTRACT TOO ───────────────────────────────────────────────────────
 * The wrapper that calls this (`scripts/aimaestro-statusline-capture.sh`) is detached and discards
 * our response entirely. Nothing here can stall or corrupt the user's status bar, whatever it
 * answers — which is why this handler is allowed to be strict about bad input while the caller is
 * not allowed to care.
 */
import { NextRequest, NextResponse } from 'next/server'
import { isConsolePeer, peerAddress } from '@/lib/peer-address.mjs'
import { checkAndRecordAttempt } from '@/lib/rate-limit'
import { loadState } from '@/lib/oauth-rotator/slots'
import { runOneTick, tickAttemptAllowed } from '@/lib/oauth-rotator/server-tick'
import { isNearLimit } from '@/lib/oauth-rotator/tick'
import { admitSnapshot, stampLiveAccount } from '@/lib/statusline-admissible'
import type { StatuslineSnapshot } from '@/types/statusline'
import { normalizeStatuslinePayload } from '@/lib/statusline-normalize'
import { MAX_INGEST_BYTES, pruneStatuslineSnapshots, writeStatuslineSnapshot } from '@/lib/statusline-store'

export const dynamic = 'force-dynamic'

/**
 * Claude Code debounces the statusline at 300 ms and a `refreshInterval` can be as low as 1 s, so a
 * handful of live sessions legitimately produce a few posts per second. 600/min per peer is far
 * above that and far below "a runaway loop fills the disk".
 */
const MAX_POSTS_PER_WINDOW = 600
const RATE_WINDOW_MS = 60_000

export async function POST(request: NextRequest) {
  const peer = peerAddress(request) ?? ''

  if (!isConsolePeer(peer)) {
    return NextResponse.json(
      {
        error: 'console_required',
        message:
          'Statusline observations are accepted only from the machine running AI Maestro. ' +
          'A statusline payload describes a local Claude Code process; a remote caller has nothing ' +
          'truthful to report here.',
      },
      { status: 403 },
    )
  }

  const rl = checkAndRecordAttempt(`statusline-ingest:${peer}`, MAX_POSTS_PER_WINDOW, RATE_WINDOW_MS)
  if (!rl.allowed) {
    return NextResponse.json(
      { error: 'too_many_requests', retryAfterMs: rl.retryAfterMs },
      { status: 429, headers: { 'Retry-After': String(Math.ceil(rl.retryAfterMs / 1000)) } },
    )
  }

  // Check the DECLARED length first (cheap, refuses before we buffer), then the ACTUAL text — a
  // header is a claim, and a sender that lies about it must still hit the wall.
  const declared = Number(request.headers.get('content-length') ?? '')
  if (Number.isFinite(declared) && declared > MAX_INGEST_BYTES) {
    return NextResponse.json({ error: 'payload_too_large', maxBytes: MAX_INGEST_BYTES }, { status: 413 })
  }

  let raw: string
  try {
    raw = await request.text()
  } catch {
    return NextResponse.json({ error: 'unreadable_body' }, { status: 400 })
  }
  if (Buffer.byteLength(raw, 'utf-8') > MAX_INGEST_BYTES) {
    return NextResponse.json({ error: 'payload_too_large', maxBytes: MAX_INGEST_BYTES }, { status: 413 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 })
  }

  // The ONLY rejection the normaliser makes: no usable `session_id`. Everything else degrades to
  // null, because the payload is a shape we do not own and one renamed field must not cost us the
  // whole observation. See lib/statusline-normalize.ts.
  const snapshot = normalizeStatuslinePayload(parsed)
  if (!snapshot) {
    return NextResponse.json(
      {
        error: 'invalid_payload',
        message: 'session_id is required and must match [A-Za-z0-9_-]{1,128}',
      },
      { status: 400 },
    )
  }

  // Stamp WHICH ACCOUNT IS LIVE RIGHT NOW, server-side (TRDD-SIV45HOG). This must happen HERE and
  // not in the normaliser: the normaliser is a pure payload→snapshot mapping and the payload is
  // attacker-shaped input from a local process, so the one field the sender must not choose is
  // resolved outside its reach. Without the stamp the rotator attributes reports produced under an
  // exhausted account to the fresh one it just switched to, and rotates straight back out — a loop
  // that burns every remaining account in minutes. Fail-soft by construction: an unreadable rotator
  // state stamps null, which is inadmissible downstream rather than lost here.
  stampLiveAccount(snapshot)

  try {
    await writeStatuslineSnapshot(snapshot)
  } catch (err) {
    return NextResponse.json(
      { error: 'write_failed', message: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    )
  }

  // ── PUSH-TRIGGER (TRDD-GY0LJV6S) ────────────────────────────────────────────────────────────
  // The statusline says "CHECK NOW"; it does NOT say "rotate now". This fires the ordinary
  // endpoint-backed rotation beat and lets THAT decide — which is what makes a misattributed
  // reading harmless: the report's account stamp records who was live at ARRIVAL, not who produced
  // it, so a session running through an A→B switch keeps reporting A's ~98% and is admitted as B's.
  // Acting on that directly burns the fleet (measured, and reverted in 3c9a7493). Triggering on it
  // costs one HTTP call the endpoint then answers with the truth.
  maybeTriggerRotationCheck(snapshot)

  // Housekeeping, deliberately AFTER the write and deliberately unable to fail the request: a
  // successful observation must never be reported as lost because a prune could not run.
  const pruned = await pruneStatuslineSnapshots().catch(() => 0)

  return NextResponse.json({ ok: true, sessionId: snapshot.sessionId, capturedAt: snapshot.capturedAt, pruned })
}

/**
 * Fire the ordinary rotation beat when THIS observation is at/over threshold — TRDD-GY0LJV6S.
 *
 * ── WHY `runOneTick` AND NOTHING INNER ───────────────────────────────────────────────────────────
 * The tick LOCK lives in `runOneTick`, not in `runTick` and not in `autoRotate`. Calling either
 * inner function would make this route a SECOND, UNSERIALIZED writer into the live credential,
 * racing the 60 s timer — the one irreversible failure the rotator subsystem is built to avoid. It
 * would also bypass the R16 activation gate, so a user who never enabled rotation would get one.
 *
 * ── WHY IT IS NEVER AWAITED ──────────────────────────────────────────────────────────────────────
 * `runOneTick` already swallows every error by contract, and the caller here
 * (`scripts/aimaestro-statusline-capture.sh`) is detached and discards the response. Awaiting would
 * hold an HTTP request open across the rotator's network I/O for no reader.
 *
 * ── THE TWO ZERO-I/O GATES, IN THIS ORDER ────────────────────────────────────────────────────────
 * This runs on a path rate-limited at 600/min, so both gates must be free. The floor is checked
 * FIRST because it is a pure arithmetic compare, where the threshold test reads rotator state from
 * disk. Note what is deliberately NOT here: `listStatuslineSnapshots()`. The freshest observation
 * is the one in hand; a readdir per ingest is exactly the cost this feature exists to remove.
 */
function maybeTriggerRotationCheck(snapshot: StatuslineSnapshot): void {
  try {
    if (!tickAttemptAllowed()) return // cheapest gate first — pure compare, no I/O

    // `admitSnapshot` is the SAME predicate the rest of the system uses — never a second copy.
    // It cannot make the trigger safe (the arrival-stamp hole is unclosable from the server), but
    // it removes the observations we CAN prove irrelevant, so the wasted-call rate stays low.
    if (admitSnapshot(snapshot, loadState()) !== null) return

    const fh = snapshot.rateLimits.fiveHour?.usedPercentage ?? null
    const sd = snapshot.rateLimits.sevenDay?.usedPercentage ?? null
    // `null` scoped: the statusline structurally cannot observe the model-scoped weekly windows,
    // and `isNearLimit` documents null as "contributes nothing". Passing 0 would be a lie that
    // reads as healthy; passing a second threshold constant would be a copy that drifts.
    if (!isNearLimit(fh, sd, null)) return

    void runOneTick().catch(() => {}) // fire-and-forget; see above
  } catch {
    // FAIL-SOFT, and this is the contract that lets the trigger sit in a request path at all: an
    // unreadable rotator state, a missing flag file, anything — the observation was already written
    // and acknowledged, and the 60 s timer still runs. The worst case is the latency we had before.
  }
}
