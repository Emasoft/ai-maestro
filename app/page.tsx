'use client'

import { useState, useEffect, useMemo, useRef } from 'react'
import dynamic from 'next/dynamic'
import AgentList from '@/components/AgentList'
import { HUMAN_SELF_ID } from '@/components/sidebar/HumanUserCard'
import HumanUserPanel from '@/components/HumanUserPanel'
import HaephestosEmbeddedView from '@/components/HaephestosEmbeddedView'
import TerminalView from '@/components/TerminalView'
import ChatView from '@/components/ChatView'
import MessageCenter from '@/components/MessageCenter'
import ErrorBoundary from '@/components/ErrorBoundary'
import WorkTree from '@/components/WorkTree'
import Header from '@/components/Header'
import MobileDashboard from '@/components/MobileDashboard'
import { useDeviceType } from '@/hooks/useDeviceType'
import { AgentSubconsciousIndicator } from '@/components/AgentSubconsciousIndicator'
import MigrationBanner from '@/components/MigrationBanner'
import { VersionChecker } from '@/components/VersionChecker'
import AgentSearch from '@/components/AgentSearch'
import TranscriptExport from '@/components/TranscriptExport'
import { useAgents } from '@/hooks/useAgents'
import { TerminalProvider } from '@/contexts/TerminalContext'
import { useHelpPanel } from '@/contexts/HelpPanelContext'
import { Terminal, Mail, User, GitBranch, MessageSquare, Moon, Power, Loader2, Plus, Search, Download, ExternalLink, History } from 'lucide-react'
import { agentToSession } from '@/lib/agent-utils'
import { resolveAvatarUrl } from '@/lib/avatar-url'
import type { Agent, AgentRole } from '@/types/agent'

// Dynamic imports for heavy components that are conditionally rendered
// This reduces initial bundle size by ~100KB+

// Only shown for first-time users
const OnboardingFlow = dynamic(
  () => import('@/components/onboarding/OnboardingFlow'),
  { ssr: false }
)

// Only shown when organization not set
const OrganizationSetup = dynamic(
  () => import('@/components/OrganizationSetup'),
  { ssr: false }
)

// Help Panel is owned by HelpPanelProvider (see contexts/HelpPanelContext.tsx):
// the provider is mounted once in app/layout.tsx and renders the panel itself,
// so page.tsx only needs `useHelpPanel()` to open it.

// Only shown when import button is clicked
const ImportAgentDialog = dynamic(
  () => import('@/components/ImportAgentDialog'),
  { ssr: false }
)

// Right panel — Profile (Overview + Config tabs)
const AgentProfilePanel = dynamic(
  () => import('@/components/AgentProfilePanel'),
  { ssr: false }
)

// JSONL chat-transcript browser — peer of Terminal/Chat/Messages.
// Was previously a sub-tab of the Profile panel; surfaced as a top-level
// tab so the transcripts sit next to the live conversation surfaces.
const SessionsTab = dynamic(
  () => import('@/components/agent-profile/SessionsTab'),
  { ssr: false }
)

// Only shown when waking an agent
const WakeAgentDialog = dynamic(
  () => import('@/components/WakeAgentDialog'),
  { ssr: false }
)

