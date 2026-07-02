'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import {
  XCircle,
  ExternalLink,
  ChevronDown,
  ChevronRight,
  Sparkles,
  Users,
  Webhook,
  ScrollText,
  Terminal as TerminalIcon,
  Server,
  Palette,
  Puzzle,
  RefreshCw,
  Loader2,
} from 'lucide-react'
import type { AgentLocalConfig, LocalPlugin } from '@/types/agent-local-config'
import { EmptyState, FilterInput, type TabId } from './shared'
import { useSudo } from '@/contexts/SudoContext'
import { sudoFetch } from '@/lib/sudo-fetch'

/** Element type counts for a plugin */
function pluginElementCounts(p: LocalPlugin) {
  if (!p.elements) return null
  const e = p.elements
  return {
    skills: e.skills?.length ?? 0,
    agents: e.agents?.length ?? 0,
    hooks: e.hooks?.length ?? 0,
    rules: e.rules?.length ?? 0,
    commands: e.commands?.length ?? 0,
    mcpServers: e.mcpServers?.length ?? 0,
    outputStyles: e.outputStyles?.length ?? 0,
  }
}

/** Small count chip for element types */
const ELEMENT_CHIPS: { key: string; label: string; icon: typeof Sparkles; tabId: TabId }[] = [
  { key: 'skills', label: 'Skills', icon: Sparkles, tabId: 'skills' },
  { key: 'agents', label: 'Agents', icon: Users, tabId: 'agents' },
  { key: 'hooks', label: 'Hooks', icon: Webhook, tabId: 'hooks' },
  { key: 'rules', label: 'Rules', icon: ScrollText, tabId: 'rules' },
  { key: 'commands', label: 'Cmds', icon: TerminalIcon, tabId: 'commands' },
  { key: 'mcpServers', label: 'MCP', icon: Server, tabId: 'mcps' },
  { key: 'outputStyles', label: 'Styles', icon: Palette, tabId: 'outputStyles' },
]

interface PluginsTabProps {
  config: AgentLocalConfig
  /** Agent ID — needed for the Update endpoint
   *  POST /api/agents/{id}/local-plugins. */
  agentId?: string | null
  /** Callback to switch accordion section in parent (cross-section navigation) */
  onSwitchTab?: (tab: TabId) => void
  /** Callback to notify parent that plugin state changed (triggers config refetch) */
  onRefresh?: () => void
}

