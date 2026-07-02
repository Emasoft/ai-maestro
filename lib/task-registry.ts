/**
 * Task Registry - File-based CRUD for team task persistence
 *
 * Storage: ~/.aimaestro/teams/tasks-{teamId}.json (one per team)
 * Mirrors the pattern from lib/team-registry.ts
 */

import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import { loadAgents } from '@/lib/agent-registry'
import { getTeam } from '@/lib/team-registry'
import { withLock } from '@/lib/file-lock'
import { isValidUuid } from '@/lib/validation'
import { DEFAULT_STATUSES } from '@/types/task'
import type { Task, TaskWithDeps, TasksFile } from '@/types/task'
import { statePath } from '@/lib/ecosystem-constants'

/**
 * Legacy status -> TRDD-v2 status migration map.
 * The original 5-column kanban used these statuses; the 14-stage pipeline
 * renamed them. Migration is applied at read time (loadTasks) and is idempotent
 * — a status not in this map (already-new, or a custom column id) passes through
 * unchanged.
 */
const STATUS_MIGRATION: Record<string, string> = {
  backlog: 'backburner',
  pending: 'todo',
  in_progress: 'dev',
  review: 'ai_review',
  completed: 'complete',
}

/**
 * Migrate a single legacy status string to its TRDD-v2 equivalent.
 * Idempotent: an unrecognized status (a new status, or a custom kanban column id)
 * is returned unchanged, so re-running migration never double-maps.
 */
export function migrateStatus(status: string): string {
  return STATUS_MIGRATION[status] ?? status
}

/**
 * The set of status ids a task may legally hold for a given team.
 * Uses the team's custom kanban column ids when configured, otherwise the
 * 17 DEFAULT_STATUSES. A missing/unknown team falls back to DEFAULT_STATUSES so
 * validation degrades safely rather than rejecting every status.
 */
function validStatusesForTeam(teamId: string): string[] {
  const team = getTeam(teamId)
  return team?.kanbanConfig?.map(c => c.id) ?? DEFAULT_STATUSES
}

const TEAMS_DIR = statePath('teams')

function ensureTeamsDir() {
  if (!fs.existsSync(TEAMS_DIR)) {
    fs.mkdirSync(TEAMS_DIR, { recursive: true })
  }
}

function tasksFilePath(teamId: string): string {
  // NT-020: Use shared isValidUuid instead of duplicating UUID regex
  if (!isValidUuid(teamId)) throw new Error('Invalid team ID')
  // Defense-in-depth: use basename to strip any directory components
  return path.join(TEAMS_DIR, path.basename(`tasks-${teamId}.json`))
}

export function loadTasks(teamId: string): Task[] {
  try {
    ensureTeamsDir()
    const filePath = tasksFilePath(teamId)
    if (!fs.existsSync(filePath)) {
      return []
    }
    const data = fs.readFileSync(filePath, 'utf-8')
    const parsed: TasksFile = JSON.parse(data)
    if (!Array.isArray(parsed.tasks)) return []
    // Normalize any legacy status to its TRDD-v2 equivalent at read time so the
    // rest of the codebase only ever sees current status ids (idempotent).
    return parsed.tasks.map(t => ({ ...t, status: migrateStatus(t.status) }))
  } catch (error) {
    console.error(`Failed to load tasks for team ${teamId}:`, error)
    return []
  }
}

// SF-028: Throws on error instead of returning false -- callers already ignore the return value.
// The previous boolean return masked write failures silently.
export function saveTasks(teamId: string, tasks: Task[]): void {
  ensureTeamsDir()
  const file: TasksFile = { version: 1, tasks }
  const filePath = tasksFilePath(teamId)
  // MF-024: Atomic write -- write to temp file then rename to avoid corruption on crash
  const tmpPath = `${filePath}.tmp.${process.pid}`
  fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2), 'utf-8')
  fs.renameSync(tmpPath, filePath)
}

/**
 * Resolve task dependencies and compute derived fields
 */
