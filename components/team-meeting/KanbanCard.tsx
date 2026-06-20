'use client'

import * as LucideIcons from 'lucide-react'
import { Circle, Lock, User, GitPullRequest, GitBranch, CircleDot } from 'lucide-react'
import type { TaskWithDeps } from '@/types/task'
import type { KanbanColumnConfig } from '@/types/team'

type IconComponent = React.ComponentType<{ className?: string }>

/**
 * Resolve a column's lucide icon NAME string (as stored in KanbanColumnConfig.icon)
 * to the actual lucide component. Falls back to Circle for an unknown/missing name.
 * Exported so the board, columns, and detail/section views all resolve icons the
 * same way from the dynamic column config instead of a hardcoded status->icon map.
 */
export function resolveColumnIcon(iconName?: string): IconComponent {
  if (iconName) {
    const candidate = (LucideIcons as unknown as Record<string, IconComponent>)[iconName]
    if (candidate) return candidate
  }
  return Circle
}

// 'complete' is the single terminal-done status (TRDD-v2 renamed the old 'completed').
// Used to strike-through finished cards. We treat the legacy 'completed'/'done' values as
// complete too so cards that haven't been migrated yet still render struck-through.
function isCompleteStatus(status: string): boolean {
  return status === 'complete' || status === 'completed' || status === 'done'
}

// Priority indicator colors: 0=critical(red), 1=high(amber), 2=medium(blue), 3+=low(gray)
const PRIORITY_COLORS: Record<number, string> = {
  0: 'bg-red-500',
  1: 'bg-amber-500',
  2: 'bg-blue-500',
}

// Stable color palette for label pills — hash-based assignment
const LABEL_COLORS = [
  'bg-purple-800/60 text-purple-300',
  'bg-blue-800/60 text-blue-300',
  'bg-emerald-800/60 text-emerald-300',
  'bg-amber-800/60 text-amber-300',
  'bg-pink-800/60 text-pink-300',
  'bg-cyan-800/60 text-cyan-300',
]
function labelColor(label: string): string {
  const hash = label.split('').reduce((acc, c) => c.charCodeAt(0) + ((acc << 5) - acc), 0)
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length]
}

/** Agent status info passed from the board — mirrors the 5-state model from AgentBadge */
interface AgentStatusOnCard {
  color: string   // Tailwind bg class: 'bg-green-500', 'bg-amber-500', 'bg-orange-500', 'bg-gray-400'
  pulse: boolean  // true = animate-pulse (permission, waiting, active)
  label: string   // 'Active', 'Idle', 'Waiting', 'Permission', 'Exited', 'Offline'
}

interface KanbanCardProps {
  task: TaskWithDeps
  onSelect: (task: TaskWithDeps) => void
  isSelected?: boolean
  /** Optional agent status indicator — shown as a small dot on the avatar */
  agentStatus?: AgentStatusOnCard
  /**
   * The column config this card's status belongs to. When provided, the card's
   * fallback status icon is derived from the column's configured lucide icon
   * (so it stays in sync with the 17-column board). Optional + backward
   * compatible — without it the card falls back to a plain Circle.
   */
  column?: KanbanColumnConfig
}

// Stable color palette for assignee avatar circles — hash-based assignment
const ASSIGNEE_COLORS = [
  'bg-purple-600', 'bg-blue-600', 'bg-emerald-600', 'bg-amber-600',
  'bg-pink-600', 'bg-cyan-600', 'bg-indigo-600', 'bg-rose-600',
]
function assigneeColor(name: string): string {
  const hash = name.split('').reduce((acc, c) => c.charCodeAt(0) + ((acc << 5) - acc), 0)
  return ASSIGNEE_COLORS[Math.abs(hash) % ASSIGNEE_COLORS.length]
}

