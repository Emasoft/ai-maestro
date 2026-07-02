/**
 * Governance Peers - Cache of governance state from peer hosts in the AMP mesh
 *
 * Each peer host's governance state is stored at ~/.aimaestro/governance-peers/{hostId}.json
 * All reads/writes are synchronous, matching the pattern in lib/governance.ts.
 * No HTTP calls -- this module is purely file-based cache management.
 */

import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, unlinkSync, renameSync } from 'fs'
import path from 'path'
import type { GovernancePeerState, PeerTeamSummary } from '@/types/governance'
import { isManager, getManagerId } from '@/lib/governance'
import { loadTeams } from '@/lib/team-registry'
// SF-024: File lock for serializing peer governance writes per host
import { withLock } from '@/lib/file-lock'
import { statePath } from '@/lib/ecosystem-constants'

const PEERS_DIR = statePath('governance-peers')

// Peer state older than DEFAULT_TTL seconds is considered stale and filtered out
const DEFAULT_TTL = 300 // 5 minutes

/** Ensure the governance-peers directory exists on disk */
function ensurePeersDir(): void {
  if (!existsSync(PEERS_DIR)) {
    mkdirSync(PEERS_DIR, { recursive: true })
  }
}

/** Reject hostIds that contain path separators or '..' to prevent path traversal attacks */
function validateHostId(hostId: string): void {
  if (!hostId || /[\/\\]|\.\./.test(hostId)) {
    throw new Error(`Invalid hostId: contains path traversal characters: ${hostId}`)
  }
}

/**
 * Load peer governance state for a specific host.
 * Returns null if the file is missing or contains invalid JSON.
 */
export function loadPeerGovernance(hostId: string): GovernancePeerState | null {
  validateHostId(hostId)
  ensurePeersDir()
  const filePath = path.join(PEERS_DIR, `${hostId}.json`)
  if (!existsSync(filePath)) {
    return null
  }
  try {
    const data = readFileSync(filePath, 'utf-8')
    const parsed: GovernancePeerState = JSON.parse(data)
    return parsed
  } catch {
    // Corrupt or unreadable file -- treat as absent
    return null
  }
}

/**
 * Save peer governance state for a specific host.
 * Overwrites any existing state for that hostId.
 */
// SF-024: Serialize writes per host to prevent concurrent file corruption
export async function savePeerGovernance(hostId: string, state: GovernancePeerState): Promise<void> {
  validateHostId(hostId)
  return withLock(`governance-peers-${hostId}`, () => {
    ensurePeersDir()
    const filePath = path.join(PEERS_DIR, `${hostId}.json`)
    // Atomic write: write to temp file then rename to avoid corruption on crash (CC-005 fix)
    // SF-040: Include process.pid for multi-process safety
    const tmpFile = `${filePath}.tmp.${process.pid}`
    writeFileSync(tmpFile, JSON.stringify(state, null, 2), 'utf-8')
    renameSync(tmpFile, filePath)
  })
}

/**
 * Delete peer governance state for a specific host.
 * No-op if the file does not exist.
 * SF-032: Protected by file lock to prevent races with concurrent savePeerGovernance.
 */
export async function deletePeerGovernance(hostId: string): Promise<void> {
  validateHostId(hostId)
  return withLock(`governance-peers-${hostId}`, () => {
    const filePath = path.join(PEERS_DIR, `${hostId}.json`)
    if (existsSync(filePath)) {
      unlinkSync(filePath)
    }
  })
}

/**
 * Load all peer governance states, filtering out entries whose TTL has expired.
 * Expiry check: (Date.now() - Date.parse(state.lastSyncAt)) > state.ttl * 1000
 */