export function resolveTaskDeps(tasks: Task[]): TaskWithDeps[] {
  if (tasks.length === 0) return []
  // loadAgents() has internal caching (_cachedAgents), so repeated calls are cheap
  const agents = loadAgents()
  const taskMap = new Map(tasks.map(t => [t.id, t]))

  return tasks.map(task => {
    // Compute blocks (reverse of blockedBy)
    const blocks = tasks
      .filter(t => t.blockedBy.includes(task.id))
      .map(t => t.id)

    // Compute isBlocked — a dependency that has not reached the terminal
    // 'complete' status still blocks (TRDD-v2 renamed 'completed' -> 'complete').
    const isBlocked = task.blockedBy.some(depId => {
      const dep = taskMap.get(depId)
      return dep && dep.status !== 'complete'
    })

    // Resolve assignee: try by ID, then by name/alias/label (for assign: labels from GitHub)
    let assigneeName: string | undefined
    let assigneeAvatar: string | undefined
    if (task.assigneeAgentId) {
      const agentId = task.assigneeAgentId
      const agent = agents.find(a =>
        a.id === agentId ||
        a.name === agentId ||
        a.alias === agentId ||
        (a.label && a.label.toLowerCase() === agentId.toLowerCase())
      )
      if (agent) {
        assigneeName = agent.label || agent.name || agent.alias || agent.id.slice(0, 8)
        assigneeAvatar = agent.avatar
      } else {
        // No matching agent found — use the raw ID/name as display name
        assigneeName = agentId
      }
    }

    return {
      ...task,
      blocks,
      isBlocked,
      assigneeName,
      assigneeAvatar,
    }
  })
}

export function createTask(data: {
  teamId: string
  subject: string
  description?: string
  assigneeAgentId?: string | null
  blockedBy?: string[]
  priority?: number
  status?: string
  labels?: string[]
  taskType?: string
  externalRef?: string
  externalProjectRef?: string
  acceptanceCriteria?: string[]
  handoffDoc?: string
  prUrl?: string
  reviewResult?: string
  // TRDD-v2 alignment fields (additive)
  severity?: Task['severity']
  effort?: Task['effort']
  parentTask?: string
  npt?: string[]
  eht?: string[]
  supersedes?: string[]
  supersededBy?: string[]
  relevantRules?: string[]
  releaseVia?: Task['releaseVia']
  implementationCommits?: string[]
  lastTestResult?: Task['lastTestResult']
  publishedVersion?: string
  liveSince?: string
  attachments?: Task['attachments']
  dueDate?: string
}): Promise<Task> {
  return withLock('tasks-' + data.teamId, () => {
    const tasks = loadTasks(data.teamId)
    const now = new Date().toISOString()

    // Default to 'todo' (skip 'backburner') — tasks created via API are considered already triaged
    const status = data.status || 'todo'
    // Reject a status that is not a valid column for this team (custom kanban or defaults).
    const validStatuses = validStatusesForTeam(data.teamId)
    if (!validStatuses.includes(status)) {
      throw new Error(`Invalid task status: ${status}`)
    }

    const task: Task = {
      id: uuidv4(),
      teamId: data.teamId,
      subject: data.subject,
      description: data.description,
      status,
      // SF-034: Use || instead of ?? to normalize empty string to null (empty string is not a valid agent ID)
      assigneeAgentId: data.assigneeAgentId || null,
      blockedBy: data.blockedBy ?? [],
      priority: data.priority,
      labels: data.labels,
      taskType: data.taskType,
      externalRef: data.externalRef,
      externalProjectRef: data.externalProjectRef,
      acceptanceCriteria: data.acceptanceCriteria,
      handoffDoc: data.handoffDoc,
      prUrl: data.prUrl,
      reviewResult: data.reviewResult,
      severity: data.severity,
      effort: data.effort,
      parentTask: data.parentTask,
      npt: data.npt,
      eht: data.eht,
      supersedes: data.supersedes,
      supersededBy: data.supersededBy,
      relevantRules: data.relevantRules,
      releaseVia: data.releaseVia,
      implementationCommits: data.implementationCommits,
      lastTestResult: data.lastTestResult,
      publishedVersion: data.publishedVersion,
      liveSince: data.liveSince,
      attachments: data.attachments,
      dueDate: data.dueDate,
      createdAt: now,
      updatedAt: now,
    }

    tasks.push(task)
    saveTasks(data.teamId, tasks)
    return task
  })
}

