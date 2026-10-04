/**
 * Server-side authority for the ASSISTANT visibility/messaging matrix
 * (R39.5/R39.7/R39.9/R39.10 — TRDD-U4KP0H92, parent TRDD-3QRUDK12).
 *
 * The comm-graph (lib/communication-graph.ts) stays pure and registry-free: it
 * decides routes only from the relational `assistantSender` block handed to it.
 * This module is the ONE production producer of that block — both send paths
 * (services/send-message-service.ts G06 and services/amp-service.ts local
 * delivery) and the visibility surface (getReachableAgents) resolve an
 * ASSISTANT's channel set HERE, from the registries, per message:
 *
 *   default  → own user + (the MANAGER only while the bound user approves the
 *              collaboration — R39.9); every other agent denied both directions.
 *   expanded → exactly the collaborators the MANAGER approved on a shared
 *              project (R39.10), each stored as an unrevoked, agent-resolvable
 *              grant in ~/.aimaestro/assistant-collaborations.json.
 *
 * Everything is recomputed from the store on every call — a grant is never
 * cached on the agent record — so a revocation (revokeCollaboration) re-closes
 * the edge on the next message with no code change and no TTL to guess.
 */

import fs from 'fs'
import path from 'path'
import { withLock } from '@/lib/file-lock'
import { statePath } from '@/lib/ecosystem-constants'

const COLLAB_FILE = statePath('assistant-collaborations.json')

/** One approved (or revoked) ASSISTANT↔collaborator edge, scoped to a project. */
export interface AssistantCollaboration {
  /** Project the collaboration is scoped to (the shared GitHub project's id). */
  projectId: string
  /** The ASSISTANT-titled agent the grant expands. */
  assistantAgentId: string
  /** The single agent the ASSISTANT becomes mutually visible with. */
  collaboratorAgentId: string
  approvedAt: string
  /** Set by revokeCollaboration — an revoked grant is dead and never re-counted. */
  revokedAt?: string
}

interface CollaborationsFile {
  version: 1
  collaborations: AssistantCollaboration[]
}

function loadCollaborationsFile(): CollaborationsFile {
  try {
    if (!fs.existsSync(COLLAB_FILE)) {
      return { version: 1, collaborations: [] }
    }
    const raw = JSON.parse(fs.readFileSync(COLLAB_FILE, 'utf-8'))
    if (!Array.isArray(raw?.collaborations)) {
      // A malformed store is an EMPTY store, never a throw: a message gate that
      // throws here would be read as graph_check_unavailable and fail closed
      // for every agent — availability sabotage by file corruption. Fail closed
      // for the ASSISTANT (no grants) while staying open for everyone else.
      return { version: 1, collaborations: [] }
    }
    return { version: 1, collaborations: raw.collaborations }
  } catch {
    return { version: 1, collaborations: [] }
  }
}

