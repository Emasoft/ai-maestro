
/**
 * Teams Service
 *
 * Pure business logic extracted from app/api/teams/** routes.
 * No HTTP concepts (Request, Response, NextResponse, headers) leak into this module.
 * API routes become thin wrappers that call these functions.
 *
 * Covers:
 *   GET    /api/teams                          -> listAllTeams
 *   POST   /api/teams                          -> createNewTeam
 *   GET    /api/teams/[id]                     -> getTeamById
 *   PUT    /api/teams/[id]                     -> updateTeamById
 *   DELETE /api/teams/[id]                     -> deleteTeamById
 *   GET    /api/teams/[id]/tasks               -> listTeamTasks
 *   POST   /api/teams/[id]/tasks               -> createTeamTask
 *   GET    /api/teams/[id]/tasks/[taskId]      -> getTeamTask
 *   PUT    /api/teams/[id]/tasks/[taskId]      -> updateTeamTask
 *   DELETE /api/teams/[id]/tasks/[taskId]      -> deleteTeamTask
 *   GET    /api/teams/[id]/documents            -> listTeamDocuments
 *   POST   /api/teams/[id]/documents            -> createTeamDocument
 *   GET    /api/teams/[id]/documents/[docId]    -> getTeamDocument
 *   PUT    /api/teams/[id]/documents/[docId]    -> updateTeamDocument
 *   DELETE /api/teams/[id]/documents/[docId]    -> deleteTeamDocument
 *   POST   /api/teams/notify                    -> notifyTeamAgents
 */

import { join } from 'path'
import { loadTeams, createTeam, getTeam, updateTeam, deleteTeam, TeamValidationException } from '@/lib/team-registry'
// Local task-registry removed (governance simplification 2026-03-27) — kanban uses GitHub Projects exclusively
import { loadDocuments, createDocument, getDocument, updateDocument, deleteDocument } from '@/lib/document-registry'
import * as ghProject from '@/lib/github-project'
import type { Task, TaskWithDeps } from '@/types/task'
import type { Team, KanbanColumnConfig } from '@/types/team'
import { DEFAULT_KANBAN_COLUMNS } from '@/types/team'
import type { TeamDocument } from '@/types/document'
import { getAgent, loadAgents } from '@/lib/agent-registry'
import { notifyAgent } from '@/lib/notification-service'
import { getManagerId, isManager, isChiefOfStaffAnywhere, verifyPassword, loadGovernance } from '@/lib/governance'
import { checkAndRecordAttempt, resetRateLimit } from '@/lib/rate-limit'
import { checkTeamAccess } from '@/lib/team-acl'
import { isValidUuid } from '@/lib/validation'
import type { TeamType } from '@/types/governance'
import type { AuthContext } from '@/lib/agent-auth'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

import { ServiceResult } from '@/types/service'
// NT-006: ServiceResult re-export removed — import directly from @/types/service

// SVC2-MAJ-11 fix (2026-05-06): every entry point that takes a caller-supplied
// `requestingAgentId` MUST cross-check it against the verified `authContext`.
// Previously a caller could spoof `requestingAgentId: <managerId>` while
// presenting an entirely different agent's auth token (or no token at all in
// the SRV-CRIT-02 cluster), and checkTeamAccess would happily authorize as
// MANAGER. Now: when both are present and `authContext` is NOT system-owner,
// they must match. System-owner is exempt — the web-UI legitimately acts on
// behalf of any agentId in some flows.
function rejectMismatchedRequestingAgentId(
  requestingAgentId: string | undefined,
  authContext: AuthContext | undefined
): ServiceResult<never> | null {
  if (!requestingAgentId) return null
  if (!authContext) return null // checkTeamAccess will fail-closed for anonymous
  if (authContext.isSystemOwner) return null
  if (authContext.agentId && authContext.agentId !== requestingAgentId) {
    return {
      error: `Caller-supplied requestingAgentId (${requestingAgentId}) does not match authenticated identity (${authContext.agentId}). Spoofing the requestingAgentId field is not permitted.`,
      status: 403,
    }
  }
  return null
}

export interface CreateTeamParams {
  name: string
  description?: string
  agentIds?: string[]
  type?: TeamType
  chiefOfStaffId?: string
  orchestratorId?: string
  // SCEN-005.03 + SCEN-010.02 (second option, 2026-04-30): optional link to
  // an existing GitHub Projects v2 board. When set, the team's kanban will
  // sync with this project (the pre-existing behaviour for teams that have
  // `team.githubProject` set is preserved). LINK only — no project creation.
  githubProject?: { owner: string; repo: string; number: number }
  requestingAgentId?: string
  // LIB2-CRIT-02 follow-up (2026-05-06): callers MUST forward the AuthContext
  // built from authenticateFromRequest(request) so checkTeamAccess can
  // distinguish a verified web-UI session from an anonymous request that
  // simply omitted X-Agent-Id. Optional only because the existing API
  // signature accepts an optional requestingAgentId; downstream Change*
  // calls will reject if it's missing.
  authContext?: AuthContext
}

export interface UpdateTeamParams {
  name?: string
  description?: string
  agentIds?: string[]
  lastMeetingAt?: string
  instructions?: string
  lastActivityAt?: string
  type?: TeamType
  chiefOfStaffId?: string | null
  orchestratorId?: string | null
  githubProject?: { owner: string; repo: string; number: number } | null
  requestingAgentId?: string
  authContext?: AuthContext
}

export interface CreateTaskParams {
  subject: string
  description?: string
  // SF-007: Allow null to explicitly unassign -- matches task-registry's `string | null` type
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
  // TRDD-v2 alignment fields (additive, all optional) — mirror the Task schema so
  // the service layer can carry the same classification/relationship/delivery metadata.
  severity?: Task['severity']
  effort?: Task['effort']
  parentTask?: string
  npt?: string[]
  eht?: string[]
  supersedes?: string[]
  relevantRules?: string[]
  releaseVia?: Task['releaseVia']
  requestingAgentId?: string
  authContext?: AuthContext
}

export interface UpdateTaskParams {
  subject?: string
  description?: string
  status?: string
  // SF-008: Allow null to explicitly unassign -- matches task-registry's `string | null` type
  assigneeAgentId?: string | null
  blockedBy?: string[]
  priority?: number
  labels?: string[]
  taskType?: string
  externalRef?: string
  externalProjectRef?: string
  previousStatus?: string
  acceptanceCriteria?: string[]
  handoffDoc?: string
  prUrl?: string
  reviewResult?: string
  // TRDD-v2 alignment fields (additive, all optional) — mirror the Task schema.
  severity?: Task['severity']
  effort?: Task['effort']
  parentTask?: string
  npt?: string[]
  eht?: string[]
  supersedes?: string[]
  relevantRules?: string[]
  releaseVia?: Task['releaseVia']
  requestingAgentId?: string
  authContext?: AuthContext
}

export interface CreateDocumentParams {
  title: string
  content?: string
  pinned?: boolean
  tags?: string[]
  requestingAgentId?: string
  authContext?: AuthContext
}

export interface UpdateDocumentParams {
  title?: string
  content?: string
  pinned?: boolean
  tags?: string[]
  requestingAgentId?: string
  authContext?: AuthContext
}

export interface NotifyTeamParams {
  agentIds: string[]
  teamName: string
}

// SF-004: Concrete type for notification results (replaces any[])
export interface AgentNotifyResult {
  agentId: string
  agentName?: string
  success: boolean
  reason?: string
  error?: string
}

// Local VALID_TASK_STATUSES removed — task status validation done by GitHub Projects

// ===========================================================================
// PUBLIC API -- called by API routes
// ===========================================================================

// ---------------------------------------------------------------------------
// Teams CRUD
// ---------------------------------------------------------------------------

/**
 * List all teams.
 */
export function listAllTeams(): ServiceResult<{ teams: Team[] }> {
  const teams = loadTeams()
  return { data: { teams }, status: 200 }
}

