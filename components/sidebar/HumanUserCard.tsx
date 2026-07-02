'use client'

import { useEffect, useState } from 'react'
import { User } from 'lucide-react'

/**
 * Compact sidebar card for the local human user. Clicking it triggers the
 * parent's selection callback with `HUMAN_SELF_ID`, which routes the main
 * content area to HumanUserPanel (chat-only).
 *
 * Humans have NO terminal, memory, playback, team membership, or agent profile
 * panel — they are a pure messaging endpoint. They can participate in groups
 * but never in teams.
 */

export const HUMAN_SELF_ID = 'human:self'

interface HumanUserCardProps {
  isSelected: boolean
  onSelect: () => void
}

export default function HumanUserCard({ isSelected, onSelect }: HumanUserCardProps) {
  const [userName, setUserName] = useState<string | null>(null)
  const [userAvatar, setUserAvatar] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    const fetchProfile = async () => {
      try {
        const res = await fetch('/api/governance')
        if (!res.ok) return
        const data = await res.json()
        if (cancelled) return
        setUserName(data.userName ?? null)
        setUserAvatar(data.userAvatar ?? null)
      } catch { /* ignore */ }
    }
    fetchProfile()
    // Refetch on window focus so changes made in Settings reflect here
    const onFocus = () => fetchProfile()
    window.addEventListener('focus', onFocus)
    return () => { cancelled = true; window.removeEventListener('focus', onFocus) }
  }, [])

  return (
    <button
      onClick={onSelect}
      className={`w-full flex items-center gap-3 px-3 py-2 text-left transition-all duration-200 ${
        isSelected
          ? 'bg-emerald-600/20 border-l-2 border-emerald-400'
          : 'hover:bg-sidebar-hover border-l-2 border-transparent'
      }`}
      title="Open your chat view"
    >
      <div className="relative w-9 h-9 rounded-full overflow-hidden bg-gray-800 border border-gray-700 flex-shrink-0">
        {userAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={userAvatar} alt="You" className="w-full h-full object-cover" />
        ) : (
          <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-emerald-600/30 to-cyan-600/30">
            <User className="w-4 h-4 text-gray-300" />
          </div>
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className={`text-sm font-medium truncate ${isSelected ? 'text-emerald-200' : 'text-gray-100'}`}>
          {userName ?? '…'}
        </p>
        <p className="text-[10px] text-gray-500">You · chat only</p>
      </div>
    </button>
  )
}
