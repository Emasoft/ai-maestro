'use client'

/**
 * Settings -> Plugin Updates
 *
 * Master toggle + interval + 7 category checkboxes for the periodic
 * auto-update scheduler. Always-auto-apply (no notify-only mode by user
 * directive) — when a plugin is detected as outdated, it's updated
 * immediately, and any agent whose local-scope plugin was updated gets
 * queued for restart via the existing useRestartQueue path (waits for
 * idle_prompt before stopping/restarting claude).
 *
 * Persisted to ~/.aimaestro/auto-update-settings.json via:
 *   GET   /api/settings/auto-update          (read current settings)
 *   PATCH /api/settings/auto-update          (sudo-gated; partial updates)
 *   POST  /api/settings/auto-update/run      (sudo-gated; manual "Run now")
 */

import { useState, useEffect, useCallback } from 'react'
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, XCircle, Clock } from 'lucide-react'
import { useSudo } from '@/contexts/SudoContext'
import { sudoFetch } from '@/lib/sudo-fetch'

interface AutoUpdateCategories {
  marketplaceManifests: boolean
  core: boolean
  localMarketplaces: boolean
  aiMaestroMarketplace: boolean
  dependencyPlugins: boolean
  agentLocalScopePlugins: boolean
  userScopePlugins: boolean
}

interface AutoUpdateRunEntry {
  target: string
  status: 'updated' | 'already-current' | 'failed' | 'skipped'
  at: string
  detail?: string
}

interface AutoUpdateSettings {
  enabled: boolean
  intervalMinutes: number
  categories: AutoUpdateCategories
  lastRunAt: string | null
  lastRunSummary: AutoUpdateRunEntry[]
}

const INTERVAL_PRESETS = [
  { label: 'Every 15 minutes', value: 15 },
  { label: 'Every 30 minutes', value: 30 },
  { label: 'Every hour', value: 60 },
  { label: 'Every 6 hours', value: 360 },
  { label: 'Every 24 hours', value: 1440 },
] as const

const CATEGORY_LABELS: { key: keyof AutoUpdateCategories; label: string; description: string }[] = [
  {
    key: 'marketplaceManifests',
    label: 'Refresh marketplace manifests',
    description: 'Run `claude plugin marketplace update <name>` for every marketplace touched by enabled categories. Mandatory prerequisite — without this, the server cannot detect new plugin versions.',
  },
  {
    key: 'core',
    label: 'Core AI Maestro plugin',
    description: 'Update ai-maestro-plugin (R17 core plugin) at user scope from the ai-maestro-plugins marketplace.',
  },
  {
    key: 'localMarketplaces',
    label: 'Local marketplaces',
    description: 'Update every plugin that comes from ai-maestro-local-roles-marketplace or ai-maestro-local-custom-marketplace (Haephestos-authored plugins, converted plugins).',
  },
  {
    key: 'aiMaestroMarketplace',
    label: 'Remote ai-maestro-plugins marketplace',
    description: 'Update every plugin that comes from the remote ai-maestro-plugins marketplace (8 predefined role-plugins + bundled core mirror).',
  },
  {
    key: 'dependencyPlugins',
    label: 'Dependency plugins',
    description: 'Update PSS, CPV, llm-externalizer, code-auditor, serena, and grepika in every marketplace where they appear.',
  },
  {
    key: 'agentLocalScopePlugins',
    label: 'All agent local-scope plugins',
    description: 'Sweep every plugin currently installed in any agent\'s .claude/settings.local.json. Catch-all — overlaps with the categories above.',
  },
  {
    key: 'userScopePlugins',
    label: 'All user-scope plugins',
    description: 'Sweep every plugin currently enabled in ~/.claude/settings.json. Catch-all — overlaps with the categories above.',
  },
]

