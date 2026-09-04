import { NextRequest, NextResponse } from 'next/server'
import { enforceSystemOwner } from '@/lib/route-auth'
import { execFile } from 'child_process'
import { promisify } from 'util'

const execFileAsync = promisify(execFile)
const SESSION_NAME = '_aim-creation-helper'

/**
 * POST /api/agents/creation-helper/clear-banner
 *
 * Sends a short greeting prompt to Haephestos to push the Claude startup
 * banner off the visible viewport. The banner is part of Claude Code's TUI
 * and can only be scrolled away by generating conversation output.
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

  try {
    // Send a minimal greeting — Haephestos will respond with a short welcome,
    // which generates enough output to push the startup banner off-screen.
    await execFileAsync('tmux', [
      'send-keys', '-t', SESSION_NAME,
      'hi',
      'Enter'
    ])
    return NextResponse.json({ ok: true })
  } catch (error) {
    console.error('[Clear Banner] Failed to send greeting to Haephestos:', error)
    return NextResponse.json({ ok: false, error: 'Failed to clear banner' }, { status: 500 })
  }
}
