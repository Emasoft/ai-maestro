'use client'

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle, ExternalLink, KeyRound, Loader2, RefreshCw } from 'lucide-react'
import { sudoFetch } from '@/lib/sudo-fetch'
import { useSudo } from '@/contexts/SudoContext'

/**
 * ClaudeAccountsSection (TRDD-OX5TT5OT) — the Claude accounts this host rotates between, and the
 * re-login that repairs a dead one.
 *
 * WHY IT EXISTS: a slot whose refresh token is dead can only be repaired by a human consenting
 * again, and until this panel the only way to do that was a CLI buried in a plugin cache that an
 * agent had to remember to mention. Per the USER: the server should do these things itself; the
 * owner should never be told to run something by hand.
 *
 * THE FLOW (three routes):
 *   GET  /api/oauth-rotator/status          → the account list (no secrets; readable remotely)
 *   POST /api/oauth-rotator/reauth/start    → PKCE + the claude.ai consent URL   ┐ console-gated:
 *   POST /api/oauth-rotator/reauth/complete → exchange the pasted code, file it  ┘ host only
 *
 * The pasted code goes browser → this field → the server. It is never logged, never echoed back,
 * and single-use at the endpoint anyway.
 */

interface RotatorAccount {
  email: string
  isLive: boolean
  expiresAt: number | null
  expiresInH: number | null
  refreshFailures: number
  refreshDead: boolean
  capturedAt: string | null
  via: string | null
}

/** Which account the owner is mid-flow on, and how far along. */
interface ActiveFlow {
  email: string
  state: string
  authorizeUrl: string
}

/** Server refusal codes mapped to what the owner should actually DO about each. */
const FAILURE_HELP: Record<string, string> = {
  console_required:
    'Logging in to Claude only works from the machine running AI Maestro — not from a remote device. Open the dashboard on the host itself.',
  unknown_state: 'That login attempt is no longer known to the server. Start a new one.',
  expired_state: 'The login attempt timed out (10 minutes). Start a new one.',
  replayed_state: 'That code was already used. Start a new login.',
  state_mismatch:
    'The pasted text belongs to a different login attempt. Paste the whole string from the Claude page, or start again.',
  empty_code: 'No code found in what was pasted. Copy the whole string shown on the Claude page.',
  exchange_failed:
    'Claude refused the code. They expire within minutes — start a new login and paste it promptly.',
  account_unresolved:
    'The token was accepted but Claude would not say which account it belongs to, so nothing was filed. Try again.',
  slot_locked: 'A rotation was in progress, so nothing was written. Try again in a moment.',
}

function runwayLabel(a: RotatorAccount): string {
  if (a.expiresInH === null) return 'no expiry recorded'
  if (a.expiresInH <= 0) return `expired ${Math.abs(Math.round(a.expiresInH))}h ago`
  return `${a.expiresInH.toFixed(1)}h left`
}

