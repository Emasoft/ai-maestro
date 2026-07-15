'use client'

/**
 * PasswordDialog — the ONE governance-password/auth dialog every surface invokes
 * (TRDD-P7XKV3N9). It replaces the five hand-rolled copies (LoginGate, SudoContext,
 * GovernancePasswordDialog, RevokePasswordDialog, TeamListView) — "we cannot debug
 * five versions of the same code". This component owns, in ONE place:
 *   - the password input (+ confirm on `setup`), submit-per-purpose, error rendering;
 *   - the built-in "Forgot your password?" → multi-channel RESET state machine
 *     (request a code → enter code + a new password with a 5-min countdown → success),
 *     which needs NO old password (console presence or a verified recovery email is
 *     the factor — see app/api/governance/password/reset/route.ts).
 *
 * POLICY LIVES IN THE ROUTES, not here. Every gate (console-locality, code check,
 * rate-limit, sudo) is server-side because every route is curl-able: a check in a
 * client is skippable with one curl, so it is no check. This component only collects
 * input, POSTs, and renders whatever the server says — including the refusals.
 *
 * Phase B (this file) wires the `login` purpose natively + the full reset flow so the
 * login screen is testable now. `sudo`/`confirm`/`setup` accept a caller `onSubmit`
 * (Phase C/D refactors SudoContext + GovernancePasswordDialog + TeamListView onto it).
 */
import { useState, useEffect, type ReactNode } from 'react'
import { Lock, X, KeyRound, Monitor, Mail } from 'lucide-react'

export type PasswordPurpose = 'login' | 'sudo' | 'confirm' | 'setup'
export type ResetMethod = 'console' | 'email'
export interface PasswordDialogResult {
  token?: string
}

interface PasswordDialogProps {
  purpose: PasswordPurpose
  variant?: 'modal' | 'fullscreen'
  title?: string
  description?: string
  onSuccess: (result?: PasswordDialogResult) => void
  onCancel?: () => void
  /** Extra controls rendered above the buttons (e.g. TeamListView's cascade checkbox). */
  extraFields?: ReactNode
  /**
   * Purpose-specific submit for `sudo`/`confirm`/`setup`. When omitted, `login` posts
   * to /api/auth/login natively. Returning `{ ok:false, error }` shows the error.
   */
  onSubmit?: (password: string, confirmPassword?: string) => Promise<{ ok: boolean; error?: string; result?: PasswordDialogResult }>
  /** Show the "Forgot your password?" reset link. Default: true for login/sudo/confirm. */
  allowReset?: boolean
}

/** Server error code → a sentence a human can act on. Unknown codes fall through verbatim. */
function explain(err: string, message?: string): string {
  switch (err) {
    case 'console_required':
      return 'The password can only be reset from the machine running AI Maestro. On a remote device, use your recovery email instead.'
    case 'email_not_configured':
      return 'No verified recovery email is configured. Set one up in Settings from the host machine, or reset from the host itself.'
    case 'email_delivery_failed':
      return 'The recovery email could not be sent — check the SMTP configuration in Settings.'
    case 'delivery_channel_unavailable':
      return 'Could not deliver a confirmation code, so control of the recovery channel cannot be proven.'
    case 'too_many_attempts':
      return 'Too many attempts. Wait a while and try again.'
    case 'code_mismatch':
      return 'That code is not correct.'
    case 'code_expired':
      return 'That code has expired. Start the reset again.'
    case 'not_implemented':
      return message ?? 'That recovery method is not available yet.'
    case 'invalid_request':
    case 'invalid_body':
      return 'Something was off with the request. Start again.'
    default:
      return message ?? err
  }
}

/** mm:ss remaining until `expiresAt` (epoch ms), or null when unset/elapsed. */
function useCountdown(expiresAt: number | null): string | null {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!expiresAt) return
    const id = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(id)
  }, [expiresAt])
  if (!expiresAt) return null
  const ms = Math.max(0, expiresAt - now)
  const total = Math.floor(ms / 1000)
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

type View =
  | { kind: 'password' }
  | { kind: 'reset-method' }
  | { kind: 'reset-code'; method: ResetMethod; channel: string; hint: string; expiresAt: number | null }

