import { NextRequest, NextResponse } from 'next/server'
import { enforceSystemOwner } from '@/lib/route-auth'
import { rm, mkdir } from 'fs/promises'
import { existsSync } from 'fs'
import { join } from 'path'
import { conversationSlug } from '@/lib/claude-conversation'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)

export const dynamic = 'force-dynamic'

const SESSION_NAME = '_aim-creation-helper'

/**
 * POST /api/agents/creation-helper/cleanup
 * Wipes Haephestos session state so each launch starts fresh:
 * - Kills existing tmux session (so createSession can start a new one)
 * - ~/agents/haephestos/ (working dir — draft TOML, uploads, all session files)
 * - ~/.claude/projects/-Users-...-agents-haephestos/ (Claude conversation cache)
 */
export async function POST(request: NextRequest) {
  // #114: Authenticate before any side effect.
  // TRDD-DQVPODKW: SYSTEM-OWNER only. This is a wizard-only surface — the Haephestos creation
  // wizard is a human dashboard flow, and a per-route caller census (2026-09-04) found this route
  // called from `components/` and NOT by the persona, whose shipped instructions
  // (agents/haephestos-creation-helper.md) curl only element-descriptions and publish-plugin.
  // Authenticating and stopping there let any agent of any title drive the owner's wizard — wipe
  // its working directory, kill its session, reset its banner, browse its filesystem.
  // A browser cookie session resolves to the system owner, so the UI is unaffected.
  const authErr = enforceSystemOwner(request)
  if (authErr) return authErr

  const home = process.env.HOME
  if (!home) {
    return NextResponse.json({ cleaned: false, reason: 'HOME not set' })
  }

  const workDir = join(home, 'agents', 'haephestos')
  // Claude stores per-project state using absolute path with / replaced by -
  // e.g. /Users/foo/agents/haephestos -> -Users-foo-agents-haephestos
  const claudeCacheDir = join(home, '.claude', 'projects', conversationSlug(workDir))

  const cleaned: string[] = []

  // Kill stale tmux session so createSession can start fresh
  try {
    await execFileAsync('tmux', ['kill-session', '-t', SESSION_NAME])
    cleaned.push(`tmux:${SESSION_NAME}`)
  } catch {
    // Session didn't exist — that's fine
  }

  // Wipe working directory (contains draft TOML, uploads, and conversation context)
  if (existsSync(workDir)) {
    // existsSync guard ensures the path exists; any error here is real (permissions, I/O) and must propagate
    await rm(workDir, { recursive: true })
    cleaned.push('~/agents/haephestos/')
  }
  // recursive: true already handles the case where workDir already exists; real errors must propagate
  await mkdir(workDir, { recursive: true })

  // Wipe Claude's conversation cache for this project path
  if (existsSync(claudeCacheDir)) {
    // existsSync guard ensures the path exists; any error here is real (permissions, I/O) and must propagate
    await rm(claudeCacheDir, { recursive: true })
    cleaned.push(`.claude/projects/${conversationSlug(workDir)}/`)
  }

  return NextResponse.json({ cleaned: true, files: cleaned })
}
