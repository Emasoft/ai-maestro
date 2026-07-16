'use client'

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import PasswordDialog from './governance/PasswordDialog'
import RecoveryEmailSection from './settings/RecoveryEmailSection'

interface LoginGateProps {
  children: ReactNode
}

/**
 * RecoveryGate (TRDD-7U927FCM 2A) — the first-run REQUIRED-recovery step. After the owner
 * bootstraps a governance password, LoginGate keeps them here (never in the app) until they
 * either configure a verified recovery email OR explicitly opt out to console/passkey recovery.
 *
 * It is NOT a hard block: the opt-out is the escape hatch so a host whose SMTP is unreachable
 * never dead-ends. `/api/governance/recovery-optout` is owner-gated only (a plain cookie'd
 * fetch — deliberately not strict, so a remote owner mid-first-run is never locked out).
 */
function RecoveryGate({ onComplete }: { onComplete: () => void }) {
  const [optingOut, setOptingOut] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const optOut = async () => {
    setOptingOut(true)
    setError(null)
    try {
      const res = await fetch('/api/governance/recovery-optout', { method: 'POST' })
      if (!res.ok) {
        setError(`Could not record the choice (${res.status}).`)
        return
      }
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Request failed')
    } finally {
      setOptingOut(false)
    }
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-gray-950 p-4">
      <div className="w-full max-w-md">
        <h1 className="text-lg font-semibold text-gray-100 mb-1">Set up account recovery</h1>
        <p className="text-sm text-gray-400 mb-1">
          Configure a way to reset the governance password if you ever forget it — even from a
          remote device. Add a recovery email below, then verify the emailed code.
        </p>
        <p className="text-xs text-gray-500 mb-3">
          No mail server on this host? Choose console/passkey recovery instead — you can always
          add a recovery email later from Settings.
        </p>
        <RecoveryEmailSection onRecoveryComplete={onComplete} />
        <div className="mt-4 flex items-center justify-between gap-2">
          {error ? <span className="text-xs text-red-400">{error}</span> : <span />}
          <button
            onClick={optOut}
            disabled={optingOut}
            className="text-xs text-gray-400 hover:text-gray-200 underline disabled:opacity-50"
          >
            {optingOut ? 'Saving…' : 'Use console/passkey recovery instead'}
          </button>
        </div>
      </div>
    </div>
  )
}

/**
 * LoginGate — wraps the app and checks for a valid session cookie.
 * If no valid session, shows the login screen (the unified PasswordDialog, which also
 * carries the built-in "Did you forget your password?" → reset flow, TRDD-P7XKV3N9).
 * After a successful login OR reset (the reset route auto-logins by setting the session
 * cookie), the app renders.
 *
 * The password input, submit, error rendering, and the reset state machine ALL live in
 * PasswordDialog now — LoginGate keeps only session lifecycle (initial check + the 30s
 * mid-session-expiry poll). One dialog, one place to debug.
 */
export default function LoginGate({ children }: LoginGateProps) {
  const [status, setStatus] = useState<'checking' | 'authenticated' | 'login' | 'recovery'>('checking')
  // UI2-MAJ-18: track mount state so async setState (checkSession, 30s session-poll)
  // doesn't fire on the unmounted component (e.g. navigating between LoginGate routes).
  const isMountedRef = useRef(true)
  useEffect(() => {
    isMountedRef.current = true
    return () => { isMountedRef.current = false }
  }, [])

  const checkSession = useCallback(async (signal?: AbortSignal) => {
    try {
      const res = await fetch('/api/auth/session', signal ? { signal } : undefined)
      if (signal?.aborted) return
      if (!isMountedRef.current) return
      if (!res.ok) { setStatus('login'); return }
      const data = await res.json().catch(() => ({} as Record<string, unknown>))
      // Open access (no governance password yet) → no account to protect, so no recovery gate.
      if (data.passwordNotSet) { setStatus('authenticated'); return }
      // A real account exists: hold the owner on the first-run required-recovery step
      // (TRDD-7U927FCM 2A) until recovery setup is complete — a verified recovery email OR
      // an explicit opt-out. An older server that omits the field (undefined) is treated as
      // complete so it never blocks a pre-2A deployment.
      if (data.recoverySetupComplete === false) { setStatus('recovery'); return }
      setStatus('authenticated')
    } catch (err) {
      if ((err as Error)?.name === 'AbortError') return
      // CC-GOV-003: Network error must NOT grant access — show login form
      if (!isMountedRef.current) return
      setStatus('login')
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    checkSession(controller.signal)
    return () => controller.abort()
  }, [checkSession])

  // Detect mid-session expiration: if the server restarts while the page is open,
  // the in-memory session store is cleared but LoginGate stays in 'authenticated' state.
  // API calls silently fail with 401, showing 0 agents. This periodic check forces
  // re-login when the session becomes invalid.
  useEffect(() => {
    if (status !== 'authenticated') return
    const controller = new AbortController()
    const interval = setInterval(async () => {
      try {
        const res = await fetch('/api/auth/session', { signal: controller.signal })
        if (controller.signal.aborted) return
        if (!isMountedRef.current) return
        if (!res.ok) {
          setStatus('login')
        }
      } catch (err) {
        if ((err as Error)?.name === 'AbortError') return
        // Network error while authenticated — don't force logout,
        // could be a transient issue. Let the user retry.
      }
    }, 30000) // Check every 30 seconds
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [status])

  // Checking session...
  if (status === 'checking') {
    return (
      <div className="flex h-screen items-center justify-center bg-gray-950 text-gray-500">
        <div className="animate-pulse">Verifying session...</div>
      </div>
    )
  }

  // Authenticated — render the app
  if (status === 'authenticated') {
    return <>{children}</>
  }

  // First-run required-recovery gate (TRDD-7U927FCM 2A) — the owner has a password but has
  // not yet completed recovery setup. Advance to the app only when they configure+verify a
  // recovery email or opt out to console/passkey recovery.
  if (status === 'recovery') {
    return <RecoveryGate onComplete={() => { if (isMountedRef.current) setStatus('authenticated') }} />
  }

  // Login screen — the unified dialog. A successful login OR a completed password reset
  // (which the route finishes by minting a session cookie) both resolve to authenticated.
  return (
    <PasswordDialog
      purpose="login"
      variant="fullscreen"
      onSuccess={() => { if (isMountedRef.current) setStatus('authenticated') }}
    />
  )
}
