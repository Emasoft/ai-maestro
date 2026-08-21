'use client'

import { useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

interface AlarmState {
  active: boolean
  since?: string
  message?: string
}

const POLL_MS = 30_000

/**
 * Fleet-level banner for the tmux-server keychain alarm (TRDD-GIA2LC83, UI half of
 * TRDD-78J4I4QS). Polls the alarm state and renders only while active — silent when
 * clear, same alarm-fatigue discipline the parent watchdog card set for the sweep itself.
 */
export default function TmuxKeychainAlarmBanner() {
  const [alarm, setAlarm] = useState<AlarmState | null>(null)

  useEffect(() => {
    let cancelled = false

    const poll = async () => {
      try {
        const response = await fetch('/api/system/tmux-keychain-alarm')
        if (!response.ok) return
        const data = (await response.json()) as AlarmState
        if (!cancelled) setAlarm(data)
      } catch {
        // Transient fetch failure — keep the last known state, try again next tick.
      }
    }

    poll()
    const id = setInterval(poll, POLL_MS)
    return () => {
      cancelled = true
      clearInterval(id)
    }
  }, [])

  if (!alarm?.active) return null

  return (
    <div className="bg-red-500/10 border border-red-500/30 rounded-lg p-4 mx-4 mt-4 flex items-start gap-3">
      <AlertTriangle className="w-5 h-5 text-red-400 flex-shrink-0 mt-0.5" />
      <div className="flex-1">
        <h3 className="text-sm font-semibold text-red-300 mb-1">Tmux server is keychain-blind</h3>
        <p className="text-sm text-red-200/80">
          {alarm.message ??
            'The tmux server is keychain-blind; every agent forked from it will fail to authenticate.'}
        </p>
      </div>
    </div>
  )
}
