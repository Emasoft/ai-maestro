'use client'

import { useState, useEffect, useCallback } from 'react'
import { Archive, RotateCcw, Trash2, RefreshCw, Download } from 'lucide-react'
import { sudoFetch } from '@/lib/sudo-fetch'
import { useSudo } from '@/contexts/SudoContext'

interface CemeteryEntry {
  filename: string
  agentName: string
  archivedAt: string
  sizeBytes: number
  sizeHuman: string
}

export default function CemeterySection() {
  const { requestSudoToken } = useSudo()
  const [archives, setArchives] = useState<CemeteryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)
  const [confirmAction, setConfirmAction] = useState<{ type: 'revive' | 'purge'; filename: string; agentName: string } | null>(null)
  const [statusMessage, setStatusMessage] = useState<{ text: string; type: 'success' | 'error' } | null>(null)

  const fetchArchives = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const res = await fetch('/api/agents/cemetery')
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        setError(data.error || `Failed to load archives (${res.status})`)
        return
      }
      const data = await res.json()
      setArchives(data.archives || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load cemetery')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchArchives() }, [fetchArchives])

  // Auto-clear status messages after 4s
  useEffect(() => {
    if (!statusMessage) return
    const timer = setTimeout(() => setStatusMessage(null), 4000)
    return () => clearTimeout(timer)
  }, [statusMessage])

  const handleRevive = async (filename: string, agentName: string) => {
    setActionInProgress(filename)
    setStatusMessage(null)
    try {
      const res = await fetch('/api/agents/cemetery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      })
      const data = await res.json()
      if (!res.ok) {
        setStatusMessage({ text: `Failed to revive: ${data.error || 'Unknown error'}`, type: 'error' })
        return
      }
      setStatusMessage({ text: `Agent "${agentName}" has been revived!`, type: 'success' })
      fetchArchives()
    } catch (err) {
      setStatusMessage({ text: `Revive failed: ${err instanceof Error ? err.message : 'Unknown error'}`, type: 'error' })
    } finally {
      setActionInProgress(null)
    }
  }

  const handlePurge = async (filename: string, agentName: string) => {
    setActionInProgress(filename)
    setStatusMessage(null)
    try {
      const res = await sudoFetch(
        '/api/agents/cemetery',
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ filename }),
        },
        (reason) => requestSudoToken(reason),
      )
      const data = await res.json()
      if (!res.ok) {
        setStatusMessage({ text: `Failed to purge: ${data.error || 'Unknown error'}`, type: 'error' })
        return
      }
      setStatusMessage({ text: `Archive of "${agentName}" permanently deleted.`, type: 'success' })
      fetchArchives()
    } catch (err) {
      setStatusMessage({ text: `Purge failed: ${err instanceof Error ? err.message : 'Unknown error'}`, type: 'error' })
    } finally {
      setActionInProgress(null)
    }
  }

  const handleConfirmAction = () => {
    if (!confirmAction) return
    if (confirmAction.type === 'revive') {
      handleRevive(confirmAction.filename, confirmAction.agentName)
    } else {
      handlePurge(confirmAction.filename, confirmAction.agentName)
    }
    setConfirmAction(null)
  }

  const handleDownload = (filename: string) => {
    window.open(`/api/agents/cemetery/download?file=${encodeURIComponent(filename)}`, '_blank')
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-xl font-bold text-white flex items-center gap-2">
            <Archive className="w-5 h-5 text-gray-400" />
            Agent Cemetery
          </h2>
          <p className="text-sm text-gray-400 mt-1">
            Soft-deleted agents are archived here. You can revive them, transfer them to another host, or permanently purge them.
          </p>
        </div>
        <button
          onClick={fetchArchives}
          className="p-2 text-gray-400 hover:text-white hover:bg-gray-800 rounded-lg transition-colors"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Status message (replaces alert()) */}
      {statusMessage && (
        <div className={`rounded-lg p-3 text-sm mb-4 ${statusMessage.type === 'success' ? 'bg-green-900/20 border border-green-800 text-green-400' : 'bg-red-900/20 border border-red-800 text-red-400'}`}>
          {statusMessage.text}
        </div>
      )}

      {/* Confirmation modal (replaces confirm()) */}
      {confirmAction && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-md w-full mx-4 shadow-2xl">
            <h3 className="text-lg font-semibold text-white mb-2">
              {confirmAction.type === 'revive' ? 'Revive Agent' : 'Purge Archive'}
            </h3>
            <p className="text-sm text-gray-300 mb-6">
              {confirmAction.type === 'revive'
                ? `Revive agent "${confirmAction.agentName}" from the cemetery? A new agent will be created from the archive.`
                : `Permanently delete the archive of "${confirmAction.agentName}"? This cannot be undone.`}
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmAction(null)}
                className="px-4 py-2 bg-gray-800 text-gray-300 hover:bg-gray-700 rounded-lg text-sm font-medium transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleConfirmAction}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  confirmAction.type === 'revive'
                    ? 'bg-green-600 text-white hover:bg-green-500'
                    : 'bg-red-600 text-white hover:bg-red-500'
                }`}
              >
                {confirmAction.type === 'revive' ? 'Revive' : 'Purge Forever'}
              </button>
            </div>
          </div>
        </div>
      )}

      {loading && (
        <div className="text-gray-500 text-sm py-8 text-center">Loading archives...</div>
      )}

      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-4 text-red-400 text-sm mb-4">
          {error}
        </div>
      )}

      {!loading && !error && archives.length === 0 && (
        <div className="border border-dashed border-gray-700 rounded-lg p-8 text-center">
          <Archive className="w-8 h-8 text-gray-600 mx-auto mb-3" />
          <p className="text-gray-400 text-sm">No archived agents</p>
          <p className="text-gray-600 text-xs mt-1">Soft-deleted agents will appear here</p>
        </div>
      )}

      {archives.length > 0 && (
        <div className="space-y-3">
          {archives.map(archive => (
            <div
              key={archive.filename}
              className="bg-gray-900 border border-gray-800 rounded-lg p-4 flex items-center justify-between gap-4"
            >
              <div className="min-w-0 flex-1">
                <div className="font-medium text-white truncate">{archive.agentName}</div>
                <div className="text-xs text-gray-500 mt-1">
                  Archived: {new Date(archive.archivedAt).toLocaleString()} &middot; {archive.sizeHuman}
                </div>
              </div>

              <div className="flex items-center gap-2 flex-shrink-0">
                <button
                  onClick={() => handleDownload(archive.filename)}
                  className="p-2 text-gray-400 hover:text-blue-400 hover:bg-gray-800 rounded-lg transition-colors"
                  title="Download archive (for transfer)"
                >
                  <Download className="w-4 h-4" />
                </button>
                <button
                  onClick={() => setConfirmAction({ type: 'revive', filename: archive.filename, agentName: archive.agentName })}
                  disabled={actionInProgress === archive.filename}
                  className="px-3 py-1.5 bg-green-900/30 text-green-400 hover:bg-green-900/50 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  title="Revive agent"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Revive
                </button>
                <button
                  onClick={() => setConfirmAction({ type: 'purge', filename: archive.filename, agentName: archive.agentName })}
                  disabled={actionInProgress === archive.filename}
                  className="px-3 py-1.5 bg-red-900/30 text-red-400 hover:bg-red-900/50 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  title="Permanently delete archive"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Purge
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
