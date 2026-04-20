'use client'

/**
 * DiagnosticsSection — Settings → Diagnostics.
 *
 * Phase 0.A-derived (#234, 2026-04-20). Displays the signed-ledger health
 * returned by GET /api/system/ledger-health (route.ts). Polls every 30s
 * plus a manual "Re-check" button. Surfaces a bright red tamper banner
 * if any ledger's hash chain or signature verify fails, and a yellow
 * read-only-mode banner if the server has auto-disabled writes because
 * of a tamper detection.
 *
 * This is the first view into the ledger's per-op coverage now that
 * TRDD-eac02238 step 6 + 7 fan-out has shipped — operators can see
 * entry counts climb in real time as agents mutate state.
 */

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, CheckCircle2, RefreshCw, ShieldAlert } from 'lucide-react'

interface PerLedgerReport {
  label: string
  path: string
  verified: boolean
  entryCount: number
  lastSeq: number
  lastTs: string
  rootHash: string
  reason?: string
}

interface LedgerHealthResponse {
  ok: boolean
  readOnlyMode: boolean
  ledgers: PerLedgerReport[]
  details: string
  checkedAt: string
}

const POLL_INTERVAL_MS = 30_000

export default function DiagnosticsSection() {
  const [report, setReport] = useState<LedgerHealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchHealth = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/system/ledger-health')
      // 503 is a valid "not ok" response with a body we WANT to render.
      // Any other non-OK status is an auth/network failure.
      if (!res.ok && res.status !== 503) {
        const body = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        setError(body.error || `Ledger health probe failed (HTTP ${res.status})`)
        return
      }
      const data = (await res.json()) as LedgerHealthResponse
      setReport(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch ledger health')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchHealth()
    const timer = setInterval(fetchHealth, POLL_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [fetchHealth])

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-gray-100">Ledger Health</h2>
          <p className="text-xs text-gray-500">
            Ed25519 signatures + BLAKE2b-256 hash chain over the 4 core registries.
            Re-verified every 30 seconds.
          </p>
        </div>
        <button
          onClick={fetchHealth}
          disabled={loading}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs rounded-lg border border-gray-700 text-gray-300 hover:bg-gray-800 disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          Re-check
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Tamper banner — top of section, impossible to miss */}
      {report && !report.ok && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-red-600/20 border border-red-500/50 text-sm text-red-200">
          <ShieldAlert className="w-5 h-5 flex-shrink-0 mt-0.5 text-red-400" />
          <div className="space-y-1">
            <p className="font-semibold">Ledger tamper detected.</p>
            <p className="text-xs text-red-300/90">
              One or more registries has a broken hash chain or an invalid Ed25519
              signature. Details below. Do NOT continue mutating state —
              investigate which registry is affected and restore from a backup.
            </p>
          </div>
        </div>
      )}

      {/* Read-only-mode banner */}
      {report?.readOnlyMode && (
        <div className="flex items-start gap-2 p-3 rounded-lg bg-amber-500/10 border border-amber-500/30 text-sm text-amber-200">
          <AlertTriangle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>
            Server is in <strong>read-only mode</strong> due to ledger tampering.
            Write-path APIs will refuse mutations until the server is restarted
            with a verified ledger.
          </span>
        </div>
      )}

      {/* Per-ledger table */}
      {report && (
        <div className="border border-gray-800 rounded-lg overflow-hidden">
          <table className="w-full text-xs">
            <thead className="bg-gray-800/50 text-gray-400">
              <tr>
                <th className="text-left px-3 py-2">Ledger</th>
                <th className="text-right px-3 py-2">Entries</th>
                <th className="text-right px-3 py-2">Last seq</th>
                <th className="text-left px-3 py-2">Last timestamp</th>
                <th className="text-center px-3 py-2">Status</th>
              </tr>
            </thead>
            <tbody>
              {report.ledgers.map((l) => (
                <tr key={l.label} className="border-t border-gray-800">
                  <td className="px-3 py-2 font-mono text-gray-200">{l.label}</td>
                  <td className="px-3 py-2 text-right text-gray-300">{l.entryCount}</td>
                  <td className="px-3 py-2 text-right text-gray-300">
                    {l.lastSeq >= 0 ? l.lastSeq : '—'}
                  </td>
                  <td className="px-3 py-2 text-gray-500">
                    {l.lastTs || '—'}
                  </td>
                  <td className="px-3 py-2 text-center">
                    {l.verified ? (
                      <span
                        className="inline-flex items-center gap-1 text-emerald-400"
                        title={l.reason ?? 'Hash chain + signatures verified'}
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        {l.reason?.startsWith('unavailable') ? 'Empty' : 'OK'}
                      </span>
                    ) : (
                      <span
                        className="inline-flex items-center gap-1 text-red-400"
                        title={l.reason ?? 'Tamper'}
                      >
                        <ShieldAlert className="w-3.5 h-3.5" />
                        Tamper
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {report && (
        <p className="text-[10px] text-gray-600 text-right">
          Last checked: {new Date(report.checkedAt).toLocaleString()}
        </p>
      )}
    </div>
  )
}
