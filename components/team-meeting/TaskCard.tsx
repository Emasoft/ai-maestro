'use client'

import { Lock, User } from 'lucide-react'
import type { TaskWithDeps, TaskStatus } from '@/types/task'
import type { KanbanColumnConfig } from '@/types/team'
import { DEFAULT_KANBAN_COLUMNS } from '@/types/team'
import { resolveColumnIcon } from './KanbanCard'

interface TaskCardProps {
  task: TaskWithDeps
  onSelect: (task: TaskWithDeps) => void
  onStatusChange: (taskId: string, status: TaskStatus) => void
  /**
   * The dynamic kanban columns for this task's team. The status-toggle icon and
   * its next-status cycle are derived from this config (17-column board), not a
   * hardcoded 5-status map. Optional + backward compatible — falls back to
   * DEFAULT_KANBAN_COLUMNS when omitted.
   */
  kanbanColumns?: KanbanColumnConfig[]
}

// 'complete' is the single terminal-done status (TRDD-v2). Treat legacy values as complete too.
function isCompleteStatus(status: string): boolean {
  return status === 'complete' || status === 'completed' || status === 'done'
}

export default function TaskCard({ task, onSelect, onStatusChange, kanbanColumns }: TaskCardProps) {
  const columns = kanbanColumns && kanbanColumns.length > 0 ? kanbanColumns : DEFAULT_KANBAN_COLUMNS
  const column = columns.find(c => c.id === task.status)
  const StatusIcon = resolveColumnIcon(column?.icon)
  // Derive the icon tint from the column's configured dot color (e.g. "bg-blue-400" -> "text-blue-400").
  const iconColor = column ? column.color.replace(/^bg-/, 'text-') : 'text-gray-400'

  const handleStatusClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (task.isBlocked) return
    // Cycle through the team's configured columns in order; wrap at the end.
    const cycle = columns.map(c => c.id)
    const idx = cycle.indexOf(task.status)
    const next = cycle.length === 0
      ? task.status
      : idx >= 0
        ? cycle[(idx + 1) % cycle.length]
        : cycle[0]
    onStatusChange(task.id, next)
  }

  return (
    // UI2-MAJ-02: Mirror the KanbanCard accessibility pattern — role + tabIndex
    // + onKeyDown so keyboard users can open the task detail view.
    <div
      role="button"
      tabIndex={0}
      onClick={() => onSelect(task)}
      onKeyDown={(e) => {
        if ((e.key === 'Enter' || e.key === ' ') && e.target === e.currentTarget) {
          e.preventDefault()
          onSelect(task)
        }
      }}
      className={`
        flex items-start gap-2 px-2.5 py-2 rounded-lg cursor-pointer transition-all duration-200
        border border-transparent hover:bg-gray-800/60 hover:border-gray-700/50
        focus:outline-none focus:ring-2 focus:ring-emerald-400/70
        ${task.isBlocked ? 'opacity-60' : ''}
      `}
    >
      {/* Status toggle */}
      <button
        onClick={handleStatusClick}
        disabled={task.isBlocked}
        className={`mt-0.5 flex-shrink-0 ${iconColor} hover:opacity-80 transition-opacity ${task.isBlocked ? 'cursor-not-allowed' : ''}`}
        title={task.isBlocked ? 'Blocked by dependencies' : `Status: ${column?.label ?? task.status}`}
      >
        {task.isBlocked ? (
          <Lock className="w-4 h-4 text-amber-500" />
        ) : (
          <StatusIcon className="w-4 h-4" />
        )}
      </button>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <p className={`text-xs leading-snug ${isCompleteStatus(task.status) ? 'text-gray-500 line-through' : 'text-gray-200'}`}>
          {task.subject}
        </p>
        {task.labels && task.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-0.5">
            {task.labels.slice(0, 3).map(label => (
              <span key={label} className="text-[9px] px-1 py-0.5 rounded bg-gray-700/80 text-gray-400">
                {label}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 mt-1">
          {task.assigneeName && (
            <span className="flex items-center gap-1 text-[10px] text-gray-500">
              <User className="w-2.5 h-2.5" />
              {task.assigneeName}
            </span>
          )}
          {task.blockedBy.length > 0 && (
            <span className="text-[10px] text-amber-500/70">
              {task.blockedBy.length} dep{task.blockedBy.length > 1 ? 's' : ''}
            </span>
          )}
          {task.blocks.length > 0 && (
            <span className="text-[10px] text-blue-500/70">
              blocks {task.blocks.length}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}
