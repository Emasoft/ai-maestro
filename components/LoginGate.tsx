'use client'

import { useState, useEffect, useCallback, useRef, type ReactNode } from 'react'
import PasswordDialog from './governance/PasswordDialog'

interface LoginGateProps {
  children: ReactNode
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
  const [status, setStatus] = useState<'checking' | 'authenticated' | 'login'>('checking')
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
      setStatus(res.ok ? 'authenticated' : 'login')
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
