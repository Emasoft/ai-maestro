'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Store, ChevronDown, ChevronRight, ExternalLink, Loader2, Download, Check } from 'lucide-react'
import { FilterInput } from './shared'

/**
 * Read-only marketplaces inspector for Agent Profile → Config.
 * Mirrors Settings → Plugins Explorer → Marketplaces but:
 *   - Marketplace add/remove is DISABLED (link to Settings instead)
 *   - Install buttons use scope='local' (current agent's .claude/settings.local.json)
 *   - Uninstall buttons remove from local scope only
 */

interface MarketplaceInfo {
  name: string
  source: string
  pluginCount: number
  plugins?: { name: string; description?: string; installed?: boolean; enabled?: boolean }[]
}

interface MarketplacesTabProps {
  workingDirectory?: string
  installedPluginNames: Set<string>
  onRefresh?: () => void
}

export default function MarketplacesTab({ workingDirectory, installedPluginNames, onRefresh }: MarketplacesTabProps) {
  const router = useRouter()
  const [marketplaces, setMarketplaces] = useState<MarketplaceInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expandedMkt, setExpandedMkt] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [installing, setInstalling] = useState<string | null>(null)

  const fetchMarketplaces = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch('/api/settings/marketplaces')
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setMarketplaces(data.marketplaces || [])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load marketplaces')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { fetchMarketplaces() }, [fetchMarketplaces])

  const handleInstall = async (pluginName: string) => {
    if (!workingDirectory || installing) return
    setInstalling(pluginName)
    try {
      const res = await fetch('/api/agents/role-plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginName, agentDir: workingDirectory, scope: 'local' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Install failed' }))
        console.error('[MarketplacesTab] Install failed:', err.error)
        return
      }
      onRefresh?.()
    } catch (err) {
      console.error('[MarketplacesTab] Install request failed:', err)
    } finally {
      setInstalling(null)
    }
  }

  const navigateToSettingsMarketplaces = () => {
    router.push('/settings?tab=global-elements&subtab=marketplaces')
  }

  const filtered = query.trim()
    ? marketplaces.filter((m) => {
        const q = query.trim().toLowerCase()
        const name = (m.name || '').toLowerCase()
        const source = (m.source || '').toLowerCase()
        return name.includes(q) || source.includes(q)
      })
    : marketplaces

  if (loading) {
    return (
      <div className="flex items-center justify-center h-20">
        <Loader2 className="w-4 h-4 text-gray-500 animate-spin" />
      </div>
    )
  }

  if (error) {
    return (
      <div className="px-2 py-2">
        <p className="text-[10px] text-red-400">Error: {error}</p>
      </div>
    )
  }

  if (marketplaces.length === 0) {
    return (
      <div className="px-2 py-3 space-y-2">
        <p className="text-[10px] text-gray-600 italic">No marketplaces registered</p>
        <button
          onClick={navigateToSettingsMarketplaces}
          className="inline-flex items-center gap-1 text-[10px] text-emerald-400 hover:text-emerald-300"
        >
          <ExternalLink className="w-3 h-3" />
          Manage Marketplaces in Settings
        </button>
      </div>
    )
  }

  return (
    <div>
      <FilterInput
        value={query}
        onChange={setQuery}
        placeholder={`Filter ${marketplaces.length} marketplace${marketplaces.length === 1 ? '' : 's'}…`}
      />

      <div className="space-y-1.5 mb-2">
        {filtered.length === 0 ? (
          <p className="text-[10px] text-gray-600 italic px-2 py-1">No matches</p>
        ) : (
          filtered.map((mkt) => {
            const isExpanded = expandedMkt === mkt.name
            return (
              <div key={mkt.name} className="rounded-lg border border-gray-700/30 bg-gray-800/20 overflow-hidden">
                <div
                  onClick={() => setExpandedMkt(isExpanded ? null : mkt.name)}
                  className="flex items-center gap-2 px-2.5 py-2 cursor-pointer hover:bg-gray-800/30 transition-colors"
                >
                  {isExpanded
                    ? <ChevronDown className="w-3 h-3 text-gray-500 flex-shrink-0" />
                    : <ChevronRight className="w-3 h-3 text-gray-500 flex-shrink-0" />
                  }
                  <Store className="w-3.5 h-3.5 flex-shrink-0 text-violet-400" />
                  <p className="text-xs font-medium text-gray-200 truncate flex-1" title={mkt.source}>
                    {mkt.name}
                  </p>
                  <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-gray-800/60 text-gray-500 flex-shrink-0">
                    {mkt.pluginCount}
                  </span>
                </div>

                {isExpanded && (
                  <div className="px-3 pb-2.5 border-t border-gray-800/30 space-y-1 pt-2">
                    <p className="text-[9px] text-gray-600 font-mono truncate" title={mkt.source}>
                      {mkt.source}
                    </p>
                    {mkt.plugins && mkt.plugins.length > 0 ? (
                      <div className="space-y-1 pt-1">
                        {mkt.plugins.map((p) => {
                          const isInstalled = installedPluginNames.has(p.name)
                          return (
                            <div key={p.name} className="flex items-center gap-2 px-2 py-1 rounded bg-gray-900/40">
                              <div className="flex-1 min-w-0">
                                <p className="text-[10px] text-gray-300 truncate">{p.name}</p>
                                {p.description && (
                                  <p className="text-[9px] text-gray-600 truncate">{p.description}</p>
                                )}
                              </div>
                              {isInstalled ? (
                                <span className="flex items-center gap-1 text-[9px] text-emerald-400 px-1.5" title="Installed in this agent">
                                  <Check className="w-3 h-3" />
                                  local
                                </span>
                              ) : (
                                <button
                                  onClick={() => handleInstall(p.name)}
                                  disabled={!workingDirectory || installing === p.name}
                                  className="flex items-center gap-1 text-[9px] text-blue-400 hover:text-blue-300 px-1.5 py-0.5 rounded disabled:opacity-50"
                                  title="Install to this agent (--scope local)"
                                >
                                  {installing === p.name
                                    ? <Loader2 className="w-3 h-3 animate-spin" />
                                    : <Download className="w-3 h-3" />
                                  }
                                  install
                                </button>
                              )}
                            </div>
                          )
                        })}
                      </div>
                    ) : (
                      <p className="text-[9px] text-gray-600 italic">No plugins in this marketplace</p>
                    )}
                  </div>
                )}
              </div>
            )
          })
        )}
      </div>

      <button
        onClick={navigateToSettingsMarketplaces}
        className="inline-flex items-center gap-1 text-[10px] text-emerald-400/80 hover:text-emerald-300 px-2 py-1"
      >
        <ExternalLink className="w-3 h-3" />
        Manage Marketplaces in Settings
      </button>
    </div>
  )
}