function writeCollaborationsFile(data: CollaborationsFile): void {
  const tmp = COLLAB_FILE + '.tmp.' + process.pid
  fs.mkdirSync(path.dirname(COLLAB_FILE), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
  fs.renameSync(tmp, COLLAB_FILE)
}

/** All UNREVOKED collaborator agent ids for one ASSISTANT (R39.10), deduplicated. */
export function getAssistantCollaborators(assistantAgentId: string): string[] {
  if (!assistantAgentId) return []
  const { collaborations } = loadCollaborationsFile()
  const ids = new Set<string>()
  for (const c of collaborations) {
    if (c.assistantAgentId === assistantAgentId && !c.revokedAt) {
      ids.add(c.collaboratorAgentId)
    }
  }
  return Array.from(ids)
}

/**
 * Record a MANAGER-approved collaboration (R39.10). Idempotent per
 * (project, assistant, collaborator): an existing UNREVOKED grant is returned
 * unchanged; a revoked one is re-approved by clearing revokedAt — re-approval
 * after a stop is a normal USER decision, not a new identity.
 */
export async function approveCollaboration(
  projectId: string,
  assistantAgentId: string,
  collaboratorAgentId: string,
): Promise<AssistantCollaboration> {
  if (!projectId || !assistantAgentId || !collaboratorAgentId) {
    throw new Error('approveCollaboration requires projectId, assistantAgentId and collaboratorAgentId')
  }
  return withLock('assistant-collaborations', () => {
    const data = loadCollaborationsFile()
    const now = new Date().toISOString()
    const existing = data.collaborations.find(
      c =>
        c.projectId === projectId &&
        c.assistantAgentId === assistantAgentId &&
        c.collaboratorAgentId === collaboratorAgentId,
    )
    if (existing) {
      if (!existing.revokedAt) return existing
      delete existing.revokedAt
      existing.approvedAt = now
      writeCollaborationsFile(data)
      return existing
    }
    const rec: AssistantCollaboration = {
      projectId,
      assistantAgentId,
      collaboratorAgentId,
      approvedAt: now,
    }
    data.collaborations.push(rec)
    writeCollaborationsFile(data)
    return rec
  })
}

/**
 * Revoke a collaboration (R39.10 — the USER may stop it at any time). Sets
 * revokedAt rather than deleting the row: the audit trail of when a grant was
 * opened and closed is the only record a later "who could this assistant reach"
 * question has. Unknown grant → null (idempotent; revoking nothing happened).
 */
export async function revokeCollaboration(
  projectId: string,
  assistantAgentId: string,
  collaboratorAgentId: string,
): Promise<AssistantCollaboration | null> {
  return withLock('assistant-collaborations', () => {
    const data = loadCollaborationsFile()
    const rec = data.collaborations.find(
      c =>
        c.projectId === projectId &&
        c.assistantAgentId === assistantAgentId &&
        c.collaboratorAgentId === collaboratorAgentId &&
        !c.revokedAt,
    )
    if (!rec) return null
    rec.revokedAt = new Date().toISOString()
    writeCollaborationsFile(data)
    return rec
  })
}

/**
 * The ONE production producer of the comm-graph's `assistantSender` block
 * (R39.5/R39.9/R39.10). Resolves the ASSISTANT's channel set from the
 * registries, per message — never from a cached flag:
 *
 *   recipientIsOwnUser                 → the recipient IS the bound user
 *   recipientIsManager                 → the recipient is the singleton MANAGER
 *   userPermitsManagerCollaboration    → the bound user's standing R39.9 approval
 *   recipientIsProjectCollaborator     → an unrevoked R39.10 grant names this recipient
 *
 * Returns null whenever the sender is NOT a live ASSISTANT-titled agent with a
 * bound user — the graph's fail-closed branch then denies everything, which is
 * the correct answer for a deleted assistant or a title the registry lost.
 */
export async function resolveAssistantSenderContext(
  senderAgentId: string,
  recipientAgentId: string | null,
): Promise<import('@/lib/communication-graph').AssistantSenderContext | null> {
  try {
    const { getAgent } = await import('@/lib/agent-registry')
    const sender = senderAgentId ? getAgent(senderAgentId) : null
    if (!sender || sender.deletedAt) return null
    if (String(sender.governanceTitle || '').toLowerCase() !== 'assistant') return null

    // The bound user: exactly the user whose assistantAgentId points here
    // (R39.1 — one ASSISTANT per user, lifecycle-bound R39.6).
    const { loadUsers } = await import('@/lib/user-registry')
    const boundUser = loadUsers().find(u => !u.deletedAt && u.assistantAgentId === senderAgentId)
    if (!boundUser) return null

    let recipientIsManager = false
    if (recipientAgentId) {
      try {
        const { isManager } = await import('@/lib/governance')
        recipientIsManager = isManager(recipientAgentId)
      } catch {
        recipientIsManager = false
      }
    }

    // R39.10 — the unrevoked collaborator grants for THIS assistant. Recomputed
    // per message so revokeCollaboration re-closes the edge on the next send.
    const collaboratorIds = new Set(getAssistantCollaborators(senderAgentId))
    const recipientIsProjectCollaborator =
      !!recipientAgentId && collaboratorIds.has(recipientAgentId)

    return {
      recipientIsOwnUser: false, // an agent recipient is never the human user
      recipientIsManager,
      // R39.9 standing gate: the bound USER's approval opens the MANAGER channel.
      userPermitsManagerCollaboration: boundUser.managerCollaborationApproved === true,
      recipientIsProjectCollaborator,
    }
  } catch {
    // Fail CLOSED: any registry/lookup failure resolves to "no channels", and
    // the graph denies the send — the SVC2-MAJ-19 rule for governance gates.
    return null
  }
}

/**
 * Does the recipient resolve to the ASSISTANT's bound human user? The user is
 * not an agent id, so send paths pass the recipient identifier they resolved —
 * the user's id or name. Only own-user reaches an ASSISTANT's human (R39.5);
 * every other user is refused (R38.2/R39.7).
 */
export async function isBoundUserRecipient(
  senderAgentId: string,
  recipientIdentifier: string | null | undefined,
): Promise<boolean> {
  try {
    const { loadUsers } = await import('@/lib/user-registry')
    const boundUser = loadUsers().find(u => !u.deletedAt && u.assistantAgentId === senderAgentId)
    if (!boundUser || !recipientIdentifier) return false
    const bare = recipientIdentifier.includes('@')
      ? recipientIdentifier.split('@')[0]
      : recipientIdentifier
    return bare === boundUser.id || bare === boundUser.name
  } catch {
    return false
  }
}