/**
 * Create a new team (always closed after governance simplification).
 * Governance: passes managerId and agentNames to createTeam for business rule enforcement.
 * All teams are closed — the type parameter is ignored.
 */
export async function createNewTeam(params: CreateTeamParams): Promise<ServiceResult<{ team: any; needsChiefOfStaff?: boolean }>> {
  const { name, description, agentIds } = params

  if (!name || typeof name !== 'string') {
    return { error: 'Team name is required', status: 400 }
  }

  if (agentIds && !Array.isArray(agentIds)) {
    return { error: 'agentIds must be an array', status: 400 }
  }

  // ── R40 foreign-user gate for create_team ──────────────────────────────
  // M3 fix (2026-06-19 R26-R40 audit): `create_team` is in
  // R40_RESTRICTABLE_COMMANDS but assertForeignUserMayCall was wired ONLY into
  // CreateAgent (G00f). Every team-creation entry point routes through
  // createNewTeam (the Next.js routes AND headless), so gating here closes the
  // gap for all of them: an approved foreign user (model-ON) without a
  // `create_team` grant is refused BEFORE any side effect, exactly like the
  // create_agent gate. INERT WHEN THE MODEL IS OFF — no userId is resolved then,
  // so isForeignUser() is false and assertForeignUserMayCall() returns null
  // (zero behavior change for the single-operator deployment). Native users, the
  // MAESTRO/system-owner, and agent callers are also passed through here (their
  // authority is governed by the MANAGER/web-UI title gate + R28 below). Dynamic
  // import mirrors the ChangeTitle calls below — element-management-service
  // dynamically imports teams-service, so a static edge here would cycle.
  {
    const { assertForeignUserMayCall } = await import('@/services/element-management-service')
    const foreignErr = await assertForeignUserMayCall(params.authContext, 'create_team')
    if (foreignErr) {
      return { error: foreignErr, status: 403 }
    }
  }

  // Governance: teams require an existing MANAGER first
  const existingManagerId = getManagerId()
  if (!existingManagerId) {
    return { error: 'Teams require an existing MANAGER first. Assign the MANAGER title to an agent before creating teams.', status: 400 }
  }

  // Governance: only MANAGER or web UI (no requestingAgentId) can create teams
  if (params.requestingAgentId) {
    const managerId = getManagerId()
    if (managerId && managerId !== params.requestingAgentId) {
      return { error: 'Only the MANAGER agent can create teams. Use the dashboard to create teams without manager role.', status: 403 }
    }
  }

  // ── Portfolio / mandate token check (R28 check #3) — mirrors CreateAgent
  // G01e ──────────────────────────────────────────────────────────────────
  // The THIRD authorization check, after (1) AID identity and (2) the
  // MANAGER/web-UI title gate above. A DELEGATED caller (a COS holding a
  // `team:create` mandate, etc.) without a valid, ledger-anchored mandate is
  // refused BEFORE any team or COS-agent side effect. System-owner (no
  // authContext / isSystemOwner) and MANAGER are the mint authority and bypass
  // it inside matchPortfolioToken. While OPERATIONS_REQUIRING_TOKEN is empty
  // (D2) this is a pure no-op with zero behavior change. If a ONE-SHOT approval
  // matched, its id is threaded to the consume-after-success tail below so the
  // token is burned ONLY after the team persists (R28 §4.3).
  let matchedPortfolioTokenId: string | null = null
  {
    const { matchPortfolioToken } = await import('@/lib/portfolio-check')
    const tokMatch = await matchPortfolioToken(params.authContext ?? { isSystemOwner: true }, 'CreateTeam')
    if (!tokMatch.ok) {
      return { error: tokMatch.reason, status: 403 }
    }
    matchedPortfolioTokenId = tokMatch.token?.token_id ?? null
  }

  try {
    // Validate chiefOfStaffId if provided: must be an existing AUTONOMOUS agent (not in any team)
    let cosId: string | null = params.chiefOfStaffId || null
    if (cosId) {
      const cosAgent = loadAgents().find(a => a.id === cosId)
      if (!cosAgent) {
        return { error: `Agent ${cosId} not found`, status: 404 }
      }
      const { loadTeams: loadTeamsForCos } = await import('@/lib/team-registry')
      const cosInTeam = loadTeamsForCos().some(t => t.agentIds.includes(cosId!))
      if (cosInTeam) {
        return { error: `Agent "${cosAgent.name}" is already in a team. Only AUTONOMOUS agents can be assigned as COS for a new team.`, status: 400 }
      }
      const cosTitle = cosAgent.governanceTitle || null
      if (cosTitle && cosTitle !== 'autonomous') {
        return { error: `Agent "${cosAgent.name}" has title "${cosTitle}". Only AUTONOMOUS agents can be assigned as COS.`, status: 400 }
      }
    }

    // Pass governance context (managerId + agent names for collision checks) to createTeam
    const managerId = getManagerId()
    const agentNames = loadAgents().map(a => a.name).filter(Boolean)
    const team = await createTeam(
      { name, description, agentIds: agentIds || [], type: 'closed', chiefOfStaffId: cosId || undefined },
      managerId,
      agentNames
    )

    // Auto-create COS agent if none was provided.
    // Every team MUST have a COS. If the caller didn't specify one, we create a new
    // agent with a random robot persona name and assign it as COS automatically.
    if (!cosId) {
      // SVC2-MIN-08: track whether mkdir succeeded so we can roll back on
      // partial failure. Previously, if mkdir succeeded but createCosAgent
      // failed, an empty `~/agents/cos-<teamslug>/` was left orphaned on
      // disk — visible in the agent-folder picker but unbacked by any
      // registry entry, confusing users into thinking the agent existed.
      let cosWorkDir: string | null = null
      let cosWorkDirCreated = false
      try {
        const { createAgent: createCosAgent } = await import('@/lib/agent-registry')
        const teamSlug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 30)
        const cosName = `cos-${teamSlug}`
        // Random robot avatar (index 1-50)
        const robotIndex = Math.floor(Math.random() * 50) + 1
        const robotAvatar = `/avatars/robots_${robotIndex.toString().padStart(2, '0')}.jpg`
        const os = await import('os')
        cosWorkDir = join(os.homedir(), 'agents', cosName)
        const { mkdir, rm: fsRm } = await import('fs/promises')
        const { existsSync } = await import('fs')
        // Only mark as created if the dir was newly made; if it already
        // existed (e.g. a leftover from a previous failed create), DO NOT
        // mark it as ours-to-delete — rolling back would destroy unrelated
        // user data.
        const preexisting = existsSync(cosWorkDir)
        await mkdir(cosWorkDir, { recursive: true })
        cosWorkDirCreated = !preexisting
        try {
          const cosAgent = await createCosAgent({
            name: cosName,
            program: 'claude',
            avatar: robotAvatar,
            workingDirectory: cosWorkDir,
            taskDescription: `Chief-of-Staff for team "${name}"`,
            role: 'chief-of-staff',
            createSession: false,
          })
          cosId = cosAgent.id
          // Add COS to team agentIds and set chiefOfStaffId
          await updateTeam(team.id, {
            chiefOfStaffId: cosId,
            agentIds: [...(team.agentIds || []), cosId],
          }, managerId)
          console.log(`[teams] Auto-created COS agent "${cosName}" (${cosId}) for team "${name}"`)
        } catch (innerErr) {
          // Rollback: createCosAgent failed AFTER we created the dir. Remove
          // the empty dir so it doesn't pollute ~/agents/. Only delete if
          // WE created it during this call (cosWorkDirCreated flag).
          if (cosWorkDirCreated && cosWorkDir) {
            try {
              await fsRm(cosWorkDir, { recursive: true, force: true })
              console.warn(`[teams] Rolled back orphan COS dir ${cosWorkDir} after createAgent failure`)
            } catch (rmErr) {
              console.warn(`[teams] Failed to roll back orphan COS dir ${cosWorkDir}:`, rmErr instanceof Error ? rmErr.message : rmErr)
            }
          }
          throw innerErr
        }
      } catch (err) {
        console.warn('[teams] Failed to auto-create COS agent:', err instanceof Error ? err.message : err)
      }
    }

    // SCEN-001 fix (2026-04-13): Gate 0 of ChangeTitle now requires an
    // authContext. teams-service is only called from authenticated API
    // routes (the webapp session is a system-owner in Phase 1), so it is
    // safe to pass a system-owner authContext here. Without it, every
    // auto-title step is silently rejected (caught as a `console.warn`),
    // leaving newly-added team members as AUTONOMOUS in the registry.
    const systemOwnerAuthContext = { isSystemOwner: true as const }

    // Assign COS title + role-plugin via ChangeTitle pipeline.
    if (cosId) {
      try {
        const { ChangeTitle } = await import('@/services/element-management-service')
        await ChangeTitle(cosId, 'chief-of-staff', { authContext: systemOwnerAuthContext })
      } catch (err) {
        console.warn('[teams] Failed ChangeTitle for COS:', err instanceof Error ? err.message : err)
      }
    }

    // Auto-title all other agents added to the team as MEMBER.
    // Exclude COS (already titled above) and MANAGER (title must not change).
    const managerId2 = getManagerId()
    const agentIdsToTitle = (team.agentIds || []).filter(
      (id: string) => id !== cosId && id !== managerId2
    )
    for (const id of agentIdsToTitle) {
      try {
        const { ChangeTitle } = await import('@/services/element-management-service')
        await ChangeTitle(id, 'member', { authContext: systemOwnerAuthContext })
      } catch (err) {
        console.warn(`[teams] Failed ChangeTitle to MEMBER for agent ${id}:`, err instanceof Error ? err.message : err)
      }
    }

    // Set orchestrator if provided
    if (params.orchestratorId) {
      try {
        await updateTeam(team.id, { orchestratorId: params.orchestratorId }, managerId)
        const { ChangeTitle } = await import('@/services/element-management-service')
        await ChangeTitle(params.orchestratorId, 'orchestrator', { authContext: systemOwnerAuthContext })
      } catch (err) {
        console.warn('[teams] Failed to set orchestrator:', err instanceof Error ? err.message : err)
      }
    }

    // SCEN-005.03 + SCEN-010.02 (second option, 2026-04-30): optionally link
    // an existing GitHub Project at create time. We MIRROR the post-creation
    // pattern from `app/api/teams/create-with-project/route.ts` (lines 73-91)
    // so the simple sidebar dialog and the full wizard share the same
    // failure-tolerant behaviour:
    //   - persist `githubProject` via team-registry updateTeam
    //   - best-effort configureProjectTemplate (requires gh CLI authed with
    //     the `project` scope); failure is logged but does NOT block team
    //     creation. The team is fully usable; the user just needs to retry
    //     the project linkage later (or run `gh auth refresh -s project`).
    if (params.githubProject) {
      try {
        await updateTeam(team.id, { githubProject: params.githubProject }, managerId)
        try {
          const { configureProjectTemplate } = await import('@/lib/github-cli')
          configureProjectTemplate(params.githubProject.owner, params.githubProject.number)
          console.log(`[teams] GitHub Project linked and template configured for team "${name}"`)
        } catch (err) {
          // Non-fatal — gh might not be authed, or scope might be missing.
          console.warn('[teams] Failed to configure GitHub Project template (linkage saved):', err instanceof Error ? err.message : err)
        }
      } catch (err) {
        // updateTeam shouldn't fail on a freshly-created team, but if it
        // does the team is still usable — log and continue.
        console.warn('[teams] Failed to persist githubProject linkage:', err instanceof Error ? err.message : err)
      }
    }

    // ── Consume-after-success (R28 §4.3) ──────────────────────────────
    // A ONE-SHOT approval token is consumed ONLY now — after the team (and its
    // COS / orchestrator / project links) persisted. Consuming earlier would
    // burn a token on a create that later threw. Mandate tokens
    // (uses_remaining null) are a no-op in consumeToken — only approvals burn.
    if (matchedPortfolioTokenId) {
      try {
        const { consumeToken, getTokenById } = await import('@/lib/portfolio-store')
        const tok = getTokenById(matchedPortfolioTokenId)
        const consumed = await consumeToken(matchedPortfolioTokenId)
        if (consumed && tok) {
          const { emitPortfolioOp, consumeDiff } = await import('@/lib/portfolio-ledger')
          const remaining = (tok.uses_remaining ?? 1) - 1
          void emitPortfolioOp('consume_portfolio_token', tok.token_id, consumeDiff(tok, remaining), {
            action: 'consume-portfolio-token',
            agentId: params.authContext?.agentId ?? null,
            actor: params.authContext?.agentId ? 'agent' : 'user',
          })
        }
      } catch (consumeErr) {
        // Non-fatal: the team is already created. A failed consume leaves the
        // approval usable once more — logged so it is auditable.
        console.warn('[teams] Portfolio token consume failed (team already created):', consumeErr instanceof Error ? consumeErr.message : consumeErr)
      }
    }

    // Reload team to get the latest state (COS/orchestrator/githubProject may have been added)
    const finalTeam = getTeam(team.id) || team
    return { data: { team: finalTeam, needsChiefOfStaff: false }, status: 201 }
  } catch (error) {
    // TeamValidationException carries a specific HTTP status code from governance rules
    if (error instanceof TeamValidationException) {
      return { error: error.message, status: error.code }
    }
    console.error('Failed to create team:', error)
    return { error: error instanceof Error ? error.message : 'Failed to create team', status: 500 }
  }
}

