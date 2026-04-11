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

import { createContext, useContext, useState, useCallback, type ReactNode } from 'react'
import { Lock, X, AlertCircle, Loader2 } from 'lucide-react'

interface SudoContextValue {
  /**
   * Prompt the user for the governance password, exchange it for a
   * sudo token via POST /api/auth/sudo-password, and return the token.
   * Returns null if the user cancels or if the password is rejected.
   */
  requestSudoToken: (reason: string) => Promise<string | null>
}

const SudoContext = createContext<SudoContextValue | null>(null)

interface Resolver {
  resolve: (token: string | null) => void
}

export function SudoProvider({ children }: { children: ReactNode }) {
  const [reason, setReason] = useState<string | null>(null)
  const [resolver, setResolver] = useState<Resolver | null>(null)
  const [password, setPassword] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const requestSudoToken = useCallback((r: string): Promise<string | null> => {
    return new Promise<string | null>((resolve) => {
      setReason(r)
      setPassword('')
      setError(null)
      setResolver({ resolve })
    })
  }, [])

  const cancel = useCallback(() => {
    if (resolver) resolver.resolve(null)
    setResolver(null)
    setReason(null)
    setPassword('')
    setError(null)
  }, [resolver])

  const submit = useCallback(async () => {
    if (!resolver || !password || submitting) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch('/api/auth/sudo-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.status === 403) {
        setError('Password does not match — try again.')
        setPassword('')
        return
      }
      if (res.status === 503) {
        setError('Governance password not configured on this host.')
        return
      }
      if (!res.ok) {
        const body = await res.json().catch(() => ({ error: 'Unknown error' }))
        setError(body.error || `HTTP ${res.status}`)
        return
      }
      const data = await res.json() as { token: string; expiresAt: number }
      resolver.resolve(data.token)
      setResolver(null)
      setReason(null)
      setPassword('')
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setSubmitting(false)
    }
  }, [resolver, password, submitting])

  const open = resolver !== null

  return (
    <SudoContext.Provider value={{ requestSudoToken }}>
      {children}
      {open && (
        <div
          className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/70 backdrop-blur-sm"
          onClick={cancel}
          role="dialog"
          aria-modal="true"
        >
          <div
            className="w-full max-w-sm rounded-xl border border-amber-500/40 bg-gray-900 shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-gray-800">
              <div className="flex items-center gap-2">
                <Lock className="w-4 h-4 text-amber-400" />
                <h2 className="text-sm font-semibold text-gray-100">Confirm with password</h2>
              </div>
              <button
                onClick={cancel}
                className="p-1 rounded hover:bg-gray-800 text-gray-500 hover:text-gray-300"
                title="Cancel"
                disabled={submitting}
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Body */}
            <div className="p-4 space-y-3">
              <p className="text-xs text-gray-400">
                {reason ?? 'This action requires re-entering your governance password.'}
              </p>
              <p className="text-[10px] text-amber-400/80">
                This confirmation is valid for 60 seconds and cannot be replayed.
              </p>
              <div>
                <label className="block text-[10px] text-gray-500 mb-1 uppercase tracking-wide">
                  Governance password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && password && !submitting) submit()
                    if (e.key === 'Escape') cancel()
                  }}
                  autoFocus
                  disabled={submitting}
                  autoComplete="current-password"
                  className="w-full px-3 py-2 bg-gray-800 border border-gray-700 rounded text-gray-100 text-sm focus:outline-none focus:border-amber-500/60 disabled:opacity-50"
                  placeholder="••••••••"
                />
              </div>
              {error && (
                <div className="flex items-start gap-2 p-2 rounded bg-red-500/10 border border-red-500/30">
                  <AlertCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                  <p className="text-xs text-red-300">{error}</p>
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center gap-2 px-4 py-3 border-t border-gray-800 justify-end">
              <button
                onClick={cancel}
                disabled={submitting}
                className="px-3 py-1.5 text-xs rounded border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={submit}
                disabled={submitting || !password}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded bg-amber-600 hover:bg-amber-500 text-white disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {submitting && <Loader2 className="w-3 h-3 animate-spin" />}
                Confirm
              </button>
            </div>
          </div>
        </div>
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
