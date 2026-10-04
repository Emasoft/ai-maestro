/**
 * Groups Service
 *
 * Pure business logic for group CRUD and subscriber management.
 * No HTTP concepts (Request, Response, NextResponse, headers) leak into this module.
 * Mirrors the ServiceResult pattern from services/teams-service.ts but without governance.
 *
 * Covers:
 *   GET    /api/groups                  -> listAllGroups
 *   POST   /api/groups                  -> createNewGroup
 *   GET    /api/groups/[id]             -> getGroupById
 *   PUT    /api/groups/[id]             -> updateGroupById
 *   DELETE /api/groups/[id]             -> deleteGroupById
 *   POST   /api/groups/[id]/subscribe   -> subscribeAgent
 *   POST   /api/groups/[id]/unsubscribe -> unsubscribeAgent
 */

import {
  loadGroups,
  createGroup,
  getGroup,
  updateGroup,
  deleteGroup,
  addSubscriber,
  removeSubscriber,
  GroupValidationException,
} from '@/lib/group-registry'
import { getAgent } from '@/lib/agent-registry'
// TRDD-V2BLADSF: static import, matching services/teams-service.ts — governance.ts
// reads team-registry and agent-registry only, so there is no cycle back to this
// module. The four call sites below used `require('@/lib/governance')` "to avoid a
// cycle"; a bare `@` specifier does not resolve in vitest, so every guard written
// that way was UNREACHABLE under test (and threw instead of refusing). A guard the
// tests cannot drive is a guard nobody can neuter.
import { isManager } from '@/lib/governance'
import { notifyAgent } from '@/lib/notification-service'
import type { Group } from '@/types/group'
import type { ServiceResult } from '@/types/service'
import type { AuthContext } from '@/lib/agent-auth'

// SVC2-MAJ-07/08 fix (2026-05-06): every mutation function below takes a
// mandatory AuthContext and refuses callers that fail the manage-group ACL.
// A `Group` does not currently store its creator agentId, so the policy is:
//   * system-owner (web-UI, sudo) — always allowed
//   * MANAGER — always allowed (consistent with team governance)
//   * any subscribed agent — allowed for the group(s) they belong to
//   * everyone else — denied
// When a creator field is added to the Group type, tighten the rule to
// "creator OR system-owner" for delete/update.
function checkGroupMutationAuth(
  authContext: AuthContext | undefined,
  group: Group | null
): { allowed: true } | { allowed: false; reason: string; status: number } {
  if (!authContext) {
    return { allowed: false, reason: 'Auth context required for group mutation', status: 401 }
  }
  if (authContext.isSystemOwner) {
    return { allowed: true }
  }
  if (!authContext.agentId) {
    return { allowed: false, reason: 'Agent identity required to mutate group', status: 401 }
  }
  if (isManager(authContext.agentId)) return { allowed: true }
  if (group && group.subscriberIds?.includes(authContext.agentId)) {
    return { allowed: true }
  }
  return { allowed: false, reason: 'Only MANAGER, system owner, or a current subscriber can mutate this group', status: 403 }
}

