'use client'

import { Crown, Megaphone, Shield, Compass, GitMerge, Bot, Wrench } from 'lucide-react'
import type { GovernanceTitle } from '@/hooks/useGovernance'
export type { GovernanceTitle }

interface TitleBadgeProps {
  title: GovernanceTitle
  onClick?: () => void
  size?: 'sm' | 'md'
}

export default function TitleBadge({ title, onClick, size = 'md' }: TitleBadgeProps) {
  // Size classes for badge dimensions
  const sizeClasses = size === 'sm'
    ? 'text-xs px-2 py-0.5 gap-1'
    : 'text-sm px-3 py-1 gap-1.5'
  const iconSize = size === 'sm' ? 'w-3 h-3' : 'w-4 h-4'

  // Helper to render a badge element as button (if clickable) or span (if static)
  const renderBadge = (classes: string, content: React.ReactNode) => {
    return onClick ? (
      <button type="button" onClick={onClick} className={classes}>
        {content}
      </button>
    ) : (
      <span className={classes}>
        {content}
      </span>
    )
  }

  switch (title) {
    case 'manager': {
      const classes = `inline-flex items-center ${sizeClasses} rounded-full border font-bold tracking-wider transition-colors
            bg-red-500/15 text-red-400 border-red-500/30
            ${onClick ? 'hover:bg-red-500/25 cursor-pointer' : 'cursor-default'}`
      return renderBadge(classes, <><Crown className={iconSize} />MANAGER</>)
    }

    case 'chief-of-staff': {
      const classes = `inline-flex items-center ${sizeClasses} rounded-full border font-bold tracking-wider transition-colors
            bg-yellow-500/15 text-yellow-400 border-yellow-500/30
            ${onClick ? 'hover:bg-yellow-500/25 cursor-pointer' : 'cursor-default'}`
      return renderBadge(classes, <><Shield className={iconSize} />CHIEF-OF-STAFF</>)
    }

    case 'orchestrator': {
      const classes = `inline-flex items-center ${sizeClasses} rounded-full border font-bold tracking-wider transition-colors
            bg-blue-500/15 text-blue-400 border-blue-500/30
            ${onClick ? 'hover:bg-blue-500/25 cursor-pointer' : 'cursor-default'}`
      return renderBadge(classes, <><Megaphone className={iconSize} />ORCHESTRATOR</>)
    }

    case 'architect': {
      const classes = `inline-flex items-center ${sizeClasses} rounded-full border font-bold tracking-wider transition-colors
            bg-purple-500/15 text-purple-400 border-purple-500/30
            ${onClick ? 'hover:bg-purple-500/25 cursor-pointer' : 'cursor-default'}`
      return renderBadge(classes, <><Compass className={iconSize} />ARCHITECT</>)
    }

    case 'integrator': {
      const classes = `inline-flex items-center ${sizeClasses} rounded-full border font-bold tracking-wider transition-colors
            bg-cyan-500/15 text-cyan-400 border-cyan-500/30
            ${onClick ? 'hover:bg-cyan-500/25 cursor-pointer' : 'cursor-default'}`
      return renderBadge(classes, <><GitMerge className={iconSize} />INTEGRATOR</>)
    }

    case 'autonomous': {
      const classes = `inline-flex items-center ${sizeClasses} rounded-full border font-bold tracking-wider transition-colors
            bg-slate-500/15 text-slate-400 border-slate-500/30
            ${onClick ? 'hover:bg-slate-500/25 cursor-pointer' : 'cursor-default'}`
      return renderBadge(classes, <><Bot className={iconSize} />AUTONOMOUS</>)
    }

    case 'maintainer': {
      const classes = `inline-flex items-center ${sizeClasses} rounded-full border font-bold tracking-wider transition-colors
            bg-emerald-500/15 text-emerald-400 border-emerald-500/30
            ${onClick ? 'hover:bg-emerald-500/25 cursor-pointer' : 'cursor-default'}`
      return renderBadge(classes, <><Wrench className={iconSize} />MAINTAINER</>)
    }

    case 'member': {
      // Proposal 1 (2026-04-20): the clickable variant used to show
      // "ASSIGN TITLE" but that nudge was wrong for a confirmed team
      // MEMBER — the user is already a member and clicking is a
      // title-change affordance, not a first-time assignment. Now the
      // label reads MEMBER in both read-only and clickable variants;
      // clickability is retained so a MANAGER/COS can still open the
      // Title Assignment Dialog.
      const classes = `inline-flex items-center ${sizeClasses} rounded-full border font-bold tracking-wider transition-colors
            bg-gray-500/10 text-gray-400 border-gray-500/25
            ${onClick ? 'hover:bg-gray-500/20 cursor-pointer' : 'cursor-default'}`
      return renderBadge(classes, <>MEMBER</>)
    }

    case 'assistant': {
      // R39.2 ASSISTANT — a user's bound assistant agent (planning + programming
      // mix, no agent/team-creation). Teal badge, distinct from the agent titles.
      const classes = `inline-flex items-center ${sizeClasses} rounded-full border font-bold tracking-wider transition-colors
            bg-teal-500/15 text-teal-400 border-teal-500/30
            ${onClick ? 'hover:bg-teal-500/25 cursor-pointer' : 'cursor-default'}`
      return renderBadge(classes, <><Bot className={iconSize} />ASSISTANT</>)
    }

    default: {
      // NT-022: Exhaustiveness check — if all GovernanceTitle variants are handled above,
      // this line will cause a compile-time error when a new variant is added but not handled.
      const _exhaustive: never = title
      // Fallback for any future title values not yet handled explicitly.
      // CC-P1-708: Use String() instead of `as string` to convert the exhausted `never` type safely.
      const displayLabel = String(_exhaustive).toUpperCase()
      const classes = `inline-flex items-center ${sizeClasses} rounded-full border font-medium transition-colors
            bg-gray-500/20 text-gray-300 border-gray-500/30
            ${onClick ? 'hover:bg-gray-500/30 cursor-pointer' : 'cursor-default'}`
      return renderBadge(classes, <><Shield className={iconSize} />{displayLabel}</>)
    }
  }
}