export default function PluginsTab({ config, agentId, onSwitchTab, onRefresh }: PluginsTabProps) {
  const router = useRouter()
  const { requestSudoToken } = useSudo()
  const [confirmUninstall, setConfirmUninstall] = useState<LocalPlugin | null>(null)
  const [uninstalling, setUninstalling] = useState(false)
  const [expandedPlugin, setExpandedPlugin] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  /** Per-plugin "currently updating" flag. Keyed by plugin.key so two
   *  simultaneous updates on different plugins each show their own
   *  spinner. Cleared when the update settles (success or failure). */
  const [updatingPlugin, setUpdatingPlugin] = useState<string | null>(null)

  const filteredPlugins = query.trim()
    ? config.plugins.filter((p) => {
        const q = query.trim().toLowerCase()
        return [p.name, p.description, p.author, p.version, p.marketplace, p.key]
          .filter((v): v is string => typeof v === 'string')
          .some(v => v.toLowerCase().includes(q))
      })
    : config.plugins

  /** Update a locally-installed plugin to the latest version available
   *  in its marketplace. Server-side ChangePlugin (action='update', scope=
   *  'local') runs `claude plugin install` which pulls the latest version
   *  from the marketplace cache. After success, onRefresh() fires the
   *  parent's handleElementChanged which queues a stop+restart of the
   *  agent's session — required for claude to load the new version. */
  const handleUpdate = async (plugin: LocalPlugin) => {
    if (!agentId || !plugin.key) {
      console.error('[PluginsTab] Cannot update: missing agentId or plugin.key')
      return
    }
    setUpdatingPlugin(plugin.key)
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/local-plugins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: plugin.key, action: 'update' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Update failed' }))
        console.error('[PluginsTab] Update failed:', err.error)
        return
      }
    } catch (err) {
      console.error('[PluginsTab] Update request failed:', err)
      return
    } finally {
      setUpdatingPlugin(null)
    }
    onRefresh?.()
  }

  const handleUninstall = async (plugin: LocalPlugin) => {
    setUninstalling(true)
    try {
      // Extract marketplace from plugin key ("name@marketplace") for correct removal
      const marketplaceName = plugin.key?.includes('@') ? plugin.key.split('@').slice(1).join('@') : undefined
      // DELETE /api/agents/role-plugins/install is classified "strict" in
      // the security registry. sudoFetch transparently prompts the user
      // for the governance password and retries with X-Sudo-Token on the
      // first 403 response.
      const res = await sudoFetch(
        '/api/agents/role-plugins/install',
        {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            pluginName: plugin.name,
            agentDir: config.workingDirectory,
            ...(marketplaceName !== undefined && { marketplaceName }),
          }),
        },
        (reason) => requestSudoToken(`Uninstall plugin "${plugin.name}". ${reason}`)
      )
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Uninstall failed' }))
        console.error('[PluginsTab] Uninstall failed:', err.error)
        // MF-027: do not call onRefresh on failure — avoid false "config refreshed" signal
        setUninstalling(false)
        setConfirmUninstall(null)
        return
      }
    } catch (err) {
      console.error('[PluginsTab] Uninstall request failed:', err)
      setUninstalling(false)
      setConfirmUninstall(null)
      return
    }
    setUninstalling(false)
    setConfirmUninstall(null)
    onRefresh?.()
  }

  if (config.plugins.length === 0) {
    return <EmptyState text="No plugins installed" hint="No non-Role plugins detected in local config. Role Plugin shown in Role tab." />
  }

  return (
    <div>
      <FilterInput
        value={query}
        onChange={setQuery}
        placeholder={`Filter ${config.plugins.length} plugin${config.plugins.length === 1 ? '' : 's'}…`}
      />
      {filteredPlugins.length === 0 && (
        <p className="text-[10px] text-gray-600 italic px-2 py-1">No matches</p>
      )}
      <div className="space-y-1.5">
      {filteredPlugins.map((p) => {
        const isRole = p.name === config.rolePlugin?.name
        const isExpanded = expandedPlugin === p.name
        const counts = pluginElementCounts(p)
        const totalElements = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0
        const mkt = p.key?.includes('@') ? p.key.split('@').slice(1).join('@') : undefined

        return (
          <div
            key={p.name}
            className={`rounded-lg border overflow-hidden ${
              p.isConflictingRolePlugin
                ? 'border-red-500/40 bg-red-500/10'
                : isRole
                  ? 'border-emerald-500/20 bg-emerald-500/5'
                  : 'border-gray-700/30 bg-gray-800/20'
            }`}
          >
            {/* Plugin header — clickable to expand/collapse.
                UI2-MAJ-05: keyboard support so a11y users can expand/collapse
                plugin rows. The inner uninstall icon-divs are also converted
                to real <button> elements below. */}
            <div
              role="button"
              tabIndex={0}
              aria-expanded={isExpanded}
              aria-label={`${isExpanded ? 'Collapse' : 'Expand'} ${p.name}`}
              onClick={() => setExpandedPlugin(isExpanded ? null : p.name)}
              onKeyDown={(e) => {
                if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
                  e.preventDefault()
                  setExpandedPlugin(isExpanded ? null : p.name)
                }
              }}
              className="flex items-center gap-2 px-2.5 py-2 cursor-pointer hover:bg-gray-800/20 transition-colors focus:outline-none focus:bg-gray-800/40"
            >
              {isExpanded
                ? <ChevronDown className="w-3 h-3 text-gray-500 flex-shrink-0" />
                : <ChevronRight className="w-3 h-3 text-gray-500 flex-shrink-0" />
              }
              <Puzzle className={`w-3.5 h-3.5 flex-shrink-0 ${isRole ? 'text-emerald-400' : 'text-blue-400'}`} />
              <div className="flex-1 min-w-0">
                <p className={`text-xs font-medium truncate ${p.isConflictingRolePlugin ? 'text-red-300' : 'text-gray-200'}`}>
                  {p.name}
                </p>
              </div>
              {/* Version badge */}
              {p.version && (
                <span className="text-[8px] text-gray-600 px-1 flex-shrink-0">{p.version}</span>
              )}
              {/* Element count chip */}
              {totalElements > 0 && (
                <span className="text-[8px] px-1.5 py-0.5 rounded-full bg-gray-800/60 text-gray-500 flex-shrink-0">
                  {totalElements}
                </span>
              )}
              {/* Role/Core badges + Update + Uninstall actions */}
              {/* Role and Core plugins are tagged with a non-destructive
                  badge: role-plugins are managed via the Role tab's N:1
                  swap dropdown (not via Update — they have their own
                  semantics), and the core ai-maestro-plugin is protected
                  by R17 from any uninstall/disable. Both render their
                  badge in place of the action buttons.
                  Every OTHER plugin gets two icon buttons: Update
                  (RefreshCw) — pulls the latest version from its
                  marketplace and queues a restart — and Uninstall
                  (XCircle) — the existing flow.
                  We render the Update button only when agentId is
                  available (the parent must wire it through); without
                  agentId the API call has no target. */}
              {isRole ? (
                <span className="text-[9px] text-emerald-400/70 px-1.5 flex-shrink-0">role</span>
              ) : p.name === 'ai-maestro-plugin' ? (
                <span className="text-[9px] text-blue-400/70 px-1.5 flex-shrink-0" title="Core plugin — cannot be uninstalled (R17)">core</span>
              ) : (
                <div className="flex items-center gap-0.5 flex-shrink-0">
                  {agentId && (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); handleUpdate(p) }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
                      disabled={updatingPlugin === p.key}
                      className="flex-shrink-0 p-1 rounded-md cursor-pointer hover:bg-blue-500/20 focus:outline-none focus:ring-1 focus:ring-blue-400/70 disabled:opacity-50"
                      title="Update this plugin to the latest version (refreshes from marketplace, queues a session restart)"
                      aria-label={`Update ${p.name}`}
                    >
                      {updatingPlugin === p.key
                        ? <Loader2 className="w-3.5 h-3.5 text-blue-400 animate-spin" />
                        : <RefreshCw className="w-3.5 h-3.5 text-gray-500 hover:text-blue-400" />}
                    </button>
                  )}
                  {p.isConflictingRolePlugin ? (
                    // UI2-MAJ-05: real <button> for uninstall — natively keyboard-accessible
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmUninstall(p) }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
                      className="flex-shrink-0 p-1 rounded-md cursor-pointer hover:bg-red-500/20 focus:outline-none focus:ring-1 focus:ring-red-400/70"
                      title="Uninstall this plugin"
                      aria-label={`Uninstall ${p.name}`}
                    >
                      <XCircle className="w-3.5 h-3.5 text-red-400" />
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={(e) => { e.stopPropagation(); setConfirmUninstall(p) }}
                      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation() }}
                      className="flex-shrink-0 p-1 rounded-md cursor-pointer hover:bg-gray-700/60 focus:outline-none focus:ring-1 focus:ring-gray-500/70"
                      title="Uninstall this plugin"
                      aria-label={`Uninstall ${p.name}`}
                    >
                      <XCircle className="w-3.5 h-3.5 text-gray-500 hover:text-gray-300" />
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Expanded details */}
            {isExpanded && (
              <div className="px-3 pb-2.5 border-t border-gray-800/30 space-y-2 pt-2">
                {/* Description */}
                {p.description && (
                  <p className="text-[10px] text-gray-500 leading-snug line-clamp-3">{p.description}</p>
                )}

                {/* Metadata rows */}
                <div className="space-y-0.5">
                  {p.author && (
                    <div className="flex items-center gap-1.5 text-[9px]">
                      <span className="text-gray-600 w-14 flex-shrink-0">Author</span>
                      <span className="text-gray-400 truncate">{p.author}</span>
                    </div>
                  )}
                  {p.version && (
                    <div className="flex items-center gap-1.5 text-[9px]">
                      <span className="text-gray-600 w-14 flex-shrink-0">Version</span>
                      <span className="text-gray-400">{p.version}</span>
                    </div>
                  )}
                  {p.license && (
                    <div className="flex items-center gap-1.5 text-[9px]">
                      <span className="text-gray-600 w-14 flex-shrink-0">License</span>
                      <span className="text-gray-400">{p.license}</span>
                    </div>
                  )}
                  {p.isConflictingRolePlugin && (
                    <p className="text-[10px] text-red-400/80 mt-0.5">
                      Conflicting Role Plugin — only one is allowed per agent
                    </p>
                  )}
                </div>

                {/* Marketplace link */}
                {mkt && (
                  <span
                    onClick={(e) => {
                      e.stopPropagation()
                      sessionStorage.setItem('profile-panel-return', JSON.stringify({ agentId: config.workingDirectory, tab: 'plugins' }))
                      router.push(`/settings?tab=global-elements&subtab=plugins&marketplace=${encodeURIComponent(mkt)}`)
                    }}
                    className="inline-flex items-center gap-1 text-[9px] text-emerald-400/70 hover:text-emerald-300 cursor-pointer"
                    title={`View in Settings → ${mkt}`}
                  >
                    <ExternalLink className="w-2.5 h-2.5" />
                    {mkt}
                  </span>
                )}

                {/* Element sections — clickable chips that navigate to element accordion section */}
                {counts && totalElements > 0 && (
                  <div className="flex flex-wrap gap-1 pt-1">
                    {ELEMENT_CHIPS.map(({ key, label, icon: Icon, tabId }) => {
                      const count = counts[key as keyof typeof counts]
                      if (!count) return null
                      return (
                        <div
                          key={key}
                          onClick={(e) => {
                            e.stopPropagation()
                            // Cross-section navigation: switch to the element's accordion section
                            if (onSwitchTab) onSwitchTab(tabId)
                          }}
                          className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded bg-gray-800/40 hover:bg-gray-700/60 cursor-pointer transition-colors"
                          title={`View ${label} from this plugin`}
                        >
                          <Icon className="w-2.5 h-2.5 text-gray-500" />
                          <span className="text-[8px] text-gray-400">{label}</span>
                          <span className="text-[8px] text-gray-600">{count}</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}
          </div>
        )
      })}
      </div>

      {/* Uninstall confirmation dialog */}
      {confirmUninstall && (
        <div className={`mt-3 px-3 py-3 rounded-lg border ${
          confirmUninstall.isConflictingRolePlugin
            ? 'border-red-500/30 bg-red-500/10'
            : 'border-amber-500/30 bg-amber-500/10'
        }`}>
          <p className={`text-xs mb-3 ${confirmUninstall.isConflictingRolePlugin ? 'text-red-300' : 'text-amber-300'}`}>
            Do you want to uninstall <span className="font-semibold">{confirmUninstall.name}</span>?
            {!confirmUninstall.isConflictingRolePlugin && (
              <span className="block mt-1 text-[10px] opacity-80">
                All elements bundled in this plugin will also be removed. This action cannot be undone.
              </span>
            )}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => handleUninstall(confirmUninstall)}
              disabled={uninstalling}
              className={`flex-1 px-3 py-1.5 rounded-md disabled:opacity-50 text-white text-xs font-medium transition-colors ${
                confirmUninstall.isConflictingRolePlugin
                  ? 'bg-red-600 hover:bg-red-500'
                  : 'bg-amber-600 hover:bg-amber-500'
              }`}
            >
              {uninstalling ? 'Uninstalling…' : 'Yes'}
            </button>
            <button
              onClick={() => setConfirmUninstall(null)}
              disabled={uninstalling}
              className="flex-1 px-3 py-1.5 rounded-md bg-gray-700 hover:bg-gray-600 disabled:opacity-50 text-gray-200 text-xs font-medium transition-colors"
            >
              No
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