export default function PasswordDialog({
  purpose,
  variant = 'modal',
  title,
  description,
  onSuccess,
  onCancel,
  extraFields,
  onSubmit,
  allowReset = purpose !== 'setup',
}: PasswordDialogProps) {
  const [view, setView] = useState<View>({ kind: 'password' })
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [code, setCode] = useState('')
  const [newPassword, setNewPassword] = useState('')
  const [newConfirm, setNewConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const countdown = useCountdown(view.kind === 'reset-code' ? view.expiresAt : null)

  const heading = title ?? (purpose === 'login' ? 'AI Maestro' : purpose === 'setup' ? 'Set a governance password' : 'Confirm your password')
  const subtitle = description ?? (purpose === 'login' ? 'Enter governance password to continue' : undefined)

  // ── Primary submit (login native; other purposes delegate to onSubmit) ──
  const submitPassword = async () => {
    setBusy(true)
    setError(null)
    try {
      if (purpose === 'setup' && password !== confirmPassword) {
        setError('The two passwords do not match.')
        return
      }
      if (onSubmit) {
        const r = await onSubmit(password, purpose === 'setup' ? confirmPassword : undefined)
        if (!r.ok) { setError(explain(r.error ?? 'unknown')); return }
        onSuccess(r.result)
        return
      }
      // Native login path.
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password }),
      })
      if (res.ok) { setPassword(''); onSuccess(); return }
      const data = await res.json().catch(() => ({}))
      setError(explain(data.error ?? 'Login failed', data.message))
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setBusy(false)
    }
  }

  // ── Reset call-1: request a code over the chosen channel ──
  const requestCode = async (method: ResetMethod) => {
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      const res = await fetch('/api/governance/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(explain(data.error ?? 'unknown', data.message)); return }
      setView({
        kind: 'reset-code',
        method,
        channel: data.channel ?? 'file',
        hint: data.hint ?? '',
        expiresAt: typeof data.expiresAt === 'number' ? data.expiresAt : null,
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setBusy(false)
    }
  }

  // ── Reset call-2: code + new password → reset (route auto-logins via cookie) ──
  const submitReset = async () => {
    if (view.kind !== 'reset-code') return
    setBusy(true)
    setError(null)
    try {
      if (newPassword !== newConfirm) { setError('The two passwords do not match.'); return }
      const res = await fetch('/api/governance/password/reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method: view.method, code, newPassword }),
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) { setError(explain(data.error ?? 'unknown', data.message)); return }
      if (data.reset) {
        // The route set a fresh session cookie — the caller is now authenticated.
        onSuccess()
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Connection failed')
    } finally {
      setBusy(false)
    }
  }

  const canSubmitPassword = purpose === 'setup' ? !!password && !!confirmPassword : !!password
  const canSubmitReset = /^\d{6}$/.test(code) && newPassword.length >= 8 && !!newConfirm

  const body = (
    <>
      {view.kind === 'password' && (
        <>
          {subtitle && <p className="mb-6 text-center text-sm text-gray-500">{subtitle}</p>}
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canSubmitPassword && !busy && submitPassword()}
            placeholder={purpose === 'setup' ? 'New governance password' : 'Governance password'}
            autoFocus
            disabled={busy}
            className="mb-3 w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-white placeholder-gray-500 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
          />
          {purpose === 'setup' && (
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && canSubmitPassword && !busy && submitPassword()}
              placeholder="Confirm password"
              disabled={busy}
              className="mb-3 w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-white placeholder-gray-500 outline-none transition-colors focus:border-blue-500 focus:ring-1 focus:ring-blue-500"
            />
          )}
        </>
      )}

      {view.kind === 'reset-method' && (
        <>
          <p className="mb-4 text-sm text-gray-400">
            Reset without your old password. A one-time code proves you control a recovery channel.
          </p>
          <button
            onClick={() => requestCode('console')}
            disabled={busy}
            className="mb-2 flex w-full items-center gap-3 rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-left transition-colors hover:border-blue-500 disabled:opacity-40"
          >
            <Monitor className="h-5 w-5 shrink-0 text-blue-400" />
            <span>
              <span className="block text-sm font-medium text-white">This machine (console)</span>
              <span className="block text-xs text-gray-500">Code delivered to the host running AI Maestro.</span>
            </span>
          </button>
          <button
            onClick={() => requestCode('email')}
            disabled={busy}
            className="flex w-full items-center gap-3 rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-left transition-colors hover:border-blue-500 disabled:opacity-40"
          >
            <Mail className="h-5 w-5 shrink-0 text-blue-400" />
            <span>
              <span className="block text-sm font-medium text-white">Recovery email</span>
              <span className="block text-xs text-gray-500">For remote devices — requires a verified email (set in Settings).</span>
            </span>
          </button>
        </>
      )}

      {view.kind === 'reset-code' && (
        <>
          <p className="mb-3 text-xs leading-relaxed text-gray-400">
            {view.method === 'console'
              ? <>A confirmation code was delivered to <strong className="text-gray-200">this machine</strong>. {view.hint && <span className="text-gray-500">({view.hint})</span>}</>
              : <>A confirmation code was emailed to your <strong className="text-gray-200">recovery address</strong>. {view.hint && <span className="text-gray-500">({view.hint})</span>}</>}
            {countdown && <> Expires in <strong className="text-gray-200">{countdown}</strong>.</>}
          </p>
          <input
            type="text"
            inputMode="numeric"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit code"
            autoFocus
            disabled={busy}
            className="mb-3 w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 tracking-[0.4em] text-white placeholder-gray-500 outline-none focus:border-blue-500"
          />
          <input
            type="password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
            placeholder="New governance password (min 8)"
            disabled={busy}
            className="mb-3 w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-blue-500"
          />
          <input
            type="password"
            value={newConfirm}
            onChange={(e) => setNewConfirm(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && canSubmitReset && !busy && submitReset()}
            placeholder="Confirm new password"
            disabled={busy}
            className="mb-3 w-full rounded-lg border border-gray-700 bg-gray-800 px-4 py-3 text-white placeholder-gray-500 outline-none focus:border-blue-500"
          />
        </>
      )}

      {extraFields}

      {error && <div className="mb-3 rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-center text-sm text-red-300">{error}</div>}
      {notice && <div className="mb-3 rounded border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-center text-xs text-amber-300">{notice}</div>}

      {/* Action buttons per view */}
      {view.kind === 'password' && (
        <button
          onClick={submitPassword}
          disabled={busy || !canSubmitPassword}
          className="w-full rounded-lg bg-blue-600 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500"
        >
          {busy ? 'Working…' : purpose === 'login' ? 'Sign In' : purpose === 'setup' ? 'Set password' : 'Confirm'}
        </button>
      )}
      {view.kind === 'reset-code' && (
        <button
          onClick={submitReset}
          disabled={busy || !canSubmitReset}
          className="w-full rounded-lg bg-blue-600 py-3 font-medium text-white transition-colors hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500"
        >
          {busy ? 'Resetting…' : 'Set new password'}
        </button>
      )}

      {/* Footer navigation */}
      {view.kind === 'password' && allowReset && (
        <button
          onClick={() => { setError(null); setView({ kind: 'reset-method' }) }}
          className="mt-4 block w-full text-center text-xs text-gray-500 transition-colors hover:text-gray-300"
        >
          Did you forget your password?
        </button>
      )}
      {(view.kind === 'reset-method' || view.kind === 'reset-code') && (
        <button
          onClick={() => { setError(null); setCode(''); setNewPassword(''); setNewConfirm(''); setView({ kind: 'password' }) }}
          className="mt-4 block w-full text-center text-xs text-gray-500 transition-colors hover:text-gray-300"
        >
          ← Back to sign in
        </button>
      )}
    </>
  )

  const card = (
    <div className="w-full max-w-sm">
      <div className="rounded-xl border border-gray-800 bg-gray-900 p-8 shadow-2xl">
        <div className="mb-6 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="rounded-full bg-gray-800 p-2">
              {view.kind === 'password' ? <Lock className="h-5 w-5 text-gray-400" /> : <KeyRound className="h-5 w-5 text-blue-400" />}
            </div>
            <h1 className="text-lg font-bold text-white">{view.kind === 'password' ? heading : 'Reset password'}</h1>
          </div>
          {onCancel && (
            <button onClick={onCancel} className="text-gray-500 hover:text-gray-300" aria-label="Close">
              <X className="h-4 w-4" />
            </button>
          )}
        </div>
        {body}
      </div>
    </div>
  )

  if (variant === 'fullscreen') {
    return <div className="flex h-screen items-center justify-center bg-gray-950">{card}</div>
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">{card}</div>
}