/**
 * Get a single team by ID.
 * Governance: validates UUID format, enforces team ACL for closed teams.
 */
export function getTeamById(id: string, requestingAgentId?: string, authContext?: AuthContext): ServiceResult<{ team: any }> {
  // Validate UUID format to prevent path traversal and invalid lookups
  if (!isValidUuid(id)) {
    return { error: 'Invalid team ID format', status: 400 }
  }

  const team = getTeam(id)
  if (!team) {
    return { error: 'Team not found', status: 404 }
  }

  // SVC2-MAJ-11 (2026-05-06): refuse spoofed requestingAgentId.
  const mismatch = rejectMismatchedRequestingAgentId(requestingAgentId, authContext)
  if (mismatch) return mismatch as ServiceResult<{ team: any }>

  // LIB2-CRIT-02 (2026-05-06): pass authContext so checkTeamAccess can
  // distinguish a verified system-owner web-UI session from a request
  // that merely omitted X-Agent-Id.
  const access = checkTeamAccess({ teamId: id, requestingAgentId, authContext })
  if (!access.allowed) {
    return { error: access.reason || 'Access denied', status: 403 }
  }

  return { data: { team }, status: 200 }
}

/**
 * Update a team by ID.
 * Governance: enforces ACL for closed teams, passes managerId + agentNames
 * to updateTeam for business rule enforcement (R1-R4).
 */
