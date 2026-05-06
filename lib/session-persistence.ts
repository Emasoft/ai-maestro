import fs from 'fs'
import path from 'path'
import { withLock } from '@/lib/file-lock'
import { getStateDir } from '@/lib/ecosystem-constants'

export interface PersistedSession {
  id: string
  name: string
  workingDirectory: string
  createdAt: string
  lastSavedAt: string
  agentId?: string  // Link to agent (optional for backward compatibility)
}

const PERSISTENCE_DIR = getStateDir()
const SESSIONS_FILE = path.join(PERSISTENCE_DIR, 'sessions.json')

/**
 * Ensure the persistence directory exists
 */
function ensurePersistenceDir() {
  if (!fs.existsSync(PERSISTENCE_DIR)) {
    fs.mkdirSync(PERSISTENCE_DIR, { recursive: true })
  }
}

/**
 * Load persisted sessions from disk
 */
export function loadPersistedSessions(): PersistedSession[] {
  try {
    ensurePersistenceDir()

    if (!fs.existsSync(SESSIONS_FILE)) {
      return []
    }

    const data = fs.readFileSync(SESSIONS_FILE, 'utf-8')
    const sessions = JSON.parse(data)

    return Array.isArray(sessions) ? sessions : []
  } catch (error) {
    console.error('Failed to load persisted sessions:', error)
    return []
  }
}

/**
 * Save sessions to disk using atomic write (tmp + rename) to prevent
 * partial reads if the process crashes mid-write.
 */
export function savePersistedSessions(sessions: PersistedSession[]) {
  try {
    ensurePersistenceDir()

    const data = JSON.stringify(sessions, null, 2)
    const tmpPath = SESSIONS_FILE + '.tmp.' + process.pid
    fs.writeFileSync(tmpPath, data, 'utf-8')
    fs.renameSync(tmpPath, SESSIONS_FILE)

    return true
  } catch (error) {
    console.error('Failed to save persisted sessions:', error)
    return false
  }
}

/**
 * Add or update a session in persistence.
 * Serialized via withLock to prevent TOCTOU races on the read-modify-write cycle.
 */
export async function persistSession(session: Omit<PersistedSession, 'lastSavedAt'>): Promise<boolean> {
  return withLock('sessions', () => {
    const sessions = loadPersistedSessions()

    const existingIndex = sessions.findIndex(s => s.id === session.id)

    const persistedSession: PersistedSession = {
      ...session,
      lastSavedAt: new Date().toISOString()
    }

    if (existingIndex >= 0) {
      sessions[existingIndex] = persistedSession
    } else {
      sessions.push(persistedSession)
    }

    return savePersistedSessions(sessions)
  })
}

/**
 * Remove a session from persistence.
 * Serialized via withLock to prevent TOCTOU races on the read-modify-write cycle.
 *
 * SVC2-MIN-04: distinguishes "not found" from "save failed". Returns:
 * - `'ok'`     — session was present and removed successfully
 * - `'not-found'` — session was not in the persisted list (idempotent caller-friendly)
 * - `'failed'` — IO error during save
 *
 * The legacy boolean signature is preserved via `unpersistSessionLegacy`
 * for callers that don't care about the distinction.
 */
export async function unpersistSession(sessionId: string): Promise<'ok' | 'not-found' | 'failed'> {
  return withLock('sessions', () => {
    const sessions = loadPersistedSessions()
    const filtered = sessions.filter(s => s.id !== sessionId)
    if (filtered.length === sessions.length) {
      // No entry was removed — session was never persisted.
      return 'not-found'
    }
    return savePersistedSessions(filtered) ? 'ok' : 'failed'
  })
}

/**
 * Clear all persisted sessions
 */
export function clearPersistedSessions() {
  try {
    if (fs.existsSync(SESSIONS_FILE)) {
      fs.unlinkSync(SESSIONS_FILE)
    }
    return true
  } catch (error) {
    console.error('Failed to clear persisted sessions:', error)
    return false
  }
}
