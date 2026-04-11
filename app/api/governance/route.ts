import { NextResponse } from 'next/server'
import { loadGovernance } from '@/lib/governance'
import { getAgent } from '@/lib/agent-registry'

export const dynamic = 'force-dynamic'

// Auth required: the global /api/* middleware gates this endpoint with the
// session cookie. This handler exposes only non-secret state (password
// presence, manager name, user name, avatar) — no tokens or hashes leaked.
// SF-029: wrapped in try/catch to prevent unhandled errors from leaking
// stack traces.
export async function GET() {
  try {
    const config = loadGovernance()
    // SF-054: Use nullish coalescing to preserve empty-string names
    const managerName = config.managerId ? getAgent(config.managerId)?.name ?? null : null
    return NextResponse.json({
      hasPassword: !!config.passwordHash,
      hasManager: !!config.managerId,
      managerId: config.managerId,
      managerName,
      userName: config.userName ?? null,
      userAvatar: config.userAvatar ?? null,
    })
  } catch (error) {
    console.error('[governance] GET error:', error)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