export async function updateTeamById(id: string, params: UpdateTeamParams): Promise<ServiceResult<{ team: any }>> {
  // Validate UUID format for consistency with getTeamById (CC-008)
  if (!isValidUuid(id)) {
    return { error: 'Invalid team ID', status: 400 }
  }

  try {
    // R9.3: Reject mutations on blocked teams (no MANAGER on host)
    const teamForBlockCheck = getTeam(id)
    if (teamForBlockCheck?.blocked) {
      return { error: 'Team is blocked: no MANAGER exists on this host. Assign a MANAGER first.', status: 400 }
    }

    // Destructure requestingAgentId, type, chiefOfStaffId, and orchestratorId out so
    // they do not leak into the lib update call. Governance type/COS/orchestrator
    // changes must go through dedicated endpoints, not the general update path
    // (CC-007 defense-in-depth).
    // L2-H2 fix (2026-06-18, TRDD-f9f71e4a Gap 2): orchestratorId is now stripped
    // here exactly like chiefOfStaffId. The slot is team authority (isOrchestrator →
    // kanban-write + team resolution), so it must NOT be settable via the general
    // PUT /api/teams/[id] path — only via PUT/DELETE /api/teams/[id]/orchestrator,
    // which validates in-team eligibility and applies the orchestrator title through
    // the ChangeTitle pipeline. This is the second strip layer (the route also
    // strips it) so neither can be bypassed if the other is refactored.
    const { requestingAgentId, authContext, type: _type, chiefOfStaffId: _cos, orchestratorId: _orch, githubProject: ghProj, ...updateFields } = params

    // SVC2-MAJ-11 (2026-05-06): refuse spoofed requestingAgentId.
    const mismatch = rejectMismatchedRequestingAgentId(requestingAgentId, authContext)
    if (mismatch) return mismatch as ServiceResult<{ team: any }>

    // LIB2-CRIT-02 (2026-05-06): forward authContext so the ACL bypass
    // is gated on a verified system-owner session, not a missing header.
    const access = checkTeamAccess({ teamId: id, requestingAgentId, authContext })
    if (!access.allowed) {
      return { error: access.reason || 'Access denied', status: 403 }
    }

    // Convert null to undefined to unlink githubProject; omit entirely if unchanged
    const finalFields = {
      ...updateFields,
      ...(ghProj !== undefined && { githubProject: ghProj ?? undefined }),
    }

    // Pass governance context (managerId + agent names for collision checks) to updateTeam
    const managerId = getManagerId()
    const agentNames = loadAgents().map(a => a.name).filter(Boolean)

    // Detect agents being REMOVED from the team — they need title stripped to AUTONOMOUS
    const oldTeam = getTeam(id)
    const oldAgentIds = oldTeam?.agentIds || []
    const newAgentIds = (finalFields as any).agentIds as string[] | undefined

    const team = await updateTeam(id, finalFields, managerId, agentNames)
    if (!team) {
      return { error: 'Team not found', status: 404 }
    }

    // SCEN-001 fix (2026-04-13): pass system-owner authContext, same
    // rationale as the createTeam branch above — teams-service is always
    // invoked from an authenticated API route, and without this the
    // auto-title steps silently no-op.
    const systemOwnerAuthContextForUpdate = { isSystemOwner: true as const }

    // Strip titles from removed agents (team-bound titles are meaningless outside teams)
    if (newAgentIds !== undefined) {
      const removedAgentIds = oldAgentIds.filter(aid => !newAgentIds.includes(aid))
      if (removedAgentIds.length > 0) {
        const { ChangeTitle } = await import('@/services/element-management-service')
        for (const removedId of removedAgentIds) {
          try {
            // Reverts to AUTONOMOUS, uninstalls role-plugin
            await ChangeTitle(removedId, null, { authContext: systemOwnerAuthContextForUpdate })
          } catch (err) {
            console.warn(`[teams] Failed to strip title from removed agent ${removedId}:`, err instanceof Error ? err.message : err)
          }
        }
      }

      // Auto-title newly added agents to MEMBER
      const addedAgentIds = newAgentIds.filter(aid => !oldAgentIds.includes(aid))
      if (addedAgentIds.length > 0) {
        const { ChangeTitle } = await import('@/services/element-management-service')
        for (const addedId of addedAgentIds) {
          try {
            const { getAgent } = await import('@/lib/agent-registry')
            const agent = getAgent(addedId)
            // Only auto-title if agent doesn't already have a team-specific title
            if (!agent?.governanceTitle || agent.governanceTitle === 'autonomous') {
              await ChangeTitle(addedId, 'member', { authContext: systemOwnerAuthContextForUpdate })
            }
          } catch (err) {
            console.warn(`[teams] Failed to auto-title added agent ${addedId}:`, err instanceof Error ? err.message : err)
          }
        }
      }
    }

    // SCEN-005.03 + SCEN-010.02 (second option, 2026-04-30): if the caller
    // SET (not cleared) a GitHub Project link on this update, mirror the
    // create-flow behaviour and try to configure the project template
    // (single-select fields used by the kanban). Best-effort — if `gh`
    // isn't authed or the scope is missing we just log a warning. The
    // linkage itself is already persisted by `updateTeam` above.
    if (ghProj) {
      try {
        const { configureProjectTemplate } = await import('@/lib/github-cli')
        configureProjectTemplate(ghProj.owner, ghProj.number)
      } catch (err) {
        console.warn('[teams] Failed to configure GitHub Project template on update (linkage saved):', err instanceof Error ? err.message : err)
      }
    }

    return { data: { team }, status: 200 }
  } catch (error) {
    // TeamValidationException carries a specific HTTP status code from governance rules
    if (error instanceof TeamValidationException) {
      return { error: error.message, status: error.code }
    }
    console.error('Failed to update team:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update team', status: 500 }
  }
}

/**
 * Set or clear a team's orchestrator slot (TRDD-f9f71e4a Gap 2/3, option b).
 *
 * This is the ONLY service path that may write `team.orchestratorId` from an
 * external request — the general `updateTeamById` strips the field, and the
 * dedicated PUT/DELETE /api/teams/[id]/orchestrator route is the only caller.
 * The route is responsible for the SECURITY factor (USER/UI → sudo; agent →
 * AID + MANAGER-or-own-team-COS title per R32); this function is responsible
 * for the GOVERNANCE-CORRECTNESS factor:
 *
 *   - the team exists and is not blocked,
 *   - SET: `orchestratorId` is an EXISTING agent that is a MEMBER of this team
 *     (`team.agentIds`) — a foreign or non-existent agent is rejected,
 *   - SET: the orchestrator title is applied via the SAME ChangeTitle('orchestrator')
 *     pipeline the create path uses, so kanban-write/ACL is granted through the
 *     pipeline (never by a raw slot write),
 *   - CLEAR (orchestratorId === null): the slot is emptied (no title change here;
 *     the agent's title lifecycle is driven separately by PATCH /api/agents/[id]/title,
 *     mirroring create-path semantics where slot and title are paired only on SET).
 *
 * The create-path orchestrator assignment (createNewTeam) is intentionally NOT
 * routed through here and is unchanged.
 */
export async function setTeamOrchestrator(
  id: string,
  orchestratorId: string | null,
  authContext?: AuthContext
): Promise<ServiceResult<{ team: any }>> {
  if (!isValidUuid(id)) {
    return { error: 'Invalid team ID', status: 400 }
  }

  try {
    const team = getTeam(id)
    if (!team) {
      return { error: 'Team not found', status: 404 }
    }

    // R9.3: reject mutations on blocked teams (no MANAGER on host)
    if (team.blocked) {
      return { error: 'Team is blocked: no MANAGER exists on this host. Assign a MANAGER first.', status: 400 }
    }

    const managerId = getManagerId()
    // System-owner web-UI session is exempt from per-call agentName collision
    // checks; updateTeam still validates the slot via validateTeamMutation.

    if (orchestratorId) {
      // Eligibility: the target MUST be an existing agent AND a member of THIS team.
      const candidate = loadAgents().find(a => a.id === orchestratorId)
      if (!candidate) {
        return { error: `Agent ${orchestratorId} not found`, status: 404 }
      }
      if (!team.agentIds.includes(orchestratorId)) {
        return {
          error: `Agent "${candidate.name}" is not a member of this team. Add the agent to the team before assigning it as orchestrator.`,
          status: 400,
        }
      }

      // Persist the slot through the validated updateTeam path (validateTeamMutation
      // re-checks and propagates orchestratorId; it is no longer raw-spread).
      const updated = await updateTeam(id, { orchestratorId }, managerId)
      if (!updated) {
        return { error: 'Team not found', status: 404 }
      }

      // Apply the orchestrator title via the SAME pipeline the create path uses.
      // teams-service is only reached from an authenticated route; pass the route's
      // AuthContext so ChangeTitle Gate 0 (authContext mandatory) is satisfied.
      try {
        const { ChangeTitle } = await import('@/services/element-management-service')
        await ChangeTitle(orchestratorId, 'orchestrator', { authContext: authContext ?? { isSystemOwner: true as const } })
      } catch (err) {
        // Roll back the slot so we never leave an orchestrator seated without the
        // governance title (which would grant kanban-write through the slot alone).
        try { await updateTeam(id, { orchestratorId: null }, managerId) } catch { /* best-effort rollback */ }
        return { error: `Failed to apply orchestrator title: ${err instanceof Error ? err.message : String(err)}`, status: 500 }
      }

      const finalTeam = getTeam(id) || updated
      return { data: { team: finalTeam }, status: 200 }
    }

    // CLEAR the slot.
    const updated = await updateTeam(id, { orchestratorId: null }, managerId)
    if (!updated) {
      return { error: 'Team not found', status: 404 }
    }
    return { data: { team: updated }, status: 200 }
  } catch (error) {
    if (error instanceof TeamValidationException) {
      return { error: error.message, status: error.code }
    }
    console.error('Failed to set team orchestrator:', error)
    return { error: error instanceof Error ? error.message : 'Failed to set team orchestrator', status: 500 }
  }
}

