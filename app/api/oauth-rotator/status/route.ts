/**
 * GET /api/oauth-rotator/status — which Claude accounts this host holds, and which need a human.
 *
 * TRDD-OX5TT5OT. The read half of the re-login flow: a "Re-login" button is useless without saying
 * WHICH account needs one, and until now nothing in the dashboard showed the rotator at all.
 *
 * NO SECRETS. It reads only `state.json`, the rotator's no-secret INDEX (emails, timestamps,
 * failure counters) — never a slot blob, so no keychain is touched and no token can be returned.
 * The `fp` fingerprint the index also carries is deliberately omitted: it identifies a token and
 * the UI has no use for it.
 *
 * MAESTRO-only, but deliberately NOT console-gated, unlike the two mutating routes. Seeing that an
 * account is dead is exactly what the owner needs from their phone — it is what tells them a trip
 * to the machine is required. Only the LOGIN itself is bound to physical presence.
 */
import { NextRequest, NextResponse } from 'next/server'

import { enforceMaestro } from '@/lib/route-auth'
import { expiresInH, loadState } from '@/lib/oauth-rotator/slots'
import { readTickStatus } from '@/lib/oauth-rotator/tick-status'
import { refreshNeedsHuman, readRefreshCounters, type BlobIdentity } from '@/lib/oauth-rotator/supervisor'

/** Read one optional numeric extra off an index entry without asserting the open shape. */
function num(entry: Record<string, unknown>, key: string): number | null {
  const v = entry[key]
  return typeof v === 'number' ? v : null
}

/** issue-152: this slot's `BlobIdentity` AS OF WHATEVER `tick.ts` LAST WROTE — `meta.fp`
 *  (tick.ts:795/1066, `fingerprint(...)` of the credential the tick most recently confirmed) and
 *  `meta.expires_at` (tick.ts:796/1067) — built ENTIRELY from the no-secret state.json index, no
 *  keychain read. This is deliberately NOT "the identity right now": a corrected route must never
 *  claim the same value the tick already computed as if it were fresher. When the tick's own
 *  `refresh_counts_snapshot` was written against this exact `(fp, expiresAt)` pair,
 *  `freshRefreshSubCounters` (supervisor.ts) accepts it and this route gets the SAME cause-aware
 *  verdict the tick and the supervisor already agree on (e.g. 775 consecutive `network` failures
 *  correctly reading NOT dead, TRDD-Y1ZWU998). If `meta.fp` is absent (a legacy slot pre-#152, or
 *  one never yet touched by a successful tick) the identity is `null`, which makes any snapshot
 *  read as stale/unconfirmable and falls back to the raw `refresh_failures` total — safe, and the
 *  same legacy behavior this route always had. */
function currentIdentityFrom(entry: Record<string, unknown>): BlobIdentity | null {
  const fp = entry.fp
  if (typeof fp !== 'string') return null
  return { fp, expiresAt: num(entry, 'expires_at') }
}

export async function GET(request: NextRequest) {
  const denied = enforceMaestro(request)
  if (denied) return denied

  const state = loadState()
  const slots = (state.slots ?? {}) as unknown as Record<string, Record<string, unknown>>

  const accounts = Object.keys(slots)
    .sort()
    .map((email) => {
      const entry = slots[email] ?? {}
      const expiresAt = num(entry, 'expires_at')
      const refreshFailures = num(entry, 'refresh_failures') ?? 0
      return {
        email,
        isLive: state.live_email === email,
        expiresAt,
        // Reuse the blob helper rather than re-implementing its ms-vs-seconds heuristic: two
        // readings of `expiresAt` would eventually disagree, and the one on screen would be wrong.
        expiresInH: expiresAt === null ? null : expiresInH({ claudeAiOauth: { expiresAt } }),
        refreshFailures,
        // issue-152: routed through the SAME shared predicate `tick.ts` uses, not a re-derived
        // raw-threshold comparison. The identity comes from `meta.fp`/`meta.expires_at` — the
        // no-secret index fields the tick itself writes on every success (see
        // `currentIdentityFrom`'s doc) — never a keychain read. `hasRefresh: true` preserves prior
        // behavior for a no-refresh setup-token slot (this index never recorded refresh-token
        // presence, so treating it as unknown-but-true avoids inventing a NEW "no refresh ->
        // always dead" verdict this route never made before).
        refreshDead: refreshNeedsHuman(readRefreshCounters(entry), true, currentIdentityFrom(entry)),
        capturedAt: typeof entry.captured_at === 'string' ? entry.captured_at : null,
        via: typeof entry.via === 'string' ? entry.via : null,
      }
    })

  // TRDD-CVQJNW3A box 3: the per-account `refreshDead` flags above say which SLOT is dead; they
  // do not say what the TICK concluded about the host as a whole. `reauth-needed` is the verdict
  // that means "no automatic path is left" — and until now it existed only in a file on disk, so
  // it reached the owner only if a human read it out to them. That is the gap this closes.
  //
  // ⚠ `null` DOES NOT MEAN HEALTHY, and no derived boolean is exported here for exactly that
  // reason. `readTickStatus` returns null when the stamp is absent OR older than 300 s — i.e.
  // when the beat is not running — so a `needsHuman: false` collapsed out of it would report a
  // DEAD rotator as a well one, which is the lenient-reader failure this codebase has been bitten
  // by before. Three states reach the client and the client compares for itself:
  //   'reauth-needed' → a human is required · 'ok'/'rotating'/'stuck' → the tick is deciding
  //   null            → the tick is not beating, or its verdict is stale: UNKNOWN, not fine.
  const tickNextAction = readTickStatus()

  return NextResponse.json({ liveEmail: state.live_email ?? null, accounts, tickNextAction })
}