// TRDD-V2BLADSF — the subscriber LIST is a broadcast delivery address, so naming
// who receives it is the same privilege as subscribing them. `subscribeAgent`
// already enforces self-only for a single add (see its docstring: "No agent can
// silently subscribe other agents to broadcasts"), but `createNewGroup` and
// `updateGroupById` wrote the whole list verbatim. An agent could therefore PUT
// every agent on the host into a group it had joined, and then broadcast to all
// of them — `notifyGroupSubscribers` accepts any current subscriber, and the
// payload is typed into a live tmux pane with Enter. This helper is the single
// predicate both writers call, lifted from subscribeAgent rather than invented,
// so the two doors cannot drift apart again.
//
// Rule: self-only for a plain agent; unrestricted for MANAGER and the system
// owner (the operator UI genuinely needs multi-subscriber creation).
function checkSubscriberListAuth(
  subscriberIds: string[] | undefined,
  authContext: AuthContext | undefined
): { allowed: true } | { allowed: false; reason: string; status: number } {
  if (!subscriberIds || subscriberIds.length === 0) {
    return { allowed: true }
  }
  if (!authContext) {
    return { allowed: false, reason: 'Auth context required to set group subscribers', status: 401 }
  }
  if (authContext.isSystemOwner) {
    return { allowed: true }
  }
  if (!authContext.agentId) {
    return { allowed: false, reason: 'Agent identity required to set group subscribers', status: 401 }
  }
  // Static import, matching services/teams-service.ts: there is no cycle back
  // from governance.ts to this module (it reads team-registry and agent-registry
  // only). The lazy `require('@/lib/governance')` idiom used a bare `@` specifier
  // that vitest does not resolve, so a guard written that way is unreachable in
  // tests — the check must run on the path the tests drive.
  if (isManager(authContext.agentId)) return { allowed: true }

  const foreign = subscriberIds.filter(id => id !== authContext.agentId)
  if (foreign.length > 0) {
    return {
      allowed: false,
      reason:
        'Agents may only name themselves as group subscribers; MANAGER may name others' +
        ` (foreign subscriber id${foreign.length === 1 ? '' : 's'}: ${foreign.join(', ')})`,
      status: 403,
    }
  }
  return { allowed: true }
}

// Notification rate limit: SVC2-MAJ-08 (2026-05-06).
// In-memory token-bucket: 10 broadcasts per minute per sender. Bursting is
// fine within the bucket; sustained spam is rejected with 429. Module-level
// state is intentional — same lifetime as the headless server process.
const GROUP_NOTIFY_LIMIT_PER_MIN = 10
const GROUP_NOTIFY_WINDOW_MS = 60_000
const groupNotifyBuckets = new Map<string, number[]>()

function checkNotifyRateLimit(senderKey: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now()
  const window = groupNotifyBuckets.get(senderKey) || []
  const fresh = window.filter(ts => now - ts < GROUP_NOTIFY_WINDOW_MS)
  if (fresh.length >= GROUP_NOTIFY_LIMIT_PER_MIN) {
    const oldest = fresh[0]
    return { allowed: false, retryAfterMs: GROUP_NOTIFY_WINDOW_MS - (now - oldest) }
  }
  fresh.push(now)
  groupNotifyBuckets.set(senderKey, fresh)
  return { allowed: true }
}

// ===========================================================================
// PUBLIC API -- called by API routes
// ===========================================================================

/**
 * List all groups.
 */
export function listAllGroups(): ServiceResult<{ groups: Group[] }> {
  try {
    const groups = loadGroups()
    return { data: { groups }, status: 200 }
  } catch (err) {
    if (err instanceof GroupValidationException) {
      return { error: err.message, status: err.code }
    }
    console.error('Failed to load groups:', err)
    return { error: err instanceof Error ? err.message : 'Failed to load groups', status: 500 }
  }
}

/**
 * Create a new group.
 *
 * SVC2-MAJ-07 fix (2026-05-06): authContext is mandatory. Any authenticated
 * caller (system-owner OR a real agent) may create a group — there is no
 * governance gate on creation, only on mutation/delete (handled separately).
 *
 * TRDD-V2BLADSF: creation is still governance-free, but the subscriber LIST is
 * gated by checkSubscriberListAuth — a plain agent may create a group naming
 * only itself; MANAGER and the system owner may name anyone.
 */