/**
 * @deprecated Use DeleteTeam from element-management-service instead.
 * This function is dead code — all callers now use the DeleteTeam pipeline.
 * Kept temporarily for reference during migration; will be removed.
 */
export async function deleteTeamById(id: string, requestingAgentId?: string, password?: string, deleteAgents: boolean = false, authContext?: AuthContext): Promise<ServiceResult<{ success: boolean }>> {
  // Validate UUID format for consistency with getTeamById (CC-008)
  if (!isValidUuid(id)) {
    return { error: 'Invalid team ID', status: 400 }
  }

  const team = getTeam(id)
  if (!team) {
    return { error: 'Team not found', status: 404 }
  }

  // SVC2-MAJ-11 (2026-05-06): refuse spoofed requestingAgentId.
  const mismatch10 = rejectMismatchedRequestingAgentId(requestingAgentId, authContext)
  if (mismatch10) return mismatch10 as ServiceResult<{ success: boolean }>

  // LIB2-CRIT-02 (2026-05-06): forward authContext.
  const access = checkTeamAccess({ teamId: id, requestingAgentId, authContext })
  if (!access.allowed) {
    return { error: access.reason || 'Access denied', status: 403 }
  }

  // SVC2-MAJ-10 fix (2026-05-06): if a governance password is configured, it is
  // ALWAYS mandatory — regardless of team shape, COS presence, or whether
  // the caller provided a requestingAgentId. The previous flow had a
  // password-less branch for closed teams without a COS (reachable during
  // the transient SCEN-005.03 race) which could let an unauthenticated
  // caller delete teams that lacked the COS chain.
  // Fail-closed: refuse the request unless EITHER (a) a verified
  // password was provided, OR (b) the caller is a system-owner with no
  // password configured on the system, OR (c) the caller is a real agent
  // whose identity satisfies the team ACL above.
  // Governance: team deletion is a destructive USER-only operation requiring governance password.
  // This prevents agents from deleting teams without human authorization.
  const config = loadGovernance()
  if (config.passwordHash) {
    if (!password || typeof password !== 'string') {
      return { error: 'Team deletion requires governance password', status: 400 }
    }
    // MF-001: Apply rate limiting to prevent brute-force of governance password, consistent
    // with setManagerRole and setGovernancePassword in governance-service.ts.
    const rateLimitKey = `team-delete-password:${id}`
    const rateCheck = checkAndRecordAttempt(rateLimitKey)
    if (!rateCheck.allowed) {
      const retryAfterSeconds = Math.ceil(rateCheck.retryAfterMs / 1000)
      return { error: `Too many failed attempts. Try again in ${retryAfterSeconds}s`, status: 429 }
    }
    if (!(await verifyPassword(password))) {
      return { error: 'Invalid governance password', status: 401 }
    }
    resetRateLimit(rateLimitKey)
  } else {
    // No governance password configured — require either a verified
    // system-owner authContext OR a verified agent identity. Without
    // either, the deprecated wrapper used to silently fall through to
    // the system-owner branch, which is the SVC2-MAJ-10 bug.
    if (!authContext?.isSystemOwner && !requestingAgentId) {
      return { error: 'Team deletion requires authenticated identity (system-owner or agent)', status: 401 }
    }
  }

  // Governance: a closed team with a COS requires agent identity for deletion,
  // UNLESS the system owner (web UI) already provided a valid governance password above.
  if (team.type === 'closed' && team.chiefOfStaffId && !requestingAgentId && !password) {
    return { error: 'Agent identity required to delete a governed team', status: 400 }
  }

  // Governance: team deletion requires MANAGER, Chief-of-Staff, or system owner (web UI)
  // System owner (requestingAgentId === undefined) is allowed — they already provided the password above
  if (requestingAgentId) {
    const managerId2 = getManagerId()
    if (requestingAgentId !== managerId2 && team.chiefOfStaffId !== requestingAgentId) {
      return { error: 'Only MANAGER or the team Chief-of-Staff can delete a team', status: 403 }
    }
  }

  // Strip titles from all team agents before deleting the team.
  // Team deletion reverts all agents to AUTONOMOUS (no team = no team title).
  const agentsToRevert = [
    ...team.agentIds,
    ...(team.chiefOfStaffId ? [team.chiefOfStaffId] : []),
    ...(team.orchestratorId && !team.agentIds.includes(team.orchestratorId) ? [team.orchestratorId] : []),
  ]
  const uniqueAgents = [...new Set(agentsToRevert)]
  if (uniqueAgents.length > 0) {
    // SCEN-001 fix (2026-04-13): pass system-owner authContext so
    // ChangeTitle Gate 0 doesn't silently reject the revert. deleteTeamById
    // itself is marked @deprecated, but the fix is kept for safety while
    // the DeleteTeam pipeline is still being adopted.
    const systemOwnerAuthContextForDelete = { isSystemOwner: true as const }
    const { ChangeTitle } = await import('@/services/element-management-service')
    for (const agentId of uniqueAgents) {
      try {
        await ChangeTitle(agentId, 'autonomous', { authContext: systemOwnerAuthContextForDelete })
      } catch (err) {
        console.warn(`[deleteTeamById] ChangeTitle to AUTONOMOUS failed for ${agentId}:`, err instanceof Error ? err.message : err)
      }
    }
  }

  const deleted = await deleteTeam(id)
  if (!deleted) {
    return { error: 'Team not found', status: 404 }
  }

  // If deleteAgents requested (UI-only option), delete all team agents from registry
  if (deleteAgents && uniqueAgents.length > 0) {
    const { deleteAgent } = await import('@/lib/agent-registry')
    for (const agentId of uniqueAgents) {
      try {
        await deleteAgent(agentId)
        console.log(`[deleteTeamById] Deleted team agent ${agentId}`)
      } catch (err) {
        console.warn(`[deleteTeamById] Failed to delete agent ${agentId}:`, err instanceof Error ? err.message : err)
      }
    }
  }

  return { data: { success: true }, status: 200 }
}

// ---------------------------------------------------------------------------
// Bulk Stats (SF-028: Eliminates N+1 fetch for team task/document counts)
// ---------------------------------------------------------------------------

/**
 * Get task and document counts for all teams in a single call.
 * Returns a map of teamId -> { taskCount, docCount }.
 */
export function getTeamsBulkStats(): ServiceResult<Record<string, { taskCount: number; docCount: number }>> {
  const teams = loadTeams()
  const stats: Record<string, { taskCount: number; docCount: number }> = {}
  for (const team of teams) {
    // Local task storage removed — task counts come from GitHub Projects (fetched async per-team, not in bulk)
    // Return 0 for taskCount in bulk stats; UI should use per-team GitHub Project queries for accurate counts
    const documents = loadDocuments(team.id)
    stats[team.id] = { taskCount: 0, docCount: documents.length }
  }
  return { data: stats, status: 200 }
}

