'use client'

/**
 * Sudo-mode password dialog context (SEC-PHASE-7, #92).
 *
 * The server rejects strict API calls (delete agent, delete team, plugin
 * uninstall, password change, etc.) with 403 `sudo_required` unless the
 * caller presents a fresh X-Sudo-Token earned by re-entering the
 * governance password within the last 60 seconds. This context owns a
 * single app-wide password modal and hands out sudo tokens on demand
 * via `requestSudoToken()`.
 *
 * USAGE (in any client component):
 *
 *   const { requestSudoToken } = useSudo()
 *   const token = await requestSudoToken('Delete agent "foo"')
 *   if (!token) return  // user cancelled
 *   await fetch('/api/agents/foo', {
 *     method: 'DELETE',
 *     headers: { 'X-Sudo-Token': token },
 *   })
 *
 * Or let `sudoFetch` (lib/sudo-fetch.ts) handle the retry loop for you.
 */

import { createContext, useContext, useState, useCallback, useEffect, useRef, type ReactNode } from 'react'
import { usePathname } from 'next/navigation'
import { X, AlertCircle } from 'lucide-react'
import type { SudoOperation } from '@/lib/sudo-fetch'
import PasswordDialog from '@/components/governance/PasswordDialog'

// Proposal 32 (2026-04-20): auto-cancel window. If the user opens the
// sudo modal, walks away, and the timer expires, the modal closes so
// a subsequent click isn't silently intercepted. Matches the 60s
// server-side token TTL + 60s grace.
const SUDO_MODAL_TIMEOUT_MS = 120_000

interface SudoContextValue {
  /**
   * Prompt the user for the governance password, exchange it for a
   * sudo token via POST /api/auth/sudo-password, and return the token.
   * Returns null if the user cancels or if the password is rejected.
   *
   * `operation` (optional, SUDO-01/R32): when supplied — e.g. by sudoFetch
   * forwarding the (method, path) of the retried request — the minted token is
   * bound to that operation so it cannot be replayed for a different strict
   * route. Omitted → an unbound token (two-phase rollout, R-3).
   */
  requestSudoToken: (reason: string, operation?: SudoOperation) => Promise<string | null>

  /**
   * TRDD-HZDD1CUD: surface a sudo-retry rejection (op/subject mismatch) as a
   * transient toast instead of the caller silently reverting its own state
   * with no visible explanation. Callers catch `SudoRetryRejected` from
   * `sudoFetch` and pass its `.message` here.
   */
  reportSudoError: (message: string) => void
}

const SudoContext = createContext<SudoContextValue | null>(null)

interface Resolver {
  resolve: (token: string | null) => void
}

export function SudoProvider({ children }: { children: ReactNode }) {
  const [reason, setReason] = useState<string | null>(null)
  const [resolver, setResolver] = useState<Resolver | null>(null)
  const [operation, setOperation] = useState<SudoOperation | undefined>(undefined)

  // TRDD-HZDD1CUD: independent of the password-modal state above — the
  // mismatch happens AFTER a token was already successfully minted (the
  // modal has already closed), so it needs its own transient surface.
  const [toastMessage, setToastMessage] = useState<string | null>(null)
  const reportSudoError = useCallback((message: string) => {
    setToastMessage(message)
  }, [])
  useEffect(() => {
    if (!toastMessage) return
    const timer = setTimeout(() => setToastMessage(null), 8000)
    return () => clearTimeout(timer)
  }, [toastMessage])

  const requestSudoToken = useCallback((r: string, op?: SudoOperation): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      setReason(r)
      setOperation(op)
      setResolver({ resolve })
    })
  }, [])

  const cancel = useCallback(() => {
    if (resolver) resolver.resolve(null)
    setResolver(null)
    setReason(null)
    setOperation(undefined)
  }, [resolver])

  // Proposal 32 (2026-04-20): dismiss the sudo modal on:
  //   (a) Next.js pathname change (user navigated away without interacting).
  //   (b) 120-second inactivity (server token TTL is 60s; grace for keystrokes).
  // Without these the modal lingers as a global portal and intercepts
  // subsequent clicks, confusing users.
  const pathname = usePathname()
  const lastPathnameRef = useRef<string | null>(pathname)
  useEffect(() => {
    if (!resolver) {
      lastPathnameRef.current = pathname
      return
    }
    if (lastPathnameRef.current !== pathname) {
      lastPathnameRef.current = pathname
      cancel()
    }
  }, [pathname, resolver, cancel])

  useEffect(() => {
    if (!resolver) return
    const timer = setTimeout(cancel, SUDO_MODAL_TIMEOUT_MS)
    return () => clearTimeout(timer)
  }, [resolver, cancel])

  const open = resolver !== null

  return (
    <SudoContext.Provider value={{ requestSudoToken, reportSudoError }}>
      {children}
      {/* TRDD-HZDD1CUD: op/subject-mismatch toast. Rendered independently
          of the password modal (`open`) since the mismatch surfaces AFTER
          the modal already closed with a "successfully minted" token. */}
      {toastMessage && (
        <div
          role="alert"
          className="fixed bottom-4 right-4 z-[9999] max-w-sm rounded-lg border border-amber-500/40 bg-gray-900 shadow-2xl p-3 flex items-start gap-2"
        >
          <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
          <p className="text-xs text-gray-200 flex-1">{toastMessage}</p>
          <button
            onClick={() => setToastMessage(null)}
            className="p-0.5 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300 flex-shrink-0"
            aria-label="Dismiss"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {/* TRDD-P7XKV3N9 Phase C: the sudo password prompt is now the ONE unified
          PasswordDialog, not a hand-rolled modal. SudoContext keeps ownership of
          the pending-promise + token contract; PasswordDialog owns the input,
          submit-in-flight, and error rendering. `onSubmit` mints the token via
          the SAME endpoint the old modal used, so the 60s one-shot semantics are
          unchanged (they live server-side in /api/auth/sudo-password). */}
      {open && (
        <PasswordDialog
          purpose="sudo"
          variant="modal"
          title="Confirm your identity"
          description={reason ?? 'This action requires re-entering your governance password.'}
          // The old sudo modal offered no password-reset path; keep it a pure
          // confirmation prompt so success can only ever resolve with a token.
          allowReset={false}
          onSubmit={async (pw) => {
            const res = await fetch('/api/auth/sudo-password', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              // SUDO-01: forward the operation (if any) so the minted token is
              // bound to the action the user is confirming.
              body: JSON.stringify(operation ? { password: pw, operation } : { password: pw }),
            })
            if (res.status === 403) {
              return { ok: false, error: 'Password does not match — try again.' }
            }
            if (res.status === 503) {
              return { ok: false, error: 'Governance password not configured on this host.' }
            }
            if (!res.ok) {
              const body = await res.json().catch(() => ({ error: 'Unknown error' }))
              return { ok: false, error: (body as { error?: string }).error || `HTTP ${res.status}` }
            }
            const data = await res.json() as { token: string; expiresAt: number }
            return { ok: true, result: { token: data.token } }
          }}
          onSuccess={(result) => {
            // Hand the minted token back to the caller waiting on requestSudoToken
            // and close, exactly as the old modal's success path did.
            if (resolver) resolver.resolve(result?.token ?? null)
            setResolver(null)
            setReason(null)
            setOperation(undefined)
          }}
          onCancel={cancel}
        />
      )}
    </SudoContext.Provider>
  )
}

export function useSudo(): SudoContextValue {
  const ctx = useContext(SudoContext)
  if (!ctx) {
    throw new Error('useSudo must be used inside <SudoProvider>')
  }
  return ctx
}
