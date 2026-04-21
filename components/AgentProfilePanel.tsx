'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Shield,
  Puzzle,
  Sparkles,
  Users,
  Webhook,
  ScrollText,
  Terminal,
  Server,
  Palette,
  Store,
  Loader2,
  AlertCircle,
  FolderOpen,
  XCircle,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  Lock,
  MoreVertical,
  Trash2,
} from 'lucide-react'
import dynamic from 'next/dynamic'
import { useAgentLocalConfig } from '@/hooks/useAgentLocalConfig'
import { useRestartQueue } from '@/hooks/useRestartQueue'
import type { AgentLocalConfig } from '@/types/agent-local-config'
import { type TabId, type TabDef, type AgentInfo } from './agent-profile/shared'
import TabContent from './agent-profile/TabContent'
import FolderBrowser from './agent-profile/FolderBrowser'
import RolePluginModal from './agent-profile/RolePluginModal'
import { detectClientType, getClientCapabilities, isTabSupported, clientTypeLabel } from '@/lib/client-capabilities'
import { TITLE_PLUGIN_MAP as ECOSYSTEM_TITLE_MAP, ROLE_PLUGIN_PROGRAMMER } from '@/lib/ecosystem-constants'
import { sudoFetch } from '@/lib/sudo-fetch'
import { useSudo } from '@/contexts/SudoContext'

// Lazy-load AgentProfile — only mounted when Overview tab is active
const AgentProfile = dynamic(() => import('@/components/AgentProfile'), { ssr: false })
// Lazy-load SessionsTab — only mounted when Sessions tab is active (Phase 3, TRDD-d46b42e9)
const SessionsTab = dynamic(() => import('@/components/agent-profile/SessionsTab'), { ssr: false })

// ---------------------------------------------------------------------------
// Title → Role-Plugin map — derived from ecosystem-constants (lower-cased keys for UI matching).
// Used to show the locked plugin name for non-MEMBER titles.
// ---------------------------------------------------------------------------

const TITLE_PLUGIN_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(ECOSYSTEM_TITLE_MAP).map(([k, v]) => [k.toLowerCase(), v])
)

// ---------------------------------------------------------------------------
// Tab definitions
// ---------------------------------------------------------------------------

// Sections that are always expanded (no accordion toggle)
const NON_COLLAPSIBLE = new Set<TabId>(['role'])

const TABS: TabDef[] = [
  { id: 'role', label: 'Role', icon: Shield, colorClass: 'text-amber-400' },
  { id: 'skills', label: 'Skills', icon: Sparkles, colorClass: 'text-emerald-400', countKey: 'skills' },
  { id: 'agents', label: 'Agents', icon: Users, colorClass: 'text-cyan-400', countKey: 'agents' },
  { id: 'hooks', label: 'Hooks', icon: Webhook, colorClass: 'text-amber-400', countKey: 'hooks' },
  { id: 'rules', label: 'Rules', icon: ScrollText, colorClass: 'text-gray-400', countKey: 'rules' },
  { id: 'commands', label: 'Commands', icon: Terminal, colorClass: 'text-violet-400', countKey: 'commands' },
  { id: 'mcps', label: 'MCP Servers', icon: Server, colorClass: 'text-purple-400', countKey: 'mcpServers' },
  { id: 'outputStyles', label: 'Output Styles', icon: Palette, colorClass: 'text-pink-400', countKey: 'outputStyles' },
  { id: 'plugins', label: 'Plugins', icon: Puzzle, colorClass: 'text-blue-400', countKey: 'plugins' },
  { id: 'marketplaces', label: 'Marketplaces', icon: Store, colorClass: 'text-violet-400' },
]