// ---------------------------------------------------------------------------
// Tasks CRUD
// ---------------------------------------------------------------------------

/**
 * List all tasks for a team, with resolved dependencies.
 * Governance: enforces team ACL for closed teams.
 */
export async function listTeamTasks(teamId: string, requestingAgentId?: string, filters?: { assignee?: string; status?: string; label?: string; taskType?: string }, authContext?: AuthContext): Promise<ServiceResult<{ tasks: TaskWithDeps[] }>> {
  const team = getTeam(teamId)
  if (!team) {
    return { error: 'Team not found', status: 404 }
  }

  // SVC2-MAJ-11 (2026-05-06): refuse spoofed requestingAgentId.
  const mismatch = rejectMismatchedRequestingAgentId(requestingAgentId, authContext)
  if (mismatch) return mismatch as ServiceResult<{ tasks: TaskWithDeps[] }>

  // LIB2-CRIT-02 (2026-05-06): forward authContext.
  const access = checkTeamAccess({ teamId, requestingAgentId, authContext })
  if (!access.allowed) {
    return { error: access.reason || 'Access denied', status: 403 }
  }

  let resolved: TaskWithDeps[]

  if (!team.githubProject) {
    // No GitHub Project linked — team has no task source after local task storage removal
    return { data: { tasks: [] }, status: 200 }
  }

  // GitHub Project is source of truth — fetch from GitHub
  const ghAuth = ghProject.checkGhAuth()
  if (ghAuth) return { error: ghAuth, status: 503 }
  try {
    const tasks = await ghProject.listTasks(team.githubProject, teamId)
    resolved = ghProject.resolveTaskDeps(tasks)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'GitHub API error', status: 502 }
  }

  // Enrich tasks with agent display names and avatars from the registry.
  // assigneeAgentId may be a UUID, an agent name, or a GitHub login (from assign: label).
  const allAgents = loadAgents()
  for (const task of resolved) {
    if (task.assigneeAgentId && !task.assigneeAvatar) {
      const agentId = task.assigneeAgentId
      const agent = allAgents.find(a =>
        a.id === agentId ||
        a.name === agentId ||
        a.alias === agentId ||
        (a.label && a.label.toLowerCase() === agentId.toLowerCase())
      )
      if (agent) {
        task.assigneeName = agent.label || agent.name || agent.alias || agent.id.slice(0, 8)
        task.assigneeAvatar = agent.avatar
      }
    }
  }

  let filtered = resolved
  if (filters) {
    if (filters.assignee) filtered = filtered.filter(t => t.assigneeAgentId === filters.assignee)
    if (filters.status) filtered = filtered.filter(t => t.status === filters.status)
    if (filters.label) filtered = filtered.filter(t => t.labels?.includes(filters.label!) || false)
    if (filters.taskType) filtered = filtered.filter(t => t.taskType === filters.taskType)
  }
  return { data: { tasks: filtered }, status: 200 }
}

/**
 * Get a single task by ID within a team.
 * Governance: enforces team ACL for closed teams.
 * SF-010: Added to support GET /api/teams/[id]/tasks/[taskId]
 */
export async function getTeamTask(teamId: string, taskId: string, requestingAgentId?: string, authContext?: AuthContext): Promise<ServiceResult<{ task: any }>> {
  const team = getTeam(teamId)
  if (!team) {
    return { error: 'Team not found', status: 404 }
  }

  // SVC2-MAJ-11 (2026-05-06): refuse spoofed requestingAgentId.
  const mismatch = rejectMismatchedRequestingAgentId(requestingAgentId, authContext)
  if (mismatch) return mismatch as ServiceResult<{ task: any }>

  // LIB2-CRIT-02 (2026-05-06): forward authContext.
  const access = checkTeamAccess({ teamId, requestingAgentId, authContext })
  if (!access.allowed) {
    return { error: access.reason || 'Access denied', status: 403 }
  }

  if (!team.githubProject) {
    // No GitHub Project linked — no task source after local task storage removal
    return { error: 'Task not found (team has no GitHub Project linked)', status: 404 }
  }

  // GitHub-backed: find task in the full list (cached 10s)
  const ghAuth = ghProject.checkGhAuth()
  if (ghAuth) return { error: ghAuth, status: 503 }
  try {
    const tasks = await ghProject.listTasks(team.githubProject, teamId)
    const task = tasks.find(t => t.id === taskId)
    if (!task) return { error: 'Task not found', status: 404 }
    return { data: { task }, status: 200 }
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'GitHub API error', status: 502 }
  }
}


/**
 * Create a new task for a team.
 * Governance: enforces team ACL for closed teams.
 */
export async function createTeamTask(teamId: string, params: CreateTaskParams): Promise<ServiceResult<{ task: any }>> {
  const team = getTeam(teamId)
  if (!team) {
    return { error: 'Team not found', status: 404 }
  }

  // LIB2-CRIT-02 (2026-05-06): forward authContext.
  const { requestingAgentId, authContext, ...taskFields } = params
  // SVC2-MAJ-11 (2026-05-06): refuse spoofed requestingAgentId.
  const mismatch = rejectMismatchedRequestingAgentId(requestingAgentId, authContext)
  if (mismatch) return mismatch as ServiceResult<{ task: any }>
  const access = checkTeamAccess({ teamId, requestingAgentId, authContext })
  if (!access.allowed) {
    return { error: access.reason || 'Access denied', status: 403 }
  }

  const { subject, description, assigneeAgentId, blockedBy, priority } = taskFields

  if (!subject || typeof subject !== 'string' || !subject.trim()) {
    return { error: 'Subject is required', status: 400 }
  }

  // Validate blockedBy is an array of strings if provided
  if (blockedBy !== undefined) {
    if (!Array.isArray(blockedBy) || !blockedBy.every((id: unknown) => typeof id === 'string')) {
      return { error: 'blockedBy must be an array of task ID strings', status: 400 }
    }
  }

  if (!team.githubProject) {
    return { error: 'Cannot create task: team has no GitHub Project linked', status: 400 }
  }

  try {
    // Create issue + project item on GitHub (source of truth)
    const ghAuth = ghProject.checkGhAuth()
    if (ghAuth) return { error: ghAuth, status: 503 }
    const task = await ghProject.createTask(team.githubProject, teamId, {
      subject: subject.trim(),
      description,
      status: taskFields.status,
      priority,
      labels: taskFields.labels,
      assigneeLogin: assigneeAgentId === null ? undefined : assigneeAgentId, // For GitHub-backed teams, this is a GitHub login
      taskType: taskFields.taskType,
      blockedBy,
      acceptanceCriteria: taskFields.acceptanceCriteria,
      prUrl: taskFields.prUrl,
      // TRDD-v2 alignment fields (carried as prefixed issue labels by github-project).
      severity: taskFields.severity,
      effort: taskFields.effort,
      parentTask: taskFields.parentTask,
      npt: taskFields.npt,
      eht: taskFields.eht,
      supersedes: taskFields.supersedes,
      relevantRules: taskFields.relevantRules,
      releaseVia: taskFields.releaseVia,
    })
    return { data: { task }, status: 201 }
  } catch (error) {
    console.error('Failed to create task:', error)
    return { error: error instanceof Error ? error.message : 'Failed to create task', status: 500 }
  }
}

/**
 * Update a task within a team.
 * Governance: enforces team ACL for closed teams.
 */
