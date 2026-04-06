'use client'

import { useState, useEffect, useCallback } from 'react'
import { Archive, RotateCcw, Trash2, RefreshCw, Download } from 'lucide-react'

interface CemeteryEntry {
  filename: string
  agentName: string
  archivedAt: string
  sizeBytes: number
  sizeHuman: string
}

export default function CemeterySection() {
  const [archives, setArchives] = useState<CemeteryEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [actionInProgress, setActionInProgress] = useState<string | null>(null)

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

  const handleRevive = async (filename: string, agentName: string) => {
    if (!confirm(`Revive agent "${agentName}" from the cemetery? A new agent will be created from the archive.`)) return
    setActionInProgress(filename)
    try {
      const res = await fetch('/api/agents/cemetery', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(`Failed to revive: ${data.error || 'Unknown error'}`)
        return
      }
      alert(`Agent "${agentName}" has been revived!`)
      fetchArchives()
    } catch (err) {
      alert(`Revive failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setActionInProgress(null)
    }
  }

  const handlePurge = async (filename: string, agentName: string) => {
    if (!confirm(`Permanently delete the archive of "${agentName}"? This cannot be undone.`)) return
    setActionInProgress(filename)
    try {
      const res = await fetch('/api/agents/cemetery', {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ filename }),
      })
      const data = await res.json()
      if (!res.ok) {
        alert(`Failed to purge: ${data.error || 'Unknown error'}`)
        return
      }
      fetchArchives()
    } catch (err) {
      alert(`Purge failed: ${err instanceof Error ? err.message : 'Unknown error'}`)
    } finally {
      setActionInProgress(null)
    }
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
                  onClick={() => handleRevive(archive.filename, archive.agentName)}
                  disabled={actionInProgress === archive.filename}
                  className="px-3 py-1.5 bg-green-900/30 text-green-400 hover:bg-green-900/50 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 flex items-center gap-1.5"
                  title="Revive agent"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  Revive
                </button>
                <button
                  onClick={() => handlePurge(archive.filename, archive.agentName)}
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