// Accordion section order for Config tab (Plugins is always LAST)

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface AgentProfilePanelProps {
  agentId: string | null
  agentName?: string
  agentInfo?: AgentInfo
  onEditInHaephestos?: (profilePath: string) => void
  onClose?: () => void
  onAgentDataChanged?: () => void // Notify parent to refresh sidebar agent list
  // Props forwarded to embedded AgentProfile (Overview tab)
  sessionStatus?: import('@/types/agent').AgentSessionStatus
  onStartSession?: () => void
  onDeleteAgent?: (agentId: string) => Promise<void>
  scrollToDangerZone?: boolean
  hostUrl?: string
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

type TopTab = 'overview' | 'config' | 'sessions' | 'advanced'

export default function AgentProfilePanel({
  agentId,
  agentName,
  agentInfo,
  onEditInHaephestos,
  onClose,
  onAgentDataChanged,
  sessionStatus,
  onStartSession,
  onDeleteAgent,
  scrollToDangerZone,
  hostUrl,
}: AgentProfilePanelProps) {
  const { requestSudoToken } = useSudo()
  const { config, error, loading, refetch: rawRefetch } = useAgentLocalConfig(agentId)
  const onAgentDataChangedRef = useRef(onAgentDataChanged)
  onAgentDataChangedRef.current = onAgentDataChanged
  // Wrap refetch: await config reload FIRST, then sidebar refresh
  const refetch = useCallback(async () => {
    await rawRefetch() // Wait for config to fully reload
    onAgentDataChangedRef.current?.() // Sidebar refresh last
  }, [rawRefetch])
  const [topTab, setTopTab] = useState<TopTab>('overview')
  // Phase 3 (TRDD-d46b42e9) — session count shown as a badge on the Sessions
  // tab. Fetches the Phase 2 list route once per agent. null until the first
  // response arrives.
  const [sessionCount, setSessionCount] = useState<number | null>(null)
  useEffect(() => {
    if (!agentId) {
      setSessionCount(null)
      return
    }
    const ctrl = new AbortController()
    fetch(`/api/sessions-browser/agents/${encodeURIComponent(agentId)}/sessions`, {
      method: 'GET',
      credentials: 'include',
      signal: ctrl.signal,
    })
      .then(async res => {
        if (!res.ok) return null
        const body = await res.json() as { sessions?: unknown[] }
        return Array.isArray(body.sessions) ? body.sessions.length : 0
      })
      .then(count => {
        if (!ctrl.signal.aborted && typeof count === 'number') setSessionCount(count)
      })
      .catch(() => { /* ignore — badge stays null */ })
    return () => ctrl.abort()
  }, [agentId])
  const [activeTab, setActiveTab] = useState<TabId>('role')
  const [browsePath, setBrowsePath] = useState<string | null>(null)
  const sectionRefs = useRef<Map<string, HTMLDivElement>>(new Map())
  // Proposal 13 (2026-04-20): header "Agent Actions" dropdown. Consolidates
  // the Delete-Agent shortcut so the user doesn't have to switch to
  // Advanced → scroll → Danger Zone on every destructive operation.
  // The dropdown does NOT bypass the confirmation dialog or the sudo-mode
  // token — it just navigates there in one click.
  const [actionsOpen, setActionsOpen] = useState(false)
  const [actionsScrollSignal, setActionsScrollSignal] = useState(0)
  const actionsMenuRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!actionsOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (actionsMenuRef.current && !actionsMenuRef.current.contains(e.target as Node)) {
        setActionsOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [actionsOpen])

  // Role Plugin modal state
  const [showRolePluginModal, setShowRolePluginModal] = useState(false)
  const [switchingPlugin, setSwitchingPlugin] = useState(false)

  // Auto-continue state
  const [autoContinue, setAutoContinue] = useState(false)
  const [autoContinueLoading, setAutoContinueLoading] = useState(false)

  // Restart queue: deferred restart after element changes (plugin install/uninstall/switch)
  const { queueRestart, pendingCount, pendingSessions } = useRestartQueue()

  // Client capability detection — filter config tabs based on AI client type
  const clientType = detectClientType(agentInfo?.program || '')
  const capabilities = getClientCapabilities(agentInfo?.program || '')
  const visibleTabs = TABS.filter(tab => isTabSupported(tab.id, capabilities))

  // Cross-section navigation: expand section + scroll to it
  const handleSwitchSection = useCallback((tab: TabId) => {
    setActiveTab(tab)
    // Scroll to the section header after React renders the expanded content
    requestAnimationFrame(() => {
      const el = sectionRefs.current.get(tab)
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'start' })
    })
  }, [])

  // Reset browse mode when agent changes
  useEffect(() => { setBrowsePath(null); setShowRolePluginModal(false) }, [agentId])

  // Fetch agent's autoContinue preference
  useEffect(() => {
    if (!agentId) return
    fetch(`/api/agents/${agentId}`)
      .then(r => r.json())
      .then(data => { setAutoContinue(!!data.agent?.preferences?.autoContinue) })
      .catch(() => {})
  }, [agentId])

  // Toggle autoContinue via PATCH
  // SCEN-016 BUG-001: PATCH /api/agents/[id] is a strict route → sudoFetch.
  const toggleAutoContinue = useCallback(async () => {
    if (!agentId || autoContinueLoading) return
    setAutoContinueLoading(true)
    try {
      const newValue = !autoContinue
      const res = await sudoFetch(`/api/agents/${agentId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ preferences: { autoContinue: newValue } })
      }, requestSudoToken)
      if (res.ok) {
        setAutoContinue(newValue)
        onAgentDataChangedRef.current?.()
      }
    } catch (err) {
      console.error('[AgentProfilePanel] Failed to toggle autoContinue:', err)
    } finally {
      setAutoContinueLoading(false)
    }
  }, [agentId, autoContinue, autoContinueLoading, requestSudoToken])

  // Switch role plugin: uninstall old → install new → restart agent session
  const handleSwitchPlugin = useCallback(async (newPluginName: string) => {
    if (!config?.workingDirectory || !agentId || switchingPlugin) return
    const currentPlugin = config.rolePlugin?.name
    if (currentPlugin === newPluginName) return

    // Client-side title lock guard: only MEMBER and AUTONOMOUS can freely switch role-plugins
    const agentTitle = agentInfo?.title
    if (agentTitle && agentTitle !== 'member' && agentTitle !== 'autonomous') {
      return // Title-locked — the server enforces this too via autoAssignRolePluginForTitle
    }

    setSwitchingPlugin(true)
    try {
      const agentDir = config.workingDirectory

      // 1. Uninstall old plugin if one exists
      if (currentPlugin) {
        await sudoFetch(
          '/api/agents/role-plugins/install',
          {
            method: 'DELETE',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ pluginName: currentPlugin, agentDir }),
          },
          (reason) => requestSudoToken(reason),
        )
      }

      // 2. Install new plugin (explicit scope: 'local' for defense-in-depth)
      const installRes = await fetch('/api/agents/role-plugins/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pluginName: newPluginName, agentDir, scope: 'local' }),
      })
      if (!installRes.ok) {
        const err = await installRes.json().catch(() => ({ error: 'Install failed' }))
        throw new Error(err.error || 'Failed to install role plugin')
      }

      // 3. Update agent registry with new programArgs
      const mainAgentName = `${newPluginName}-main-agent`
      const sessionName = sessionStatus?.tmuxSessionName
      const effectiveAgentName = agentName || agentId
      const newArgs = `--agent ${mainAgentName} --name ${effectiveAgentName}`
      // SCEN-016 BUG-001: PATCH /api/agents/[id] is a strict route → sudoFetch.
      const registryRes = await sudoFetch(`/api/agents/${encodeURIComponent(agentId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ programArgs: newArgs }),
      }, requestSudoToken)
      if (!registryRes.ok) {
        const err = await registryRes.json().catch(() => ({ error: 'Registry update failed' }))
        throw new Error(err.error || 'Failed to update agent registry')
      }

      // 4. Queue deferred restart — fires automatically when agent reaches idle_prompt safe state
      if (sessionName) {
        const program = agentInfo?.program || 'claude'
        queueRestart(sessionName, program, newArgs)
      }
      // Notify parent and refresh config — role plugin change should update sidebar + panel
      await refetch()
    } catch (err) {
      console.error('[RolePluginSelector] Switch failed:', err)
    } finally {
      setSwitchingPlugin(false)
    }
  }, [config, agentId, agentName, switchingPlugin, sessionStatus, queueRestart, agentInfo, refetch, requestSudoToken])

  // Callback for child components (RoleTab, PluginsTab) to enqueue restart after element changes
  const handleElementChanged = useCallback(async () => {
    await refetch() // Reload config first
    // Enqueue restart if agent has an active session
    const sessionName = sessionStatus?.tmuxSessionName
    if (sessionName) {
      const program = agentInfo?.program || 'claude'
      const args = agentInfo?.programArgs || ''
      queueRestart(sessionName, program, args)
    }
  }, [refetch, sessionStatus, agentInfo, queueRestart])

  if (!agentId) {
    return (
      <div className="flex w-[420px] flex-shrink-0 items-center justify-center bg-gray-900 border-l border-gray-800" style={{ overscrollBehavior: 'contain' }}>
        <p className="text-sm text-gray-600 italic">Select an agent to inspect</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col w-[420px] flex-shrink-0 bg-gray-900 border-l border-gray-800 overflow-hidden" style={{ overscrollBehavior: 'contain' }}>
      {/* Header */}
      <div className="flex items-center gap-2.5 px-4 py-2.5 border-b border-gray-800">
        <div className="flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-gray-200 truncate">
            {agentName || 'Profile'}
          </h2>
        </div>
        {/* Proposal 13 (2026-04-20): Agent Actions dropdown. Shortcut to
            Advanced → Danger Zone so users don't have to hunt through the
            tab nav every time they want to delete an agent. Does NOT skip
            the DeleteAgentDialog confirmation or the sudo-mode token
            requirement — it just opens the Advanced tab and auto-scrolls
            to the Danger Zone block. */}
        {onDeleteAgent && (
          <div className="relative flex-shrink-0" ref={actionsMenuRef}>
            <button
              type="button"
              onClick={() => setActionsOpen(v => !v)}
              className="p-1 rounded-md cursor-pointer hover:bg-gray-700/60 transition-colors"
              title="Agent actions"
              aria-label="Open agent actions menu"
              aria-haspopup="menu"
              aria-expanded={actionsOpen}
            >
              <MoreVertical className="w-4 h-4 text-gray-500 hover:text-gray-300" />
            </button>
            {actionsOpen && (
              <div
                role="menu"
                className="absolute right-0 top-full mt-1 w-52 rounded-md border border-gray-700 bg-gray-900 shadow-xl z-20"
              >
                <button
                  role="menuitem"
                  type="button"
                  onClick={() => {
                    setActionsOpen(false)
                    setTopTab('advanced')
                    // Bump the signal so the Advanced tab scrolls to
                    // Danger Zone even if the parent prop didn't change.
                    setActionsScrollSignal(s => s + 1)
                  }}
                  className="w-full flex items-center gap-2 px-3 py-2 text-xs text-red-300 hover:bg-red-900/30 hover:text-red-200 rounded-md text-left"
                >
                  <Trash2 className="w-3.5 h-3.5" />
                  Delete Agent…
                </button>
              </div>
            )}
          </div>
        )}
        {onClose && (
          <div
            onClick={onClose}
            className="p-1 rounded-md cursor-pointer hover:bg-gray-700/60 transition-colors flex-shrink-0"
            title="Close profile panel"
          >
            <XCircle className="w-4 h-4 text-gray-500 hover:text-gray-300" />
          </div>
        )}
      </div>

      {/* Top-level tabs */}
      <div className="flex border-b border-gray-800">
        {([['overview', 'Overview'], ['config', 'Config'], ['sessions', 'Sessions'], ['advanced', 'Advanced']] as [TopTab, string][]).map(([t, label]) => (
          <div
            key={t}
            onClick={() => setTopTab(t)}
            className={`flex-1 text-center py-2 text-xs font-medium cursor-pointer transition-colors ${
              topTab === t
                ? 'text-gray-200 border-b-2 border-emerald-400'
                : 'text-gray-500 hover:text-gray-300'
            }`}
          >
            {label}
            {t === 'sessions' && sessionCount !== null && sessionCount > 0 && (
              <span className="ml-1 text-[9px] font-normal text-gray-500 tabular-nums">
                ({sessionCount})
              </span>
            )}
          </div>
        ))}
      </div>

      {/* Overview tab — Agent Profile + Role Plugin selector */}
      {topTab === 'overview' && (
        <div className="flex-1 overflow-y-auto" style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}>
          {/* Role Plugin display — locked for title-locked agents, changeable for MEMBER/AUTONOMOUS */}
          <div className="px-4 pt-3 pb-2">
            {agentInfo?.title && agentInfo.title !== 'member' && agentInfo.title !== 'autonomous' ? (
              // Title-locked (e.g. manager, chief-of-staff): static locked display
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-emerald-500/30 bg-emerald-500/5">
                <Shield className="w-4 h-4 text-emerald-400 flex-shrink-0" />
                <span className="text-xs font-medium text-emerald-300 flex-1 truncate">
                  {switchingPlugin ? 'Switching…' : (TITLE_PLUGIN_MAP[agentInfo.title] || config?.rolePlugin?.name || 'No Role Plugin')}
                </span>
                <Lock className="w-3 h-3 text-emerald-500/50 flex-shrink-0" />
              </div>
            ) : (
              // MEMBER or AUTONOMOUS (or no title): shows current plugin + "Change" button
              <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-gray-700/40 bg-gray-800/30">
                <Shield className="w-4 h-4 text-gray-500 flex-shrink-0" />
                <span className="text-xs font-medium text-gray-400 flex-1 truncate">
                  {switchingPlugin
                    ? 'Switching…'
                    : (config?.rolePlugin?.name ||
                        (agentInfo?.title?.toLowerCase() === 'autonomous' ? 'No Role Plugin' : 'Default (Programmer)'))
                  }
                  {!switchingPlugin && config?.rolePlugin?.name && config.rolePlugin.name !== ROLE_PLUGIN_PROGRAMMER && (
                    <span className="ml-1.5 text-[9px] px-1.5 py-0.5 rounded bg-amber-500/20 text-amber-400 font-medium">custom</span>
                  )}
                </span>
                <button
                  onClick={() => setShowRolePluginModal(true)}
                  disabled={switchingPlugin}
                  className="text-[10px] px-2 py-0.5 rounded bg-gray-700 hover:bg-gray-600 text-gray-300 font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  Change
                </button>
              </div>
            )}
          </div>

          {/* Embedded AgentProfile — overview sections only (no elements, no metrics/danger) */}
          <AgentProfile
            isOpen={true}
            onClose={() => {}}
            embedded={true}
            renderMode="overview"
            agentId={agentId}
            sessionStatus={sessionStatus}
            onStartSession={onStartSession}
            onDeleteAgent={onDeleteAgent}
            hostUrl={hostUrl}
            onDataChanged={refetch}
          />
        </div>
      )}

      {/* Config tab — .claude/ inspector */}
      {topTab === 'config' && (
        <>
          {/* Config sub-header */}
          <div className="flex items-center gap-2 px-4 py-2 border-b border-gray-800/50">
            <FolderOpen className="w-3.5 h-3.5 text-blue-400" />
            <p className="text-[10px] text-gray-500 truncate flex-1">
              {config?.workingDirectory || 'Live .claude/ configuration'}
            </p>
            {/* Client type badge — shows which AI client this agent uses */}
            {clientType !== 'unknown' && (
              <span className="text-[9px] px-1.5 py-0.5 rounded-full bg-blue-500/15 text-blue-300 flex-shrink-0">
                {clientTypeLabel(clientType)}
              </span>
            )}
            {loading && <Loader2 className="w-3 h-3 text-gray-500 animate-spin flex-shrink-0" />}
            {config?.workingDirectory && (
              <div
                onClick={() => setBrowsePath(`${config.workingDirectory}/.claude`)}
                className="p-1 rounded-md cursor-pointer hover:bg-gray-700/60 transition-colors flex-shrink-0"
                title="Browse .claude/ folder"
              >
                <FolderOpen className="w-3.5 h-3.5 text-gray-500 hover:text-amber-400" />
              </div>
            )}
          </div>

          {/* Error banner */}
          {error && (
            <div className="flex items-center gap-2 px-4 py-2 bg-red-500/10 border-b border-red-500/20">
              <AlertCircle className="w-3.5 h-3.5 text-red-400 flex-shrink-0" />
              <span className="text-[11px] text-red-400 truncate">{error}</span>
            </div>
          )}

          {/* TRDD-c7a81642 (R9.13 extension, 2026-04-20): roleMissing banner.
              Agents in this state are hibernated and /wake refuses them until
              a compatible role-plugin is assigned. The Assign button reuses
              the existing RolePluginModal which already filters options by
              (governanceTitle, client). After a successful install, the
              ChangePlugin pipeline clears roleMissing via the usual PG04
              flow (compatibleSurvived branch), and the banner disappears on
              the next refetch. */}
          {agentInfo?.roleMissing && (
            <div className="flex items-start gap-2 px-4 py-3 bg-amber-500/10 border-b border-amber-500/30">
              <AlertCircle className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1 min-w-0">
                <p className="text-xs font-semibold text-amber-200">This agent has no role-plugin installed.</p>
                <p className="text-[10px] text-amber-300/80 mt-0.5">
                  Wake is disabled until you assign one. Pick a role-plugin
                  compatible with the agent&rsquo;s title and client below.
                </p>
                <button
                  type="button"
                  onClick={() => setShowRolePluginModal(true)}
                  className="mt-2 px-2.5 py-1 text-[11px] font-medium rounded bg-amber-600 hover:bg-amber-500 text-white"
                >
                  Assign role-plugin…
                </button>
              </div>
            </div>
          )}

          {/* Folder browser mode — replaces tab grid + tab content */}
          {browsePath && (
            <FolderBrowser
              key={browsePath}
              initialPath={browsePath}
              onBack={() => setBrowsePath(null)}
            />
          )}

          {/* Collapsible accordion sections — hidden when browsing */}
          {!browsePath && (
            <div className="flex-1 overflow-y-auto" style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}>

              {/* Auto-Continue toggle — at top of Config tab */}
              {config && (
                <div className="flex items-center justify-between px-4 py-2.5 border-b border-gray-800/30 bg-gray-900/40">
                  <div className="flex items-center gap-2 min-w-0">
                    <RefreshCw className={`w-3.5 h-3.5 flex-shrink-0 ${autoContinue ? 'text-emerald-400' : 'text-gray-600'}`} />
                    <div className="min-w-0">
                      <span className="text-[11px] font-medium text-gray-300">Auto-Continue</span>
                      <p className="text-[9px] text-gray-600 leading-tight">
                        Keep-alive: Esc + &quot;continue&quot; every 4 min idle.
                        {!(agentInfo?.programArgs || '').includes('--dangerously-skip-permissions') && (
                          <span className="text-amber-500"> Requires --dangerously-skip-permissions</span>
                        )}
                      </p>
                    </div>
                  </div>
                  <button
                    onClick={toggleAutoContinue}
                    disabled={autoContinueLoading}
                    className={`relative w-8 h-4 rounded-full transition-colors flex-shrink-0 ${
                      autoContinue ? 'bg-emerald-500' : 'bg-gray-700'
                    } ${autoContinueLoading ? 'opacity-50' : ''}`}
                  >
                    <span className={`absolute top-0.5 left-0.5 w-3 h-3 rounded-full bg-white transition-transform ${
                      autoContinue ? 'translate-x-4' : 'translate-x-0'
                    }`} />
                  </button>
                </div>
              )}

              {/* Restart queue indicator */}
              {pendingCount > 0 && (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg border border-amber-500/30 bg-amber-500/5">
                  <Loader2 className="w-3.5 h-3.5 text-amber-400 animate-spin" />
                  <span className="text-[10px] text-amber-300">
                    {pendingCount} agent{pendingCount > 1 ? 's' : ''} waiting to restart…
                  </span>
                </div>
              )}

              {!config && !error && (
                <div className="flex items-center justify-center h-32">
                  <Loader2 className="w-5 h-5 text-gray-600 animate-spin" />
                </div>
              )}
              {config && visibleTabs.map(tab => {
                const Icon = tab.icon
                const pinned = NON_COLLAPSIBLE.has(tab.id)
                const isActive = pinned || activeTab === tab.id
                const count = tab.countKey
                  ? (config[tab.countKey] as unknown[])?.length ?? 0
                  : null

                return (
                  <div key={tab.id} ref={(el) => { if (el) sectionRefs.current.set(tab.id, el) }}>
                    {/* Section header — non-collapsible sections have no toggle */}
                    <div
                      onClick={pinned ? undefined : () => setActiveTab(isActive ? (null as unknown as TabId) : tab.id)}
                      className={`flex items-center gap-2 px-4 py-2 border-b border-gray-800/30 transition-colors ${
                        pinned ? 'bg-amber-500/10' : isActive ? 'bg-amber-500/10 cursor-pointer' : 'hover:bg-gray-800/30 cursor-pointer'
                      }`}
                    >
                      {!pinned && (isActive
                        ? <ChevronDown className="w-3.5 h-3.5 text-amber-400 flex-shrink-0" />
                        : <ChevronRight className="w-3.5 h-3.5 text-gray-500 flex-shrink-0" />
                      )}
                      <Icon className={`w-3.5 h-3.5 flex-shrink-0 ${isActive ? tab.colorClass : 'text-gray-600'}`} />
                      <span className={`text-[11px] font-medium flex-1 ${isActive ? 'text-gray-200' : 'text-gray-500'}`}>
                        {tab.label}
                      </span>
                      {count !== null && (
                        <span className={`text-[9px] px-1.5 py-0.5 rounded-full ${
                          isActive ? 'bg-amber-500/20 text-amber-300' : 'bg-gray-800/60 text-gray-600'
                        }`}>
                          {count}
                        </span>
                      )}
                    </div>
                    {/* Section content */}
                    {isActive && (
                      <div className="px-4 py-3 border-b border-gray-800/30">
                        <TabContent tab={tab.id} config={config} agentId={agentId} agentInfo={agentInfo} onEditInHaephestos={onEditInHaephestos} onBrowse={setBrowsePath} onRefresh={handleElementChanged} onSwitchTab={handleSwitchSection} />
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </>
      )}

      {/* Sessions tab — JSONL transcript browser (TRDD-d46b42e9 Phase 3) */}
      {topTab === 'sessions' && (
        <div className="flex-1 min-h-0 flex" style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}>
          <SessionsTab agentId={agentId} />
        </div>
      )}

      {/* Advanced tab — Metrics, Documentation, Danger Zone */}
      {topTab === 'advanced' && (
        <div className="flex-1 overflow-y-auto" style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}>
          <AgentProfile
            isOpen={true}
            onClose={() => {}}
            embedded={true}
            renderMode="advanced"
            agentId={agentId}
            sessionStatus={sessionStatus}
            onStartSession={onStartSession}
            onDeleteAgent={onDeleteAgent}
            // Proposal 13: parent's scrollToDangerZone OR the local signal
            // from the Agent Actions dropdown both trigger the auto-scroll.
            scrollToDangerZone={scrollToDangerZone || actionsScrollSignal > 0}
            hostUrl={hostUrl}
            onDataChanged={refetch}
          />
        </div>
      )}

      {/* Role Plugin modal — accessible for MEMBER and AUTONOMOUS agents */}
      <RolePluginModal
        isOpen={showRolePluginModal}
        onClose={() => setShowRolePluginModal(false)}
        currentPluginName={config?.rolePlugin?.name}
        agentTitle={agentInfo?.title || 'member'}
        onSelectPlugin={async (pluginName) => {
          await handleSwitchPlugin(pluginName)
          setShowRolePluginModal(false)
        }}
      />
    </div>
  )
}