export async function updateTeamTask(
  teamId: string,
  taskId: string,
  params: UpdateTaskParams
): Promise<ServiceResult<{ task: any; unblocked?: any[] }>> {
  const team = getTeam(teamId)
  if (!team) {
    return { error: 'Team not found', status: 404 }
  }

  // LIB2-CRIT-02 (2026-05-06): forward authContext.
  const { requestingAgentId, authContext, ...taskFields } = params
  // SVC2-MAJ-11 (2026-05-06): refuse spoofed requestingAgentId.
  const mismatch = rejectMismatchedRequestingAgentId(requestingAgentId, authContext)
  if (mismatch) return mismatch as ServiceResult<{ task: any; unblocked?: any[] }>
  const access = checkTeamAccess({ teamId, requestingAgentId, authContext })
  if (!access.allowed) {
    return { error: access.reason || 'Access denied', status: 403 }
  }

  const { subject, description, status, assigneeAgentId, blockedBy, priority } = taskFields

  if (!team.githubProject) {
    return { error: 'Cannot update task: team has no GitHub Project linked', status: 400 }
  }

  // GitHub Project is source of truth — update project item fields
  const ghAuth = ghProject.checkGhAuth()
  if (ghAuth) return { error: ghAuth, status: 503 }

  // Basic blockedBy validation (no cycle check for GitHub — deps are issue-number references)
  if (Array.isArray(blockedBy)) {
    for (const depId of blockedBy) {
      if (typeof depId !== 'string') {
        return { error: 'blockedBy must contain only string task IDs', status: 400 }
      }
    }
  }

  try {
    const task = await ghProject.updateTask(team.githubProject, teamId, taskId, {
      subject,
      description,
      status,
      priority,
      labels: taskFields.labels,
      assigneeLogin: assigneeAgentId !== undefined
        ? (assigneeAgentId || undefined) // null → unassign
        : undefined,
      taskType: taskFields.taskType,
      blockedBy,
      acceptanceCriteria: taskFields.acceptanceCriteria,
      prUrl: taskFields.prUrl,
      previousStatus: taskFields.previousStatus,
      // TRDD-v2 alignment fields (carried as prefixed issue labels by github-project).
      severity: taskFields.severity,
      effort: taskFields.effort,
      parentTask: taskFields.parentTask,
      npt: taskFields.npt,
      eht: taskFields.eht,
      supersedes: taskFields.supersedes,
      relevantRules: taskFields.relevantRules,
      releaseVia: taskFields.releaseVia,
    })
    if (!task) {
      return { error: 'Task not found', status: 404 }
    }
    return { data: { task, unblocked: [] }, status: 200 }
  } catch (error) {
    console.error('Failed to update task:', error)
    return { error: error instanceof Error ? error.message : 'GitHub API error', status: 502 }
  }
}

/**
 * Delete a task from a team.
 * Governance: enforces team ACL for closed teams.
 */
export async function deleteTeamTask(teamId: string, taskId: string, requestingAgentId?: string, authContext?: AuthContext): Promise<ServiceResult<{ success: boolean }>> {
  const team = getTeam(teamId)
  if (!team) {
    return { error: 'Team not found', status: 404 }
  }

  // SVC2-MAJ-11 (2026-05-06): refuse spoofed requestingAgentId.
  const mismatch = rejectMismatchedRequestingAgentId(requestingAgentId, authContext)
  if (mismatch) return mismatch as ServiceResult<{ success: boolean }>

  // LIB2-CRIT-02 (2026-05-06): forward authContext.
  const access = checkTeamAccess({ teamId, requestingAgentId, authContext })
  if (!access.allowed) {
    return { error: access.reason || 'Access denied', status: 403 }
  }

  if (!team.githubProject) {
    return { error: 'Cannot delete task: team has no GitHub Project linked', status: 400 }
  }

  // GitHub Project is source of truth — remove item from project
  const ghAuth = ghProject.checkGhAuth()
  if (ghAuth) return { error: ghAuth, status: 503 }
  let deleted: boolean
  try {
    deleted = await ghProject.deleteTask(team.githubProject, taskId, true)
  } catch (e) {
    return { error: e instanceof Error ? e.message : 'GitHub API error', status: 502 }
  }

  if (!deleted) {
    return { error: 'Task not found', status: 404 }
  }

  return { data: { success: true }, status: 200 }
}

// ---------------------------------------------------------------------------
// Documents CRUD
// ---------------------------------------------------------------------------

/**
 * List all documents for a team.
 * Governance: enforces team ACL for closed teams.
 */
export function listTeamDocuments(teamId: string, requestingAgentId?: string, authContext?: AuthContext): ServiceResult<{ documents: TeamDocument[] }> {
  const team = getTeam(teamId)
  if (!team) {
    return { error: 'Team not found', status: 404 }
  }

  // SVC2-MAJ-11 (2026-05-06): refuse spoofed requestingAgentId.
  const mismatch = rejectMismatchedRequestingAgentId(requestingAgentId, authContext)
  if (mismatch) return mismatch as ServiceResult<{ documents: TeamDocument[] }>

  // LIB2-CRIT-02 (2026-05-06): forward authContext.
  const access = checkTeamAccess({ teamId, requestingAgentId, authContext })
  if (!access.allowed) {
    return { error: access.reason || 'Access denied', status: 403 }
  }

  const documents = loadDocuments(teamId)
  return { data: { documents }, status: 200 }
}

/**
 * Create a new document for a team.
 * Governance: enforces team ACL for closed teams.
 */
export async function createTeamDocument(teamId: string, params: CreateDocumentParams): Promise<ServiceResult<{ document: any }>> {
  const team = getTeam(teamId)
  if (!team) {
    return { error: 'Team not found', status: 404 }
  }

  // LIB2-CRIT-02 (2026-05-06): forward authContext.
  const { requestingAgentId, authContext, ...docFields } = params
  // SVC2-MAJ-11 (2026-05-06): refuse spoofed requestingAgentId.
  const mismatch = rejectMismatchedRequestingAgentId(requestingAgentId, authContext)
  if (mismatch) return mismatch as ServiceResult<{ document: any }>
  const access = checkTeamAccess({ teamId, requestingAgentId, authContext })
  if (!access.allowed) {
    return { error: access.reason || 'Access denied', status: 403 }
  }

  const { title, content, pinned, tags } = docFields

  if (!title || typeof title !== 'string') {
    return { error: 'title is required', status: 400 }
  }

  try {
    const document = await createDocument({
      teamId,
      title,
      content: content || '',
      pinned,
      tags,
    })
    return { data: { document }, status: 201 }
  } catch (error) {
    console.error('Failed to create document:', error)
    return { error: error instanceof Error ? error.message : 'Failed to create document', status: 500 }
  }
}

/**
 * Get a single document by ID.
 * Governance: enforces team ACL for closed teams.
 */
export function getTeamDocument(teamId: string, docId: string, requestingAgentId?: string, authContext?: AuthContext): ServiceResult<{ document: any }> {
  const team = getTeam(teamId)
  if (!team) {
    return { error: 'Team not found', status: 404 }
  }

  // SVC2-MAJ-11 (2026-05-06): refuse spoofed requestingAgentId.
  const mismatch = rejectMismatchedRequestingAgentId(requestingAgentId, authContext)
  if (mismatch) return mismatch as ServiceResult<{ document: any }>

  // LIB2-CRIT-02 (2026-05-06): forward authContext.
  const access = checkTeamAccess({ teamId, requestingAgentId, authContext })
  if (!access.allowed) {
    return { error: access.reason || 'Access denied', status: 403 }
  }

  const document = getDocument(teamId, docId)
  if (!document) {
    return { error: 'Document not found', status: 404 }
  }

  return { data: { document }, status: 200 }
}

/**
 * Update a document by ID.
 * Governance: enforces team ACL for closed teams.
 */