export function getAllPeerGovernance(): GovernancePeerState[] {
  ensurePeersDir()

  let files: string[]
  try {
    files = readdirSync(PEERS_DIR).filter(f => f.endsWith('.json'))
  } catch {
    return []
  }

  const now = Date.now()
  const results: GovernancePeerState[] = []

  for (const file of files) {
    try {
      const data = readFileSync(path.join(PEERS_DIR, file), 'utf-8')
      const raw = JSON.parse(data) as Partial<GovernancePeerState>

      // SECURITY: peer governance state is a CACHE of data that ORIGINATED on a
      // remote host (handleGovernanceSyncMessage → savePeerGovernance), and the
      // on-disk file can also be corrupt or hand-edited. The write path checks
      // that `teams` is an array but does NOT validate the individual entries, so
      // a peer could persist `teams: [null, 42]`. The downstream consumers of
      // this function (isChiefOfStaffOnAnyHost, getTeamFromAnyHost,
      // getPeerTeamsForAgent) all read `state.teams[i].chiefOfStaffId` /
      // `.agentIds` OUTSIDE any try/catch — a malformed entry there would throw
      // and break a governance query for ALL peers. Normalize here, fail-closed:
      // skip a state object that isn't an object, and drop any team entry that
      // isn't a well-formed object. A bad peer can only ever shrink its own
      // advertised teams, never crash the query or inject a half-formed team.
      if (!raw || typeof raw !== 'object') {
        continue
      }
      // Require agentIds to be an array: getPeerTeamsForAgent() calls
      // team.agentIds.includes(...), which throws if agentIds is undefined on a
      // malformed entry. Normalizing it to [] here keeps that consumer safe
      // without it having to re-validate. id/chiefOfStaffId accesses are
      // null-safe on an object, so only agentIds needs the stricter guard.
      const teams = (Array.isArray(raw.teams) ? raw.teams : [])
        .filter((t): t is PeerTeamSummary => !!t && typeof t === 'object')
        .map((t) => ({ ...t, agentIds: Array.isArray(t.agentIds) ? t.agentIds : [] }))
      const state: GovernancePeerState = {
        hostId: typeof raw.hostId === 'string' ? raw.hostId : file.replace(/\.json$/, ''),
        managerId: typeof raw.managerId === 'string' ? raw.managerId : null,
        managerName: typeof raw.managerName === 'string' ? raw.managerName : null,
        teams,
        lastSyncAt: typeof raw.lastSyncAt === 'string' ? raw.lastSyncAt : '',
        ttl: typeof raw.ttl === 'number' ? raw.ttl : DEFAULT_TTL,
      }

      // Use state.ttl if present, otherwise fall back to DEFAULT_TTL
      const ttlMs = (state.ttl ?? DEFAULT_TTL) * 1000
      const syncedAt = Date.parse(state.lastSyncAt)

      // Skip entries with unparseable timestamps or that have expired
      if (isNaN(syncedAt) || (now - syncedAt) > ttlMs) {
        continue
      }

      results.push(state)
    } catch (err: unknown) {
      // TOCTOU: file deleted between readdirSync and readFileSync — skip gracefully
      if (err instanceof Error && 'code' in err && (err as NodeJS.ErrnoException).code === 'ENOENT') {
        continue
      }
      // Corrupt JSON or other read errors — skip but log for diagnostics
      console.warn(`[governance-peers] Skipping unreadable peer file ${file}:`, err instanceof Error ? err.message : err)
      continue
    }
  }

  return results
}

/**
 * Check if agentId holds the MANAGER role on ANY host (local or any known peer).
 * Checks local governance first, then iterates over all non-expired peer states.
 */
export function isManagerOnAnyHost(agentId: string): boolean {
  if (!agentId) return false

  // Check local host first (fast path)
  if (isManager(agentId)) return true

  // Check all non-expired peer states
  const peers = getAllPeerGovernance()
  return peers.some(state => state.managerId === agentId)
}

/**
 * Check if agentId is Chief-of-Staff on ANY host (local or any known peer).
 * Checks local teams first, then iterates over all non-expired peer states.
 */
export function isChiefOfStaffOnAnyHost(agentId: string): boolean {
  if (!agentId) return false

  // All teams are closed after governance simplification — no type filter needed
  const localTeams = loadTeams()
  if (localTeams.some(t => t.chiefOfStaffId === agentId)) {
    return true
  }

  // Check peer teams — all teams are closed, no type filter needed
  const peers = getAllPeerGovernance()
  return peers.some(p => p.teams.some(t => t.chiefOfStaffId === agentId))
}

/**
 * Find a team by ID across local and peer hosts.
 * Checks local teams first (returns hostId = 'local'), then peers.
 * Returns the team summary and the hostId it was found on, or null.
 */
export function getTeamFromAnyHost(teamId: string): { team: PeerTeamSummary; hostId: string } | null {
  // Check local teams first
  const localTeams = loadTeams()
  const localMatch = localTeams.find(t => t.id === teamId)
  if (localMatch) {
    // Convert full Team to PeerTeamSummary shape
    const summary: PeerTeamSummary = {
      id: localMatch.id,
      name: localMatch.name,
      type: localMatch.type,
      chiefOfStaffId: localMatch.chiefOfStaffId ?? null,
      agentIds: localMatch.agentIds,
    }
    return { team: summary, hostId: 'local' }
  }

  // Check peer hosts
  const peers = getAllPeerGovernance()
  for (const peer of peers) {
    const peerMatch = peer.teams.find(t => t.id === teamId)
    if (peerMatch) {
      return { team: peerMatch, hostId: peer.hostId }
    }
  }

  return null
}

/**
 * Get all peer teams (non-expired) that include a given agentId as a member.
 * Returns an array of PeerTeamSummary objects augmented with the hostId they belong to.
 * Does NOT include local teams -- use loadTeams() directly for those.
 */
export function getPeerTeamsForAgent(agentId: string): Array<PeerTeamSummary & { hostId: string }> {
  if (!agentId) return []

  const peers = getAllPeerGovernance()
  const results: Array<PeerTeamSummary & { hostId: string }> = []

  for (const peer of peers) {
    for (const team of peer.teams) {
      if (team.agentIds.includes(agentId)) {
        results.push({ ...team, hostId: peer.hostId })
      }
    }
  }

  return results
}
