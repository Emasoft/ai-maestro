'use client'

// The JANITOR REPORT section — the janitor's own global-status document, preserved and displayed
// VERBATIM (TRDD-TCKNOA72).
//
// WHY THE DOCUMENT IS SHOWN AS-IS RATHER THAN RE-RENDERED. It is an AUDIT TRAIL, to be consulted
// when something has gone wrong, so it must be the artifact the janitor actually produced — not a
// table we drew from the same data. It is also the only honest option: the document is a
// whole-HOST view (every running claude instance, found by process scan) and this server can only
// see its own registry, so anything we re-derived would be missing rows we cannot enumerate.
//
// WHY AN IFRAME IS THE ONLY WAY TO DO THAT. The document is a complete standalone page —
// `<!doctype html>`, its own `<head>`, a hard-coded dark theme (`background:#0d1117`, with no
// `prefers-color-scheme`), its own `<style>` and `<script>`, and inline `onclick` handlers on its
// kanban buttons. Injected into this page it would fight the settings theme and leak global
// styles; `dangerouslySetInnerHTML` is additionally banned outright in this codebase.
//
// SANDBOX, AND WHY `allow-same-origin` IS ABSENT. `HtmlSidePanel.tsx` states the rule this follows:
// grant `allow-scripts` so the document's own KB modal works, and withhold `allow-same-origin` so
// its scripts get an opaque origin. That matters MORE here than for a cross-origin URL, because
// this document is served from our OWN origin — with `allow-same-origin` its scripts would hold
// the dashboard's DOM and cookies, and its content is derived from kanban card bodies, i.e. text
// nobody audited.

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Download, FileClock, RefreshCw } from 'lucide-react'

interface ArchiveEntry {
  name: string
  mtimeMs: number
  bytes: number
}

/** Matches the archive filename's leading `YYYYMMDD_HHMMSS±HHMM`. */
function formatWhen(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  })
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`
  return `${(n / (1024 * 1024)).toFixed(1)} MB`
}

function formatAge(ms: number): string {
  const s = Math.max(0, Math.round((Date.now() - ms) / 1000))
  if (s < 60) return `${s}s ago`
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)}h ago`
  return `${Math.round(s / 86400)}d ago`
}

export default function JanitorReportSection() {
  const [entries, setEntries] = useState<ArchiveEntry[]>([])
  const [selected, setSelected] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reloadKey, setReloadKey] = useState(0)

  const fetchList = useCallback(async (keepSelection = true) => {
    try {
      const res = await fetch('/api/janitor/status-archive')
      if (!res.ok) throw new Error(`listing failed (${res.status})`)
      const data = (await res.json()) as { entries: ArchiveEntry[] }
      const list = data.entries ?? []
      setEntries(list)
      setError(null)
      // Default to the newest; only move an existing selection if it vanished under a prune.
      setSelected(prev =>
        keepSelection && prev && list.some(e => e.name === prev) ? prev : (list[0]?.name ?? null),
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void fetchList() }, [fetchList])

  const handleRefresh = useCallback(async () => {
    setGenerating(true)
    setError(null)
    try {
      const res = await fetch('/api/janitor/status-archive/generate', { method: 'POST' })
      const body = (await res.json().catch(() => ({}))) as { entry?: ArchiveEntry; error?: string }
      if (!res.ok) throw new Error(body.error || `generation failed (${res.status})`)
      await fetchList(false)
      // Remount the iframe so the newly selected document is actually fetched — the same
      // key-bump idiom AnalyticsSection uses for its reload button.
      setReloadKey(k => k + 1)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    } finally {
      setGenerating(false)
    }
  }, [fetchList])

  const handleExport = useCallback(() => {
    if (!selected) return
    // The route sets Content-Disposition; letting the browser handle it avoids pulling a 26 MB
    // document through a Blob in the page's own heap just to hand it straight back to the disk.
    window.open(`/api/janitor/status-archive/${encodeURIComponent(selected)}?download=1`, '_blank')
  }, [selected])

  const current = entries.find(e => e.name === selected) ?? null

  return (
    <div className="flex flex-col h-full">
      <div className="flex-shrink-0 border-b border-gray-800 bg-gray-950 px-6 py-4">
        <div className="flex items-center justify-between gap-4 flex-wrap">
          <div>
            <h2 className="text-lg font-semibold text-gray-100">Janitor Report</h2>
            <p className="text-sm text-gray-400 mt-0.5">
              The janitor&apos;s whole-host status document, preserved exactly as it was rendered.
              Kept as an audit trail — the newest {entries.length > 0 ? entries.length : ''} are
              retained and none overwrites the last.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handleRefresh}
              disabled={generating}
              className="inline-flex items-center gap-2 rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50"
              title="Generate a fresh document and preserve it"
            >
              <RefreshCw className={`h-4 w-4 ${generating ? 'animate-spin' : ''}`} />
              {generating ? 'Scanning host…' : 'Refresh'}
            </button>
            <button
              onClick={handleExport}
              disabled={!selected}
              className="inline-flex items-center gap-2 rounded-md border border-gray-700 bg-gray-900 px-3 py-1.5 text-sm text-gray-200 hover:bg-gray-800 disabled:opacity-50"
              title="Save a copy of the document being shown"
            >
              <Download className="h-4 w-4" />
              Export
            </button>
          </div>
        </div>

        {entries.length > 0 && (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <FileClock className="h-4 w-4 text-gray-500" />
            <select
              value={selected ?? ''}
              onChange={e => { setSelected(e.target.value); setReloadKey(k => k + 1) }}
              className="rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm text-gray-200"
            >
              {entries.map(e => (
                <option key={e.name} value={e.name}>
                  {formatWhen(e.mtimeMs)} — {formatBytes(e.bytes)}
                </option>
              ))}
            </select>
            {current && (
              // The age is shown deliberately: this is the freshest data that EXISTS, not a live
              // feed, and a status surface that hides how old it is invites being read as live.
              <span className="text-xs text-gray-500">captured {formatAge(current.mtimeMs)}</span>
            )}
          </div>
        )}

        {error && (
          <div className="mt-3 flex items-start gap-2 rounded-md border border-amber-900/60 bg-amber-950/30 px-3 py-2 text-sm text-amber-200">
            <AlertTriangle className="h-4 w-4 mt-0.5 flex-shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0">
        {loading ? (
          <div className="p-6 text-sm text-gray-400">Loading…</div>
        ) : entries.length === 0 ? (
          // Degrade honestly. An empty frame here would read as "the fleet is down", which is the
          // alarming direction and is worse than saying plainly that we have nothing yet.
          <div className="p-6 max-w-2xl">
            <h3 className="text-gray-200 font-medium">No status document has been preserved yet</h3>
            <p className="text-sm text-gray-400 mt-2">
              These documents are produced by the ai-maestro-janitor plugin. Press{' '}
              <span className="text-gray-200">Refresh</span> to generate one now, or run{' '}
              <code className="rounded bg-gray-900 px-1 py-0.5 text-gray-300">
                /janitor-show-global-status
              </code>{' '}
              in any session — anything it writes is preserved automatically.
            </p>
            <p className="text-sm text-gray-500 mt-2">
              If the janitor plugin is not installed on this host, Refresh will say so rather than
              showing an empty report.
            </p>
          </div>
        ) : (
          <iframe
            key={`${selected}-${reloadKey}`}
            src={`/api/janitor/status-archive/${encodeURIComponent(selected ?? '')}`}
            title="Janitor global status"
            className="w-full h-full border-0"
            sandbox="allow-scripts"
          />
        )}
      </div>
    </div>
  )
}