export async function updateTeamDocument(
  teamId: string,
  docId: string,
  params: UpdateDocumentParams
): Promise<ServiceResult<{ document: any }>> {
  // Validate team exists before attempting document update (CC-005)
  const team = getTeam(teamId)
  if (!team) {
    return { error: 'Team not found', status: 404 }
  }

  // LIB2-CRIT-02 (2026-05-06): forward authContext.
  const { requestingAgentId, authContext, ...docFields } = params
  // SVC2-MAJ-11 (2026-05-06): refuse spoofed requestingAgentId.
  const mismatch = rejectMismatchedRequestingAgentId(requestingAgentId, authContext)
  if (mismatch) return mismatch as ServiceResult<{ document: any }>
  const access = checkTeamAccess({ teamId, requestingAgentId, authContext })
  if (!access.allowed) {
    return { error: access.reason || 'Access denied', status: 403 }
  }

  try {
    // Build a Partial<Pick<TeamDocument, 'title' | 'content' | 'pinned' | 'tags'>> that
    // matches updateDocument's parameter type exactly — no type assertion needed.
    const updates: Partial<Pick<TeamDocument, 'title' | 'content' | 'pinned' | 'tags'>> = {}
    if (docFields.title !== undefined) updates.title = docFields.title
    if (docFields.content !== undefined) updates.content = docFields.content
    if (docFields.pinned !== undefined) updates.pinned = docFields.pinned
    if (docFields.tags !== undefined) updates.tags = docFields.tags

    const document = await updateDocument(teamId, docId, updates)
    if (!document) {
      return { error: 'Document not found', status: 404 }
    }

    return { data: { document }, status: 200 }
  } catch (error) {
    console.error('Failed to update document:', error)
    return { error: error instanceof Error ? error.message : 'Failed to update document', status: 500 }
  }
}

/**
 * Delete a document by ID.
 * Governance: enforces team ACL for closed teams.
 */
export async function deleteTeamDocument(teamId: string, docId: string, requestingAgentId?: string, authContext?: AuthContext): Promise<ServiceResult<{ success: boolean }>> {
  const team = getTeam(teamId)
  if (!team) {
    return { error: 'Team not found', status: 404 }
  }

  // SVC2-MAJ-11 (2026-05-06): refuse spoofed requestingAgentId.
  const mismatch = rejectMismatchedRequestingAgentId(requestingAgentId, authContext)
  if (mismatch) return mismatch as ServiceResult<{ success: boolean }>

  // LIB2-CRIT-02 (2026-05-06): forward authContext.
  const access = checkTeamAccess({ teamId, requestingAgentId, authContext })
  if (!access.allowed) {
    return { error: access.reason || 'Access denied', status: 403 }
  }

  const deleted = await deleteDocument(teamId, docId)
  if (!deleted) {
    return { error: 'Document not found', status: 404 }
  }

  return { data: { success: true }, status: 200 }
}

// ---------------------------------------------------------------------------
// Notifications
// ---------------------------------------------------------------------------

/**
 * Notify team agents about a meeting.
 */
export async function notifyTeamAgents(params: NotifyTeamParams): Promise<ServiceResult<{ results: AgentNotifyResult[] }>> {
  const { agentIds, teamName } = params

  if (!agentIds || !Array.isArray(agentIds)) {
    return { error: 'agentIds array is required', status: 400 }
  }

  if (!teamName || typeof teamName !== 'string') {
    return { error: 'teamName is required', status: 400 }
  }

  // SVC2-MIN-09: cap fan-out to prevent a runaway team-notify call from
  // flooding the notification channel. Each notifyAgent ultimately writes
  // to the agent's tmux pane; with hundreds of agents this could DoS the
  // system. 50 is a generous bound — real teams rarely have more than 20.
  const MAX_FANOUT = 50
  if (agentIds.length > MAX_FANOUT) {
    return {
      error: `Cannot notify more than ${MAX_FANOUT} agents in one call (got ${agentIds.length})`,
      status: 400,
    }
  }

  // Strip control characters to prevent command injection via tmux send-keys
  const safeTeamName = teamName.replace(/[\x00-\x1F\x7F]/g, '')

  try {
    const results = await Promise.all(
      agentIds.map(async (agentId: string) => {
        const agent = getAgent(agentId)
        if (!agent) {
          return { agentId, success: false, reason: 'Agent not found' }
        }

        const agentName = agent.name || agent.alias || 'unknown'
        try {
          const result = await notifyAgent({
            agentId: agent.id,
            agentName,
            agentHost: agent.hostId,
            fromName: 'AI Maestro',
            subject: `Team "${safeTeamName}" is starting`,
            messageId: `meeting-${Date.now()}`,
            messageType: 'notification',
          })
          return { agentId, agentName, ...result }
        } catch (error) {
          return { agentId, agentName, success: false, error: String(error) }
        }
      })
    )

    return { data: { results }, status: 200 }
  } catch (error) {
    console.error('Failed to notify team:', error)
    return { error: error instanceof Error ? error.message : 'Failed to notify team', status: 500 }
  }
}

// ---------------------------------------------------------------------------
// Kanban Configuration
// ---------------------------------------------------------------------------

/**
 * Get kanban column configuration for a team.
 * Returns team's custom config or DEFAULT_KANBAN_COLUMNS.
 */
export async function getKanbanConfig(teamId: string, requestingAgentId?: string, authContext?: AuthContext): Promise<ServiceResult<{ columns: KanbanColumnConfig[] }>> {
  const team = getTeam(teamId)
  if (!team) {
    return { error: 'Team not found', status: 404 }
  }
  // SVC2-MAJ-11 (2026-05-06): refuse spoofed requestingAgentId.
  const mismatch = rejectMismatchedRequestingAgentId(requestingAgentId, authContext)
  if (mismatch) return mismatch as ServiceResult<{ columns: KanbanColumnConfig[] }>
  // LIB2-CRIT-02 (2026-05-06): forward authContext.
  const access = checkTeamAccess({ teamId, requestingAgentId, authContext })
  if (!access.allowed) {
    return { error: access.reason || 'Access denied', status: 403 }
  }

  if (team.githubProject) {
    // Columns derived from GitHub Project Status field options
    const ghAuth = ghProject.checkGhAuth()
    if (ghAuth) return { error: ghAuth, status: 503 }
    try {
      const columns = await ghProject.getKanbanColumns(team.githubProject)
      return { data: { columns }, status: 200 }
    } catch (e) {
      return { error: e instanceof Error ? e.message : 'GitHub API error', status: 502 }
    }
  }

  return { data: { columns: team.kanbanConfig || DEFAULT_KANBAN_COLUMNS }, status: 200 }
}

/**
 * Set kanban column configuration for a team.
 */
export async function setKanbanConfig(teamId: string, columns: KanbanColumnConfig[], requestingAgentId?: string, authContext?: AuthContext): Promise<ServiceResult<{ columns: KanbanColumnConfig[] }>> {
  const team = getTeam(teamId)
  if (!team) {
    return { error: 'Team not found', status: 404 }
  }
  // SVC2-MAJ-11 (2026-05-06): refuse spoofed requestingAgentId.
  const mismatch = rejectMismatchedRequestingAgentId(requestingAgentId, authContext)
  if (mismatch) return mismatch as ServiceResult<{ columns: KanbanColumnConfig[] }>
  // LIB2-CRIT-02 (2026-05-06): forward authContext.
  const access = checkTeamAccess({ teamId, requestingAgentId, authContext })
  if (!access.allowed) {
    return { error: access.reason || 'Access denied', status: 403 }
  }
  if (!Array.isArray(columns) || columns.length === 0) {
    return { error: 'columns must be a non-empty array', status: 400 }
  }
  for (const col of columns) {
    if (!col.id || !col.label || !col.color) {
      return { error: 'Each column must have id, label, and color', status: 400 }
    }
  }
  try {
    if (team.githubProject) {
      // Update GitHub Project Status field options directly
      const ghAuth = ghProject.checkGhAuth()
      if (ghAuth) return { error: ghAuth, status: 503 }
      await ghProject.updateKanbanColumns(team.githubProject, columns)
      return { data: { columns }, status: 200 }
    }
    await updateTeam(teamId, { kanbanConfig: columns })
    return { data: { columns }, status: 200 }
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Failed to update kanban config', status: 500 }
  }
}