export default function DashboardPage() {
  // Agent-centric: Primary hook is useAgents
  const { agents, unregisteredSessions, stats: agentStats, loading: agentsLoading, error: agentsError, refreshAgents, onlineAgents, hostErrors } = useAgents()

  // PRIMARY STATE: Agent ID (no longer session-driven)
  const [activeAgentId, setActiveAgentId] = useState<string | null>(null)
  // Track whether we've already processed the ?agent=haephestos query param
  const haephestosQueryHandled = useRef(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const resizeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === 'undefined') return 320
    const saved = localStorage.getItem('sidebar-width')
    return saved ? parseInt(saved, 10) : 320
  })
  const [isResizing, setIsResizing] = useState(false)
  const { deviceType } = useDeviceType()
  const isMobile = deviceType === 'phone'
  const [activeTab, setActiveTab] = useState<'terminal' | 'chat' | 'sessions' | 'messages' | 'worktree' | 'search' | 'export'>('terminal')
  const [unreadCount, setUnreadCount] = useState(0)
  // profileScrollToDangerZone — forwarded to AgentProfilePanel → AgentProfile (embedded)
  const [profileScrollToDangerZone, setProfileScrollToDangerZone] = useState(false)
  const [showOnboarding, setShowOnboarding] = useState(false)
  const [showOrganizationSetup, setShowOrganizationSetup] = useState(false)
  const [organizationChecked, setOrganizationChecked] = useState(false)
  const [showImportDialog, setShowImportDialog] = useState(false)
  // Help panel state lives in HelpPanelContext (mounted in app/layout.tsx).
  // We only need `open` here to wire up the header button.
  const { open: openHelp } = useHelpPanel()
  const [subconsciousRefreshTrigger, setSubconsciousRefreshTrigger] = useState(0)
  const [showProfilePanel, setShowProfilePanel] = useState(() => {
    if (typeof window === 'undefined') return false
    return localStorage.getItem('aimaestro-profile-panel') === 'true'
  })

  // Derive active agent from state
  const activeAgent = agents.find(a => a.id === activeAgentId) || null

  // Compute selectable agents: ALL registered agents (online, hibernated, or offline)
  // Profile panel reads from the API/registry and works regardless of session status
  const selectableAgents = useMemo(
    () => agents,
    [agents]
  )

  // Auto-hibernate Haephestos on browser/tab close — prevents zombie sessions
  useEffect(() => {
    const killHaephestos = () => {
      // Only kill if haephestos is the currently active agent (= user was using it)
      const haephestos = agents.find(a => a.name === '_aim-creation-helper')
      if (haephestos?.session?.status === 'online') {
        navigator.sendBeacon('/api/agents/creation-helper/kill')
      }
    }
    window.addEventListener('beforeunload', killHaephestos)
    return () => window.removeEventListener('beforeunload', killHaephestos)
  }, [agents])

  // Check for organization and onboarding completion on mount
  // Auto-detects GitHub identity via gh CLI if organization is not set (skips onboarding wizard)
  // UI2-MAJ-17: AbortController + cancelled-flag prevents the chain of two
  // fetches from calling setShowOrganizationSetup/setOrganizationChecked on
  // an unmounted component if the user navigates away during the round-trips.
  useEffect(() => {
    const controller = new AbortController()
    let cancelled = false

    const checkOrganization = async () => {
      try {
        const response = await fetch('/api/organization', { signal: controller.signal })
        if (cancelled) return
        const data = await response.json()
        if (cancelled) return

        if (!data.isSet) {
          // Auto-detect GitHub identity from gh CLI — skip manual organization setup
          try {
            const ghRes = await fetch('/api/github/auth', { signal: controller.signal })
            if (cancelled) return
            if (ghRes.ok) {
              const ghData = await ghRes.json()
              if (cancelled) return
              const activeUser = ghData.accounts?.find((a: { active: boolean }) => a.active)
              if (activeUser?.username) {
                // Auto-set organization from GitHub username
                await fetch('/api/organization', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ name: activeUser.username }),
                  signal: controller.signal,
                })
                if (cancelled) return
                // Auto-complete onboarding since gh identity is the only required thing
                localStorage.setItem('aimaestro-onboarding-completed', 'true')
                // Skip both organization setup and onboarding wizard
                setOrganizationChecked(true)
                return
              }
            }
          } catch (e) {
            if ((e as Error).name === 'AbortError') return
            // gh auto-detect failed — fall through to manual setup
          }
          if (cancelled) return
          // No gh identity found — show organization setup
          setShowOrganizationSetup(true)
        } else {
          // Organization is set, check onboarding
          const onboardingCompleted = localStorage.getItem('aimaestro-onboarding-completed')
          if (!onboardingCompleted) {
            // Auto-complete onboarding — the wizard is optional, gh identity is enough
            localStorage.setItem('aimaestro-onboarding-completed', 'true')
          }
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
        console.error('Failed to check organization:', error)
        // UI2-MIN-06: a transient network failure during the very first visit
        // SHOULD NOT permanently mark onboarding as completed. Previously this
        // unconditionally set the flag in localStorage, which meant a single
        // network blip on first launch silently disabled the onboarding flow
        // for the user forever (until they cleared site data). Now we only
        // set the flag if it was already set (no-op confirmation) — first-
        // visit users will retry the check on next page load. The trade-off:
        // a definitive "no org" answer never lands here (it lands in the
        // success branch above where the flag IS set), so the flag still
        // reaches `true` for legitimate skip-onboarding cases.
        const existingFlag = localStorage.getItem('aimaestro-onboarding-completed')
        if (existingFlag) {
          // Re-affirm the existing flag so other code paths that depend on
          // it being explicitly set continue to see the same value.
          localStorage.setItem('aimaestro-onboarding-completed', existingFlag)
        }
        // First-visit users WILL see the wizard on the next mount when the
        // network has recovered.
      } finally {
        if (cancelled) return
        setOrganizationChecked(true)
      }
    }

    checkOrganization()
    return () => {
      cancelled = true
      controller.abort()
    }
  }, [])

  // Read agent from URL parameter ONCE on mount, then strip from URL.
  // The ?agent= param is only used for deep-linking (e.g., from immersive → dashboard).
  // After reading, we remove it so it doesn't interfere with future navigation.
  const urlParamProcessedRef = useRef(false)

  useEffect(() => {
    if (urlParamProcessedRef.current) return

    const params = new URLSearchParams(window.location.search)
    const agentParam = params.get('agent')
    const sessionParam = params.get('session')
    const humanParam = params.get('human')

    if (humanParam === 'self') {
      setActiveAgentId(HUMAN_SELF_ID)
      window.history.replaceState({}, '', window.location.pathname)
      urlParamProcessedRef.current = true
      return
    }

    if (agentParam) {
      // Proposal 18 (2026-04-20): "haephestos" is a sentinel, not a real id.
      // The dedicated Haephestos useEffect below resolves it to the real
      // agent id (a.name === '_aim-creation-helper') and strips the URL
      // only after a successful resolution. If we strip here, a race with
      // the async agents fetch leaves activeAgentId="haephestos" forever
      // (no agent.id matches) and the purple card click appears to do
      // nothing.
      if (agentParam === 'haephestos') {
        urlParamProcessedRef.current = true
        return
      }
      setActiveAgentId(decodeURIComponent(agentParam))
      window.history.replaceState({}, '', window.location.pathname)
      urlParamProcessedRef.current = true
    } else if (sessionParam) {
      // Legacy ?session= param - needs agents loaded to resolve
      if (agents.length > 0) {
        const agent = agents.find(a => a.session?.tmuxSessionName === decodeURIComponent(sessionParam))
        if (agent) {
          setActiveAgentId(agent.id)
        }
        window.history.replaceState({}, '', window.location.pathname)
        urlParamProcessedRef.current = true
      } else {
        // Agents not loaded yet — strip param immediately to prevent stale URL (#57)
        // Set raw value; it will resolve when agents load via other effects
        setActiveAgentId(decodeURIComponent(sessionParam))
        window.history.replaceState({}, '', window.location.pathname)
        urlParamProcessedRef.current = true
      }
    } else {
      // No URL params — nothing to do
      urlParamProcessedRef.current = true
    }
  }, [agents])

  // Collapse sidebar on phone/tablet
  useEffect(() => {
    if (deviceType !== 'desktop') {
      setSidebarCollapsed(true)
    }
  }, [deviceType])

  // Clean up sidebar toggle resize timeout on unmount
  useEffect(() => {
    return () => {
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current)
    }
  }, [])

  // Keyboard shortcuts for Phase 5 features
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Only handle shortcuts when not in input fields
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
        return
      }

      // Ctrl/Cmd + E - Export (reserved for future use)
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [activeAgentId])

  // Sidebar resize handler
  useEffect(() => {
    const handleMouseMove = (e: MouseEvent) => {
      if (!isResizing) return
      const minWidth = 320
      const maxWidth = Math.floor(window.innerWidth / 2)
      const newWidth = Math.min(Math.max(e.clientX, minWidth), maxWidth)
      setSidebarWidth(newWidth)
    }

    const handleMouseUp = () => {
      if (isResizing) {
        setIsResizing(false)
        localStorage.setItem('sidebar-width', sidebarWidth.toString())
      }
    }

    if (isResizing) {
      document.addEventListener('mousemove', handleMouseMove)
      document.addEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = 'col-resize'
      document.body.style.userSelect = 'none'
    }

    return () => {
      document.removeEventListener('mousemove', handleMouseMove)
      document.removeEventListener('mouseup', handleMouseUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
    }
  }, [isResizing, sidebarWidth])

  // Auto-select first online agent when agents load
  // Optimized: use derived primitives instead of full array dependency
  const firstOnlineAgentId = onlineAgents[0]?.id
  const hasOnlineAgents = onlineAgents.length > 0

  useEffect(() => {
    if (hasOnlineAgents && !activeAgentId && firstOnlineAgentId) {
      setActiveAgentId(firstOnlineAgentId)
    }
  }, [hasOnlineAgents, activeAgentId, firstOnlineAgentId])

  // Handle ?agent=haephestos query param (redirected from /agent-creation)
  // If the Haephestos agent does not yet exist in the registry, register it
  // first via /api/agents/creation-helper/session (BUG-001 SCEN-004 fix). The
  // session endpoint returns the new agentId; we set it as active immediately
  // so HaephestosEmbeddedView mounts even before the next polling refresh.
  useEffect(() => {
    if (haephestosQueryHandled.current) return
    if (agents.length === 0) return
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const agentParam = params.get('agent')
    if (agentParam !== 'haephestos') return

    haephestosQueryHandled.current = true
    const haephestos = agents.find(a => a.name === '_aim-creation-helper')
    if (haephestos) {
      setActiveAgentId(haephestos.id)
      window.history.replaceState({}, '', '/')
      return
    }

    // Agent missing — bootstrap via creation-helper session API.
    // The HaephestosEmbeddedView wake button will then transition it online.
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/agents/creation-helper/session', { method: 'POST' })
        if (!res.ok) return
        const data = await res.json()
        if (cancelled || !data?.agentId) return
        setActiveAgentId(data.agentId)
        refreshAgents()
        window.history.replaceState({}, '', '/')
      } catch {
        /* ignore — wake button can be retried manually */
      }
    })()
    return () => { cancelled = true }
  }, [agents, refreshAgents])

  // Initialize agent memories for all agents on load
  // Fetch unread message count for active agent.
  // UI2-MAJ-16: AbortController + signal pass-through prevents in-flight
  // fetches from calling setUnreadCount on an unmounted component when the
  // user navigates away during a poll cycle.
  useEffect(() => {
    if (!activeAgentId || !activeAgent) return

    const controller = new AbortController()

    const fetchUnreadCount = async () => {
      try {
        // Use agent's hostUrl to route to the correct host for remote agents
        const baseUrl = activeAgent.hostUrl || ''
        const response = await fetch(
          `${baseUrl}/api/messages?agent=${encodeURIComponent(activeAgentId)}&action=unread-count`,
          { signal: controller.signal }
        )
        if (controller.signal.aborted) return
        if (response.ok) {
          const data = await response.json()
          if (controller.signal.aborted) return
          setUnreadCount(data.count || 0)
        }
      } catch (error) {
        if ((error as Error).name === 'AbortError') return
        console.error('Failed to fetch unread count:', error)
      }
    }

    fetchUnreadCount()
    const interval = setInterval(fetchUnreadCount, 10000)
    return () => {
      controller.abort()
      clearInterval(interval)
    }
  }, [activeAgentId, activeAgent])

  // Agent-centric handlers
  const handleAgentSelect = (agent: Agent) => {
    // If switching AWAY from Haephestos, auto-hibernate it to prevent zombie sessions
    if (activeAgent?.name === '_aim-creation-helper' && agent.name !== '_aim-creation-helper') {
      // Fire-and-forget hibernate — kill the tmux session
      fetch('/api/agents/creation-helper/kill', { method: 'POST' }).catch(() => {})
    }
    setActiveAgentId(agent.id)
  }

  const handleShowAgentProfile = (agent: Agent) => {
    // Set active agent and open the right profile panel
    setActiveAgentId(agent.id)
    if (!showProfilePanel) {
      setShowProfilePanel(true)
      localStorage.setItem('aimaestro-profile-panel', 'true')
    }
    setProfileScrollToDangerZone(false)
  }

  // Proposal 31 (2026-04-20) — DATA-LOSS near-miss fix.
  // The wizard hands us the new agent id; we switch activeAgentId so the
  // terminal AND the (possibly still-open) profile panel track the new agent.
  // Without this handoff, the next profile click (Delete, Hibernate, etc.)
  // would still target the pre-wizard agent — SCEN-005 nearly destroyed a
  // real MANAGER this way.
  const handleAgentCreated = (newAgentId: string) => {
    setActiveAgentId(newAgentId)
    setProfileScrollToDangerZone(false)
  }

  // handleShowAgentProfileDangerZone removed — sidebar delete shortcut was removed (ISSUE-002).
  // The Danger Zone is only accessible via Profile → Advanced → Danger Zone.

  const handleDeleteAgent = async (agentId: string) => {
    try {
      // API DELETE call is now made by DeleteAgentDialog directly (supports deleteFolder param).
      // This handler only does UI cleanup.

      // Close profile panel
      setShowProfilePanel(false)
      localStorage.setItem('aimaestro-profile-panel', 'false')
      setProfileScrollToDangerZone(false)

      // Clear active agent if it was the deleted one
      if (activeAgentId === agentId) {
        setActiveAgentId(null)
      }

      // Refresh agents list
      refreshAgents()

      // Trigger subconscious status refresh
      setSubconsciousRefreshTrigger(prev => prev + 1)
    } catch (error) {
      console.error('Failed to delete agent:', error)
      throw error // Re-throw so the dialog can handle it
    }
  }

  const handleStartSession = async (agent: Agent) => {
    try {
      // Use wakeAgent API — this ensures the R17 gate runs (installs ai-maestro-plugin
      // if missing, blocks wake if install fails, handles trust auto-accept).
      // NEVER call /api/sessions/create directly — it bypasses the R17 enforcement chain.
      const response = await fetch(`/api/agents/${agent.id}/wake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startProgram: true,
          program: agent.program || undefined,
        }),
      })

      if (!response.ok) {
        const data = await response.json().catch(() => ({}))
        // P007: Include HTTP status + full error body + stack trace for diagnostics
        const errorText = data.error || 'Failed to wake agent'
        const statusLine = `HTTP ${response.status} ${response.statusText}`
        throw new Error(`${statusLine}\n\n${errorText}`)
      }

      refreshAgents()

      // Select the agent after session starts
      setTimeout(() => {
        setActiveAgentId(agent.id)
      }, 500)
    } catch (error) {
      const msg = error instanceof Error ? error.message : 'Failed to start session'
      const stack = error instanceof Error && error.stack ? `\n\nStack trace:\n${error.stack}` : ''
      setWakeError(`${msg}${stack}`)
    }
  }

  // P007: Expandable error modal for R17 wake failures (replaces alert())
  const [wakeError, setWakeError] = useState<string | null>(null)

  const [wakingAgentId, setWakingAgentId] = useState<string | null>(null)
  const [wakeDialogAgent, setWakeDialogAgent] = useState<Agent | null>(null)

  // Opens the wake dialog to select CLI
  const handleWakeAgent = (agent: Agent) => {
    if (wakingAgentId === agent.id) return
    setWakeDialogAgent(agent)
  }

  // Performs the actual wake with selected program
  const handleWakeConfirm = async (program: string) => {
    if (!wakeDialogAgent) return

    const agent = wakeDialogAgent

    // Close dialog immediately so UI isn't blocked
    setWakeDialogAgent(null)
    setWakingAgentId(agent.id)

    try {
      const baseUrl = agent.hostUrl || ''
      const response = await fetch(`${baseUrl}/api/agents/${agent.id}/wake`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ program }),
      })

      if (!response.ok) {
        const data = await response.json()
        throw new Error(data.error || 'Failed to wake agent')
      }

      refreshAgents()
    } catch (error) {
      console.error('Failed to wake agent:', error)
      // Use setTimeout to ensure state updates happen first
      setTimeout(() => {
        alert(error instanceof Error ? error.message : 'Failed to wake agent')
      }, 0)
    } finally {
      setWakingAgentId(null)
    }
  }

  const toggleSidebar = () => {
    setSidebarCollapsed(prev => !prev)
    // Trigger terminal refit after the CSS transition completes (300ms duration + 50ms buffer)
    // This dispatches a synthetic resize event that the global handler in TerminalContext picks up,
    // calling fitAddon.fit() on all registered terminals so they fill the new available width
    if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current)
    resizeTimeoutRef.current = setTimeout(() => {
      window.dispatchEvent(new Event('resize'))
    }, 350)
  }

  const toggleProfilePanel = () => {
    setShowProfilePanel(prev => {
      const next = !prev
      localStorage.setItem('aimaestro-profile-panel', String(next))
      // Trigger terminal refit after layout change
      if (resizeTimeoutRef.current) clearTimeout(resizeTimeoutRef.current)
      resizeTimeoutRef.current = setTimeout(() => {
        window.dispatchEvent(new Event('resize'))
      }, 350)
      return next
    })
  }

  const handleOnboardingComplete = () => {
    setShowOnboarding(false)
    refreshAgents()
  }

  const handleOnboardingSkip = () => {
    localStorage.setItem('aimaestro-onboarding-completed', 'true')
    setShowOnboarding(false)
  }

  const handleOrganizationComplete = () => {
    setShowOrganizationSetup(false)
    // After organization is set, check if onboarding is needed
    const onboardingCompleted = localStorage.getItem('aimaestro-onboarding-completed')
    if (!onboardingCompleted) {
      setShowOnboarding(true)
    }
  }

  // Show loading while checking organization status
  if (!organizationChecked) {
    return (
      <div className="fixed inset-0 bg-gray-950 flex items-center justify-center">
        <div className="text-center">
          <div className="w-12 h-12 mx-auto mb-4 border-4 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    )
  }

  // Show organization setup if not set
  if (showOrganizationSetup) {
    return <OrganizationSetup onComplete={handleOrganizationComplete} />
  }

  // Show onboarding flow if not completed
  if (showOnboarding) {
    return <OnboardingFlow onComplete={handleOnboardingComplete} onSkip={handleOnboardingSkip} />
  }

  // Render mobile-specific dashboard for phones.
  //
  // UI2-MIN-05: the two TerminalProvider trees use DIFFERENT React `key` props
  // (`mobile-dashboard` vs `desktop-dashboard`). When the viewport crosses the
  // 768px breakpoint mid-session (e.g. tablet rotation, dragging the window
  // wider on a desktop), React unmounts the entire mobile tree and mounts a
  // fresh desktop tree (or vice-versa). All terminals in the previous tree
  // are torn down — their WebSockets disconnect, xterm scrollback is lost,
  // and they re-attach via `tmux capture-pane` on the next mount. This is
  // INTENTIONAL: mobile and desktop have different component trees and
  // sharing terminal contexts across the breakpoint would couple the two
  // implementations. The cost is a one-time terminal re-init on resize.
  // If this becomes a UX issue, the fix is to consolidate to one
  // TerminalProvider at the layout level — but that requires the mobile
  // and desktop dashboards to use the same terminal-rendering primitives,
  // which today they do not.
  if (isMobile) {
    return (
      <TerminalProvider key="mobile-dashboard">
        <MobileDashboard
          agents={agents}
          loading={agentsLoading}
          error={agentsError?.message || null}
          onRefresh={refreshAgents}
        />
      </TerminalProvider>
    )
  }

  // Desktop dashboard - AGENT-CENTRIC
  return (
    <TerminalProvider key="desktop-dashboard">
      <div className="flex flex-col bg-gray-900" style={{ overflow: 'hidden', position: 'fixed', inset: 0 }}>
        {/* Header */}
        <Header
          onToggleSidebar={toggleSidebar}
          sidebarCollapsed={sidebarCollapsed}
          activeAgentId={activeAgentId}
          onOpenHelp={openHelp}
        />

        {/* Migration Banner */}
        <MigrationBanner />

        {/* Main Content Area */}
        <div className="flex flex-1 overflow-hidden relative">
          {/* Sidebar - Always AgentList now */}
          <aside
            className={`
              border-r border-sidebar-border bg-sidebar-bg overflow-hidden relative flex-shrink-0
              ${sidebarCollapsed ? 'w-0' : ''}
              ${isResizing ? '' : 'transition-all duration-300'}
            `}
            style={{ width: sidebarCollapsed ? 0 : sidebarWidth }}
          >
            <ErrorBoundary fallbackLabel="Agent List">
              <AgentList
                agents={agents}
                unregisteredSessions={unregisteredSessions}
                activeAgentId={activeAgentId}
                onAgentSelect={handleAgentSelect}
                onHumanSelect={() => setActiveAgentId(HUMAN_SELF_ID)}
                onShowAgentProfile={handleShowAgentProfile}
                onImportAgent={() => setShowImportDialog(true)}
                loading={agentsLoading}
                error={agentsError}
                onRefresh={refreshAgents}
                stats={agentStats}
                subconsciousRefreshTrigger={subconsciousRefreshTrigger}
                sidebarWidth={sidebarWidth}
                hostErrors={hostErrors}
                onAgentCreated={handleAgentCreated}
              />
            </ErrorBoundary>
          </aside>

          {/* Resize Handle */}
          {!sidebarCollapsed && (
            <div
              className={`
                w-1 cursor-col-resize hover:bg-blue-500/50 active:bg-blue-500 transition-colors flex-shrink-0
                ${isResizing ? 'bg-blue-500' : 'bg-transparent hover:bg-blue-500/30'}
              `}
              onMouseDown={() => setIsResizing(true)}
              title="Drag to resize sidebar"
            />
          )}

          {/* Main Content */}
          <main className="flex-1 flex flex-col relative overflow-hidden isolate">
            {/* Human user chat view — absolute overlay when the local user card is selected */}
            {activeAgentId === HUMAN_SELF_ID && (
              <div className="absolute inset-0 z-20 flex flex-col">
                <HumanUserPanel allAgents={agents} />
              </div>
            )}

            {/* Empty State - shown when no agents */}
            {agents.length === 0 && !agentsLoading && (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <div className="text-center max-w-md">
                  <div className="relative mb-6">
                    <div className="w-20 h-20 mx-auto rounded-2xl bg-gradient-to-br from-green-500/20 to-emerald-600/20 flex items-center justify-center border border-green-500/30">
                      <User className="w-10 h-10 text-green-400" />
                    </div>
                    <div className="absolute -top-1 -right-1 w-6 h-6 bg-green-500 rounded-full flex items-center justify-center animate-pulse">
                      <Plus className="w-4 h-4 text-white" />
                    </div>
                  </div>
                  <p className="text-xl mb-2 text-gray-200">Create your first agent</p>
                  <p className="text-sm text-gray-500 mb-1">
                    Click the <span className="text-green-400 font-medium">+</span> button in the sidebar to get started
                  </p>
                  <p className="text-xs text-gray-600">
                    Agents are AI assistants that help you code, debug, and build
                  </p>
                </div>
              </div>
            )}

            {/* Offline agent placeholder removed — offline agents now render the full
                agent page layout with toolbar + profile panel. The terminal tab shows
                an offline placeholder instead. Profile panel reads from API/registry. */}

            {/* Haephestos creation helper — shows the forge UI instead of normal terminal */}
            {/* When hibernated: shows "Ask Haephestos Help" wake button */}
            {/* When online: shows the full forge layout (TOML + terminal + raw materials) */}
            {activeAgent && activeAgent.name === '_aim-creation-helper' && (
              <div className="absolute inset-0">
                <HaephestosEmbeddedView agent={activeAgent} />
              </div>
            )}

            {/* Only render the active agent - no need to mount all 40+ agents */}
            {(() => {
              const agent = selectableAgents.find(a => a.id === activeAgentId)
              if (!agent) return null

              // Haephestos has its own embedded view above — skip normal rendering
              if (agent.name === '_aim-creation-helper') return null

              // UI-CRIT-01 fix (2026-05-04): only the active agent is rendered.
              // CLAUDE.md previously documented a "tab-based architecture" where
              // every agent was mounted simultaneously and toggled via
              // `visibility: hidden`. That design was never implemented — only
              // the active agent is mounted, and switching tears down the
              // previous agent's TerminalView/WebSocket and remounts the new
              // one. The `isActive = true` constant and the `!isActive` branch
              // below have been removed; the doc has been updated to match.
              const isHibernated = agent.session?.status !== 'online' && (agent.sessions && agent.sessions.length > 0)
              // Truly offline: no session config at all (not hibernated, just never started or fully removed)
              const isOffline = agent.session?.status !== 'online' && !(agent.sessions && agent.sessions.length > 0)
              const session = agentToSession(agent)

              return (
                <div
                  key={agent.id}
                  className="absolute inset-0 flex flex-col"
                >
                  {/* Tab Navigation - Responsive with flex-wrap */}
                  <div className="flex flex-wrap border-b border-gray-800 bg-gray-900 flex-shrink-0">
                    <button
                      onClick={() => setActiveTab('terminal')}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                        activeTab === 'terminal'
                          ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/50'
                          : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/30'
                      }`}
                    >
                      <Terminal className="w-4 h-4" />
                      Terminal
                    </button>
                    <button
                      onClick={() => setActiveTab('chat')}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                        activeTab === 'chat'
                          ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/50'
                          : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/30'
                      }`}
                    >
                      <MessageSquare className="w-4 h-4" />
                      Chat
                    </button>
                    <button
                      onClick={() => setActiveTab('sessions')}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                        activeTab === 'sessions'
                          ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/50'
                          : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/30'
                      }`}
                      title="Browse JSONL chat transcripts for this agent"
                    >
                      <History className="w-4 h-4" />
                      Sessions
                    </button>
                    <button
                      onClick={() => setActiveTab('messages')}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                        activeTab === 'messages'
                          ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/50'
                          : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/30'
                      }`}
                    >
                      <Mail className="w-4 h-4" />
                      Messages
                      {unreadCount > 0 && (
                        <span className="ml-1.5 bg-blue-500/90 text-white text-[10px] font-semibold rounded-full min-w-[18px] h-[18px] flex items-center justify-center px-1.5">
                          {unreadCount > 99 ? '99+' : unreadCount}
                        </span>
                      )}
                    </button>
                    <button
                      onClick={() => setActiveTab('worktree')}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                        activeTab === 'worktree'
                          ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/50'
                          : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/30'
                      }`}
                    >
                      <GitBranch className="w-4 h-4" />
                      WorkTree
                    </button>
                    <button
                      onClick={() => setActiveTab('search')}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                        activeTab === 'search'
                          ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/50'
                          : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/30'
                      }`}
                      title="Search (Ctrl+K)"
                    >
                      <Search className="w-4 h-4" />
                      Search
                    </button>
                    <button
                      onClick={() => setActiveTab('export')}
                      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium transition-all duration-200 ${
                        activeTab === 'export'
                          ? 'text-blue-400 border-b-2 border-blue-400 bg-gray-800/50'
                          : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/30'
                      }`}
                      title="Export (Ctrl+E)"
                    >
                      <Download className="w-4 h-4" />
                      Export
                    </button>
                    <div className="flex-1" />
                    <div className="flex items-center">
                      <AgentSubconsciousIndicator agentId={agent.id} hostUrl={agent.hostUrl} />
                      <button
                        onClick={toggleProfilePanel}
                        className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all duration-200 ${
                          showProfilePanel
                            ? 'text-amber-400 bg-amber-500/10'
                            : 'text-gray-400 hover:text-gray-300 hover:bg-gray-800/30'
                        }`}
                        title="Toggle Profile Panel"
                      >
                        <User className="w-4 h-4" />
                        Profile
                      </button>
                      <button
                        onClick={() => {
                          const url = `/zoom/agent?id=${encodeURIComponent(agent.id)}`
                          window.open(url, `agent-${agent.id}`, 'width=1200,height=800,menubar=no,toolbar=no')
                        }}
                        className="flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all duration-200 text-gray-400 hover:text-violet-400 hover:bg-gray-800/30"
                        title="Open in new window"
                      >
                        <ExternalLink className="w-4 h-4" />
                        Pop Out
                      </button>
                    </div>
                  </div>

                  {/* Tab Content */}
                  <div className="flex-1 flex overflow-hidden min-h-0">
                    {/* Content area — min-w-0 lets it shrink when profile panel is open */}
                    <div className="flex-1 flex min-w-0 overflow-hidden">
                    {activeTab === 'terminal' ? (
                      isOffline ? (
                        <div className="flex-1 flex items-center justify-center text-gray-400">
                          <div className="text-center max-w-md">
                            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-gray-800 flex items-center justify-center">
                              <User className="w-10 h-10 text-gray-500" />
                            </div>
                            <p className="text-xl mb-2 text-gray-300">{agent.label || agent.name}</p>
                            <p className="text-sm mb-4 text-gray-500">This agent is offline</p>
                            <div className="flex items-center justify-center gap-3">
                              <button
                                onClick={() => handleStartSession(agent)}
                                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-all"
                              >
                                Start Session
                              </button>
                              <button
                                onClick={() => {
                                  if (!showProfilePanel) toggleProfilePanel()
                                }}
                                className="px-6 py-3 bg-gray-700 text-white rounded-lg hover:bg-gray-600 transition-all"
                              >
                                View Profile
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : isHibernated ? (
                        <div className="flex-1 flex items-center justify-center text-gray-400">
                          <div className="text-center max-w-md">
                            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-yellow-900/30 flex items-center justify-center">
                              <Moon className="w-10 h-10 text-yellow-500" />
                            </div>
                            <p className="text-xl mb-2 text-gray-300">{agent.label || agent.name}</p>
                            <p className="text-sm mb-4 text-gray-500">This agent is hibernating</p>
                            <button
                              onClick={() => handleWakeAgent(agent)}
                              disabled={wakingAgentId === agent.id}
                              className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
                            >
                              {wakingAgentId === agent.id ? (
                                <>
                                  <Loader2 className="w-4 h-4 animate-spin" />
                                  Waking...
                                </>
                              ) : (
                                <>
                                  <Power className="w-4 h-4" />
                                  Wake Agent
                                </>
                              )}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <ErrorBoundary fallbackLabel="Terminal">
                          <TerminalView session={session} isVisible={activeTab === 'terminal'} />
                        </ErrorBoundary>
                      )
                    ) : activeTab === 'chat' ? (
                      (isHibernated || isOffline) ? (
                        <div className="flex-1 flex items-center justify-center text-gray-400">
                          <div className="text-center max-w-md">
                            <div className="w-20 h-20 mx-auto mb-4 rounded-full bg-yellow-900/30 flex items-center justify-center">
                              <Moon className="w-10 h-10 text-yellow-500" />
                            </div>
                            <p className="text-xl mb-2 text-gray-300">{agent.label || agent.name}</p>
                            <p className="text-sm mb-4 text-gray-500">Wake this agent to use the chat interface</p>
                            {isOffline ? (
                              <button
                                onClick={() => handleStartSession(agent)}
                                className="px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-500 transition-all"
                              >
                                Start Session
                              </button>
                            ) : (
                              <button
                                onClick={() => handleWakeAgent(agent)}
                                disabled={wakingAgentId === agent.id}
                                className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-500 transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2 mx-auto"
                              >
                                {wakingAgentId === agent.id ? (
                                  <>
                                    <Loader2 className="w-4 h-4 animate-spin" />
                                    Waking...
                                  </>
                                ) : (
                                  <>
                                    <Power className="w-4 h-4" />
                                    Wake Agent
                                  </>
                                )}
                              </button>
                            )}
                          </div>
                        </div>
                      ) : (
                        <ErrorBoundary fallbackLabel="Chat">
                          <ChatView agent={agent} isActive={true} />
                        </ErrorBoundary>
                      )
                    ) : activeTab === 'sessions' ? (
                      <ErrorBoundary fallbackLabel="Sessions">
                        <div className="flex-1 min-h-0 flex" style={{ touchAction: 'pan-y', overscrollBehavior: 'contain' }}>
                          <SessionsTab agentId={agent.id} assistantAvatarUrl={resolveAvatarUrl(agent)} />
                        </div>
                      </ErrorBoundary>
                    ) : activeTab === 'messages' ? (
                      <ErrorBoundary fallbackLabel="Messages">
                        <MessageCenter
                          sessionName={session.id}
                          agentId={agent.id}
                          allAgents={onlineAgents.map(a => ({
                            id: a.id,
                            name: a.name || a.id,  // Technical name for lookups
                            alias: a.label || a.name || a.id,  // Display name for UI
                            tmuxSessionName: a.session?.tmuxSessionName,
                            hostId: a.hostId
                          }))}
                          hostUrl={agent.hostUrl}
                          isActive={true}
                        />
                      </ErrorBoundary>
                    ) : activeTab === 'worktree' ? (
                      <WorkTree
                        sessionName={session.id}
                        agentId={agent.id}
                        agentAlias={agent.label || agent.name}
                        hostId={agent.hostId}
                        isActive={true}
                      />
                    ) : activeTab === 'search' ? (
                      <div className="flex-1 overflow-auto p-4">
                        <AgentSearch
                          agentId={agent.id}
                          className="max-w-4xl mx-auto"
                        />
                      </div>
                    ) : activeTab === 'export' ? (
                      <div className="flex-1 overflow-auto p-4">
                        <TranscriptExport
                          agentId={agent.id}
                          agentName={agent.label || agent.name}
                          className="max-w-4xl mx-auto"
                        />
                      </div>
                    ) : null}
                    </div>

                    {/* Right Panel — Profile (Overview + Config tabs) */}
                    {showProfilePanel && (
                      <AgentProfilePanel
                        agentId={agent.id}
                        agentName={agent.label || agent.name}
                        agentInfo={{
                          name: agent.label || agent.name,
                          // Prefer explicit governanceTitle (architect/integrator/orchestrator) over raw role field
                          // BUG: agent.role stays 'member' when governanceTitle is set — useGovernance derives the correct title
                          title: (agent.governanceTitle || agent.role) as AgentRole | undefined,
                          program: agent.program,
                          tags: agent.tags,
                          // TRDD-c7a81642: forward the R9.13 invariant flag so
                          // the Config tab can render the recovery banner.
                          roleMissing: agent.roleMissing,
                        }}
                        onClose={toggleProfilePanel}
                        onAgentDataChanged={refreshAgents}
                        sessionStatus={agent.session}
                        onStartSession={() => handleStartSession(agent)}
                        onDeleteAgent={handleDeleteAgent}
                        scrollToDangerZone={profileScrollToDangerZone}
                        hostUrl={agent.hostUrl}
                      />
                    )}
                  </div>
                </div>
              )
            })()}
          </main>
        </div>

        {/* P007: Wake Error Modal — expandable/collapsable for R17 failures */}
        {wakeError && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
            <div className="bg-gray-900 border border-red-500/40 rounded-xl p-6 max-w-lg w-full mx-4 shadow-2xl">
              <h3 className="text-red-400 font-bold text-sm mb-2">Agent Wake Failed</h3>
              <p className="text-gray-300 text-xs mb-3">
                {wakeError.split('\n')[0]}
              </p>
              {wakeError.includes('\n') && (
                <details className="mb-3">
                  <summary className="text-xs text-gray-500 cursor-pointer hover:text-gray-300">
                    Technical details
                  </summary>
                  <pre className="mt-2 text-[10px] text-gray-400 bg-gray-950 rounded-lg p-3 overflow-auto max-h-48 font-mono whitespace-pre-wrap">
                    {wakeError}
                  </pre>
                </details>
              )}
              <div className="flex gap-2 justify-end">
                <button
                  onClick={() => { navigator.clipboard.writeText(wakeError); }}
                  className="px-3 py-1.5 text-xs bg-gray-800 hover:bg-gray-700 text-gray-300 rounded-lg transition-colors"
                >
                  Copy
                </button>
                <button
                  onClick={() => setWakeError(null)}
                  className="px-3 py-1.5 text-xs bg-red-600 hover:bg-red-700 text-white rounded-lg transition-colors"
                >
                  Close
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Footer */}
        <footer className="border-t border-gray-800 bg-gray-950 px-4 py-2 flex-shrink-0">
          <div className="flex flex-col md:flex-row justify-between items-center gap-1 md:gap-0 md:h-5">
            <p className="text-xs md:text-sm text-white leading-none">
              <VersionChecker /> • Made with <span className="text-red-500 text-lg inline-block scale-x-125">♥</span> in Boulder Colorado
            </p>
            <p className="text-xs md:text-sm text-white leading-none">
              Concept by{' '}
              <a
                href="https://x.com/jkpelaez"
                target="_blank"
                rel="noopener noreferrer"
                className="hover:text-gray-300 transition-colors"
              >
                Juan Peláez
              </a>{' '}
              @{' '}
              <a
                href="https://23blocks.com"
                target="_blank"
                rel="noopener noreferrer"
                className="font-semibold text-red-500 hover:text-red-400 transition-colors"
              >
                23blocks
              </a>
              . Coded by Claude
            </p>
          </div>
        </footer>

        {/* Import Agent Dialog */}
        <ImportAgentDialog
          isOpen={showImportDialog}
          onClose={() => setShowImportDialog(false)}
          onImportComplete={() => {
            setShowImportDialog(false)
            refreshAgents()
          }}
        />

        {/* Wake Agent Dialog */}
        <WakeAgentDialog
          isOpen={wakeDialogAgent !== null}
          onClose={() => setWakeDialogAgent(null)}
          onConfirm={handleWakeConfirm}
          agentName={wakeDialogAgent?.name || wakeDialogAgent?.id || ''}
          agentAlias={wakeDialogAgent?.label || wakeDialogAgent?.name}
        />

        {/* Help Panel is rendered globally by HelpPanelProvider in app/layout.tsx */}
      </div>
    </TerminalProvider>
  )
}
