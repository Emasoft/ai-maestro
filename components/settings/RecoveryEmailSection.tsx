'use client'

import { useState, useEffect } from 'react'
import { Mail, Loader2, AlertCircle, CheckCircle, Trash2, ShieldCheck } from 'lucide-react'
import { sudoFetch } from '@/lib/sudo-fetch'
import { useSudo } from '@/contexts/SudoContext'

/**
 * RecoveryEmailSection (TRDD-P7XKV3N9) — the config surface for the EMAIL
 * password-reset channel. Without a verified recovery email the "Forgot your
 * password? → email" method in PasswordDialog has nothing to send a code to, so
 * this panel is what makes remote reset testable end-to-end.
 *
 * It drives the four owner-gated routes under /api/governance/email:
 *   GET    /                 → current status (configured / verified / provider)
 *   POST   /autodetect       → preview SMTP host/port + app-password guidance
 *   POST   /configure        → store email + app-password once, email a code
 *   POST   /verify           → confirm the emailed 6-digit code (proves reachable)
 *   DELETE /                 → remove the email + its stored app-password
 *
 * The mutating calls go through sudoFetch: they are owner-gated today but
 * flagged to become `strict` (configure/DELETE establish a remote-reset
 * channel), so routing them through sudoFetch means the sudo prompt already
 * works the day they are reclassified — on a non-strict route the first attempt
 * simply succeeds and no prompt appears.
 */

interface EmailStatus {
  configured: boolean
  email?: string
  verified?: boolean
  provider?: { host: string; port: number; secure: boolean } | null
}

interface DetectPreview {
  host: string
  port: number
  secure: boolean
  label?: string
  known?: boolean
  appPasswordUrl?: string | null
  note?: string | null
}

