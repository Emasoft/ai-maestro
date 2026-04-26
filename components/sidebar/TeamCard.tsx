'use client'

import { useState, useMemo } from 'react'
import { Pencil, Trash2, AlertTriangle } from 'lucide-react'
import type { Team } from '@/types/team'
import type { Agent } from '@/types/agent'
import { checkTeamComposition } from '@/lib/team-composition'

interface TeamCardProps {
  team: Team
  agents: Agent[]
  /** @deprecated Team meetings are removed — agents coordinate via AMP + kanban.
   *  Prop kept for call-site compatibility; ignored by the component. */
  onStartMeeting?: (team: Team) => void
  onEdit: (team: Team) => void
  onDelete: (team: Team) => void
}

export default function TeamCard({ team, agents, onStartMeeting: _onStartMeeting, onEdit, onDelete }: TeamCardProps) {
  // _onStartMeeting is intentionally ignored — team meetings were removed in
  // favor of AMP + kanban, but the prop is kept for call-site compatibility.
  void _onStartMeeting
  const [confirmDelete, setConfirmDelete] = useState(false)

  const memberAgents = team.agentIds
    .map(id => agents.find(a => a.id === id))
  const maxAvatars = 5
  const shown = memberAgents.slice(0, maxAvatars)
  const overflow = memberAgents.length - maxAvatars

  // WT-010#3 (SCEN-010 P0-003): R12 composition check — flag teams missing
  // one or more required titles (chief-of-staff, architect, orchestrator,
  // integrator, member) so the user can spot incomplete teams at a glance
  // without opening each one. Pure local derivation (no network roundtrip),
  // memoized against team + agents so renders are cheap. Server PG06 remains
  // authoritative; this is a UI mirror.
  const composition = useMemo(() => checkTeamComposition(team, agents), [team, agents])

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
            {/* WT-010#3 (SCEN-010 P0-003): R12 composition warning badge.
              Amber (not red) — a non-functional team is recoverable; it
              needs attention, not alarm. The `title` attribute lists the
              specific missing titles on hover. `aria-label` mirrors for
              screen readers. */}
            {!composition.complete && composition.missing.length > 0 && (
              <span
                className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-amber-500/15 text-amber-400 flex-shrink-0"
                aria-label={`Incomplete: missing ${composition.missing.join(', ')}`}
                title={`Incomplete team (R12): missing ${composition.missing.join(', ')}`}
              >
                <AlertTriangle className="w-2.5 h-2.5" />
                R12
              </span>
            )}
            {/* Proposal 38 (2026-04-20): distinct BLOCKED badge when the
                manager-gated cascade has frozen the team (team.blocked=true
                because no MANAGER on host). Red not amber — functional
                paralysis, not a composition warning. Tooltip tells the
                user how to resolve. */}
            {team.blocked && (
              <span
                className="flex items-center gap-0.5 text-[9px] px-1.5 py-0.5 rounded-full bg-red-500/20 text-red-400 flex-shrink-0"
                aria-label="Team is blocked — no MANAGER on host"
                title="BLOCKED (R9.8): no MANAGER on host. Team operations are frozen and agents are hibernated. Assign a MANAGER in the Title Assignment Dialog to unblock."
              >
                <AlertTriangle className="w-2.5 h-2.5" />
                BLOCKED
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
