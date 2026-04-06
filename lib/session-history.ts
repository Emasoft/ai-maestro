/**
 * Session-Agent Pairing History
 *
 * Persistent record mapping tmux session names to the agents that owned them.
 * Survives agent deletion — so orphan tmux sessions can display the original
 * agent name instead of a raw session ID.
 *
 * File: ~/.aimaestro/session-history.json
 * Append-only: entries are added when sessions are created or linked.
 * Never deleted: the history is permanent.
 */

import { join } from 'path'
import { homedir } from 'os'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs'

const HISTORY_PATH = join(homedir(), '.aimaestro', 'session-history.json')

export interface SessionHistoryEntry {
  agentId: string
  agentName: string
  agentLabel?: string
  program?: string              // AI client: claude, codex, gemini, etc.
  programArgs?: string          // CLI arguments (e.g. --dangerously-skip-permissions)
  workingDirectory?: string     // Agent's working directory at session creation time
  governanceTitle?: string      // MANAGER, MEMBER, CHIEF-OF-STAFF, etc.
  teamId?: string               // Team ID (may no longer exist)
  teamName?: string             // Team name (for display even if team deleted)
  rolePlugin?: string           // Role-plugin name (e.g. ai-maestro-programmer-agent)
  createdAt: string
  lastSeen: string
}

interface SessionHistoryFile {
  /** Map of tmux session name → agent info */
  sessions: Record<string, SessionHistoryEntry>
}

function loadHistory(): SessionHistoryFile {
  try {
    if (existsSync(HISTORY_PATH)) {
      return JSON.parse(readFileSync(HISTORY_PATH, 'utf-8'))
    }
  } catch {
    // Corrupted file — start fresh
  }
  return { sessions: {} }
}

function saveHistory(history: SessionHistoryFile): void {
  const dir = join(homedir(), '.aimaestro')
  mkdirSync(dir, { recursive: true })
  writeFileSync(HISTORY_PATH, JSON.stringify(history, null, 2) + '\n', 'utf-8')
}

/**
 * Record a session-agent pairing. Called when a session is created or linked.
 */
export function recordSessionPairing(
  tmuxSessionName: string,
  agentId: string,
  agentName: string,
  opts?: {
    agentLabel?: string
    program?: string
    programArgs?: string
    workingDirectory?: string
    governanceTitle?: string
    teamId?: string
    teamName?: string
    rolePlugin?: string
  },
): void {
  const history = loadHistory()
  history.sessions[tmuxSessionName] = {
    agentId,
    agentName,
    agentLabel: opts?.agentLabel,
    program: opts?.program,
    programArgs: opts?.programArgs,
    workingDirectory: opts?.workingDirectory,
    governanceTitle: opts?.governanceTitle,
    teamId: opts?.teamId,
    teamName: opts?.teamName,
    rolePlugin: opts?.rolePlugin,
    createdAt: history.sessions[tmuxSessionName]?.createdAt || new Date().toISOString(),
    lastSeen: new Date().toISOString(),
  }
  saveHistory(history)
}

/**
 * Look up the agent that owned a tmux session.
 * Returns the history entry or null if unknown.
 */
export function lookupSessionAgent(tmuxSessionName: string): SessionHistoryEntry | null {
  const history = loadHistory()
  return history.sessions[tmuxSessionName] || null
}

/**
 * Look up multiple sessions at once (batch, avoids repeated file reads).
 */
export function lookupSessionAgents(tmuxSessionNames: string[]): Record<string, SessionHistoryEntry> {
  const history = loadHistory()
  const result: Record<string, SessionHistoryEntry> = {}
  for (const name of tmuxSessionNames) {
    if (history.sessions[name]) {
      result[name] = history.sessions[name]
    }
  }
  return result
}