export async function createNewGroup(
  params: {
    name: string
    description?: string
    subscriberIds?: string[]
  },
  authContext?: AuthContext
): Promise<ServiceResult<{ group: Group }>> {
  const { name, description, subscriberIds } = params

  if (!authContext) {
    return { error: 'Auth context required for createNewGroup', status: 401 }
  }
  if (!authContext.isSystemOwner && !authContext.agentId) {
    return { error: 'Agent identity required to create a group', status: 401 }
  }

  if (!name || typeof name !== 'string') {
    return { error: 'Group name is required', status: 400 }
  }

  if (subscriberIds && !Array.isArray(subscriberIds)) {
    return { error: 'subscriberIds must be an array', status: 400 }
  }

  // TRDD-V2BLADSF — creation is governance-free, but NAMING THE SUBSCRIBERS is
  // not: the list decides who a later broadcast reaches. Same predicate
  // subscribeAgent applies to a single add.
  const listAcl = checkSubscriberListAuth(subscriberIds, authContext)
  if (!listAcl.allowed) return { error: listAcl.reason, status: listAcl.status }

  try {
    const group = await createGroup({ name, description, subscriberIds })
    return { data: { group }, status: 201 }
  } catch (err) {
    if (err instanceof GroupValidationException) {
      return { error: err.message, status: err.code }
    }
    throw err
  }
}

/**
 * Get a group by ID.
 */
export function getGroupById(id: string): ServiceResult<{ group: Group }> {
  try {
    const group = getGroup(id)
    if (!group) {
      return { error: 'Group not found', status: 404 }
    }
    return { data: { group }, status: 200 }
  } catch (err) {
    if (err instanceof GroupValidationException) {
      return { error: err.message, status: err.code }
    }
    console.error('Failed to get group:', err)
    return { error: err instanceof Error ? err.message : 'Failed to get group', status: 500 }
  }
}

/**
 * Update a group by ID.
 *
 * SVC2-MAJ-07 fix (2026-05-06): authContext is mandatory. Only system-owner,
 * MANAGER, or an existing subscriber may update.
 *
 * TRDD-V2BLADSF: `subscriberIds` in the update is additionally gated by
 * checkSubscriberListAuth, so a subscriber cannot widen the group's delivery
 * list to agents it does not own.
 */
export async function updateGroupById(
  id: string,
  updates: {
    name?: string
    description?: string
    subscriberIds?: string[]
    lastMeetingAt?: string
  },
  authContext?: AuthContext
): Promise<ServiceResult<{ group: Group }>> {
  const existing = getGroup(id)
  const acl = checkGroupMutationAuth(authContext, existing)
  if (!acl.allowed) return { error: acl.reason, status: acl.status }
  if (!existing) {
    return { error: 'Group not found', status: 404 }
  }

  // TRDD-V2BLADSF — the second door. checkGroupMutationAuth admits any CURRENT
  // subscriber, so without this an agent that legitimately joined a group could
  // then PUT every other agent into it (the same delivery list, written a
  // different way). Same helper as createNewGroup, so the two cannot drift.
  const listAcl = checkSubscriberListAuth(updates.subscriberIds, authContext)
  if (!listAcl.allowed) return { error: listAcl.reason, status: listAcl.status }

  try {
    const group = await updateGroup(id, updates)
    if (!group) {
      return { error: 'Group not found', status: 404 }
    }
    return { data: { group }, status: 200 }
  } catch (err) {
    if (err instanceof GroupValidationException) {
      return { error: err.message, status: err.code }
    }
    throw err
  }
}

/**
 * Delete a group by ID.
 *
 * SVC2-MAJ-07 fix (2026-05-06): authContext is mandatory. Only system-owner,
 * MANAGER, or an existing subscriber may delete.
 */
export async function deleteGroupById(
  id: string,
  authContext?: AuthContext
): Promise<ServiceResult<{ deleted: true }>> {
  const existing = getGroup(id)
  const acl = checkGroupMutationAuth(authContext, existing)
  if (!acl.allowed) return { error: acl.reason, status: acl.status }
  if (!existing) {
    return { error: 'Group not found', status: 404 }
  }
  const deleted = await deleteGroup(id)
  if (!deleted) {
    return { error: 'Group not found', status: 404 }
  }
  return { data: { deleted: true }, status: 200 }
}

