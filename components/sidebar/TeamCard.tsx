'use client'

import { useState, useEffect } from 'react'
import { Pencil, Trash2, AlertTriangle } from 'lucide-react'
import type { Team } from '@/types/team'
import type { Agent } from '@/types/agent'

interface TeamCardProps {
  team: Team
  agents: Agent[]
  /** @deprecated Team meetings are removed — agents coordinate via AMP + kanban.
   *  Prop kept for call-site compatibility; ignored by the component. */
  onStartMeeting?: (team: Team) => void
  onEdit: (team: Team) => void
  onDelete: (team: Team) => void
}

// Response shape of GET /api/teams/{id}/composition-check.
// Captures only the fields used by the badge — other fields (agents list,
// presentTitles, etc.) are ignored here to keep the cache small.
interface R12Composition {
  complete: boolean
  missingTitles: string[]
}

export default function TeamCard({ team, agents, onStartMeeting: _onStartMeeting, onEdit, onDelete }: TeamCardProps) {
  // _onStartMeeting is intentionally ignored — team meetings were removed in
  // favor of AMP + kanban, but the prop is kept for call-site compatibility.
  void _onStartMeeting
  const [confirmDelete, setConfirmDelete] = useState(false)

  // SCEN-010 P0-003: R12 composition warning badge.
  // The composition-check API exists and works, but nothing surfaces its
  // results to the user. Fetch it on mount / when team.agentIds change so
  // the badge appears next to the team name whenever the team does not
  // satisfy R12 (missing one of: chief-of-staff, architect, orchestrator,
  // integrator, member). Tooltip lists the missing titles.
  const [composition, setComposition] = useState<R12Composition | null>(null)
  // Stringify agentIds so the effect only re-runs when team membership
  // actually changes — not on every parent re-render.
  const agentIdsKey = team.agentIds.join(',')
  useEffect(() => {
    const controller = new AbortController()
    fetch(`/api/teams/${team.id}/composition-check`, { signal: controller.signal })
      .then(r => (r.ok ? r.json() : null))
      .then(data => {
        if (!data) return
        setComposition({
          complete: Boolean(data.complete),
          missingTitles: Array.isArray(data.missingTitles) ? data.missingTitles : [],
        })
      })
      .catch(() => { /* aborted or failed — hide the badge by leaving composition null */ })
    return () => controller.abort()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [team.id, agentIdsKey])

  const memberAgents = team.agentIds
    .map(id => agents.find(a => a.id === id))
  const maxAvatars = 5
  const shown = memberAgents.slice(0, maxAvatars)
  const overflow = memberAgents.length - maxAvatars

  const getInitials = (agent: Agent | undefined) => {
    if (!agent) return '?'
    const name = agent.label || agent.name || '?'
    return name.slice(0, 2).toUpperCase()
  }

  return (
    <div className="group px-3 py-2.5 rounded-lg hover:bg-gray-800/60 transition-all duration-200 cursor-pointer border border-transparent hover:border-gray-700/50">
      <div className="flex items-start justify-between gap-2">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium text-gray-200 truncate">{team.name}</span>
            <span className="text-xs text-gray-500 flex-shrink-0">{team.agentIds.length}</span>
            {/* SCEN-010 P0-003: R12 warning badge — shown only when the
              composition-check API says the team lacks one of the five
              required titles. The native `title` attribute surfaces the
              specific missing titles on hover. Wrapped in a span because
              lucide-react's AlertTriangle does not accept a `title` prop. */}
            {composition && !composition.complete && composition.missingTitles.length > 0 && (
              <span
                className="inline-flex flex-shrink-0"
                aria-label={`Incomplete: missing ${composition.missingTitles.join(', ')}`}
                title={`Incomplete team (R12): missing ${composition.missingTitles.join(', ')}`}
              >
                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
              </span>
            )}
          </div>

          {team.description && (
            <p className="text-xs text-gray-500 truncate mt-0.5">{team.description}</p>
          )}

          {/* Agent avatars */}
          <div className="flex items-center gap-0.5 mt-2">
            {shown.map((agent, i) => (
              <div
                key={agent?.id || i}
                className={`w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium border border-gray-700 ${
                  agent ? 'bg-gray-700 text-gray-300' : 'bg-gray-800 text-gray-500'
                }`}
                title={agent ? (agent.label || agent.name || 'Unknown') : 'Deleted agent'}
              >
                {agent?.avatar && (agent.avatar.startsWith('http') || agent.avatar.startsWith('/')) ? (
                  <img src={agent.avatar} alt="" className="w-full h-full rounded-full object-cover" />
                ) : (
                  getInitials(agent)
                )}
              </div>
            ))}
            {overflow > 0 && (
              <div className="w-6 h-6 rounded-full flex items-center justify-center text-[10px] font-medium bg-gray-800 text-gray-400 border border-gray-700">
                +{overflow}
              </div>
            )}
          </div>

          {/*
            Team meetings are removed (R20 — humans coordinate agents via AMP
            and kanban; agents don't attend "meetings"). We no longer render
            the Last meeting timestamp or the Start Meeting button.
          */}
        </div>

        {/* Hover actions */}
        <div className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(team) }}
            className="p-1 rounded hover:bg-blue-500/20 text-gray-400 hover:text-blue-400 transition-all"
            title="Edit team"
          >
            <Pencil className="w-3.5 h-3.5" />
          </button>
          {confirmDelete ? (
            <button
              onClick={(e) => { e.stopPropagation(); onDelete(team); setConfirmDelete(false) }}
              className="p-1 rounded bg-red-500/20 text-red-400 text-[10px] font-medium transition-all"
              onMouseLeave={() => setConfirmDelete(false)}
            >
              Confirm
            </button>
          ) : (
            <button
              onClick={(e) => { e.stopPropagation(); setConfirmDelete(true) }}
              className="p-1 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-all"
              title="Delete team"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
