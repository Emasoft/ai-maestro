'use client'

import { useEffect, useState } from 'react'
import { User, LogOut, Edit2, Check, X, Image as ImageIcon, Loader2 } from 'lucide-react'
import MessageCenter from './MessageCenter'
import AvatarPicker from './AvatarPicker'
import type { Agent } from '@/types/agent'

/**
 * Chat-only main panel for the local human user.
 *
 * Unlike agent panels, humans have NO terminal, memory, playback, team, or
 * profile panel — they only have avatar + name + AMP messages. They belong
 * to groups (not teams) and never participate in team meetings.
 */

interface HumanUserPanelProps {
  /** All known agents — forwarded to MessageCenter for recipient picker */
  allAgents: Agent[]
}

interface UserProfile {
  userName: string | null
  userAvatar: string | null
}

export default function HumanUserPanel({ allAgents }: HumanUserPanelProps) {
  const [profile, setProfile] = useState<UserProfile>({ userName: null, userAvatar: null })
  const [loading, setLoading] = useState(true)
  const [editingName, setEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState('')
  const [saving, setSaving] = useState(false)
  const [showAvatarPicker, setShowAvatarPicker] = useState(false)
  const [loggingOut, setLoggingOut] = useState(false)

  const fetchProfile = async () => {
    try {
      const res = await fetch('/api/governance')
      if (res.ok) {
        const data = await res.json()
        setProfile({
          userName: data.userName ?? null,
          userAvatar: data.userAvatar ?? null,
        })
      }
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { fetchProfile() }, [])

  const saveName = async () => {
    const trimmed = nameDraft.trim()
    if (!trimmed || trimmed === profile.userName) {
      setEditingName(false)
      return
    }
    setSaving(true)
    try {
      const res = await fetch('/api/governance/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userName: trimmed }),
      })
      if (res.ok) {
        const data = await res.json()
        setProfile(p => ({ ...p, userName: data.userName ?? trimmed }))
        setEditingName(false)
      }
    } finally {
      setSaving(false)
    }
  }

  const saveAvatar = async (avatarUrl: string) => {
    try {
      const res = await fetch('/api/governance/user', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userAvatar: avatarUrl }),
      })
      if (res.ok) {
        const data = await res.json()
        setProfile(p => ({ ...p, userAvatar: data.userAvatar ?? avatarUrl }))
      }
    } finally {
      setShowAvatarPicker(false)
    }
  }

  const handleLogout = async () => {
    setLoggingOut(true)
    try {
      await fetch('/api/auth/logout', { method: 'POST' })
      window.location.href = '/'
    } catch {
      setLoggingOut(false)
    }
  }

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="w-6 h-6 text-gray-500 animate-spin" />
      </div>
    )
  }

  const messageIdentifier = profile.userName || 'user'
  const allAgentsForPicker = allAgents.map(a => ({
    id: a.id,
    name: a.name,
    alias: a.label || a.name,
    tmuxSessionName: a.session?.tmuxSessionName,
    hostId: a.hostId,
  }))

  return (
    <div className="flex-1 flex flex-col bg-gray-950 text-gray-200 relative">
      {/* Header — compact profile bar */}
      <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-800 bg-gray-900/40">
        {/* Avatar (clickable) */}
        <button
          onClick={() => setShowAvatarPicker(true)}
          className="relative w-10 h-10 rounded-full overflow-hidden bg-gray-800 border-2 border-gray-700 hover:border-emerald-500/60 flex-shrink-0 group"
          title="Change avatar"
        >
          {profile.userAvatar ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={profile.userAvatar} alt="You" className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-emerald-600/30 to-cyan-600/30">
              <User className="w-5 h-5 text-gray-300" />
            </div>
          )}
          <div className="absolute inset-0 flex items-center justify-center opacity-0 group-hover:opacity-100 bg-black/50">
            <ImageIcon className="w-4 h-4 text-white" />
          </div>
        </button>

        {/* Name (inline editable) */}
        <div className="flex-1 min-w-0">
          {editingName ? (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveName()
                  if (e.key === 'Escape') setEditingName(false)
                }}
                autoFocus
                disabled={saving}
                maxLength={64}
                className="flex-1 px-2 py-1 text-sm bg-gray-800 border border-gray-700 rounded text-gray-200 focus:outline-none focus:border-emerald-500"
              />
              <button onClick={saveName} disabled={saving} className="p-1 text-emerald-400 hover:text-emerald-300">
                {saving ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />}
              </button>
              <button onClick={() => setEditingName(false)} disabled={saving} className="p-1 text-gray-400 hover:text-gray-300">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2">
              <div className="min-w-0">
                <p className="text-sm font-semibold text-gray-100 truncate">{profile.userName ?? '…'}</p>
                <p className="text-[10px] text-gray-500">Local User · chat only</p>
              </div>
              <button
                onClick={() => { setNameDraft(profile.userName ?? ''); setEditingName(true) }}
                className="p-1 text-gray-500 hover:text-gray-300"
                title="Edit name"
              >
                <Edit2 className="w-3 h-3" />
              </button>
            </div>
          )}
        </div>

        {/* Logout */}
        <button
          onClick={handleLogout}
          disabled={loggingOut}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-red-700/30 hover:bg-red-700/50 text-red-300 rounded transition-colors disabled:opacity-50"
          title="End session"
        >
          {loggingOut ? <Loader2 className="w-3 h-3 animate-spin" /> : <LogOut className="w-3 h-3" />}
          Logout
        </button>
      </div>

      {/* Message Center — full width, the only content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <MessageCenter
          sessionName={messageIdentifier}
          agentId={`user:${messageIdentifier}`}
          allAgents={allAgentsForPicker}
          isActive={true}
        />
      </div>

      {/* Avatar picker modal */}
      <AvatarPicker
        isOpen={showAvatarPicker}
        onClose={() => setShowAvatarPicker(false)}
        onSelect={saveAvatar}
        currentAvatar={profile.userAvatar ?? undefined}
        usedAvatars={[]}
      />
    </div>
  )
}