export default function KanbanCard({ task, onSelect, isSelected, agentStatus, column }: KanbanCardProps) {
  // Derive the fallback status icon from the dynamic column config (17-column board),
  // not a hardcoded status->icon map that drifts when the column set changes.
  const Icon = resolveColumnIcon(column?.icon)
  const priorityDot = task.priority != null ? (PRIORITY_COLORS[task.priority] || 'bg-gray-500') : null
  const isComplete = isCompleteStatus(task.status)

  // Filter out Title: pseudo-labels and assign: labels (shown as assignee instead)
  const displayLabels = (task.labels || []).filter(l => !l.startsWith('Title:') && !l.startsWith('assign:'))

  const handleDragStart = (e: React.DragEvent) => {
    if (task.isBlocked) {
      e.preventDefault()
      return
    }
    e.dataTransfer.setData('text/plain', task.id)
    e.dataTransfer.effectAllowed = 'move'
  }

  // Build dynamic class string for the card wrapper
  const blockedStyle = task.isBlocked ? 'opacity-60 cursor-not-allowed border-amber-700/50' : 'active:opacity-50'
  const selectedGlow = isSelected ? 'shadow-[0_0_15px_rgba(16,185,129,0.3)] ring-1 ring-emerald-500/50' : ''
  const hoverGlow = 'hover:shadow-[0_0_10px_rgba(255,255,255,0.05)]'

  // Subject content — reused for both linked and plain rendering
  const subjectContent = (
    <span className={`text-xs leading-snug line-clamp-2 ${isComplete ? 'text-gray-500 line-through' : 'text-gray-200'}`}>
      {task.subject}
    </span>
  )

  return (
    <div
      draggable={!task.isBlocked}
      onDragStart={handleDragStart}
      onClick={() => onSelect(task)}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(task) } }}
      tabIndex={0}
      role="button"
      title={task.description ? task.description.slice(0, 200) + (task.description.length > 200 ? '...' : '') : undefined}
      className={`group px-3 py-3 rounded-lg cursor-pointer transition-all duration-200 bg-gray-800/80 border border-gray-700/50 hover:border-gray-600/80 hover:bg-gray-800 ${blockedStyle} ${selectedGlow} ${hoverGlow}`}
    >
      {/* Top row: priority dot + subject (clickable if external) */}
      <div className="flex items-start gap-1.5">
        {task.priority != null && (
          <span className="flex items-center gap-1">
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${priorityDot}`} />
            <span className={`text-[10px] font-medium ${
              task.priority === 0 ? 'text-red-400' :
              task.priority === 1 ? 'text-amber-400' :
              task.priority === 2 ? 'text-blue-400' : 'text-gray-400'
            }`}>
              P{task.priority}
            </span>
          </span>
        )}
        {/* Clickable subject for external items — opens GitHub in new tab */}
        {task.externalRef ? (
          <a
            href={task.externalRef}
            target="_blank"
            rel="noopener noreferrer"
            onClick={e => e.stopPropagation()}
            className="hover:underline hover:text-blue-300 transition-colors"
          >
            {subjectContent}
          </a>
        ) : subjectContent}
      </div>

      {/* Labels — Title: pseudo-labels filtered out */}
      {displayLabels.length > 0 && (
        <div className="flex flex-wrap gap-1 mt-1.5">
          {displayLabels.slice(0, 3).map(label => (
            <span key={label} className={`text-[9px] px-1.5 py-0.5 rounded-full ${labelColor(label)}`}>
              {label}
            </span>
          ))}
          {displayLabels.length > 3 && (
            <span className="text-[9px] text-gray-600">+{displayLabels.length - 3}</span>
          )}
        </div>
      )}

      {/* Bottom section: left metadata (stacked, shrinkable) | right avatar frame (fixed size) */}
      <div className="flex items-end gap-2 mt-3 -mb-3 -mr-3">
        {/* LEFT: two rows stacked — shrinks if needed so avatar frame stays in place */}
        <div className="flex flex-col gap-1.5 min-w-0 flex-1 mb-3 overflow-hidden">
          {/* Row 1: issue/PR icon + number */}
          {task.externalRef ? (() => {
            const isPR = task.externalRef.includes('/pull/')
            const issueMatch = task.externalRef.match(/(?:issues|pull)\/(\d+)/)
            if (!issueMatch) return null
            const TypeIcon = isPR ? GitPullRequest : CircleDot
            const isCompleted = isComplete
            return (
              <a
                href={task.externalRef}
                target="_blank"
                rel="noopener noreferrer"
                onClick={e => e.stopPropagation()}
                className={`flex items-center gap-1.5 text-[10px] font-mono hover:underline ${
                  isCompleted ? 'text-purple-400' : 'text-green-400'
                }`}
                title={`Open ${isPR ? 'PR' : 'issue'} #${issueMatch[1]} on GitHub`}
              >
                <TypeIcon className="w-4 h-4 flex-shrink-0" />
                <span>#{issueMatch[1]}</span>
              </a>
            )
          })() : <div className="h-4" />}

          {/* Row 2: repo icon + repo name (linked), or blocked/deps/type fallback */}
          <div className="flex items-center gap-1.5">
            {task.isBlocked ? (
              <span title="Task is blocked"><Lock className="w-4 h-4 text-amber-500 flex-shrink-0" /></span>
            ) : task.externalRef ? (() => {
              const repoMatch = task.externalRef.match(/github\.com\/([^/]+)\/([^/]+)/)
              if (!repoMatch) return <GitBranch className="w-4 h-4 text-gray-500 flex-shrink-0" />
              const repoOwner = repoMatch[1]
              const repoName = repoMatch[2]
              const repoFull = `${repoOwner}/${repoName}`
              // Private repo heuristic: personal account owners (not well-known orgs)
              // show a lock icon and warmer color as a visual hint
              const isLikelyPrivate = repoOwner === repoOwner.toLowerCase() && !repoOwner.includes('-')
              return (
                <a
                  href={`https://github.com/${repoFull}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={e => e.stopPropagation()}
                  className={`flex items-center gap-1.5 text-[9px] hover:text-gray-300 hover:underline transition-colors min-w-0 ${
                    isLikelyPrivate ? 'text-gray-400' : 'text-gray-500'
                  }`}
                  title={`${repoFull}${isLikelyPrivate ? ' (private)' : ''}`}
                >
                  <GitBranch className="w-4 h-4 flex-shrink-0" />
                  {isLikelyPrivate && <Lock className="w-2.5 h-2.5 flex-shrink-0 text-gray-500" />}
                  <span className="truncate">{(() => {
                    const full = `github.com/${repoFull}`
                    if (full.length <= 28) return full
                    // Middle truncation: keep start (github.com/) + end (/repoName)
                    return `github.com/…/${repoName}`
                  })()}</span>
                </a>
              )
            })() : (
              <Icon className="w-4 h-4 text-gray-500 flex-shrink-0" />
            )}
            {!task.externalRef && task.taskType && (
              <span className="text-[9px] text-gray-500">{task.taskType}</span>
            )}
            {task.blockedBy.length > 0 && (
              <span className="text-[9px] text-amber-500/70 ml-1">{task.blockedBy.length} dep{task.blockedBy.length > 1 ? 's' : ''}</span>
            )}
          </div>
        </div>

        {/* RIGHT: avatar frame — square image clipped to frame shape, flush with card bottom-right.
             Top-left corner has inset shadow giving depth (image appears below card surface).
             Shadow only on top+left inner edges, not bottom+right (those merge with card border). */}
        {task.assigneeName ? (
          <div
            className="relative flex-shrink-0 w-16 h-16 rounded-br-lg rounded-tl-lg overflow-hidden border-t border-l border-gray-600/50"
            title={`${task.assigneeName}${agentStatus ? ` — ${agentStatus.label}` : ''}`}
          >
            {/* Square avatar image fills the entire frame */}
            {task.assigneeAvatar ? (
              <img
                src={task.assigneeAvatar}
                alt={task.assigneeName}
                className="w-full h-full object-cover"
              />
            ) : (
              <div className={`w-full h-full flex items-center justify-center text-lg font-semibold text-white uppercase ${assigneeColor(task.assigneeName)}`}>
                {task.assigneeName.charAt(0)}
              </div>
            )}
            {/* Inset shadow — two thin strips along top and left edges only,
                 simulating the image being tucked under a ledge. Each strip
                 fades from dark at the edge to transparent ~8px inward.
                 No shadow on bottom or right sides. */}
            <div className="absolute inset-0 pointer-events-none rounded-br-lg rounded-tl-lg"
              style={{
                background: [
                  'linear-gradient(to bottom, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.2) 4px, transparent 8px)',
                  'linear-gradient(to right, rgba(0,0,0,0.5) 0%, rgba(0,0,0,0.2) 4px, transparent 8px)',
                ].join(', '),
              }}
            />
            {/* Agent status dot — top-right corner */}
            {agentStatus && (
              <span
                className={`absolute top-1 right-1 w-3 h-3 rounded-full border-2 border-gray-800 ${agentStatus.color} ${agentStatus.pulse ? 'animate-pulse' : ''}`}
                title={agentStatus.label}
              />
            )}
          </div>
        ) : (
          <div
            className="relative flex-shrink-0 w-16 h-16 rounded-br-lg rounded-tl-lg overflow-hidden border-t border-l border-gray-700/30 bg-gray-800/50"
            title="Unassigned"
          >
            <div className="w-full h-full flex items-center justify-center">
              <User className="w-6 h-6 text-gray-600" />
            </div>
            <div className="absolute inset-0 pointer-events-none rounded-br-lg rounded-tl-lg"
              style={{
                background: [
                  'linear-gradient(to bottom, rgba(0,0,0,0.35) 0%, transparent 6px)',
                  'linear-gradient(to right, rgba(0,0,0,0.35) 0%, transparent 6px)',
                ].join(', '),
              }}
            />
          </div>
        )}
      </div>
    </div>
  )
}
