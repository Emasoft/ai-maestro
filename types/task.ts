/**
 * Task types for the Shared Task List feature
 *
 * Tasks belong to teams and support dependency chains
 * with auto-unblocking when dependencies complete.
 *
 * TaskStatus is a string to support per-team configurable kanban columns.
 * DEFAULT_STATUSES preserves backward compatibility with the original 5-column system.
 */

export type TaskStatus = string

/**
 * First-class task-type catalogue. `taskType` stays a `string` for back-compat with
 * existing stored tasks + GitHub bare-type labels (bug/enhancement/… that aren't in
 * the TRDD set), but TASK_TYPES is the canonical set the create form offers and the
 * kanban renderer / pillar skills validate against. Mirrors the TRDD `task-type:` values.
 */
export const TASK_TYPES = [
  'feature', 'bugfix', 'refactor', 'docs', 'infra',
  'security', 'artifact', 'spike', 'audit', 'epic', 'chore',
] as const
export type TaskType = (typeof TASK_TYPES)[number]

/**
 * The 17 default statuses — used when a team has no custom kanban config.
 * 14 TRDD-v2 lifecycle stages followed by 3 orthogonal exception states
 * (blocked / failed / superseded). Order matches DEFAULT_KANBAN_COLUMNS in
 * types/team.ts so the two sources stay aligned.
 */
export const DEFAULT_STATUSES: string[] = [
  'backburner',
  'todo',
  'design',
  'dispatch',
  'dev',
  'testing',
  'ai_review',
  'human_review',
  'complete',
  'publish',
  'published',
  'deploy',
  'live',
  'live_auditing',
  'blocked',
  'failed',
  'superseded',
]

export interface TaskAttachment {
  url: string                    // Link or file URL (load-bearing)
  name?: string                  // Display name
  kind?: string                  // e.g. "pr", "doc", "image", "log"
}

export interface Task {
  id: string                     // UUID
  teamId: string                 // Team this task belongs to
  subject: string                // "Implement user auth endpoint"
  description?: string           // Detailed description / acceptance criteria
  status: TaskStatus
  assigneeAgentId?: string | null
  blockedBy: string[]            // Task IDs that must complete first
  priority?: number              // 0=highest (optional ordering)
  createdAt: string
  updatedAt: string
  startedAt?: string
  completedAt?: string

  // Extended fields for role-plugin integration (orchestrator, integrator, etc.)
  labels?: string[]              // Tags: status:*, assign:*, priority:*
  taskType?: string              // feature, bug, chore, epic
  externalRef?: string           // GitHub issue URL or number
  externalProjectRef?: string    // GitHub Projects V2 item ID
  previousStatus?: string        // For Blocked->restore flow (save column before moving to blocked)
  acceptanceCriteria?: string[]  // From AMOA module specs
  handoffDoc?: string            // Path to handoff document
  prUrl?: string                 // PR URL when in review
  reviewResult?: string          // pass|fail from integrator

  // TRDD-v2 alignment fields (additive, all optional) — mirror the TRDD frontmatter
  // schema so a kanban task can carry the same classification / relationship /
  // delivery / evidence metadata a TRDD does. taskType stays a string (see above).
  severity?: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'NIT'
  effort?: 'S' | 'M' | 'L' | 'XL'
  parentTask?: string            // Task ID that spawned this one
  npt?: string[]                 // Necessary Prerequisite Task IDs
  eht?: string[]                 // Effects Handling Task IDs
  supersedes?: string[]          // Task IDs this one replaces
  supersededBy?: string[]        // Task IDs that replace this one (set when status=superseded)
  relevantRules?: string[]       // PRRD rule numbers this task must comply with
  releaseVia?: 'publish' | 'deploy' | 'none'
  implementationCommits?: string[] // SHAs where this task's code landed (backtracking)
  lastTestResult?: 'not-run' | 'pass' | 'fail' | 'partial'
  publishedVersion?: string      // Version published (when status reaches published)
  liveSince?: string             // ISO timestamp when deployed live
  attachments?: TaskAttachment[] // Links / files attached to the task
  dueDate?: string               // ISO 8601 due date
}

export interface TaskWithDeps extends Task {
  blocks: string[]               // Derived: task IDs this blocks (computed on read)
  isBlocked: boolean             // true if any blockedBy task not completed
  assigneeName?: string          // Resolved agent display name
  assigneeAvatar?: string        // Agent avatar URL (e.g., "/avatars/men_01.jpg")
}

export interface TasksFile {
  version: 1
  tasks: Task[]
}
