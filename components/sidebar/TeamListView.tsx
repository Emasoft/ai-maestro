'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
// (useRouter removed — team meetings are no longer launched from the sidebar)
import { Plus, UsersRound, X, AlertTriangle } from 'lucide-react'
import type { Team } from '@/types/team'
import type { Agent } from '@/types/agent'
import TeamCard from './TeamCard'
import { useGovernance } from '@/hooks/useGovernance'

interface TeamListViewProps {
  agents: Agent[]
  searchQuery: string
}

export default function TeamListView({ agents, searchQuery }: TeamListViewProps) {
  const [teams, setTeams] = useState<Team[]>([])
  const [loading, setLoading] = useState(true)
  const [fetchError, setFetchError] = useState<string | null>(null)
  const [showCreate, setShowCreate] = useState(false)
  const [editingTeam, setEditingTeam] = useState<Team | null>(null)

  // Proposal 33 (2026-04-20): pre-flight the MANAGER requirement for
  // team creation. When no MANAGER is assigned on this host the R9.8
  // blocking cascade will immediately freeze any new team, so we
  // disable the Create Team button and surface an amber banner
  // explaining the blocker before the user wastes time in the wizard.
  const governance = useGovernance(null)

  const mountedRef = useRef(true)

  useEffect(() => {
    return () => { mountedRef.current = false }
  }, [])

  const fetchTeams = useCallback(async () => {
    try {
      setFetchError(null)
      const res = await fetch('/api/teams')
      if (!mountedRef.current) return
      if (!res.ok) {
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        if (!mountedRef.current) return
        setFetchError(data.error || `Failed to load teams (${res.status})`)
        return
      }
      const data = await res.json()
      if (!mountedRef.current) return
      setTeams(data.teams || [])
    } catch {
      if (!mountedRef.current) return
      setFetchError('Network error loading teams')
    } finally {
      if (mountedRef.current) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchTeams()
  }, [fetchTeams])

  const filtered = searchQuery.trim()
    ? teams.filter(t =>
        t.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        t.description?.toLowerCase().includes(searchQuery.toLowerCase())
      )
    : teams

  // Team meetings are removed (R20): agents coordinate via AMP 1:1 + kanban.
  // Kept as a no-op for forward compatibility while TeamCard ignores the prop.
  const handleStartMeeting = (_team: Team) => { /* disabled */ }

  const [deleteTarget, setDeleteTarget] = useState<Team | null>(null)
  const [deletePassword, setDeletePassword] = useState('')
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)

  const handleDelete = async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError(null)
    try {
      // DELETE /api/teams/[id] is classified "strict" (sudo-mode required)
      // AND requires the governance password in the body for the team
      // governance layer. The user types the password once inline; we
      // exchange it for a sudo token and pass BOTH to the DELETE call.
      const sudoRes = await fetch('/api/auth/sudo-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: deletePassword }),
      })
      if (sudoRes.status === 403) {
        setDeleteError('Password does not match')
        return
      }
      if (!sudoRes.ok) {
        const err = await sudoRes.json().catch(() => ({ error: `HTTP ${sudoRes.status}` }))
        setDeleteError(err.error || 'Sudo token request failed')
        return
      }
      const { token: sudoToken } = await sudoRes.json() as { token: string }

      const res = await fetch(`/api/teams/${deleteTarget.id}`, {
        method: 'DELETE',
        headers: {
          'Content-Type': 'application/json',
          'X-Sudo-Token': sudoToken,
        },
        body: JSON.stringify({ password: deletePassword }),
      })
      const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
      if (!res.ok) {
        setDeleteError(data.error || 'Failed to delete team')
        return
      }
      setTeams(prev => prev.filter(t => t.id !== deleteTarget.id))
      setDeleteTarget(null)
      setDeletePassword('')
    } catch {
      setDeleteError('Network error')
    } finally {
      setDeleting(false)
    }
  }

  const handleSave = async (name: string, description: string, agentIds: string[], teamId?: string): Promise<string | null> => {
    try {
      if (teamId) {
        const res = await fetch(`/api/teams/${teamId}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description, agentIds }),
        })
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        if (!res.ok) return data.error || 'Failed to update team'
        if (data.team) {
          setTeams(prev => prev.map(t => t.id === teamId ? data.team : t))
        }
      } else {
        const res = await fetch('/api/teams', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, description, agentIds }),
        })
        const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }))
        if (!res.ok) return data.error || 'Failed to create team'
        if (data.team) {
          setTeams(prev => [...prev, data.team])
        }
      }
      setShowCreate(false)
      setEditingTeam(null)
      return null
    } catch (err) {
      return err instanceof Error ? err.message : 'Network error'
    }
  }

  if (loading) {
    return (
      <div className="px-4 py-8 text-center text-gray-400">
        <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-gray-400 mx-auto mb-2" />
        <p className="text-xs">Loading teams...</p>
      </div>
    )
  }

  return (
    <div className="py-2">
      {/* Fetch error banner */}
      {fetchError && (
        <div className="mx-3 mb-2 bg-red-900/20 border border-red-800 rounded-lg px-3 py-2 text-xs text-red-400 flex items-center justify-between gap-2">
          <span>{fetchError}</span>
          <button onClick={fetchTeams} className="text-red-300 hover:text-white underline flex-shrink-0">Retry</button>
        </div>
      )}

      {/* Proposal 33: MANAGER-required preflight banner — render before
          the Create button so the user sees the blocker first. */}
      {!governance.hasManager && (
        <div className="mx-3 mb-2 p-2 rounded-md bg-amber-500/10 border border-amber-500/30 text-[11px] text-amber-300 flex items-start gap-2">
          <AlertTriangle className="w-3 h-3 flex-shrink-0 mt-0.5" />
          <span>
            <strong>No MANAGER on this host.</strong> New teams would
            be blocked immediately (R9.8). Assign a MANAGER first via
            an agent&apos;s Title Assignment Dialog.
          </span>
        </div>
      )}

      {/* Create button */}
      <div className="px-3 mb-2">
        <button
          onClick={() => { setEditingTeam(null); setShowCreate(true) }}
          disabled={!governance.hasManager}
          title={governance.hasManager
            ? 'Create a new team'
            : 'Cannot create team — no MANAGER on this host. Assign one first.'}
          className={`w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs border border-dashed transition-all ${
            governance.hasManager
              ? 'text-gray-400 hover:text-gray-300 border-gray-700 hover:border-gray-600 hover:bg-gray-800/50'
              : 'text-gray-600 border-gray-800 cursor-not-allowed'
          }`}
        >
          <Plus className="w-3.5 h-3.5" />
          Create Team
        </button>
      </div>

      {filtered.length === 0 ? (
        <div className="px-6 py-8 text-center">
          <UsersRound className="w-10 h-10 text-gray-700 mx-auto mb-3" />
          <p className="text-sm text-gray-500 mb-1">
            {searchQuery ? 'No teams match your search' : 'No teams yet'}
          </p>
          {!searchQuery && (
            <p className="text-xs text-gray-600">
              Create a team to group agents for meetings
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-0.5">
          {filtered.map(team => (
            <TeamCard
              key={team.id}
              team={team}
              agents={agents}
              onStartMeeting={handleStartMeeting}
              onEdit={(t) => { setEditingTeam(t); setShowCreate(true) }}
              onDelete={(t) => { setDeleteTarget(t); setDeletePassword(''); setDeleteError(null) }}
            />
          ))}
        </div>
      )}

      {/* Create/Edit modal */}
      {showCreate && (
        <TeamFormModal
          team={editingTeam}
          agents={agents}
          onSave={handleSave}
          onClose={() => { setShowCreate(false); setEditingTeam(null) }}
        />
      )}

      {/* Delete team confirmation modal with password */}
      {deleteTarget && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => { setDeleteTarget(null); setDeletePassword(''); setDeleteError(null) }}>
          <div className="bg-gray-900 rounded-xl w-full max-w-sm shadow-2xl border border-gray-700 p-5" onClick={e => e.stopPropagation()}>
            <h3 className="text-sm font-semibold text-red-400 mb-3">Delete Team</h3>
            <p className="text-xs text-gray-300 mb-4">
              Permanently delete <span className="font-semibold text-white">{deleteTarget.name}</span> and revert all agents to AUTONOMOUS?
            </p>

            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs text-gray-400 mb-1">Governance Password</label>
                <input
                  type="password"
                  value={deletePassword}
                  onChange={e => setDeletePassword(e.target.value)}
                  placeholder="Enter governance password"
                  className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-red-500"
                  autoFocus
                />
              </div>
            </div>

            {deleteError && (
              <div className="bg-red-900/20 border border-red-800 rounded-lg p-2.5 text-xs text-red-400 mb-3">
                {deleteError}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <button
                onClick={() => { setDeleteTarget(null); setDeletePassword(''); setDeleteError(null) }}
                className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 rounded-lg hover:bg-gray-800 transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                disabled={!deletePassword || deleting}
                className="px-3 py-1.5 text-xs font-medium bg-red-600 text-white rounded-lg hover:bg-red-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
              >
                {deleting ? 'Deleting...' : 'Delete Team'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function TeamFormModal({
  team,
  agents,
  onSave,
  onClose,
}: {
  team: Team | null
  agents: Agent[]
  onSave: (name: string, description: string, agentIds: string[], teamId?: string) => Promise<string | null>
  onClose: () => void
}) {
  const [name, setName] = useState(team?.name || '')
  const [description, setDescription] = useState(team?.description || '')
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set(team?.agentIds || []))
  const [error, setError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  const toggleAgent = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim() || selectedIds.size === 0) return
    setError(null)
    setSaving(true)
    const err = await onSave(name.trim(), description.trim(), Array.from(selectedIds), team?.id)
    setSaving(false)
    if (err) setError(err)
  }

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50" onClick={() => { if (!saving) onClose() }}>
      <div className="bg-gray-900 rounded-xl w-full max-w-md shadow-2xl border border-gray-700 p-5" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-gray-100">
            {team ? 'Edit Team' : 'Create Team'}
          </h3>
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-800 text-gray-400">
            <X className="w-4 h-4" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Name *</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Backend Squad"
              className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <input
              type="text"
              value={description}
              onChange={e => setDescription(e.target.value)}
              placeholder="API and infrastructure team"
              className="w-full px-3 py-2 text-sm bg-gray-800 border border-gray-700 rounded-lg text-gray-100 placeholder-gray-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs text-gray-400 mb-1">
              Agents * <span className="text-gray-600">({selectedIds.size} selected)</span>
            </label>
            <div className="max-h-48 overflow-y-auto space-y-1 border border-gray-700 rounded-lg p-2 bg-gray-800/50 custom-scrollbar">
              {agents.length === 0 ? (
                <p className="text-xs text-gray-500 text-center py-2">No agents available</p>
              ) : (
                agents.map(agent => {
                  const isSelected = selectedIds.has(agent.id)
                  return (
                    <button
                      key={agent.id}
                      type="button"
                      onClick={() => toggleAgent(agent.id)}
                      className={`w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs transition-all ${
                        isSelected
                          ? 'bg-blue-500/20 text-blue-300 border border-blue-500/30'
                          : 'text-gray-300 hover:bg-gray-700/50 border border-transparent'
                      }`}
                    >
                      {agent.avatar && (agent.avatar.startsWith('http') || agent.avatar.startsWith('/')) ? (
                        <img src={agent.avatar} alt="" className="w-5 h-5 rounded-full object-cover" />
                      ) : (
                        <div className="w-5 h-5 rounded-full bg-gray-700 flex items-center justify-center text-[9px] font-medium">
                          {(agent.label || agent.name || '?').slice(0, 2).toUpperCase()}
                        </div>
                      )}
                      <span className="truncate">{agent.label || agent.name}</span>
                    </button>
                  )
                })
              )}
            </div>
          </div>

          {error && (
            <div className="bg-red-900/20 border border-red-800 rounded-lg p-2.5 text-xs text-red-400">
              {error}
              {error.toLowerCase().includes('manager') && (
                <button
                  type="button"
                  onClick={onClose}
                  className="ml-2 text-blue-400 hover:text-blue-300 underline"
                >
                  Close and create a MANAGER agent first
                </button>
              )}
            </div>
          )}

          <div className="flex justify-end gap-2 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-3 py-1.5 text-xs text-gray-400 hover:text-gray-200 rounded-lg hover:bg-gray-800 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!name.trim() || selectedIds.size === 0 || saving}
              className="px-3 py-1.5 text-xs font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
            >
              {saving ? 'Saving...' : team ? 'Save Changes' : 'Create Team'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
