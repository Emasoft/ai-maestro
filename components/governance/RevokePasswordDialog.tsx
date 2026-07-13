'use client'

/**
 * Revoke the governance password (TRDD-P7XKV3N9).
 *
 * This component carries NO POLICY. It collects the password, POSTs it, and
 * renders whatever the server says — including the refusals. Every gate lives in
 * the endpoint, because every route is curl-able: a check placed in a client can
 * be skipped with one curl, so it is not a weak check, it is no check.
 *
 * Notably absent, on purpose:
 *  - no "are you at the console?" check here (the server decides, from the socket)
 *  - no password pre-validation to render a nicer error (that would require this
 *    code to HOLD the secret, and code that holds the secret can leak it)
 *  - the confirmation code is never in a response body; it arrives on the desktop
 */
import { useState } from 'react'
import { X, ShieldAlert } from 'lucide-react'

interface Props {
  onClose: () => void
  onRevoked: () => void
}

type Step = 'password' | 'code'

export default function RevokePasswordDialog({ onClose, onRevoked }: Props) {
  const [step, setStep] = useState<Step>('password')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  /** Turn the server's error codes into something a human can act on. */
  const explain = (err: string, message?: string): string => {
    switch (err) {
      case 'console_required':
        return message ?? 'This can only be done from the machine running AI Maestro.'
      case 'presence_channel_unavailable':
        return 'AI Maestro could not put a confirmation code on this machine’s desktop, so it cannot confirm you are here. Revocation refused.'
      case 'invalid_password':
        return 'That is not the current password.'
      case 'too_many_attempts':
        return 'Too many attempts. Wait a while and try again.'
      case 'code_mismatch':
        return 'That code is not correct.'
      case 'code_expired':
        return 'That code expired. Start again.'
      case 'code_rate_limited':
        return 'Too many wrong codes. Start again.'
      case 'no_password_set':
        return 'There is no password to revoke.'
      default:
        return message ?? err
    }
  }

  const post = async (body: Record<string, string>) => {
    const res = await fetch('/api/governance/password/invalidate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    return { ok: res.ok, data: await res.json().catch(() => ({})) }
  }

  const submitPassword = async () => {
    setBusy(true)
    setError(null)
    const { ok, data } = await post({ password })
    setBusy(false)
    if (!ok) {
      setError(explain(data.error ?? 'unknown', data.message))
      return
    }
    if (data.codeRequired) setStep('code')
  }

  const submitCode = async () => {
    setBusy(true)
    setError(null)
    const { ok, data } = await post({ password, code })
    setBusy(false)
    if (!ok) {
      setError(explain(data.error ?? 'unknown', data.message))
      return
    }
    if (data.invalidated) onRevoked()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70">
      <div className="w-full max-w-md rounded-lg border border-red-900/60 bg-gray-900 p-5 shadow-xl">
        <div className="mb-3 flex items-start justify-between">
          <div className="flex items-center gap-2">
            <ShieldAlert className="h-5 w-5 text-red-400" />
            <h2 className="text-sm font-semibold text-gray-100">Revoke governance password</h2>
          </div>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300" aria-label="Close">
            <X className="h-4 w-4" />
          </button>
        </div>

        {step === 'password' ? (
          <>
            <p className="mb-3 text-xs leading-relaxed text-gray-400">
              The current password will be <strong className="text-gray-200">destroyed</strong>, not replaced.
              The next login will ask you to create a new one. Use this if the password may have leaked.
            </p>
            <input
              type="password"
              autoFocus
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && password && !busy && submitPassword()}
              placeholder="Current governance password"
              className="mb-3 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm text-gray-100 outline-none focus:border-red-600"
            />
          </>
        ) : (
          <>
            <p className="mb-3 text-xs leading-relaxed text-gray-400">
              A confirmation code was delivered to <strong className="text-gray-200">this machine’s desktop</strong>.
              If you are not sitting at it, you will not see the code — that is deliberate.
            </p>
            <input
              type="text"
              autoFocus
              inputMode="numeric"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && code && !busy && submitCode()}
              placeholder="Confirmation code"
              className="mb-3 w-full rounded border border-gray-700 bg-gray-800 px-3 py-2 text-sm tracking-widest text-gray-100 outline-none focus:border-red-600"
            />
          </>
        )}

        {error && (
          <div className="mb-3 rounded border border-red-900/60 bg-red-950/40 px-3 py-2 text-xs text-red-300">
            {error}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button
            onClick={onClose}
            className="rounded bg-gray-700 px-3 py-1.5 text-xs text-gray-200 transition-colors hover:bg-gray-600"
          >
            Cancel
          </button>
          <button
            onClick={step === 'password' ? submitPassword : submitCode}
            disabled={busy || (step === 'password' ? !password : !code)}
            className="rounded bg-red-800 px-3 py-1.5 text-xs text-white transition-colors hover:bg-red-700 disabled:opacity-40"
          >
            {busy ? 'Working…' : step === 'password' ? 'Continue' : 'Revoke password'}
          </button>
        </div>
      </div>
    </div>
  )
}