/**
 * Subscribe an agent to a group.
 * Idempotent — adding an already-subscribed agent is a no-op.
 *
 * Uses addSubscriber() which does read+check+write inside a single file lock
 * to avoid TOCTOU races on concurrent subscribe requests.
 *
 * SVC2-MAJ-07 fix (2026-05-06): authContext is mandatory. An agent can
 * subscribe ITSELF to a group; system-owner / MANAGER can subscribe any
 * agent. No agent can silently subscribe other agents to broadcasts.
 */
export async function subscribeAgent(
  groupId: string,
  agentId: string,
  authContext?: AuthContext
): Promise<ServiceResult<{ group: Group }>> {
  if (!agentId || typeof agentId !== 'string') {
    return { error: 'agentId is required', status: 400 }
  }
  if (!authContext) {
    return { error: 'Auth context required for subscribeAgent', status: 401 }
  }
  if (!authContext.isSystemOwner) {
    if (!authContext.agentId) {
      return { error: 'Agent identity required to subscribe', status: 401 }
    }
    if (!isManager(authContext.agentId) && authContext.agentId !== agentId) {
      return { error: 'Agents may only subscribe themselves; MANAGER may subscribe others', status: 403 }
    }
  }

  try {
    const group = await addSubscriber(groupId, agentId)
    if (!group) {
      return { error: 'Group not found', status: 404 }
    }
    return { data: { group }, status: 200 }
  } catch (err) {
    if (err instanceof GroupValidationException) {
      return { error: err.message, status: err.code }
    }
    throw err
  }
}

/**
 * Unsubscribe an agent from a group.
 * Idempotent — removing a non-subscribed agent is a no-op.
 *
 * Uses removeSubscriber() which does read+check+write inside a single file lock
 * to avoid TOCTOU races on concurrent unsubscribe requests.
 *
 * SVC2-MAJ-07 fix (2026-05-06): authContext is mandatory. Same rules as
 * subscribeAgent — self-unsubscribe is always allowed; cross-agent
 * unsubscribe requires MANAGER or system-owner.
 */
export async function unsubscribeAgent(
  groupId: string,
  agentId: string,
  authContext?: AuthContext
): Promise<ServiceResult<{ group: Group }>> {
  if (!agentId || typeof agentId !== 'string') {
    return { error: 'agentId is required', status: 400 }
  }
  if (!authContext) {
    return { error: 'Auth context required for unsubscribeAgent', status: 401 }
  }
  if (!authContext.isSystemOwner) {
    if (!authContext.agentId) {
      return { error: 'Agent identity required to unsubscribe', status: 401 }
    }
    if (!isManager(authContext.agentId) && authContext.agentId !== agentId) {
      return { error: 'Agents may only unsubscribe themselves; MANAGER may unsubscribe others', status: 403 }
    }
  }

  try {
    const group = await removeSubscriber(groupId, agentId)
    if (!group) {
      return { error: 'Group not found', status: 404 }
    }
    return { data: { group }, status: 200 }
  } catch (err) {
    if (err instanceof GroupValidationException) {
      return { error: err.message, status: err.code }
    }
    throw err
  }
}

// ===========================================================================
// Notifications
// ===========================================================================

/** Result for each subscriber notification attempt */
export interface GroupNotifyResult {
  agentId: string
  agentName?: string
  success: boolean
  notified?: boolean  // True if notification was actually delivered (from NotificationResult spread)
  reason?: string
  error?: string
}

/**
 * Notify all subscribers of a group (e.g., when a meeting starts).
 * Same pattern as notifyTeamAgents in teams-service.ts but uses group data.
 *
 * SVC2-MAJ-08 fix (2026-05-06): authContext + per-sender rate limit. Without
 * these gates, any caller passing the structural credential gate could push
 * arbitrary text to every subscribed agent's tmux pane via the official
 * notification surface, with subscriber lists also attacker-controllable
 * (SVC2-MAJ-07). The mutation-auth check restricts the caller set; the
 * 10/min rate limit caps amplification.
 *
 * TRDD-V2BLADSF: the broadcast is attributed to the REAL sender (the system owner
 * keeps "AI Maestro"); it used to be unconditionally "AI Maestro", which made an
 * agent-initiated broadcast indistinguishable from an operator one at the target.
 */