export function getTask(teamId: string, taskId: string): Task | null {
  const tasks = loadTasks(teamId)
  return tasks.find(t => t.id === taskId) || null
}

/**
 * Update a task and return newly unblocked tasks if status changed to completed
 */
export function updateTask(
  teamId: string,
  taskId: string,
  updates: Partial<Pick<Task,
    | 'subject' | 'description' | 'status' | 'assigneeAgentId' | 'blockedBy' | 'priority'
    | 'labels' | 'taskType' | 'externalRef' | 'externalProjectRef' | 'previousStatus'
    | 'acceptanceCriteria' | 'handoffDoc' | 'prUrl' | 'reviewResult'
    // TRDD-v2 alignment fields (additive)
    | 'severity' | 'effort' | 'parentTask' | 'npt' | 'eht' | 'supersedes' | 'supersededBy'
    | 'relevantRules' | 'releaseVia' | 'implementationCommits' | 'lastTestResult'
    | 'publishedVersion' | 'liveSince' | 'attachments' | 'dueDate'
  >>
): Promise<{ task: Task | null; unblocked: Task[] }> {
  return withLock('tasks-' + teamId, () => {
    // Reject an invalid target status before mutating (only when a status change is requested).
    if (updates.status !== undefined && !validStatusesForTeam(teamId).includes(updates.status)) {
      throw new Error(`Invalid task status: ${updates.status}`)
    }

    const tasks = loadTasks(teamId)
    const index = tasks.findIndex(t => t.id === taskId)
    if (index === -1) return { task: null, unblocked: [] }

    const now = new Date().toISOString()
    const wasCompleted = tasks[index].status === 'complete'
    const isNowCompleted = updates.status === 'complete'

    tasks[index] = {
      ...tasks[index],
      ...updates,
      updatedAt: now,
    }

    // Clear timestamps first when moving backward in workflow
    if (updates.status && updates.status !== 'complete') {
      tasks[index].completedAt = undefined
    }
    if (updates.status && (updates.status === 'backburner' || updates.status === 'todo')) {
      tasks[index].startedAt = undefined
    }

    // Then set timestamps based on status changes (after clearing, so intent is unambiguous)
    if (updates.status === 'dev' && !tasks[index].startedAt) {
      tasks[index].startedAt = now
    }
    if (updates.status === 'complete' && !tasks[index].completedAt) {
      tasks[index].completedAt = now
    }

    // Find newly unblocked tasks when a task reaches the terminal 'complete' status
    let unblocked: Task[] = []
    if (!wasCompleted && isNowCompleted) {
      unblocked = tasks.filter(t => {
        if (!t.blockedBy.includes(taskId)) return false
        // Check if ALL blockers are now complete
        return t.blockedBy.every(depId => {
          const dep = tasks.find(d => d.id === depId)
          return dep && dep.status === 'complete'
        })
      })
    }

    saveTasks(teamId, tasks)
    return { task: tasks[index], unblocked }
  })
}

/**
 * Delete a task and clean up references in other tasks' blockedBy arrays
 */
export function deleteTask(teamId: string, taskId: string): Promise<boolean> {
  return withLock('tasks-' + teamId, () => {
    const tasks = loadTasks(teamId)
    const filtered = tasks
      .filter(t => t.id !== taskId)
      .map(t => ({
        ...t,
        blockedBy: t.blockedBy.filter(id => id !== taskId),
      }))

    if (filtered.length === tasks.length) return false
    saveTasks(teamId, filtered)
    return true
  })
}

/**
 * Check if adding a dependency would create a circular reference
 */
export function wouldCreateCycle(teamId: string, taskId: string, dependencyId: string): boolean {
  const tasks = loadTasks(teamId)
  const visited = new Set<string>()

  function hasCycle(currentId: string): boolean {
    if (currentId === taskId) return true
    if (visited.has(currentId)) return false
    visited.add(currentId)

    const task = tasks.find(t => t.id === currentId)
    if (!task) return false

    // Check what this task blocks (tasks that depend on it)
    const blockers = tasks.filter(t => t.blockedBy.includes(currentId))
    return blockers.some(b => hasCycle(b.id))
  }

  return hasCycle(dependencyId)
}
