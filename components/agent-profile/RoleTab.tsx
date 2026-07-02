'use client'

import { useState, useEffect } from 'react'
import { Shield, FolderOpen, Sparkles, ExternalLink, Lock, ChevronDown, RefreshCw, Loader2 } from 'lucide-react'
import type { AgentLocalConfig } from '@/types/agent-local-config'
import type { GovernanceTitle } from '@/hooks/useGovernance'
import { SectionLabel } from './shared'
import RolePluginModal from './RolePluginModal'
import { LOCAL_MARKETPLACE_NAME } from '@/lib/ecosystem-constants'
import { sudoFetch } from '@/lib/sudo-fetch'
import { useSudo } from '@/contexts/SudoContext'

interface CompatiblePlugin {
  name: string
  marketplace?: string
  source?: string
  compatibleTitles?: string[]
  compatibleClients?: string[]
}

export default function RoleTab({
  config,
  agentId,
  agentTitle,
  agentClient,
  onEditInHaephestos,
  onBrowse,
  onRefresh,
}: {
  config: AgentLocalConfig
  /** Agent ID — needed for the role-plugin Update endpoint
   *  POST /api/agents/{id}/local-plugins. Optional for legacy callers
   *  that don't yet wire it through; in that case the Update button
   *  is hidden. */
  agentId?: string
  agentTitle?: GovernanceTitle
  agentClient?: string  // Agent's AI client (claude, codex, gemini, etc.)
  onEditInHaephestos?: (profilePath: string) => void
  onBrowse?: (path: string) => void
  onRefresh?: () => void
}) {
  const { requestSudoToken } = useSudo()
  const [showModal, setShowModal] = useState(false)
  const [switching, setSwitching] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [compatiblePlugins, setCompatiblePlugins] = useState<CompatiblePlugin[]>([])

  // Fetch compatible plugins for this agent's title + client. R9.13:
  // AUTONOMOUS is a real title now and has its own mandatory role-plugin
  // (ai-maestro-autonomous-agent), so it is queried like every other title.
  useEffect(() => {
    if (!agentTitle) {
      setCompatiblePlugins([])
      return
    }
    const url = `/api/agents/role-plugins?title=${agentTitle.toUpperCase()}${agentClient ? `&client=${agentClient}` : ''}`
    fetch(url)
      .then(r => r.ok ? r.json() : { plugins: [] })
      .then(data => setCompatiblePlugins(Array.isArray(data.plugins) ? data.plugins : []))
      .catch(() => setCompatiblePlugins([]))
  }, [agentTitle, agentClient])

  // N:1 model: 1 compatible → fixed label; 2+ → dropdown; 0 → error state
  // (no title has zero compatible plugins under R9.13, but we still render).
  // MEMBER is the only title that gets a "free choice" feel because the
  // MEMBER role-plugin pool is large (programmer, architect, integrator,
  // orchestrator, etc. all declare compatible-titles=["MEMBER"]).
  const hasMultipleOptions = compatiblePlugins.length > 1
  const isFreeChoice = agentTitle === 'member'
  // Titled agents: show Change only if 2+ compatible plugins exist
  // MEMBER: always show Change (free choice from all plugins)
  const canChange = isFreeChoice ? true : hasMultipleOptions
  // Show lock icon when exactly 1 compatible plugin for a non-MEMBER title
  const isSingleLocked = !isFreeChoice && compatiblePlugins.length === 1

  const handleSwitchPlugin = async (pluginName: string) => {
    if (!config.workingDirectory) return
    if (pluginName === config.rolePlugin?.name) return
    setSwitching(true)
    try {
      // Uninstall current
      if (config.rolePlugin) {
        const uninstallRes = await sudoFetch(
          '/api/agents/role-plugins/install',
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pluginName: config.rolePlugin.name, agentDir: config.workingDirectory }),
          },
          (reason) => requestSudoToken(reason),
        )
        if (!uninstallRes.ok) return
      }
      // Install new (rolePluginSwap bypasses the ChangePlugin guard for N:1 role-plugin swaps)
      const installRes = await fetch('/api/agents/role-plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginName, agentDir: config.workingDirectory, scope: 'local', rolePluginSwap: true }),
      })
      if (!installRes.ok) return
    } catch (err) {
      console.error('[RoleTab] Switch failed:', err)
      return
    } finally {
      setSwitching(false)
    }
    onRefresh?.()
  }

  /** Pull the latest version of the currently-installed role plugin from
   *  its marketplace. Reuses POST /api/agents/{id}/local-plugins with
   *  action='update' — the route hard-codes rolePluginSwap=true for
   *  update, which is what bypasses ChangePlugin's G02 role-plugin guard.
   *
   *  We deliberately NOT use sudoFetch here because the local-plugins
   *  endpoint is not currently classified strict (mirroring the existing
   *  enable/disable toggle path next to it). If that classification ever
   *  changes, swap to sudoFetch like the swap path does. */
  const handleUpdate = async () => {
    if (!agentId || !config.rolePlugin || updating) return
    const key = `${config.rolePlugin.name}@${config.rolePlugin.marketplace || ''}`
    setUpdating(true)
    try {
      const res = await fetch(`/api/agents/${encodeURIComponent(agentId)}/local-plugins`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, action: 'update' }),
      })
      if (!res.ok) {
        const err = await res.json().catch(() => ({ error: 'Update failed' }))
        console.error('[RoleTab] Update failed:', err.error)
        return
      }
    } catch (err) {
      console.error('[RoleTab] Update request failed:', err)
      return
    } finally {
      setUpdating(false)
    }
    onRefresh?.()
  }

  // Reusable inline Update icon button. Hidden when there's no agentId
  // to target or no role plugin currently installed (nothing to update).
  // Disabled while a swap is in flight to avoid races on the same
  // settings.local.json. The blue colorway matches MarketplaceManager's
  // per-plugin update button so users see the same visual signal in
  // both surfaces.
  const updateButton = agentId && config.rolePlugin ? (
    <button
      onClick={handleUpdate}
      disabled={updating || switching}
      className="p-1 rounded hover:bg-blue-500/20 transition-colors disabled:opacity-50"
      title="Update this role plugin to the latest version (refreshes from marketplace, queues a session restart)"
      aria-label="Update role plugin"
    >
      {updating
        ? <Loader2 className="w-3 h-3 text-blue-400 animate-spin" />
        : <RefreshCw className="w-3 h-3 text-gray-500 hover:text-blue-400" />}
    </button>
  ) : null

  // Role plugin display — N:1 model:
  // 1 compatible → locked label; 2+ → dropdown with Change; 0 → free choice
  const selectorEl = (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-1">
        <SectionLabel text="Role Plugin" />
        {/* SCEN-017 P1-PROP-003: surface a "required" badge so the user
            can see at a glance that the role-plugin is non-removable per
            R9.13 (every agent MUST have exactly one role-plugin — uninstall
            without a replacement is rejected by ChangePlugin Gate 7). The
            badge uses a different color than R17's "core" badge (R17 amber,
            R9.13 blue) to make clear the two rules are distinct: R17 protects
            ai-maestro-plugin specifically, R9.13 protects whichever plugin
            currently fills the role-plugin slot. */}
        {config.rolePlugin && (
          <span
            title="Role plugin — required for agent operation (R9.13)"
            className="text-[9px] text-blue-400/70 px-1.5 py-0.5 rounded border border-blue-400/30 bg-blue-400/5"
          >
            required
          </span>
        )}
      </div>
      {isSingleLocked ? (
        // Single compatible plugin: show fixed label with lock icon
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
          <Lock className="w-4 h-4 text-emerald-400 flex-shrink-0" />
          <span className="text-xs font-medium text-emerald-300 flex-1 truncate">
            {switching ? 'Switching…' : (config.rolePlugin?.name || compatiblePlugins[0]?.name || 'None')}
          </span>
          {updateButton}
          <p className="text-[9px] text-emerald-400/60 flex-shrink-0">
            Only option for {agentTitle?.toUpperCase()}
          </p>
        </div>
      ) : hasMultipleOptions ? (
        // Multiple compatible plugins: dropdown with Change button
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-blue-500/30 bg-blue-500/5">
          <ChevronDown className="w-4 h-4 text-blue-400 flex-shrink-0" />
          <span className="text-xs font-medium text-blue-300 flex-1 truncate">
            {switching ? 'Switching…' : (config.rolePlugin?.name || 'Select plugin')}
            {!switching && config.rolePlugin?.name && config.rolePlugin.marketplace === LOCAL_MARKETPLACE_NAME && (
              <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-blue-500/20 text-blue-400 font-medium">custom</span>
            )}
          </span>
          <span className="text-[9px] text-blue-400/60">{compatiblePlugins.length} options</span>
          {updateButton}
          <button
            onClick={() => setShowModal(true)}
            disabled={switching}
            className="text-[10px] px-2 py-0.5 rounded bg-blue-700 hover:bg-blue-600 text-blue-200 font-medium transition-colors disabled:opacity-50"
          >
            Change
          </button>
        </div>
      ) : (
        // Free choice (AUTONOMOUS/MEMBER or no compatible-titles constraint)
        <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-700/40 bg-gray-800/30">
          <Shield className={`w-4 h-4 flex-shrink-0 ${config.rolePlugin ? 'text-amber-400' : 'text-gray-600'}`} />
          <span className="text-xs font-medium text-gray-400 flex-1 truncate">
            {switching ? 'Switching…' : (config.rolePlugin?.name || (agentTitle === 'member' ? 'Default (Programmer)' : 'No Role Plugin'))}
            {!switching && config.rolePlugin?.name && config.rolePlugin.marketplace === LOCAL_MARKETPLACE_NAME && (
              <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">custom</span>
            )}
          </span>
          {updateButton}
          <button
            onClick={() => setShowModal(true)}
            disabled={switching}
            className="text-[10px] px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium transition-colors disabled:opacity-50"
          >
            Change
          </button>
        </div>
      )}

      {/* Metadata: compatible-titles and compatible-clients */}
      {config.rolePlugin && (
        <div className="mt-1 flex gap-2 flex-wrap">
          {config.rolePlugin.compatibleTitles && config.rolePlugin.compatibleTitles.length > 0 && (
            <span className="text-[8px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700/30">
              titles: {config.rolePlugin.compatibleTitles.join(', ')}
            </span>
          )}
          {config.rolePlugin.compatibleClients && config.rolePlugin.compatibleClients.length > 0 && (
            <span className="text-[8px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-500 border border-gray-700/30">
              clients: {config.rolePlugin.compatibleClients.join(', ')}
            </span>
          )}
        </div>
      )}
    </div>
  )

  return (
    <div className="space-y-4">
      {selectorEl}

      {/* Current Role Plugin details (if installed) */}
      {config.rolePlugin && (
        <div className="rounded-lg border border-amber-500/20 bg-amber-500/5 px-3 py-3">
          <div className="flex items-center gap-2 mb-1">
            <span className="text-[10px] text-gray-500">Main Agent:</span>
            <span className="text-[10px] text-gray-400">{config.rolePlugin.mainAgentName}</span>
            {onBrowse && config.rolePlugin?.profilePath && (
              <span
                className="ml-auto"
                title="Browse Role-Plugin contents"
                onClick={() => {
                  const dir = config.rolePlugin!.profilePath.replace(/\/[^/]+$/, '')
                  onBrowse(dir)
                }}
              >
                <FolderOpen className="w-3.5 h-3.5 text-amber-400/60 cursor-pointer hover:text-amber-300 transition-colors" />
              </span>
            )}
          </div>
          {config.rolePlugin.marketplace && (
            <div className="flex items-center gap-2">
              <span className="text-[10px] text-gray-500">Source:</span>
              <span className="text-[10px] text-gray-400">{config.rolePlugin.marketplace}</span>
              <ExternalLink className="w-2.5 h-2.5 text-gray-600" />
            </div>
          )}
        </div>
      )}

      {/* No plugin — show Haephestos create option */}
      {!config.rolePlugin && !isSingleLocked && (
        <div className="text-center py-4">
          <p className="text-[10px] text-gray-600 mb-4 px-4 leading-relaxed">
            A Role-Plugin defines the agent&apos;s specialization and bundles skills, hooks, and rules for that role.
          </p>
          {onEditInHaephestos && (
            <div
              onClick={() => onEditInHaephestos('')}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-amber-500/10 border border-amber-500/20 text-[11px] text-amber-400 font-medium cursor-pointer hover:bg-amber-500/20 transition-colors"
            >
              <Sparkles className="w-3 h-3" />
              Create new with Haephestos
            </div>
          )}
        </div>
      )}

      {/* Role Plugin selection modal */}
      {canChange && (
        <RolePluginModal
          isOpen={showModal}
          onClose={() => setShowModal(false)}
          currentPluginName={config.rolePlugin?.name}
          agentTitle={agentTitle || 'autonomous'}
          onSelectPlugin={async (pluginName) => {
            await handleSwitchPlugin(pluginName)
            setShowModal(false)
          }}
        />
      )}
    </div>
  )
}
