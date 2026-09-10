'use client'

import { useEffect, useState } from 'react'
import { KeyRound } from 'lucide-react'

interface RotatorStatus {
  tickNextAction: string | null
  accounts?: { email: string; refreshDead: boolean }[]
}

const POLL_MS = 30_000

/**
 * Fleet-level banner for the rotator's `reauth-needed` verdict (TRDD-CVQJNW3A box 3, surface
 * half; the data half is `dc8ddf30`). Renders ONLY on `reauth-needed` — silent when clear, the
 * same alarm-fatigue discipline as TmuxKeychainAlarmBanner.
 *
 * MOUNTED IN BOTH DASHBOARD ARMS, and that is not incidental. `app/page.tsx` returns
 * `<MobileDashboard>` from an early `if (isMobile)`, so the banners below that return are
 * DESKTOP-ONLY — while the status route is deliberately not console-gated precisely because
 * "seeing that an account is dead is exactly what the owner needs from their phone". Mounting
 * only beside its siblings would have shipped a feature that is silent on the one surface its
 * own rationale names.
 *
 * ⚠ `null` IS DELIBERATELY SILENT, and this is FORCED, not chosen. The route's own comment is
 * emphatic that null means the beat is absent or its verdict stale — UNKNOWN, not fine. But the
 * tick is behind OAUTH_TICK_FLAG and defaults OFF, so armed-but-dead and never-armed BOTH arrive
 * here as null, and this route carries no signal separating them — MEASURED, not assumed: its one
 * `NextResponse.json` returns exactly `{liveEmail, accounts, tickNextAction}`. Alarming on null would put a
 * permanent banner on every install that never armed the rotator. The consequence is real and
 * must not be glossed: to the owner, this banner's silence is indistinguishable from health.
 * The fix needs a new signal, not a new guard — see the card's residue (`oauthTickEnabled()`
 * surfaced as `tickArmed`, then `tickArmed && nextAction === null` → a SEPARATE banner).
 */
export default function RotatorReauthBanner() {
  const [status, setStatus] = useState<RotatorStatus | null>(null)

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const response = await fetch('/api/oauth-rotator/status')
        // Stay silent on a non-ok response rather than alarming. The route is enforceMaestro-gated,
        // so a non-maestro viewer gets 403 on every poll — failing loud would fire this banner at
        // people who cannot act on it. Keeping the last known state errs in WHICHEVER direction
        // that state pointed, and the common case is the bad one: on first load `status` is still
        // null and no poll has ever succeeded, so a route that is 500ing from the start leaves
        // this permanently silent. Only when the last good poll said `reauth-needed` does this
        // err toward over-showing.
        if (!response.ok) return
        const data = (await response.json()) as RotatorStatus
        if (!cancelled) setStatus(data)
      } catch {
        // Same shape as the `!response.ok` branch above, and it fails the same way: a network
        // error from the first poll on leaves `status` at its initial null forever, which renders
        // as silence. "Keep the last known state" only describes the case where a poll already
        // succeeded — it is not a fallback, it is the absence of one.
      }
    }

    poll()
    const id = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (status?.tickNextAction !== 'reauth-needed') return null

  const dead = (status.accounts ?? []).filter((a) => a.refreshDead).map((a) => a.email)

  return (
    <div
      role="alert"
      className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mx-4 mt-4 flex items-start gap-3"
    >
      <KeyRound className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <h3 className="text-sm font-semibold text-red-300 mb-1">Claude account needs a re-login</h3>
        <p className="text-sm text-red-200/80">
          The OAuth rotator has no automatic path left
          {dead.length > 0 ? `: ${dead.join(', ')}` : ''}. Re-login is console-gated, so it must be
          done AT the host machine — Settings → Claude Accounts.
        </p>
      </div>
    </div>
  )
}