export default function PluginUpdatesSection() {
  const { requestSudoToken } = useSudo()
  const [settings, setSettings] = useState<AutoUpdateSettings | null>(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [running, setRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const res = await fetch('/api/settings/auto-update')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setSettings(data.settings)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const persist = useCallback(async (patch: Partial<AutoUpdateSettings>) => {
    if (!settings) return
    setSaving(true)
    setError(null)
    try {
      const res = await sudoFetch(
        '/api/settings/auto-update',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(patch),
        },
        (reason) => requestSudoToken(reason),
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setSettings(data.settings)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }, [settings, requestSudoToken])

  const handleToggleEnabled = () => {
    if (!settings) return
    persist({ enabled: !settings.enabled })
  }

  const handleIntervalChange = (n: number) => {
    persist({ intervalMinutes: n })
  }

  const handleCategoryToggle = (key: keyof AutoUpdateCategories) => {
    if (!settings) return
    persist({ categories: { ...settings.categories, [key]: !settings.categories[key] } })
  }

  const handleRunNow = async () => {
    setRunning(true)
    setError(null)
    try {
      const res = await sudoFetch(
        '/api/settings/auto-update/run',
        { method: 'POST' },
        (reason) => requestSudoToken(reason),
      )
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        throw new Error(data.error || `HTTP ${res.status}`)
      }
      const data = await res.json()
      setSettings(data.settings)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to run update tick')
    } finally {
      setRunning(false)
    }
  }

  if (loading) {
    return (
      <div className="p-6 text-gray-400 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading auto-update settings…
      </div>
    )
  }

  if (!settings) {
    return (
      <div className="p-6 text-red-400">
        Failed to load auto-update settings{error ? `: ${error}` : '.'}
      </div>
    )
  }

  // Warn if any plugin category is enabled while the manifest-refresh
  // checkbox is OFF — the server can't detect new versions in that
  // configuration, so the rest of the categories effectively no-op.
  const anyPluginCategoryEnabled =
    settings.categories.core ||
    settings.categories.localMarketplaces ||
    settings.categories.aiMaestroMarketplace ||
    settings.categories.dependencyPlugins ||
    settings.categories.agentLocalScopePlugins ||
    settings.categories.userScopePlugins
  const showManifestWarning = anyPluginCategoryEnabled && !settings.categories.marketplaceManifests

  return (
    <div className="p-6 max-w-3xl space-y-6">
      <header>
        <h2 className="text-xl font-semibold text-white mb-1">Plugin Updates</h2>
        <p className="text-sm text-gray-400">
          Periodic background check that pulls new plugin versions and queues a stop+restart
          of any agent whose plugin was updated. The restart waits for the agent to be idle
          before stopping claude — running turns are never interrupted.
        </p>
      </header>

      {error && (
        <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-300 flex items-start gap-2">
          <XCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
          <span>{error}</span>
        </div>
      )}

      {/* Master toggle */}
      <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <h3 className="text-sm font-medium text-white">Auto-update enabled</h3>
            <p className="text-xs text-gray-500 mt-0.5">
              When ON, the scheduler runs at the interval below. When OFF, no automatic
              updates happen — the manual Update buttons in the agent profile and
              marketplace pages still work.
            </p>
          </div>
          <button
            type="button"
            onClick={handleToggleEnabled}
            disabled={saving}
            className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors disabled:opacity-50 ${
              settings.enabled ? 'bg-emerald-500' : 'bg-gray-700'
            }`}
            aria-pressed={settings.enabled}
            aria-label="Toggle auto-update enabled"
          >
            <span
              className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                settings.enabled ? 'translate-x-6' : 'translate-x-1'
              }`}
            />
          </button>
        </div>
      </section>

      {/* Interval */}
      <section className={`rounded-lg border border-gray-800 bg-gray-900/50 p-4 ${!settings.enabled && 'opacity-60'}`}>
        <h3 className="text-sm font-medium text-white mb-2 flex items-center gap-2">
          <Clock className="w-4 h-4 text-gray-400" /> Check interval
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-5 gap-2">
          {INTERVAL_PRESETS.map(p => (
            <button
              key={p.value}
              type="button"
              onClick={() => handleIntervalChange(p.value)}
              disabled={saving || !settings.enabled}
              className={`px-3 py-1.5 rounded text-xs font-medium transition-colors ${
                settings.intervalMinutes === p.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              } disabled:opacity-50 disabled:hover:bg-gray-800`}
            >
              {p.label}
            </button>
          ))}
        </div>
      </section>

      {/* Categories */}
      <section className={`rounded-lg border border-gray-800 bg-gray-900/50 p-4 ${!settings.enabled && 'opacity-60'}`}>
        <h3 className="text-sm font-medium text-white mb-3">Categories</h3>

        {showManifestWarning && (
          <div className="mb-3 rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 flex items-start gap-2">
            <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
            <span>
              Manifest refresh is OFF, but plugin categories below are ON. Without manifest
              refresh, the server reads the cached marketplace metadata and may not detect
              newly published versions.
            </span>
          </div>
        )}

        <div className="space-y-2">
          {CATEGORY_LABELS.map(cat => (
            <label
              key={cat.key}
              className="flex items-start gap-3 px-3 py-2 rounded hover:bg-gray-800/50 cursor-pointer"
            >
              <input
                type="checkbox"
                checked={settings.categories[cat.key]}
                onChange={() => handleCategoryToggle(cat.key)}
                disabled={saving || !settings.enabled}
                className="mt-1 w-4 h-4 rounded border-gray-700 bg-gray-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900"
              />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-gray-200">{cat.label}</div>
                <div className="text-xs text-gray-500">{cat.description}</div>
              </div>
            </label>
          ))}
        </div>
      </section>

      {/* Run now + last-run summary */}
      <section className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
        <div className="flex items-start justify-between gap-4 mb-3">
          <div>
            <h3 className="text-sm font-medium text-white">Last run</h3>
            <p className="text-xs text-gray-500">
              {settings.lastRunAt
                ? `Last tick at ${new Date(settings.lastRunAt).toLocaleString()}`
                : 'Never run yet.'}
            </p>
          </div>
          <button
            type="button"
            onClick={handleRunNow}
            disabled={running || saving}
            className="flex items-center gap-2 px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 text-white text-xs font-medium transition-colors disabled:opacity-50"
            title="Trigger one tick of the scheduler immediately, mirroring exactly what runs on the interval"
          >
            {running ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
            Run now
          </button>
        </div>

        {settings.lastRunSummary.length > 0 ? (
          <ul className="space-y-1 max-h-64 overflow-y-auto border-t border-gray-800 pt-3">
            {settings.lastRunSummary.slice(0, 50).map((entry, i) => (
              <li key={i} className="flex items-start gap-2 text-xs">
                {entry.status === 'updated' && <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 flex-shrink-0 mt-0.5" />}
                {entry.status === 'already-current' && <CheckCircle2 className="w-3.5 h-3.5 text-gray-500 flex-shrink-0 mt-0.5" />}
                {entry.status === 'failed' && <XCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0 mt-0.5" />}
                {entry.status === 'skipped' && <AlertTriangle className="w-3.5 h-3.5 text-amber-400 flex-shrink-0 mt-0.5" />}
                <div className="flex-1 min-w-0">
                  <span className="font-mono text-gray-300">{entry.target}</span>
                  <span className="text-gray-600"> · {entry.status}</span>
                  {entry.detail && <span className="text-gray-500"> — {entry.detail}</span>}
                </div>
                <span className="text-gray-700 flex-shrink-0">{new Date(entry.at).toLocaleTimeString()}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-gray-600 italic">No run history yet.</p>
        )}
      </section>
    </div>
  )
}