export async function notifyGroupSubscribers(
  groupId: string,
  message: string,
  priority?: string,
  authContext?: AuthContext
): Promise<ServiceResult<{ results: GroupNotifyResult[] }>> {
  const group = getGroup(groupId)
  const acl = checkGroupMutationAuth(authContext, group)
  if (!acl.allowed) return { error: acl.reason, status: acl.status }
  if (!group) {
    return { error: 'Group not found', status: 404 }
  }

  // Per-sender rate limit. System-owner shares a single bucket; agents are
  // bucketed per-agentId. This caps amplification regardless of how many
  // subscribers a group has.
  const senderKey = authContext?.isSystemOwner ? 'system-owner' : (authContext?.agentId || 'unknown')
  const rl = checkNotifyRateLimit(senderKey)
  if (!rl.allowed) {
    const retryAfterSec = Math.ceil((rl.retryAfterMs || GROUP_NOTIFY_WINDOW_MS) / 1000)
    return { error: `Notify rate limit exceeded — retry in ${retryAfterSec}s`, status: 429 }
  }

  if (!group.subscriberIds || group.subscriberIds.length === 0) {
    return { data: { results: [] }, status: 200 }
  }

  // Strip control characters to prevent command injection via tmux send-keys
  const safeGroupName = (group.name || '').replace(/[\x00-\x1F\x7F]/g, '')
  const safeMessage = (message || '').replace(/[\x00-\x1F\x7F]/g, '')

  // TRDD-V2BLADSF — attribute the broadcast to the REAL sender. This used to be
  // the hardcoded string "AI Maestro", so an agent-initiated broadcast reached
  // the target looking exactly like an operator message: the target saw
  // `From: AI Maestro - <attacker prose>` and had no way to tell the two apart.
  // A system identity on attacker-controlled text is its own defect. The system
  // owner (operator UI) is the only caller that IS "AI Maestro", so it keeps the
  // name; an agent caller is named by its own registry name.
  const senderAgent = authContext?.agentId ? getAgent(authContext.agentId) : null
  const fromName = authContext?.isSystemOwner
    ? 'AI Maestro'
    : (senderAgent?.name || authContext?.agentId || 'unknown agent')

  // SVC2-MIN-10: per-call nonce so concurrent notify calls firing within
  // the same millisecond don't share a `messageId`. Downstream notification
  // dedup keys off this id; collisions silently drop the second notify.
  // 9-char base36 random suffix gives ~ 1.0e14 distinct values per ms which
  // is ample for any realistic concurrency level.
  const nonce = Math.random().toString(36).slice(2, 11)

  try {
    const results = await Promise.all(
      group.subscriberIds.map(async (agentId: string, idx: number) => {
        const agent = getAgent(agentId)
        if (!agent) {
          return { agentId, success: false, reason: 'Agent not found' }
        }

        const agentName = agent.name || 'unknown'
        try {
          const result = await notifyAgent({
            agentId: agent.id,
            agentName,
            agentHost: agent.hostId,
            fromName,
            subject: safeMessage || `Group "${safeGroupName}" notification`,
            // SVC2-MIN-10: messageId now includes per-call nonce + per-recipient
            // index, eliminating Date.now()-collisions across concurrent calls
            // and across the fan-out within a single call.
            messageId: `group-notify-${Date.now()}-${nonce}-${idx}`,
            messageType: 'notification',
            priority: priority || 'normal',
          })
          return { agentId, agentName, ...result }
        } catch (error) {
          return { agentId, agentName, success: false, error: String(error) }
        }
      })
    )

    return { data: { results }, status: 200 }
  } catch (error) {
    console.error('Failed to notify group subscribers:', error)
    return { error: error instanceof Error ? error.message : 'Failed to notify group', status: 500 }
  }
}