export default function ClaudeAccountsSection() {
  const { requestSudoToken } = useSudo()

  const [accounts, setAccounts] = useState<RotatorAccount[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [flow, setFlow] = useState<ActiveFlow | null>(null)
  const [pasted, setPasted] = useState('')
  const [busy, setBusy] = useState<'start' | 'complete' | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const res = await fetch('/api/oauth-rotator/status')
      if (!res.ok) {
        setLoadError(`Could not read account status (HTTP ${res.status}).`)
        return
      }
      const data = (await res.json()) as { accounts?: RotatorAccount[] }
      setAccounts(data.accounts ?? [])
      setLoadError(null)
    } catch {
      setLoadError('Could not reach the server for account status.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  /** Read the server's refusal into something the owner can act on. */
  const explain = async (res: Response): Promise<string> => {
    let code = ''
    try {
      code = ((await res.json()) as { error?: string }).error ?? ''
    } catch {
      /* no body — fall through to the generic form */
    }
    return FAILURE_HELP[code] ?? `The server refused the request (${code || `HTTP ${res.status}`}).`
  }

  const startFlow = async (email: string) => {
    setError(null)
    setNotice(null)
    setBusy('start')
    // Open the tab NOW, inside the click, and navigate it once the URL arrives. Opening it after
    // the await would be a popup the browser blocks, which reads to the owner as a broken button.
    const popup = window.open('about:blank', '_blank', 'noopener,noreferrer,width=980,height=820')
    try {
      const res = await sudoFetch(
        '/api/oauth-rotator/reauth/start',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email }),
        },
        (reason) => requestSudoToken(reason),
      )
      if (!res.ok) {
        popup?.close()
        setError(await explain(res))
        return
      }
      const data = (await res.json()) as { authorizeUrl: string; state: string }
      setFlow({ email, state: data.state, authorizeUrl: data.authorizeUrl })
      setPasted('')
      if (popup) popup.location.href = data.authorizeUrl
      // If the popup WAS blocked the link below is the way through — say so rather than leaving
      // the owner staring at a form with no page to copy from.
      else setNotice('Your browser blocked the popup — use the "Open the Claude login page" link.')
    } catch {
      popup?.close()
      setError('Could not start the login.')
    } finally {
      setBusy(null)
    }
  }

  const completeFlow = async () => {
    if (!flow || !pasted.trim()) return
    setError(null)
    setNotice(null)
    setBusy('complete')
    try {
      const res = await sudoFetch(
        '/api/oauth-rotator/reauth/complete',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ state: flow.state, code: pasted.trim() }),
        },
        (reason) => requestSudoToken(reason),
      )
      if (!res.ok) {
        setError(await explain(res))
        return
      }
      const data = (await res.json()) as { email: string; hasRefreshToken: boolean; expiresInH: number | null }
      setFlow(null)
      setPasted('')
      // An honest success line: a grant with no refresh token files fine and then dies in hours,
      // so reporting it as a plain success would claim a repair that did not hold.
      setNotice(
        data.hasRefreshToken
          ? `Signed in as ${data.email}. The rotator will pick it up on its next beat.`
          : `Signed in as ${data.email}, but Claude returned no refresh token — this slot cannot be kept alive and will expire again. Try the login once more.`,
      )
      void load()
    } catch {
      setError('Could not complete the login.')
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="mt-3 p-3 bg-gray-900/60 border border-gray-700/60 rounded-lg">
      <div className="flex items-center justify-between gap-2 mb-2">
        <div className="flex items-center gap-2">
          <KeyRound className="w-3.5 h-3.5 text-gray-400" />
          <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">
            Claude Accounts
          </span>
        </div>
        <button
          onClick={() => void load()}
          className="p-1 text-gray-400 hover:text-gray-200"
          title="Refresh account status"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>
      </div>

      {loadError && <p className="text-xs text-amber-400 mb-2">{loadError}</p>}
      {accounts !== null && accounts.length === 0 && (
        <p className="text-xs text-gray-500">No Claude accounts are registered with the rotator.</p>
      )}

      {accounts && accounts.length > 0 && (
        <ul className="space-y-1.5">
          {accounts.map((a) => (
            <li
              key={a.email}
              className="flex items-center justify-between gap-2 px-2 py-1.5 bg-gray-800/60 rounded"
            >
              <div className="flex items-center gap-2 min-w-0">
                {a.refreshDead ? (
                  <AlertTriangle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
                ) : (
                  <CheckCircle className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0" />
                )}
                <span className="text-xs text-gray-300 truncate">{a.email}</span>
                {a.isLive && (
                  <span className="text-[10px] uppercase tracking-wide text-blue-300 flex-shrink-0">
                    live
                  </span>
                )}
                <span className="text-xs text-gray-600 flex-shrink-0">{runwayLabel(a)}</span>
              </div>
              <button
                onClick={() => void startFlow(a.email)}
                disabled={busy !== null || flow !== null}
                className={`text-xs px-2 py-0.5 rounded disabled:opacity-50 flex-shrink-0 ${
                  a.refreshDead
                    ? 'bg-red-500/20 text-red-300 hover:bg-red-500/30'
                    : 'text-gray-400 hover:text-gray-200'
                }`}
                title={
                  a.refreshDead
                    ? 'This account can only be repaired by signing in again'
                    : 'Sign in again to replace this account token'
                }
              >
                {busy === 'start' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : 'Re-login'}
              </button>
            </li>
          ))}
        </ul>
      )}

      {flow && (
        <div className="mt-3 p-2 bg-gray-800/60 border border-gray-700/60 rounded space-y-2">
          <p className="text-xs text-gray-400">
            Signing in as <span className="text-gray-200">{flow.email}</span>. Authorize on the
            Claude page, then paste the code it shows you here.
          </p>
          <a
            href={flow.authorizeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-xs text-blue-300 hover:text-blue-200"
          >
            <ExternalLink className="w-3 h-3" />
            Open the Claude login page
          </a>
          <input
            type="text"
            value={pasted}
            onChange={(e) => setPasted(e.target.value)}
            placeholder="Paste the code shown by Claude"
            spellCheck={false}
            autoComplete="off"
            className="w-full text-xs bg-gray-900 border border-gray-700 rounded px-2 py-1.5 text-gray-200 font-mono"
          />
          <div className="flex items-center gap-2">
            <button
              onClick={() => void completeFlow()}
              disabled={busy !== null || !pasted.trim()}
              className="text-xs px-2 py-1 rounded bg-blue-500/20 text-blue-300 hover:bg-blue-500/30 disabled:opacity-50"
            >
              {busy === 'complete' ? 'Finishing…' : 'Finish sign-in'}
            </button>
            <button
              onClick={() => {
                setFlow(null)
                setPasted('')
                setError(null)
              }}
              className="text-xs px-2 py-1 rounded text-gray-400 hover:text-gray-200"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && <p className="text-xs text-red-400 mt-2">{error}</p>}
      {notice && <p className="text-xs text-emerald-400 mt-2">{notice}</p>}
    </div>
  )
}