export default function RecoveryEmailSection() {
  const { requestSudoToken } = useSudo()

  const [status, setStatus] = useState<EmailStatus | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  // Add / configure form
  const [email, setEmail] = useState('')
  const [appPassword, setAppPassword] = useState('')
  const [preview, setPreview] = useState<DetectPreview | null>(null)
  const [detecting, setDetecting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [instructions, setInstructions] = useState<string | null>(null)

  // Verify form — shown after a SUCCESS configure until the code is confirmed
  const [awaitingCode, setAwaitingCode] = useState(false)
  const [code, setCode] = useState('')
  const [verifying, setVerifying] = useState(false)

  const [removing, setRemoving] = useState(false)

  useEffect(() => {
    loadStatus()
  }, [])

  const loadStatus = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/governance/email')
      if (res.ok) {
        const data = (await res.json()) as EmailStatus
        setStatus(data)
        if (data.configured && data.email) setEmail(data.email)
        // Configured-but-unverified means the owner must still confirm a code
        // (or Remove and re-add if the earlier code expired).
        setAwaitingCode(!!data.configured && !data.verified)
      }
    } catch (err) {
      console.error('[RecoveryEmailSection] loadStatus error:', err)
    } finally {
      setLoading(false)
    }
  }

  const detectProvider = async () => {
    if (!email.trim()) return
    setDetecting(true)
    setError(null)
    setPreview(null)
    try {
      const res = await fetch('/api/governance/email/autodetect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim() }),
      })
      if (res.ok) {
        setPreview((await res.json()) as DetectPreview)
      } else if (res.status === 404) {
        setError('No SMTP settings could be detected for that email domain — you can still try saving.')
      } else {
        setError('Could not detect provider settings.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Detection failed')
    } finally {
      setDetecting(false)
    }
  }

  const saveEmail = async () => {
    if (!email.trim() || !appPassword) return
    setSaving(true)
    setError(null)
    setNotice(null)
    setInstructions(null)
    try {
      const res = await sudoFetch(
        '/api/governance/email/configure',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email: email.trim(), appPassword }),
        },
        (reason) => requestSudoToken(reason),
      )
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        setError(data?.error ? `Save failed: ${data.error}` : `Save failed (${res.status})`)
        return
      }
      if (data?.status === 'SUCCESS') {
        // The app-password is now in the OS credential store — drop it from memory.
        setAppPassword('')
        setStatus({ configured: true, email: email.trim(), verified: false })
        setAwaitingCode(true)
        if (data.codeSent) {
          setNotice(`Saved. A 6-digit confirmation code was emailed to ${email.trim()} — enter it below.`)
        } else {
          // The password verified + stored, but the confirmation email itself
          // could not be delivered (the endpoint reports codeSent:false). A
          // remote owner would never receive the code, so warn explicitly.
          setNotice('Saved, but the confirmation email could not be sent. Check your SMTP configuration, then Remove and re-add.')
        }
      } else if (data?.status === 'AUTH_REQUIRED') {
        setInstructions(data.instructions || 'The mail server rejected the password. Enable SMTP access / use an app-specific password.')
      } else {
        setError(data?.error === 'no_smtp_detected'
          ? 'No SMTP server was detected for that email domain.'
          : 'The mail server was unreachable. Check the address and try again.')
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
    } finally {
      setSaving(false)
    }
  }

  const submitCode = async () => {
    if (!/^\d{6}$/.test(code)) {
      setError('Enter the 6-digit code from your email.')
      return
    }
    setVerifying(true)
    setError(null)
    try {
      const res = await sudoFetch(
        '/api/governance/email/verify',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ code }),
        },
        (reason) => requestSudoToken(reason),
      )
      const data = await res.json().catch(() => null)
      if (!res.ok) {
        // Server returns code_<reason> (e.g. code_expired, code_mismatch).
        setError(data?.error ? data.error.replace(/^code_/, 'Code ') : `Verification failed (${res.status})`)
        return
      }
      setCode('')
      setAwaitingCode(false)
      setNotice(null)
      setStatus((prev) => (prev ? { ...prev, verified: true } : { configured: true, email: email.trim(), verified: true }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Verification failed')
    } finally {
      setVerifying(false)
    }
  }

  const removeEmail = async () => {
    setRemoving(true)
    setError(null)
    setNotice(null)
    try {
      const res = await sudoFetch(
        '/api/governance/email',
        { method: 'DELETE' },
        (reason) => requestSudoToken(reason),
      )
      if (!res.ok) {
        setError(`Remove failed (${res.status})`)
        return
      }
      setStatus({ configured: false })
      setAwaitingCode(false)
      setEmail('')
      setAppPassword('')
      setPreview(null)
      setInstructions(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Remove failed')
    } finally {
      setRemoving(false)
    }
  }

  return (
    <div className="mt-3 p-3 bg-gray-900/60 border border-gray-700/60 rounded-lg">
      <div className="flex items-center gap-2 mb-3">
        <Mail className="w-3.5 h-3.5 text-gray-400" />
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">Recovery Email</span>
      </div>

      {loading ? (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <Loader2 className="w-3 h-3 animate-spin" /> Loading…
        </div>
      ) : (
        <>
          {error && (
            <div className="flex items-start gap-1.5 mb-2 text-xs text-red-400">
              <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}
          {notice && (
            <div className="flex items-start gap-1.5 mb-2 text-xs text-emerald-300">
              <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>{notice}</span>
            </div>
          )}

          {status?.configured ? (
            <div className="space-y-2">
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="text-xs text-gray-300 font-mono truncate">{status.email}</span>
                  {status.verified ? (
                    <span className="flex items-center gap-1 px-1.5 py-0.5 text-xs bg-emerald-900/50 text-emerald-300 rounded flex-shrink-0">
                      <ShieldCheck className="w-3 h-3" /> Verified
                    </span>
                  ) : (
                    <span className="px-1.5 py-0.5 text-xs bg-amber-900/50 text-amber-300 rounded flex-shrink-0">Unverified</span>
                  )}
                </div>
                <button
                  onClick={removeEmail}
                  disabled={removing}
                  className="flex items-center gap-1 px-2 py-1 text-xs bg-red-900/60 hover:bg-red-800 text-red-200 rounded transition-colors disabled:opacity-50 flex-shrink-0"
                  title="Remove the recovery email and its stored app-password"
                >
                  {removing ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                  Remove
                </button>
              </div>

              {awaitingCode && !status.verified && (
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    inputMode="numeric"
                    value={code}
                    onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                    onKeyDown={(e) => { if (e.key === 'Enter') submitCode() }}
                    placeholder="6-digit code"
                    className="flex-1 px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded text-gray-200 font-mono tracking-widest focus:outline-none focus:border-emerald-500"
                    maxLength={6}
                  />
                  <button
                    onClick={submitCode}
                    disabled={verifying || code.length !== 6}
                    className="flex items-center gap-1 px-3 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded transition-colors disabled:opacity-50"
                  >
                    {verifying ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCircle className="w-3 h-3" />}
                    Verify
                  </button>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-2">
              <p className="text-xs text-gray-500">
                A verified recovery email lets you reset the governance password remotely — a code is emailed to you. Enter your address and a mail app-password (stored in the OS keychain, never in the governance secret).
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="flex-1 px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-emerald-500"
                />
                <button
                  onClick={detectProvider}
                  disabled={detecting || !email.trim()}
                  className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 text-gray-300 rounded transition-colors disabled:opacity-50 flex-shrink-0"
                  title="Preview the SMTP settings for this address"
                >
                  {detecting ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Detect'}
                </button>
              </div>

              {preview && (
                <div className="px-2 py-1.5 text-xs text-gray-400 bg-gray-800/60 rounded space-y-0.5">
                  <div>
                    SMTP:{' '}
                    <span className="font-mono text-gray-300">{preview.host}:{preview.port}</span>
                    {preview.secure ? ' (TLS)' : ''}
                    {preview.label ? ` — ${preview.label}` : ''}
                  </div>
                  {preview.note && <div className="text-gray-500">{preview.note}</div>}
                  {preview.appPasswordUrl && (
                    <a
                      href={preview.appPasswordUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-400 hover:text-blue-300 underline"
                    >
                      Where do I get an app-password?
                    </a>
                  )}
                </div>
              )}

              {instructions && (
                <div className="flex items-start gap-1.5 px-2 py-1.5 text-xs text-amber-300 bg-amber-900/20 rounded">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{instructions}</span>
                </div>
              )}

              <input
                type="password"
                value={appPassword}
                onChange={(e) => setAppPassword(e.target.value)}
                placeholder="Mail app-password"
                autoComplete="off"
                className="w-full px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-emerald-500"
              />
              <button
                onClick={saveEmail}
                disabled={saving || !email.trim() || !appPassword}
                className="flex items-center gap-1 px-3 py-1 text-xs bg-emerald-700 hover:bg-emerald-600 text-white rounded transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Mail className="w-3 h-3" />}
                Save recovery email
              </button>
            </div>
          )}
        </>
      )}
    </div>
  )
}
