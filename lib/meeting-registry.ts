/**
 * Meeting Registry - File-based CRUD for meeting persistence
 *
 * Storage: ~/.aimaestro/teams/meetings.json
 * Mirrors the pattern from lib/team-registry.ts
 */

import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { Meeting, MeetingsFile, SidebarMode } from '@/types/team'
import { withLock } from '@/lib/file-lock'
import { getStateDir } from '@/lib/ecosystem-constants'

const AIMAESTRO_DIR = getStateDir()
const TEAMS_DIR = path.join(AIMAESTRO_DIR, 'teams')
const MEETINGS_FILE = path.join(TEAMS_DIR, 'meetings.json')

const PRUNE_DAYS = 7

function ensureTeamsDir() {
  if (!fs.existsSync(TEAMS_DIR)) {
    fs.mkdirSync(TEAMS_DIR, { recursive: true })
  }
}

function pruneOldEnded(meetings: Meeting[]): Meeting[] {
  const cutoff = Date.now() - PRUNE_DAYS * 24 * 60 * 60 * 1000
  return meetings.filter(m => {
    if (m.status !== 'ended' || !m.endedAt) return true
    return new Date(m.endedAt).getTime() > cutoff
  })
}

/**
 * Load meetings from disk. Does NOT auto-prune to avoid TOCTOU races —
 * pruning writes back to disk, which can race with concurrent mutations
 * (createMeeting / updateMeeting / deleteMeeting) that already hold the lock.
 * Pruning is done inside saveMeetings() instead, so it happens atomically
 * with every write under the lock.
 */
export function loadMeetings(): Meeting[] | null {
  try {
    ensureTeamsDir()
    if (!fs.existsSync(MEETINGS_FILE)) {
      return []
    }
    const data = fs.readFileSync(MEETINGS_FILE, 'utf-8')
    const parsed: MeetingsFile = JSON.parse(data)
    return Array.isArray(parsed.meetings) ? parsed.meetings : []
  } catch (error) {
    // Return null on read/parse errors so callers can distinguish "no file"
    // (empty array) from "corrupt/unreadable file" (null) and avoid
    // overwriting the file with an empty array — which would cause data loss.
    console.error('Failed to load meetings:', error)
    return null
  }
}

export function saveMeetings(meetings: Meeting[]): boolean {
  try {
    ensureTeamsDir()
    // Prune old ended meetings on every save (under the caller's lock)
    // so we never need a separate write from loadMeetings().
    const pruned = pruneOldEnded(meetings)
    const file: MeetingsFile = { version: 1, meetings: pruned }
    // Atomic write: write to tmp then rename to avoid partial reads
    const tmpPath = MEETINGS_FILE + '.tmp.' + process.pid
    fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2), 'utf-8')
    fs.renameSync(tmpPath, MEETINGS_FILE)
    return true
  } catch (error) {
    console.error('Failed to save meetings:', error)
    return false
  }
}

export function getMeeting(id: string): Meeting | null {
  const meetings = loadMeetings()
  if (!meetings) return null
  return meetings.find(m => m.id === id) || null
}

export async function createMeeting(data: {
  name: string
  agentIds: string[]
  teamId: string | null
  groupId?: string | null  // Link to group when meeting started from a group
  sidebarMode?: SidebarMode
}): Promise<Meeting> {
  return withLock('meetings', () => {
  const meetings = loadMeetings()
  if (!meetings) {
    throw new Error('Failed to load meetings file — refusing to create meeting to avoid data loss')
  }
  const now = new Date().toISOString()

  const meeting: Meeting = {
    id: uuidv4(),
    teamId: data.teamId,
    // Persist groupId on the meeting record so restored meetings know their origin
    ...(data.groupId ? { groupId: data.groupId } : {}),
    name: data.name,
    agentIds: data.agentIds,
    status: 'active',
    activeAgentId: data.agentIds[0] || null,
    sidebarMode: data.sidebarMode || 'grid',
    startedAt: now,
    lastActiveAt: now,
  }

  meetings.push(meeting)
  if (!saveMeetings(meetings)) {
    throw new Error('Failed to save meetings file')
  }
  return meeting
  }) // end withLock('meetings')
}

export async function updateMeeting(
  id: string,
  updates: Partial<Pick<Meeting, 'name' | 'agentIds' | 'status' | 'activeAgentId' | 'sidebarMode' | 'lastActiveAt' | 'endedAt' | 'teamId'>>
): Promise<Meeting | null> {
  return withLock('meetings', () => {
  const meetings = loadMeetings()
  if (!meetings) {
    throw new Error('Failed to load meetings file — refusing to update meeting to avoid data loss')
  }
  const index = meetings.findIndex(m => m.id === id)
  if (index === -1) return null

  // Strip undefined values so partial PATCHes don't overwrite existing fields
  const cleanUpdates = Object.fromEntries(
    Object.entries(updates).filter(([, v]) => v !== undefined)
  )

  meetings[index] = {
    ...meetings[index],
    ...cleanUpdates,
  }

  if (!saveMeetings(meetings)) {
    throw new Error('Failed to save meetings file')
  }
  return meetings[index]
  }) // end withLock('meetings')
}

export async function deleteMeeting(id: string): Promise<boolean> {
  return withLock('meetings', () => {
  const meetings = loadMeetings()
  if (!meetings) {
    throw new Error('Failed to load meetings file — refusing to delete meeting to avoid data loss')
  }
  const filtered = meetings.filter(m => m.id !== id)
  if (filtered.length === meetings.length) return false
  if (!saveMeetings(filtered)) {
    throw new Error('Failed to save meetings file')
  }
  return true
  }) // end withLock('meetings')
}
